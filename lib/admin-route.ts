// Khung chung cho route quản trị: xác thực, đổi InstallError thành mã lỗi, ghi nhật ký mỗi lượt.
import { audit } from "./audit"
import { authAdmin, clientIp, jsonError } from "./http"
import { InstallError } from "./installs"

export async function adminRoute(req: Request, event: string, fn: () => Promise<Response>, installId?: string): Promise<Response> {
  const auth = authAdmin(req)
  const ip = clientIp(req)
  if ("response" in auth) {
    await audit({ event, ok: false, ip, installId, reason: `auth_${auth.response.status}` })
    return auth.response
  }
  try {
    const res = await fn()
    await audit({ event, ok: res.ok, ip, installId })
    return res
  } catch (e) {
    if (e instanceof InstallError) {
      await audit({ event, ok: false, ip, installId, reason: e.code })
      return jsonError(e.code === "not_found" ? 404 : 400, e.code, { message: e.message })
    }
    console.error(`[${event}]`, (e as Error).message)
    await audit({ event, ok: false, ip, installId, reason: "internal" })
    return jsonError(500, "provider_error", { message: "Lỗi nội bộ" })
  }
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>
  } catch { /* rơi xuống lỗi bên dưới */ }
  throw new InstallError("bad_request", "thân yêu cầu phải là JSON object")
}
