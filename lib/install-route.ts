// Khung chung cho route bản cài gọi (/api/v1/*): giới hạn theo IP, xác thực khoá, đổi lỗi nghiệp vụ thành mã ổn định, ghi nhật ký.
import { audit } from "./audit"
import { ConnectionError } from "./connections"
import { authInstall, clientIp, jsonError } from "./http"
import { hit, isOver } from "./ratelimit"
import type { Install } from "./store"

export class BadRequest extends Error {}

export const AUTH_FAIL_LIMIT = 30 // lượt xác thực sai / phút / IP
export const INSTALL_LIMIT = 300 // lượt / phút / bản cài

export async function installRoute(req: Request, event: string, fn: (install: Install) => Promise<Response>, connectionId?: string): Promise<Response> {
  // Theo IP chỉ đếm lượt xác thực SAI (chống dò khoá). Mọi bản cài trên cùng nền tảng có thể ra cùng một IP, nên lượt
  // đúng giới hạn theo từng bản cài — bản cài này không làm bản cài kia bị 429 (review 22/10, điểm 4).
  const ip = clientIp(req)
  const blocked = isOver(`auth-fail:${ip}`, AUTH_FAIL_LIMIT)
  if (blocked.over) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(blocked.retryAfterSec) })

  const auth = authInstall(req)
  if ("response" in auth) {
    if (auth.response.status === 401) hit(`auth-fail:${ip}`, AUTH_FAIL_LIMIT, 60_000)
    await audit({ event, ok: false, ip, connectionId, reason: `auth_${auth.response.status}` })
    return auth.response
  }
  const installId = auth.install.id
  const rl = hit(`install:${installId}`, INSTALL_LIMIT, 60_000)
  if (!rl.ok) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(rl.retryAfterSec) })
  try {
    const res = await fn(auth.install)
    await audit({ event, ok: res.ok, ip, installId, connectionId, reason: res.ok ? undefined : `http_${res.status}` })
    return res
  } catch (e) {
    if (e instanceof BadRequest) {
      await audit({ event, ok: false, ip, installId, connectionId, reason: "bad_request" })
      return jsonError(400, "bad_request", { message: e.message })
    }
    if (e instanceof ConnectionError) {
      await audit({ event, ok: false, ip, installId, connectionId, reason: e.code })
      const status = e.code === "not_found" ? 404 : e.code === "bad_request" ? 400 : e.code === "connection_missing" ? 409 : 502
      return jsonError(status, e.code, { message: e.message })
    }
    console.error(`[${event}]`, (e as Error).message)
    await audit({ event, ok: false, ip, installId, connectionId, reason: "internal" })
    return jsonError(500, "provider_error", { message: "Lỗi nội bộ" })
  }
}

export async function jsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json()
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>
  } catch { /* xuống dưới */ }
  throw new BadRequest("thân yêu cầu phải là JSON object")
}
