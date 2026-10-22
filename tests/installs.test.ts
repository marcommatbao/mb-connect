import { beforeEach, describe, expect, it } from "vitest"
import { ADMIN_TOKEN, freshEnv, params, readAllData, req } from "./setup-env"
import { createInstall, normalizeAppUrl, rotateInstallKey, setInstallStatus, InstallError } from "@/lib/installs"
import { getInstall, mutateConnections, listConnections } from "@/lib/store"
import { encryptField } from "@/lib/crypto"
import { resetRateLimitsForTests } from "@/lib/ratelimit"
import * as installsRoute from "@/app/api/admin/installs/route"
import * as installRoute from "@/app/api/admin/installs/[id]/route"
import * as rotateRoute from "@/app/api/admin/installs/[id]/rotate-key/route"
import * as suspendRoute from "@/app/api/admin/installs/[id]/suspend/route"
import * as resumeRoute from "@/app/api/admin/installs/[id]/resume/route"
import * as revokeRoute from "@/app/api/admin/installs/[id]/revoke/route"
import * as v1Install from "@/app/api/v1/install/route"
import * as healthz from "@/app/api/healthz/route"

let dir: string
beforeEach(() => { dir = freshEnv(); resetRateLimitsForTests() })

describe("appUrl", () => {
  it.each([
    ["https://ads.example.com", "https://ads.example.com"],
    ["https://ads.example.com/", "https://ads.example.com"],
    ["https://ads.example.com:8443", "https://ads.example.com:8443"],
    ["http://localhost:3000", "http://localhost:3000"],
  ])("nhận %s", (input, out) => expect(normalizeAppUrl(input)).toBe(out))

  it.each([
    "http://ads.example.com", "https://ads.example.com/settings", "https://ads.example.com?x=1",
    "https://u:p@ads.example.com", "javascript:alert(1)", "không phải url",
  ])("từ chối %s", (input) => expect(() => normalizeAppUrl(input)).toThrow(InstallError))
})

describe("sổ bản cài", () => {
  it("lưu hash, KHÔNG BAO GIỜ lưu khoá thô (kể cả trong nhật ký)", async () => {
    const res = await installsRoute.POST(req("/api/admin/installs", { method: "POST", token: ADMIN_TOKEN, body: JSON.stringify({ name: "Khách A", appUrl: "https://a.example.com" }) }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.key).toMatch(/^mbk_/)
    expect(body.install.keyHash).toBeUndefined()
    const all = readAllData(dir)
    expect(all).toContain(body.install.id)
    expect(all).not.toContain(body.key)
    expect(all).not.toContain(body.key.split("_")[2])
  })

  it("không cho hai bản cài đang hoạt động trùng appUrl", async () => {
    await createInstall({ name: "A", appUrl: "https://a.example.com" })
    await expect(createInstall({ name: "A2", appUrl: "https://a.example.com/" })).rejects.toThrow(/đã có bản cài/)
  })

  it("xoay khoá: khoá cũ còn dùng 24h, khoá mới dùng ngay", async () => {
    const { install, key: oldKey } = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    const res = await rotateRoute.POST(req(`/x`, { method: "POST", token: ADMIN_TOKEN }), params({ id: install.id }))
    const { key: newKey } = await res.json()
    for (const k of [oldKey, newKey]) {
      expect((await v1Install.GET(req("/api/v1/install", { token: k }))).status).toBe(200)
    }
  })

  it("tạm ngưng → install_suspended; mở lại → dùng được; thu hồi → install_revoked, xoá khoá cũ, kết nối bị revoked", async () => {
    const { install, key: oldKey } = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    const { key } = await rotateInstallKey(install.id)
    await mutateConnections((c) => { c.push({ id: "c1", installId: install.id, provider: "google", status: "active", createdAt: "", createdBy: "x@a.com", scopes: [], secret: encryptField("1//rt") }) })

    const call = (token = key) => v1Install.GET(req("/api/v1/install", { token }))
    expect((await call(oldKey)).status).toBe(200) // khoá cũ còn trong hạn xoay
    await suspendRoute.POST(req("/x", { method: "POST", token: ADMIN_TOKEN }), params({ id: install.id }))
    expect((await (await call()).json()).error).toBe("install_suspended")

    await resumeRoute.POST(req("/x", { method: "POST", token: ADMIN_TOKEN }), params({ id: install.id }))
    expect((await call()).status).toBe(200)

    await revokeRoute.POST(req("/x", { method: "POST", token: ADMIN_TOKEN }), params({ id: install.id }))
    expect((await (await call()).json()).error).toBe("install_revoked")
    expect(getInstall(install.id)?.prevKeyHash).toBeUndefined()
    expect((await call(oldKey)).status).toBe(401) // thu hồi xoá luôn khoá cũ đang trong hạn xoay
    expect(listConnections().find((c) => c.id === "c1")?.status).toBe("revoked")

    // Đã thu hồi thì không mở lại, không xoay khoá.
    expect((await resumeRoute.POST(req("/x", { method: "POST", token: ADMIN_TOKEN }), params({ id: install.id }))).status).toBe(400)
    await expect(setInstallStatus(install.id, "suspend")).rejects.toThrow()
    await expect(rotateInstallKey(install.id)).rejects.toThrow(/đã thu hồi/)
  })

  it("chi tiết bản cài trả kết nối KHÔNG có secret", async () => {
    const { install } = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    await mutateConnections((c) => { c.push({ id: "c1", installId: install.id, provider: "google", status: "active", createdAt: "", createdBy: "x@a.com", scopes: ["adwords"], secret: encryptField("1//rt-raw") }) })
    const res = await installRoute.GET(req("/x", { token: ADMIN_TOKEN }), params({ id: install.id }))
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain("c1")
    expect(text).not.toContain("secret")
    expect(text).not.toContain("__enc")
  })
})

describe("xác thực bản cài", () => {
  it("khoá rác, khoá đúng dạng nhưng không tồn tại, khoá sai → cùng một 401", async () => {
    const { install } = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    const bad = [undefined, "garbage", `mbk_${install.id}_${"A".repeat(43)}`, `mbk_zzzzzzzzzzzz_${"A".repeat(43)}`]
    for (const token of bad) {
      const res = await v1Install.GET(req("/api/v1/install", { token }))
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: "unauthorized" })
    }
  })

  it("theo IP chỉ đếm lượt xác thực SAI: quá 30 lượt sai/phút → 429, kể cả với khoá đúng", async () => {
    const { key } = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    let last = 0
    for (let i = 0; i < 32; i++) last = (await v1Install.GET(req("/api/v1/install", { token: "garbage", ip: "10.9.9.9" }))).status
    expect(last).toBe(429)
    expect((await v1Install.GET(req("/api/v1/install", { token: key, ip: "10.9.9.9" }))).status).toBe(429)
    expect((await v1Install.GET(req("/api/v1/install", { token: key, ip: "10.9.9.10" }))).status).toBe(200)
  })

  it("lượt đúng giới hạn theo bản cài: A dùng hết hạn mức thì B cùng IP vẫn chạy", async () => {
    const a = await createInstall({ name: "A", appUrl: "https://a.example.com" })
    const b = await createInstall({ name: "B", appUrl: "https://b.example.com" })
    let last = 0
    for (let i = 0; i < 301; i++) last = (await v1Install.GET(req("/api/v1/install", { token: a.key, ip: "10.5.5.5" }))).status
    expect(last).toBe(429)
    expect((await v1Install.GET(req("/api/v1/install", { token: b.key, ip: "10.5.5.5" }))).status).toBe(200)
  })
})

