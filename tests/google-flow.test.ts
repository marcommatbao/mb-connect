import crypto from "crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { freshEnv, params, readAllData, req } from "./setup-env"
import { createInstall, setInstallStatus } from "@/lib/installs"
import { issueAccessToken, periodicSweep, resetTokenCacheForTests, sweepExpiredPending, PENDING_CONFIRM_MS } from "@/lib/connections"
import { resetFlowsForTests } from "@/lib/pending"
import { resetRateLimitsForTests } from "@/lib/ratelimit"
import { listConnections, mutateConnections, mutateInstalls } from "@/lib/store"
import { sha256Hex } from "@/lib/crypto"
import * as start from "@/app/api/v1/connect/start/route"
import * as oauthStart from "@/app/api/oauth/start/[link]/route"
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
let onRefresh: (() => Promise<void>) | null
let dir: string

beforeEach(() => {
  dir = freshEnv()
  process.env.GATEWAY_URL = GW
  process.env.GOOGLE_OAUTH_CLIENT_ID = "client-id.apps.googleusercontent.com"
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-test-secret"
  resetRateLimitsForTests(); resetFlowsForTests(); resetTokenCacheForTests()
  calls = []
  onRefresh = null
  let n = 0
  tokenResponse = () => ({ access_token: `ya29.ACCESS-${++n}`, expires_in: 3599, refresh_token: REFRESH, scope: "https://www.googleapis.com/auth/adwords", token_type: "Bearer" })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const body = new URLSearchParams(String(init.body))
    calls.push({ url, body })
    if (url === "https://oauth2.googleapis.com/revoke") return new Response("", { status: 200 })
    if (body.get("grant_type") === "refresh_token") {
      if (onRefresh) await onRefresh()
      return Response.json({ access_token: `ya29.REFRESHED-${calls.length}`, expires_in: 3599 })
    }
    return Response.json(tokenResponse())
  }))
})
afterEach(() => vi.unstubAllGlobals())

const revokeCalls = () => calls.filter((c) => c.url.endsWith("/revoke"))

async function newInstall(appUrl = APP, name = "Khách A") {
  return createInstall({ name, appUrl })
}

function nonce() {
  const n = crypto.randomBytes(32).toString("base64url")
  return { nonce: n, nonceHash: sha256Hex(n) }
}

async function startLink(key: string, nonceHash = "a".repeat(64)): Promise<string> {
  const s = await start.POST(req("/api/v1/connect/start", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "admin@khach-a.vn", nonceHash }) }))
  expect(s.status).toBe(200)
  return (await s.json()).url.split("/api/oauth/start/")[1]
}

const postAction = (link: string, action: "continue" | "cancel") =>
  oauthStart.POST(new Request(`${GW}/api/oauth/start/${link}`, { method: "POST", body: new URLSearchParams({ action }) }), params({ link }))

/** Bấm Tiếp tục → trả state gửi Google + cookie trình duyệt nhận. */
async function continueToGoogle(link: string) {
  const go = await postAction(link, "continue")
  expect(go.status).toBe(303)
  const google = new URL(go.headers.get("location")!)
  return { google, state: google.searchParams.get("state")!, cookie: go.headers.get("set-cookie")!.split(";")[0] }
}

const callGoogleBack = (state: string, cookie: string | null, code = "4/AUTH-CODE") =>
  callback.GET(new Request(`${GW}/api/oauth/google/callback?state=${encodeURIComponent(state)}&code=${code}`, { headers: cookie ? { cookie } : {} }))

/** Trọn luồng tới lúc cổng chuyển về bản cài. */
async function connectFlow(key: string, opts: { cookie?: boolean; code?: string } = {}) {
  const { nonce: n, nonceHash } = nonce()
  const link = await startLink(key, nonceHash)
  const { state, cookie } = await continueToGoogle(link)
  const cb = await callGoogleBack(state, opts.cookie === false ? null : cookie, opts.code)
  const location = new URL(cb.headers.get("location")!)
  return { cb, location, nonce: n, link, state, cid: location.searchParams.get("cid") }
}

