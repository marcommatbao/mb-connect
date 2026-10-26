// Luồng Meta (Facebook Login for Business, mã người dùng hệ thống) ở cổng — #6947 bước 5.
import crypto from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { freshEnv, params, readAllData, req } from "./setup-env"
import { createInstall } from "@/lib/installs"
import { issueAccessToken, resetTokenCacheForTests, revokeConnection } from "@/lib/connections"
import { resetFlowsForTests } from "@/lib/pending"
import { resetRateLimitsForTests } from "@/lib/ratelimit"
import { listConnections } from "@/lib/store"
import { sha256Hex } from "@/lib/crypto"
import * as start from "@/app/api/v1/connect/start/route"
import * as oauthStart from "@/app/api/oauth/start/[link]/route"
import * as callback from "@/app/api/oauth/meta/callback/route"
import * as confirm from "@/app/api/v1/connections/[id]/confirm/route"
import * as deauth from "@/app/api/meta/deauthorize/route"
import * as deletion from "@/app/api/meta/data-deletion/route"

const GW = "https://mb-connect.test"
const APP = "https://khach-a.example.com"
const APP_ID = "2077040626352062"
const SECRET = "meta-app-secret-test"
const BIZ_TOKEN = "EAAB-BUSINESS-SYSTEM-USER-TOKEN-" + "z".repeat(30)
const META_USER = "122100000000000001"

let calls: { url: string; method: string }[]
let debug: Record<string, unknown>
let dir: string

beforeEach(() => {
  dir = freshEnv()
  process.env.GATEWAY_URL = GW
  process.env.META_APP_ID = APP_ID
  process.env.META_APP_SECRET = SECRET
  process.env.META_LOGIN_CONFIG_ID = "1705244071169750"
  delete process.env.META_GRAPH_API_VERSION
  resetRateLimitsForTests(); resetFlowsForTests(); resetTokenCacheForTests()
  calls = []
  debug = { app_id: APP_ID, type: "SYSTEM_USER", is_valid: true, expires_at: 0, scopes: ["ads_management", "ads_read", "business_management"], user_id: META_USER }
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET" })
    const u = new URL(url)
    if (u.pathname.endsWith("/oauth/access_token")) return Response.json({ access_token: BIZ_TOKEN, token_type: "bearer" })
    if (u.pathname.endsWith("/debug_token")) return Response.json({ data: debug })
    if (u.pathname.endsWith("/me/permissions")) return Response.json({ success: true })
    return Response.json({ error: { message: "unexpected" } }, { status: 400 })
  }))
})
afterEach(() => vi.unstubAllGlobals())

async function startLink(key: string, nonceHash: string) {
  const s = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "meta", returnPath: "/api/connect/meta/return", createdBy: "admin@khach-a.vn", nonceHash }) }))
  expect(s.status).toBe(200)
  return (await s.json()).url.split("/api/oauth/start/")[1] as string
}

async function flow(key: string, q: (state: string) => string = (s) => `state=${s}&code=AQ-CODE`) {
  const n = crypto.randomBytes(32).toString("base64url")
  const link = await startLink(key, sha256Hex(n))
  const page = await oauthStart.GET(new Request(`${GW}/api/oauth/start/${link}`), params({ link }))
  const go = await oauthStart.POST(new Request(`${GW}/api/oauth/start/${link}`, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ link }))
  const fb = new URL(go.headers.get("location")!)
  const state = fb.searchParams.get("state")!
  const cookie = go.headers.get("set-cookie")!.split(";")[0]
  const cb = await callback.GET(new Request(`${GW}/api/oauth/meta/callback?${q(encodeURIComponent(state))}`, { headers: { cookie } }))
  const back = new URL(cb.headers.get("location")!)
  return { page, fb, back, nonce: n, cid: back.searchParams.get("cid") }
}

