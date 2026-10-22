// Cookie state trên miền cổng + chuyển hướng về bản cài với lý do lỗi trong danh sách cố định (không phản chiếu chữ tuỳ ý).
import { secureCookies } from "./config"
import type { PendingFlow } from "./pending"

export const STATE_COOKIE = "mb_state"

export function stateCookie(state: string): string {
  return `${STATE_COOKIE}=${state}; Path=/api/oauth; HttpOnly; SameSite=Lax; Max-Age=600${secureCookies() ? "; Secure" : ""}`
}

export function clearStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/api/oauth; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies() ? "; Secure" : ""}`
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

export function redirectToInstall(flow: PendingFlow, result: { ok: true; cid: string } | { ok: false; reason: ReturnReason }): Response {
  const u = new URL(flow.returnUrl)
  u.searchParams.set("provider", flow.provider)
  if (result.ok) {
    u.searchParams.set("ok", "1")
    u.searchParams.set("cid", result.cid)
  } else {
    u.searchParams.set("ok", "0")
    u.searchParams.set("reason", result.reason)
  }
  return new Response(null, { status: 303, headers: { Location: u.toString(), "Set-Cookie": clearStateCookie(), "Cache-Control": "no-store" } })
}