async function confirmed(key: string) {
  const f = await connectFlow(key)
  const r = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
  expect(r.status).toBe(200)
  return f
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
    expect((await (await call(good)).json()).url).toMatch(new RegExp(`^${GW}/api/oauth/start/[A-Za-z0-9_-]{43}$`))
  })

  it("thiếu cấu hình Google → 503", async () => {
    const { key } = await newInstall()
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET
    const r = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64) }) }))
    expect(r.status).toBe(503)
  })
})

describe("trang trung gian", () => {
  it("hiện tên bản cài, tên miền, người bắt đầu — thoát HTML — CSP cho phép form đi tới Google + bản cài", async () => {
    const { key } = await newInstall(APP, `<script>alert(1)</script> Khách`)
    const link = await startLink(key)
    const res = await oauthStart.GET(new Request(`${GW}/x`), params({ link }))
    const page = await res.text()
    expect(page).toContain("khach-a.example.com")
    expect(page).toContain("admin@khach-a.vn")
    expect(page).toContain("&lt;script&gt;")
    expect(page).not.toContain("<script>alert")
    expect(page).toContain('method="post"')
    const csp = res.headers.get("content-security-policy")!
    expect(csp).toContain("form-action 'self' https://accounts.google.com https://khach-a.example.com")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(res.headers.get("x-frame-options")).toBe("DENY")
  })

  it("Tiếp tục → sang Google với state MỚI (không phải mã trong đường dẫn) + cookie riêng HttpOnly Secure", async () => {
    const { key } = await newInstall()
    const link = await startLink(key)
    const { google, state, cookie } = await continueToGoogle(link)
    expect(google.origin + google.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(google.searchParams.get("redirect_uri")).toBe(`${GW}/api/oauth/google/callback`)
    expect(google.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords")
    expect(google.searchParams.get("access_type")).toBe("offline")
    expect(state).not.toBe(link)
    expect(cookie).toBe(`mb_state_${sha256Hex(state).slice(0, 16)}=${state}`)
  })

  it("đường dẫn chỉ bấm Tiếp tục được MỘT lần: người thứ hai cầm đường dẫn → 410 (điểm 3)", async () => {
    const { key } = await newInstall()
    const link = await startLink(key)
    await continueToGoogle(link) // kẻ lấy được đường dẫn bấm trước
    expect((await postAction(link, "continue")).status).toBe(410)
    expect((await oauthStart.GET(new Request(`${GW}/x`), params({ link }))).status).toBe(410)
  })

  it("cầm đường dẫn KHÔNG đủ để hoàn tất: callback với state = mã đường dẫn → 410", async () => {
    const { key } = await newInstall()
    const link = await startLink(key)
    await continueToGoogle(link)
    expect((await callGoogleBack(link, `mb_state_${sha256Hex(link).slice(0, 16)}=${link}`)).status).toBe(410)
  })

  it("Huỷ → về bản cài reason=cancelled và đường dẫn chết", async () => {
    const { key } = await newInstall()
    const link = await startLink(key)
    const cancel = await postAction(link, "cancel")
    expect(cancel.headers.get("location")).toBe(`${APP}/api/connect/google/return?provider=google&ok=0&reason=cancelled`)
    expect((await oauthStart.GET(new Request(`${GW}/x`), params({ link }))).status).toBe(410)
  })
})

describe("callback → xác nhận → token", () => {
  it("luồng đầy đủ: pending → nonce đúng → active → token; token chỉ cấp khi đã active", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    expect(f.location.origin + f.location.pathname).toBe(`${APP}/api/connect/google/return`)
    expect(f.location.searchParams.get("ok")).toBe("1")
    expect(f.cb.headers.get("set-cookie")).toMatch(/^mb_state_[0-9a-f]{16}=; .*Max-Age=0/)
    const exchange = calls.find((c) => c.body.get("grant_type") === "authorization_code")!
    expect(exchange.body.get("client_secret")).toBe("GOCSPX-test-secret")
    expect(exchange.body.get("redirect_uri")).toBe(`${GW}/api/oauth/google/callback`)

    const tok = () => token.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ connectionId: f.cid }) }))
    expect((await tok()).status).toBe(409)

    const bad = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: "z".repeat(43) }) }), params({ id: f.cid! }))
    expect(bad.status).toBe(400)
    const ok = await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    expect((await ok.json()).status).toBe("active")

    const t = await (await tok()).json()
    expect(t.accessToken).toBe("ya29.ACCESS-1")
    expect(t.provider).toBe("google")
  })

  it("thiếu cookie (khác trình duyệt) → session_mismatch, không lưu gì", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key, { cookie: false })
    expect(f.location.searchParams.get("reason")).toBe("session_mismatch")
    expect(listConnections()).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it("hai lượt trong cùng trình duyệt (2 tab) đều xong — cookie không ghi đè nhau (điểm 9)", async () => {
    const { key } = await newInstall()
    const a = await continueToGoogle(await startLink(key))
    const b = await continueToGoogle(await startLink(key))
    const jar = `${a.cookie}; ${b.cookie}`
    for (const s of [a.state, b.state]) {
      const r = await callGoogleBack(s, jar)
      expect(new URL(r.headers.get("location")!).searchParams.get("ok")).toBe("1")
    }
  })

  it("state dùng một lần: gọi lại callback → 410", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    expect((await callGoogleBack(f.state, null)).status).toBe(410)
  })

  it("khách từ chối → access_denied; khách bỏ tích quyền Ads → scope_denied, KHÔNG gọi Google revoke (điểm 2)", async () => {
    const { key } = await newInstall()
    const { state, cookie } = await continueToGoogle(await startLink(key))
    const denied = await callback.GET(new Request(`${GW}/cb?state=${state}&error=access_denied`, { headers: { cookie } }))
    expect(new URL(denied.headers.get("location")!).searchParams.get("reason")).toBe("access_denied")

    tokenResponse = () => ({ access_token: "ya29.NO-ADS", expires_in: 3599, scope: "openid" })
    const f = await connectFlow(key)
    expect(f.location.searchParams.get("reason")).toBe("scope_denied")
    expect(revokeCalls()).toHaveLength(0)
    expect(listConnections()).toHaveLength(0)
  })

  it("kết nối lại (cùng tài khoản Google) → kết nối cũ chỉ bị xoá token, KHÔNG gọi Google revoke (điểm 2)", async () => {
    const { key } = await newInstall()
    const a = await confirmed(key)
    const b = await confirmed(key)
    const old = listConnections().find((c) => c.id === a.cid)!
    expect(old.status).toBe("revoked")
    expect(old.secret).toBeUndefined()
    expect(revokeCalls()).toHaveLength(0)
    expect(listConnections().find((c) => c.id === b.cid)!.status).toBe("active")
  })

  it("pending quá 15 phút → bị dọn (xoá token), KHÔNG gọi Google revoke", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key)
    expect(await sweepExpiredPending(Date.now() + PENDING_CONFIRM_MS + 1)).toBe(1)
    const c = listConnections().find((x) => x.id === f.cid)!
    expect(c.status).toBe("revoked")
    expect(c.secret).toBeUndefined()
    expect(revokeCalls()).toHaveLength(0)
  })

  it("khách bấm Ngắt kết nối → xoá token + gọi Google revoke", async () => {
    const { key } = await newInstall()
    const f = await confirmed(key)
    const r = await conn.DELETE(req("/x", { method: "DELETE", token: key }), params({ id: f.cid! }))
    expect((await r.json()).status).toBe("revoked")
    expect(revokeCalls().map((c) => c.body.get("token"))).toEqual([REFRESH])
    expect(listConnections().find((c) => c.id === f.cid)!.secret).toBeUndefined()
  })
})

