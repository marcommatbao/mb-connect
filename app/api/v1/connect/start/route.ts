// POST /api/v1/connect/start — bản cài mở một lượt kết nối.
// { provider, returnPath, createdBy, nonceHash } → { url } (trình duyệt khách mở url này: trang trung gian của cổng).
// returnUrl = appUrl đã đăng ký + một trong các đường cố định — không bao giờ nhận URL tuỳ ý (chặn chuyển hướng sai chỗ).
import { gatewayUrl, googleClient, metaApp } from "@/lib/config"
import { sweepExpiredPending } from "@/lib/connections"
import { json, jsonError } from "@/lib/http"
import { BadRequest, installRoute, jsonBody } from "@/lib/install-route"
import { createFlow } from "@/lib/pending"
import { hit } from "@/lib/ratelimit"
import type { Provider } from "@/lib/store"

export const dynamic = "force-dynamic"

const RETURN_PATHS: Record<Provider, string> = {
  google: "/api/connect/google/return",
  meta: "/api/connect/meta/return",
}

export async function POST(req: Request) {
  return installRoute(req, "v1.connect.start", async (install) => {
    const body = await jsonBody(req)
    const provider = body.provider
    if (provider !== "google" && provider !== "meta") throw new BadRequest("provider phải là google hoặc meta")
    if (body.returnPath !== RETURN_PATHS[provider]) throw new BadRequest(`returnPath phải là ${RETURN_PATHS[provider]}`)
    const createdBy = String(body.createdBy ?? "").trim()
    if (!/^[^\s@]{1,100}@[^\s@]{1,100}$/.test(createdBy)) throw new BadRequest("createdBy phải là email người bấm kết nối")
    const nonceHash = String(body.nonceHash ?? "")
    if (!/^[0-9a-f]{64}$/.test(nonceHash)) throw new BadRequest("nonceHash phải là SHA-256 hex")

    const base = gatewayUrl()
    if (!base || !(provider === "google" ? googleClient() : metaApp())) return jsonError(503, "misconfigured")

    const rl = hit(`connect-start:${install.id}`, 20, 60 * 60_000)
    if (!rl.ok) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(rl.retryAfterSec) })

    await sweepExpiredPending()
    const state = createFlow({ installId: install.id, provider, returnUrl: install.appUrl + RETURN_PATHS[provider], createdBy, nonceHash })
    return json({ url: `${base}/api/oauth/start/${state}` })
  })
}
