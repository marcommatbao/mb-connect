// GET /api/oauth/meta/callback — Meta gọi về sau hộp thoại Facebook Login for Business. Redirect URI DUY NHẤT cho mọi bản cài.
// Cùng khuôn với Google: state có lượt đang mở + cookie riêng của lượt (dùng một lần) → đổi code → kiểm token đúng app + có
// ads_management → lưu mã hoá ở trạng thái pending → về bản cài kèm cid. Chỉ thành active khi bản cài xác nhận nonce.
import { audit } from "@/lib/audit"
import { createPendingConnection, primeToken } from "@/lib/connections"
import { safeEqualHex, sha256Hex } from "@/lib/crypto"
import { clientIp } from "@/lib/http"
import { errorPage } from "@/lib/html"
import { langFromRequest, strings } from "@/lib/i18n"
import { readCookie, redirectToInstall, stateCookieName, type ReturnReason } from "@/lib/oauth-flow"
import { consumeState } from "@/lib/pending"
import { MetaOAuthError, exchangeMetaCode } from "@/lib/providers/meta"
import { getInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const state = url.searchParams.get("state") ?? ""
  const ip = clientIp(req)

  const flow = state ? consumeState(state) : null
  if (!flow || flow.provider !== "meta") {
    await audit({ event: "oauth.meta.callback", ok: false, ip, reason: "unknown_state" })
    const lang = langFromRequest(req)
    return errorPage(strings(lang).expired, 410, lang)
  }
  const base = { event: "oauth.meta.callback", ip, installId: flow.installId, provider: "meta" }
  const fail = async (reason: ReturnReason) => {
    await audit({ ...base, ok: false, reason })
    return redirectToInstall(flow, { ok: false, reason }, state)
  }

  const cookie = readCookie(req, stateCookieName(state)) ?? ""
  if (!cookie || !safeEqualHex(sha256Hex(cookie), sha256Hex(state))) return fail("session_mismatch")

  const install = getInstall(flow.installId)
  if (!install || install.status !== "active") return fail("install_inactive")

  // Khách bấm Huỷ trên hộp thoại Meta: error=access_denied (kèm error_reason=user_denied).
  const error = url.searchParams.get("error")
  if (error) return fail(error === "access_denied" ? "access_denied" : "provider_error")
  const code = url.searchParams.get("code")
  if (!code) return fail("provider_error")

  try {
    const t = await exchangeMetaCode(code)
    const conn = await createPendingConnection({
      installId: flow.installId, provider: "meta", createdBy: flow.createdBy, scopes: t.scopes, secret: t.token, nonceHash: flow.nonceHash, metaUserId: t.userId,
    })
    primeToken(conn.id, t.token, 3600)
    await audit({ ...base, ok: true, connectionId: conn.id })
    return redirectToInstall(flow, { ok: true, cid: conn.id }, state)
  } catch (e) {
    if (e instanceof MetaOAuthError && (e.reason === "scope_denied" || e.reason === "misconfigured")) return fail(e.reason)
    console.error("[oauth.meta.callback]", (e as Error).message)
    return fail("provider_error")
  }
}
