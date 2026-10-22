import crypto from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { freshEnv, params, readAllData, req } from "./setup-env"
import { createInstall, setInstallStatus } from "@/lib/installs"
import { issueAccessToken, resetTokenCacheForTests, sweepExpiredPending, PENDING_CONFIRM_MS } from "@/lib/connections"
import { resetFlowsForTests } from "@/lib/pending"
import { resetRateLimitsForTests } from "@/lib/ratelimit"
import { listConnections } from "@/lib/store"
import { sha256Hex } from "@/lib/crypto"
import * as start from "@/app/api/v1/connect/start/route"
import * as oauthStart from "@/app/api/oauth/start/[state]/route"
import * as callback from "@/app/api/oauth/google/callback/route"
import * as conn from "@/app/api/v1/connections/[id]/route"
import * as confirm from "@/app/api/v1/connections/[id]/confirm/route"
import * as token from "@/app/api/v1/token/route"

const GW = "https://mb-connect.test"
const APP = "https://khach-a.example.com"
const REFRESH = "1//REFRESH-TOKEN-RAW-" + "x".repeat(20)

interface GoogleCall { url: string; body: URLSearchParams }
let calls: GoogleCall[]
let tokenResponse: () => Record<string, unknown>
let dir: string

beforeEach(() => {
  dir = freshEnv()
  process.env.GATEWAY_URL = GW
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com"
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-test-secret"
  resetRateLimitsForTests(); resetFlowsForTests(); resetTokenCacheForTests()
  calls = []
  let n = 0
  tokenResponse = () => ({ access_token: `ya29.ACCESS-${++n}`, expires_in: 3599, refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/adwords", token_type: "Bearer" })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body))
    calls.push({ url, body })
    if (url === "https://oauth2.googleapis.com/revoke") return new Response("", { status: 200 })
    if (body.get("grant_type") === "refresh_token") return Response.json({ access_token: `ya29.REFRESHED-${calls.length}`, expires_in: 3599 })
    return Response.json(tokenResponse())
  }))
})
afterEach(() => vi.unstubAllGlobals())

async function newInstall(appUrl = APP, name = "Khách A") {
  return createInstall({ name, appUrl })
}

function nonce() {
  const n = crypto.randomBytes(32).toString("base64url")
  return { nonce: n, nonceHash: sha256Hex(n) }
}

/** Chạy trọn luồng tới lúc cổng chuyển về bản cài. Trả cid + nonce. */
async function connectFlow(key: string, opts: { cookie?: boolean; code?: string } = {}) {
  const { nonce: n, nonceHash } = nonce()
  const s = await start.POST(req("/api/v1/connect/start", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "admin@khach-a.vn", nonceHash }) }))
  expect(s.status).toBe(200)
  const { url } = await s.json()
  const state = url.split("/api/oauth/start/")[1]
  const go = await oauthStart.POST(new Request(url, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ state }))
  expect(go.status).toBe(303)
  const cookie = go.headers.get("set-cookie")!.split(";")[0]
  const cbUrl = `${GW}/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=${opts.code ?? "4/AUTH-CODE"}`
  const cb = await callback.GET(new Request(cbUrl, { headers: opts.cookie === false ? {} : { cookie } }))
  const location = new URL(cb.headers.get("location")!)
  return { cb, location, nonce: n, state, cid: location.searchParams.get("cid") }
}

describe("connect/start", () => {
  it("kiểm đầu vào chặt, URL trả về nằm trên miền cổng", async () => {
    const { key } = await newInstall()
    const call = (b: Record<string, unknown>) => start.POST(req("/api/v1/connect/start", { method: "POST", token: key, body: JSON.stringify(b) }))
    const good = { provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64) }
    for (const bad of [{ ...good, provider: "x" }, { ...good, returnPath: "https://evil.example/x" }, { ...good, returnPath: "/api/connect/meta/return" },
      { ...good, createdBy: "khong-phai-email" }, { ...good, nonceHash: "abc" }]) {
      expect((await call(bad)).status).toBe(400)
    }
    const ok = await call(good)
    expect((await ok.json()).url).toMatch(new RegExp(`^${GW}/api/oauth/start/[A-Za-z0-9_-]{43}$`))
  })

  it("thiếu cấu hình Google → 503", async () => {
    const { key } = await newInstall()
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const r = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64) }) }))
    expect(r.status).toBe(503)
  })
})

