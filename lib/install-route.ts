// Khung chung cho route bản cài gọi (/api/v1/*): giới hạn theo IP, xác thực khoá, đổi lỗi nghiệp vụ thành mã ổn định, ghi nhật ký.
import { audit } from "./audit"
import { ConnectionError } from "./connections"
import { authInstall, clientIp, jsonError } from "./http"
import { hit } from "./ratelimit"
import type { Install } from "./store"

export class BadRequest extends Error {}

export async function installRoute(req: Request, event: string, fn: (install: Install) => Promise<Response>, connectionId?: string): Promise<Response> {
  const ip = clientIp(req)
  const rl = hit(`install-auth:${ip}`, 60, 60_000)
  if (!rl.ok) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(rl.retryAfterSec) })

  const auth = authInstall(req)
  if ("response" in auth) {
    await audit({ event, ok: false, ip, connectionId, reason: `auth_${auth.response.status}` })
    return auth.response
  }
  const installId = auth.install.id
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