describe("xác thực quản trị", () => {
  const list = (init: Parameters<typeof req>[1]) => installsRoute.GET(req("/api/admin/installs", init))

  it("đúng khoá + đúng IP → 200; sai khoá → 401; IP ngoài dải → 403", async () => {
    expect((await list({ token: ADMIN_TOKEN })).status).toBe(200)
    expect((await list({ token: ADMIN_TOKEN + "x" })).status).toBe(401)
    expect((await list({ token: ADMIN_TOKEN, ip: "203.0.113.5" })).status).toBe(403)
  })

  it("IPv6 bọc IPv4 trong dải → được; IPv6 trong dải → được", async () => {
    expect((await list({ token: ADMIN_TOKEN, ip: "::ffff:10.0.0.7" })).status).toBe(200)
    expect((await list({ token: ADMIN_TOKEN, ip: "2001:db8::1" })).status).toBe(200)
  })

  it("thiếu cấu hình → 503, không bao giờ mở cửa", async () => {
    process.env.GATEWAY_ADMIN_CIDRS = ""
    expect((await list({ token: ADMIN_TOKEN })).status).toBe(503)
    process.env.GATEWAY_ADMIN_CIDRS = "any"
    process.env.GATEWAY_ADMIN_TOKEN = "short"
    expect((await list({ token: "short" })).status).toBe(503)
    process.env.GATEWAY_ADMIN_TOKEN = ADMIN_TOKEN
    process.env.GATEWAY_ADMIN_CIDRS = "không-phải-ip"
    expect((await list({ token: ADMIN_TOKEN })).status).toBe(503)
  })

  it('"any" bỏ lọc IP nhưng vẫn cần khoá', async () => {
    process.env.GATEWAY_ADMIN_CIDRS = "any"
    expect((await list({ token: ADMIN_TOKEN, ip: "203.0.113.5" })).status).toBe(200)
    expect((await list({ ip: "203.0.113.5" })).status).toBe(401)
  })

  it("không có X-Forwarded-For / ít mục hơn số tầng proxy → IP không rõ → từ chối; X-Real-IP bị bỏ qua", async () => {
    const noXff = new Request("https://mb-connect.test/api/admin/installs", { headers: { authorization: `Bearer ${ADMIN_TOKEN}`, "x-real-ip": "10.0.0.1" } })
    expect((await installsRoute.GET(noXff)).status).toBe(403)
    process.env.TRUSTED_PROXY_HOPS = "2"
    expect((await list({ token: ADMIN_TOKEN, ip: "10.0.0.1" })).status).toBe(403)
  })

  it("TRUSTED_PROXY_HOPS=2: lấy mục thứ 2 từ cuối (IP giả ở đầu không qua được)", async () => {
    process.env.TRUSTED_PROXY_HOPS = "2"
    expect((await list({ token: ADMIN_TOKEN, ip: "10.0.0.1, 203.0.113.5, 172.16.0.1" })).status).toBe(403)
    expect((await list({ token: ADMIN_TOKEN, ip: "203.0.113.5, 10.0.0.1, 172.16.0.1" })).status).toBe(200)
  })
})

describe("healthz", () => {
  it("ok khi ghi được ổ + khoá hợp lệ; thiếu khoá → 503", async () => {
    expect((await healthz.GET()).status).toBe(200)
    delete process.env.GATEWAY_ENCRYPTION_KEY
    const res = await healthz.GET()
    expect(res.status).toBe(503)
    expect((await res.json()).checks.encryptionKey).toBe(false)
  })
})