function signed(payload: Record<string, unknown>, secret = SECRET) {
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${crypto.createHmac("sha256", secret).update(p).digest("base64url")}.${p}`
}
const form = (signedRequest: string) => new Request(`${GW}/x`, { method: "POST", body: new URLSearchParams({ signed_request: signedRequest }) })

describe("Meta: kết nối", () => {
  it("thiếu cấu hình Meta → 503; Google không cần có", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    delete process.env.META_LOGIN_CONFIG_ID
    const r = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "meta", returnPath: "/api/connect/meta/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64) }) }))
    expect(r.status).toBe(503)
  })

  it("trọn luồng: hộp thoại FLB đúng tham số, CSP cho facebook, token mã hoá, active sau nonce, cấp đúng token", async () => {
    const { key, install } = await createInstall({ name: "Khách A", appUrl: APP })
    const f = await flow(key)
    expect(f.page.headers.get("content-security-policy")).toContain("https://www.facebook.com")
    expect(f.fb.origin + f.fb.pathname).toBe("https://www.facebook.com/v26.0/dialog/oauth")
    expect(Object.fromEntries(f.fb.searchParams)).toMatchObject({ client_id: APP_ID, config_id: "1705244071169750", response_type: "code", override_default_response_type: "true", redirect_uri: `${GW}/api/oauth/meta/callback` })
    expect(f.back.origin + f.back.pathname).toBe(`${APP}/api/connect/meta/return`)
    expect(f.back.searchParams.get("ok")).toBe("1")
    // Đổi code gửi app secret tới Graph, không lộ ra trình duyệt.
    expect(calls.find((c) => c.url.includes("/oauth/access_token"))!.url).toContain(`client_secret=${SECRET}`)
    expect(f.fb.toString()).not.toContain(SECRET)

    const c = listConnections()[0]
    expect(c).toMatchObject({ provider: "meta", status: "pending", metaUserId: META_USER })
    expect(readAllData(dir)).not.toContain(BIZ_TOKEN)

    await expect(issueAccessToken(install.id, f.cid!)).rejects.toMatchObject({ code: "connection_missing" }) // chưa xác nhận
    const ok = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    expect(ok.status).toBe(200)
    resetTokenCacheForTests()
    const t = await issueAccessToken(install.id, f.cid!)
    expect(t.accessToken).toBe(BIZ_TOKEN)
    expect(t.provider).toBe("meta")
    expect(t.expiresAt - Date.now()).toBeLessThanOrEqual(3600_000) // xin lại mỗi giờ để cổng kiểm còn sống
  })

  it("thiếu quyền ads_management → scope_denied, không lưu token", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    debug.scopes = ["ads_read"]
    const f = await flow(key)
    expect(f.back.searchParams.get("reason")).toBe("scope_denied")
    expect(listConnections()).toHaveLength(0)
  })

  it("token của app khác → provider_error, không lưu", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    debug.app_id = "999"
    const f = await flow(key)
    expect(f.back.searchParams.get("reason")).toBe("provider_error")
    expect(listConnections()).toHaveLength(0)
  })

  it("khách bấm Huỷ trên hộp thoại Meta → access_denied", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    const f = await flow(key, (s) => `state=${s}&error=access_denied&error_reason=user_denied`)
    expect(f.back.searchParams.get("reason")).toBe("access_denied")
  })

  it("khách gỡ quyền ở Meta → lần cấp sau kết nối chết, bản cài nhận connection_missing", async () => {
    const { key, install } = await createInstall({ name: "A", appUrl: APP })
    const f = await flow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    resetTokenCacheForTests()
    debug.is_valid = false
    await expect(issueAccessToken(install.id, f.cid!)).rejects.toMatchObject({ code: "connection_missing" })
    expect(listConnections()[0].status).toBe("revoked")
    expect(listConnections()[0].secret).toBeUndefined()
  })

  it("ngắt kết nối → gọi Meta gỡ quyền + xoá token", async () => {
    const { key, install } = await createInstall({ name: "A", appUrl: APP })
    const f = await flow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    await revokeConnection(install.id, f.cid!)
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes("/me/permissions"))).toBe(true)
    expect(listConnections()[0].secret).toBeUndefined()
  })
})

describe("Meta: callback bỏ uỷ quyền / xoá dữ liệu", () => {
  it("chữ ký đúng → xoá token mọi kết nối của người dùng Meta đó; trả url + confirmation_code", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    const f = await flow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    const r = await deletion.POST(form(signed({ algorithm: "HMAC-SHA256", user_id: META_USER, issued_at: 1 })))
    expect(r.status).toBe(200)
    const d = await r.json()
    expect(d.confirmation_code).toMatch(/^del_/)
    expect(d.url).toBe(`${GW}/data-deletion?code=${d.confirmation_code}`)
    expect(listConnections()[0]).toMatchObject({ status: "revoked" })
    expect(listConnections()[0].secret).toBeUndefined()
  })

  it("chữ ký sai / sai thuật toán / rác → 400, không đụng kết nối", async () => {
    const { key } = await createInstall({ name: "A", appUrl: APP })
    const f = await flow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    for (const bad of [signed({ algorithm: "HMAC-SHA256", user_id: META_USER }, "sai-secret"), signed({ algorithm: "none", user_id: META_USER }), "abc", "a.b.c"]) {
      expect((await deauth.POST(form(bad))).status).toBe(400)
    }
    expect(listConnections()[0].status).toBe("active")
    expect((await deauth.POST(form(signed({ algorithm: "HMAC-SHA256", user_id: META_USER }))))).toHaveProperty("status", 200)
    expect(listConnections()[0].status).toBe("revoked")
  })
})