describe("trang trung gian", () => {
  it("hiện tên bản cài, tên miền, người bắt đầu — và thoát HTML", async () => {
    const { key } = await newInstall(APP, `<script>alert(1)</script> Khách`)
    const s = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "admin@khach-a.vn", nonceHash: "a".repeat(64) }) }))
    const state = (await s.json()).url.split("/api/oauth/start/")[1]
    const page = await (await oauthStart.GET(new Request(`${GW}/x`), params({ state }))).text()
    expect(page).toContain("khach-a.example.com")
    expect(page).toContain("admin@khach-a.vn")
    expect(page).toContain("&lt;script&gt;")
    expect(page).not.toContain("<script>alert")
    expect(page).toContain('method="post"')
  })

  it("Tiếp tục → sang Google đúng tham số + cookie HttpOnly Secure; Huỷ → về bản cài reason=cancelled và đường dẫn chết", async () => {
    const { key } = await newInstall()
    const mk = async () => {
      const s = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64) }) }))
      return (await s.json()).url.split("/api/oauth/start/")[1] as string
    }
    const s1 = await mk()
    const go = await oauthStart.POST(new Request(`${GW}/x`, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ state: s1 }))
    const g = new URL(go.headers.get("location")!)
    expect(g.origin + g.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(g.searchParams.get("redirect_uri")).toBe(`${GW}/api/oauth/google/callback`)
    expect(g.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords")
    expect(g.searchParams.get("access_type")).toBe("offline")
    expect(g.searchParams.get("state")).toBe(s1)
    expect(go.headers.get("set-cookie")).toMatch(/HttpOnly; SameSite=Lax; Max-Age=600; Secure/)

    const s2 = await mk()
    const cancel = await oauthStart.POST(new Request(`${GW}/x`, { method: "POST", body: new URLSearchParams({ action: "cancel" }) }), params({ state: s2 }))
    expect(cancel.headers.get("location")).toBe(`${APP}/api/connect/google/return?provider=google&ok=0&reason=cancelled`)
    expect((await oauthStart.GET(new Request(`${GW}/x`), params({ state: s2 }))).status).toBe(410)
  })
})

describe("callback → xác nhận → token", () => {
  it("luồng đầy đủ: pending → nonce đúng → active → token; token chỉ cấp khi đã active", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    expect(f.location.origin + f.location.pathname).toBe(`${APP}/api/connect/google/return`)
    expect(f.location.searchParams.get("ok")).toBe("1")
    const exchange = calls.find((c) => c.body.get("grant_type") === "authorization_code")!
    expect(exchange.body.get("client_secret")).toBe("GOCSPX-test-secret")
    expect(exchange.body.get("redirect_uri")).toBe(`${GW}/api/oauth/google/callback`)

    const tok = () => token.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ connectionId: f.cid }) }))
    expect((await tok()).status).toBe(409) // chưa xác nhận

    const bad = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: "z".repeat(43) }) }), params({ id: f.cid! }))
    expect(bad.status).toBe(400)
    const ok = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    expect((await ok.json()).status).toBe("active")

    const t = await (await tok()).json()
    expect(t.accessToken).toBe("ya29.ACCESS-1") // token nhận lúc callback, chưa phải gọi Google lần nữa
    expect(t.provider).toBe("google")
  })

  it("thiếu cookie (khác trình duyệt) → session_mismatch, không lưu gì", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key, { cookie: false })
    expect(f.location.searchParams.get("reason")).toBe("session_mismatch")
    expect(listConnections()).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it("state dùng một lần: gọi lại callback → 410", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    const again = await callback.GET(new Request(`${GW}/api/oauth/google/callback?state=${f.state}&code=x`))
    expect(again.status).toBe(410)
  })

  it("khách từ chối → access_denied; khách bỏ tích quyền Ads → scope_denied + token bị thu hồi ngay", async () => {
    const { key } = await newInstall()
    const { nonceHash } = nonce()
    const s = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash }) }))
    const state = (await s.json()).url.split("/api/oauth/start/")[1]
    const go = await oauthStart.POST(new Request(`${GW}/x`, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ state }))
    const cookie = go.headers.get("set-cookie")!.split(";")[0]
    const denied = await callback.GET(new Request(`${GW}/cb?state=${state}&error=access_denied`, { headers: { cookie } }))
    expect(new URL(denied.headers.get("location")!).searchParams.get("reason")).toBe("access_denied")

    tokenResponse = () => ({ access_token: "ya29.NO-ADS", expires_in: 3599, scope: "openid" })
    const f = await connectFlow(key)
    expect(f.location.searchParams.get("reason")).toBe("scope_denied")
    expect(calls.some((c) => c.url.endsWith("/revoke") && c.body.get("token") === "ya29.NO-ADS")).toBe(true)
    expect(listConnections()).toHaveLength(0)
  })

  it("kết nối mới được xác nhận → kết nối cũ bị thu hồi ở Google và xoá token", async () => {
    const { key } = await newInstall()
    const a = await connectFlow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: a.nonce }) }), params({ id: a.cid! }))
    const b = await connectFlow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: b.nonce }) }), params({ id: b.cid! }))
    const old = listConnections().find((c) => c.id === a.cid)!
    expect(old.status).toBe("revoked")
    expect(old.secret).toBeUndefined()
    expect(calls.filter((c) => c.url.endsWith("/revoke") && c.body.get("token") === REFRESH)).toHaveLength(1)
    expect(listConnections().find((c) => c.id === b.cid)!.status).toBe("active")
  })

  it("pending quá 15 phút không xác nhận → bị dọn + thu hồi ở Google", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    expect(await sweepExpiredPending(Date.now() + PENDING_CONFIRM_MS + 1)).toBe(1)
    const c = listConnections().find((x) => x.id === f.cid)!
    expect(c.status).toBe("revoked")
    expect(c.secret).toBeUndefined()
    expect(calls.some((x) => x.url.endsWith("/revoke"))).toBe(true)
  })
})

