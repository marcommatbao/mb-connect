// Cookie state trên miền cổng + chuyển hướng về bản cài với lý do lỗi trong danh sách cố định (không phản chiếu chữ tuỳ ý).
import { secureCookies } from "./config"
import { sha256Hex } from "./crypto"
import type { PendingFlow } from "./pending"

/** Mỗi lượt một cookie riêng (review 22/10, điểm 9): hai tab / Google rồi Meta không ghi đè lẫn nhau. */
export function stateCookieName(oauthState: string): string {
  return `mb_state_${sha256Hex(oauthState).slice(0, 16)}`
}

function cookieAttrs(maxAge: number): string {
  return `Path=/api/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies() ? "; Secure" : ""}`
}

export function stateCookie(oauthState: string): string {
  return `${stateCookieName(oauthState)}=${oauthState}; ${cookieAttrs(600)}`
}

export function clearStateCookie(oauthState: string): string {
  return `${stateCookieName(oauthState)}=; ${cookieAttrs(0)}`
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return v.join("=")
  }
  return null
}

export type ReturnReason =
  | "cancelled" | "access_denied" | "scope_denied" | "no_refresh_token" | "session_mismatch"
  | "install_inactive" | "provider_error" | "misconfigured"

export function redirectToInstall(
  flow: PendingFlow,
  result: { ok: true; cid: string } | { ok: false; reason: ReturnReason },
  oauthState?: string,
): Response {
  const u = new URL(flow.returnUrl)
  u.searchParams.set("provider", flow.provider)
  if (result.ok) {
    u.searchParams.set("ok", "1")
    u.searchParams.set("cid", result.cid)
  } else {
    u.searchParams.set("ok", "0")
    u.searchParams.set("reason", result.reason)
  }
  const headers = new Headers({ Location: u.toString(), "Cache-Control": "no-store" })
  if (oauthState) headers.append("Set-Cookie", clearStateCookie(oauthState))
  return new Response(null, { status: 303, headers })
}
