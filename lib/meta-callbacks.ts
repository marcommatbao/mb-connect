// Hai callback Meta bắt buộc (Cài đặt ứng dụng → Nâng cao / Đăng nhập bằng Facebook → Bỏ uỷ quyền, và Xoá dữ liệu):
// Meta POST form signed_request (đã ký bằng app secret). Kiểm chữ ký → xoá token mọi kết nối của người dùng Meta đó.
import crypto from "crypto"
import { audit } from "./audit"
import { gatewayUrl } from "./config"
import { revokeMetaUser } from "./connections"
import { clientIp, json, jsonError } from "./http"
import { parseSignedRequest } from "./providers/meta"

async function readSigned(req: Request): Promise<{ userId: string } | null> {
  let signed = ""
  try {
    signed = String((await req.formData()).get("signed_request") ?? "")
  } catch { /* không phải form */ }
  return signed.length > 0 && signed.length < 4096 ? parseSignedRequest(signed) : null
}

export async function handleMetaDeauthorize(req: Request): Promise<Response> {
  const parsed = await readSigned(req)
  if (!parsed) return jsonError(400, "bad_request", { message: "signed_request không hợp lệ" })
  const n = await revokeMetaUser(parsed.userId)
  await audit({ event: "meta.deauthorize", ok: true, ip: clientIp(req), provider: "meta", reason: `revoked:${n}` })
  return json({ ok: true })
}

/** Meta cần { url, confirmation_code }: url là trang người dùng xem trạng thái xoá. Xoá chạy ngay nên trang chỉ xác nhận. */
export async function handleMetaDataDeletion(req: Request): Promise<Response> {
  const parsed = await readSigned(req)
  if (!parsed) return jsonError(400, "bad_request", { message: "signed_request không hợp lệ" })
  const n = await revokeMetaUser(parsed.userId)
  const code = `del_${crypto.randomBytes(9).toString("base64url")}`
  await audit({ event: "meta.data_deletion", ok: true, ip: clientIp(req), provider: "meta", reason: `revoked:${n} code:${code}` })
  return json({ url: `${gatewayUrl() ?? ""}/data-deletion?code=${code}`, confirmation_code: code })
}