describe("làm mới token", () => {
  async function activeConnection() {
    const { install, key } = await newInstall()
    const f = await connectFlow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    return { install, key, cid: f.cid! }
  }

  it("hết hạn → làm mới; 10 lượt cùng lúc chỉ gọi Google 1 lần", async () => {
    const { install, cid } = await activeConnection()
    const later = Date.now() + 3600_000
    const before = calls.length
    const results = await Promise.all(Array.from({ length: 10 }, () => issueAccessToken(install.id, cid, later)))
    expect(calls.length - before).toBe(1)
    expect(new Set(results.map((r) => r.accessToken)).size).toBe(1)
    expect(calls.at(-1)!.body.get("refresh_token")).toBe(REFRESH)
  })

  it("Google trả invalid_grant (khách đã thu hồi) → kết nối chết, bản cài nhận 409", async () => {
    const { install, key, cid } = await activeConnection()
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 })))
    await expect(issueAccessToken(install.id, cid, Date.now() + 3600_000)).rejects.toThrow(/thu hồi/)
    expect(listConnections().find((c) => c.id === cid)!.status).toBe("revoked")
    const r = await token.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ connectionId: cid }) }))
    expect(r.status).toBe(409)
  })
})

describe("cô lập giữa các bản cài", () => {
  it("bản cài B không xem / xác nhận / lấy token / thu hồi được kết nối của A", async () => {
    const a = await newInstall(APP, "A")
    const b = await newInstall("https://khach-b.example.com", "B")
    const f = await connectFlow(a.key)
    const asB = (init: RequestInit = {}) => req("/x", { ...init, token: b.key })
    expect((await conn.GET(asB(), params({ id: f.cid! }))).status).toBe(404)
    expect((await confirm.POST(asB({ method: "POST", body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))).status).toBe(404)
    expect((await token.POST(asB({ method: "POST", body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(409)
    expect((await conn.DELETE(asB({ method: "DELETE" }), params({ id: f.cid! }))).status).toBe(404)
    expect(listConnections().find((c) => c.id === f.cid)!.status).toBe("pending")

    // Sau khi A kích hoạt: B vẫn không lấy được token của A (kết nối active thật, không phải "chưa xác nhận" che đi).
    await confirm.POST(req("/x", { method: "POST", token: a.key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    expect((await token.POST(req("/x", { method: "POST", token: a.key, body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(200)
    expect((await token.POST(asB({ method: "POST", body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(409)
  })

  it("Mắt Bão thu hồi bản cài → mọi kết nối bị thu hồi ở Google, token bị xoá", async () => {
    const { install, key } = await newInstall()
    const f = await connectFlow(key)
    await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    await setInstallStatus(install.id, "revoke")
    expect(listConnections().every((c) => c.status === "revoked" && !c.secret)).toBe(true)
    expect(calls.some((c) => c.url.endsWith("/revoke") && c.body.get("token") === REFRESH)).toBe(true)
  })
})

describe("không lộ bí mật", () => {
  it("refresh token, client secret, code, state không nằm trong phản hồi hay tệp dữ liệu/nhật ký", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key, { code: "4/SECRET-AUTH-CODE" })
    const texts = [
      await (await conn.GET(req("/x", { token: key }), params({ id: f.cid! }))).text(),
      await (await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))).text(),
      readAllData(dir),
    ].join("\n")
    for (const secret of [REFRESH, "GOCSPX-test-secret", "4/SECRET-AUTH-CODE", f.state, f.nonce]) expect(texts).not.toContain(secret)
  })
})
