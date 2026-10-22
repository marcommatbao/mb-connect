// POST /api/v1/token { connectionId } → { accessToken, expiresAt, provider }
// Access token ngắn hạn cho đúng kết nối của bản cài. Bản cài cache trong bộ nhớ và xin lại trước hạn 60 giây.
// Giới hạn 30 lượt/giờ/kết nối: đủ cho nhiều tiến trình (mỗi tiến trình ~1 lượt/giờ), chặn bản cài bị chiếm dùng làm máy mint token.
import { issueAccessToken } from "@/lib/connections"
import { json, jsonError } from "@/lib/http"
import { BadRequest, installRoute, jsonBody } from "@/lib/install-route"
import { hit } from "@/lib/ratelimit"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return installRoute(req, "v1.token", async (install) => {
    const connectionId = String((await jsonBody(req)).connectionId ?? "")
    if (!/^c_[A-Za-z0-9_-]{12}$/.test(connectionId)) throw new BadRequest("connectionId không hợp lệ")
    const rl = hit(`token:${install.id}:${connectionId}`, 30, 60 * 60_000)
    if (!rl.ok) return jsonError(429, "rate_limited", undefined, { "Retry-After": String(rl.retryAfterSec) })
    const t = await issueAccessToken(install.id, connectionId)
    return json({ accessToken: t.accessToken, expiresAt: new Date(t.expiresAt).toISOString(), provider: t.provider })
  })
}
