// GET /api/oauth/google/callback — Google gọi về sau màn hình đồng ý. Redirect URI DUY NHẤT cho mọi bản cài.
// Kiểm: state có lượt đang mở + cookie riêng của lượt, cùng trình duyệt (dùng một lần) → đổi code → lưu refresh token mã hoá
// ở trạng thái pending → chuyển về bản cài kèm cid. Kết nối chỉ thành active khi bản cài xác nhận nonce.
import { audit } from "@/lib/audit"
import { createPendingConnection, primeToken } from "@/lib/connections"
import { safeEqualHex, sha256Hex } from "@/lib/crypto"
import { clientIp } from "@/lib/http"
import { errorPage } from "@/lib/html"
import { readCookie, redirectToInstall, stateCookieName, type ReturnReason } from "@/lib/oauth-flow"
import { consumeState } from "@/lib/pending"
import { GoogleOAuthError, exchangeGoogleCode } from "@/lib/providers/google"
import { getInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get("state") ?? ""
  const ip = clientIp(req)

  const flow = state ? consumeState(state) : null
  if (!flow || flow.provider !== "google") {
    await audit({ event: "oauth.google.callback", ok: false, ip, reason: "unknown_state" })
    return errorPage("Đường dẫn kết nối đã hết hạn hoặc đã dùng.", 410)
  }
  const base = { event: "oauth.google.callback", ip, installId: flow.installId, provider: "google" }
  const fail = async (reason: ReturnReason) => {
    await audit({ ...base, ok: false, reason })
    return redirectToInstall(flow, { ok: false, reason }, state)
  }

  // Cookie phải khớp: lượt kết nối được hoàn tất trên CÙNG trình duyệt đã bấm Tiếp tục ở trang trung gian.
  const cookie = readCookie(req, stateCookieName(state)) ?? ""
  if (!cookie || !safeEqualHex(sha256Hex(cookie), sha256Hex(state))) return fail("session_mismatch")

  const install = getInstall(flow.installId)
  if (!install || install.status !== "active") return fail("install_inactive")

  const error = url.searchParams.get("error")
  if (error) return fail(error === "access_denied" ? "access_denied" : "provider_error")
  const code = url.searchParams.get("code")
  if (!code) return fail("provider_error")

  try {
    const t = await exchangeGoogleCode(code)
    const conn = await createPendingConnection({
      installId: flow.installId, provider: "google", createdBy: flow.createdBy, scopes: t.scopes, secret: t.refreshToken, nonceHash: flow.nonceHash,
    })
    primeToken(conn.id, t.accessToken, t.expiresIn)
    await audit({ ...base, ok: true, connectionId: conn.id })
    return redirectToInstall(flow, { ok: true, cid: conn.id }, state)
  } catch (e) {
    if (e instanceof GoogleOAuthError && (e.reason === "scope_denied" || e.reason === "no_refresh_token" || e.reason === "misconfigured")) return fail(e.reason)
    console.error("[oauth.google.callback]", (e as Error).message)
    return fail("provider_error")
  }
}