describe("làm mới token", () => {
  it("hết hạn → làm mới; 10 lượt cùng lúc chỉ gọi Google 1 lần", async () => {
    const { install, key } = await newInstall()
    const f = await confirmed(key)
    const later = Date.now() + 3600_000
    const before = calls.length
    const results = await Promise.all(Array.from({ length: 10 }, () => issueAccessToken(install.id, f.cid!, later)))
    expect(calls.length - before).toBe(1)
    expect(new Set(results.map((r) => r.accessToken)).size).toBe(1)
    expect(calls.at(-1)!.body.get("refresh_token")).toBe(REFRESH)
  })

  it("kết nối bị ngắt TRONG LÚC đang làm mới → không cấp, không cache (điểm 7)", async () => {
    const { install, key } = await newInstall()
    const f = await confirmed(key)
    onRefresh = async () => {
      await mutateConnections((list) => { const c = list.find((x) => x.id === f.cid)!; c.status = "revoked"; delete c.secret })
    }
    await expect(issueAccessToken(install.id, f.cid!, Date.now() + 3600_000)).rejects.toThrow(/vừa bị ngắt/)
    onRefresh = null
    await expect(issueAccessToken(install.id, f.cid!, Date.now() + 3600_000)).rejects.toThrow(/không còn hoạt động/)
  })

  it("Google trả invalid_grant (khách đã thu hồi) → kết nối chết, bản cài nhận 409, không gọi revoke", async () => {
    const { install, key } = await newInstall()
    const f = await confirmed(key)
    const revokesBefore = revokeCalls().length
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push({ url, body: new URLSearchParams() })
      return Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 })
    }))
    await expect(issueAccessToken(install.id, f.cid!, Date.now() + 3600_000)).rejects.toThrow(/thu hồi/)
    expect(listConnections().find((c) => c.id === f.cid)!.status).toBe("revoked")
    expect(revokeCalls().length).toBe(revokesBefore)
    expect((await token.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(409)
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

    await confirm.POST(req("/x", { method: "POST", token: a.key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))
    expect((await token.POST(req("/x", { method: "POST", token: a.key, body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(200)
    expect((await token.POST(asB({ method: "POST", body: JSON.stringify({ connectionId: f.cid }) }))).status).toBe(409)
  })

  it("Mắt Bão thu hồi bản cài → mọi kết nối bị thu hồi ở Google, token bị xoá", async () => {
    const { install, key } = await newInstall()
    await confirmed(key)
    await setInstallStatus(install.id, "revoke")
    expect(listConnections().every((c) => c.status === "revoked" && !c.secret)).toBe(true)
    expect(revokeCalls().map((c) => c.body.get("token"))).toEqual([REFRESH])
  })

  it("thu hồi bản cài chết giữa chừng (kết nối còn sót) → lượt dọn định kỳ làm nốt (điểm 8)", async () => {
    const { install, key } = await newInstall()
    const f = await confirmed(key)
    await mutateInstalls((list) => { list.find((i) => i.id === install.id)!.status = "revoked" }) // chỉ ghi trạng thái, như bị ngắt giữa chừng
    expect(listConnections().find((c) => c.id === f.cid)!.status).toBe("active")
    expect(await periodicSweep()).toEqual({ expiredPending: 0, orphaned: 1 })
    expect(listConnections().find((c) => c.id === f.cid)!.secret).toBeUndefined()
    expect(revokeCalls().map((c) => c.body.get("token"))).toEqual([REFRESH])
  })
})

describe("không lộ bí mật", () => {
  it("refresh token, client secret, code, state, nonce không nằm trong phản hồi hay tệp dữ liệu/nhật ký", async () => {
    const { key } = await newInstall()
    const f = await connectFlow(key, { code: "4/SECRET-AUTH-CODE" })
    const texts = [
      await (await conn.GET(req("/x", { token: key }), params({ id: f.cid! }))).text(),
      await (await confirm.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ nonce: f.nonce }) }), params({ id: f.cid! }))).text(),
      readAllData(dir),
    ].join("\n")
    for (const secret of [REFRESH, "GOCSPX-test-secret", "4/SECRET-AUTH-CODE", f.state, f.link, f.nonce]) expect(texts).not.toContain(secret)
  })
})
