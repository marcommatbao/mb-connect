// GET /api/v1/install — bản cài tự kiểm khoá của mình: { id, name, status, connections } (không có secret).
// Giới hạn theo IP để không dò khoá được.
import { audit } from "@/lib/audit"
import { authInstall, clientIp, json, jsonError } from "@/lib/http"
import { hit } from "@/lib/ratelimit"
import { connectionsOf, publicConnection } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const ip = clientIp(req)
  const rl = hit(`install-auth:${ip}`, 60, 60_000)
  if (!rl.ok) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(rl.retryAfterSec) })

  const auth = authInstall(req)
  if ("response" in auth) {
    await audit({ event: "v1.install", ok: false, ip, reason: `auth_${auth.response.status}` })
    return auth.response
  }
  const { install } = auth
  return json({
    id: install.id,
    name: install.name,
    status: install.status,
    connections: connectionsOf(install.id).filter((c) => c.status !== "revoked").map(publicConnection),
  })
}
