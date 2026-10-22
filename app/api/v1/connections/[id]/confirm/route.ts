// POST /api/v1/connections/:id/confirm { nonce } — bản cài xác nhận kết nối do CHÍNH nó mở (nonce nằm trong cookie trên miền bản cài).
// Đúng → active (kết nối active cũ cùng nhà cung cấp bị thu hồi). Sai / hết hạn → 400, kết nối pending sẽ bị dọn sau 15 phút.
import { confirmConnection } from "@/lib/connections"
import { json } from "@/lib/http"
import { BadRequest, installRoute, jsonBody } from "@/lib/install-route"
import { publicConnection } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return installRoute(req, "v1.connections.confirm", async (install) => {
    const nonce = String((await jsonBody(req)).nonce ?? "")
    if (nonce.length < 32 || nonce.length > 200) throw new BadRequest("nonce không hợp lệ")
    return json(publicConnection(await confirmConnection(install.id, id, nonce)))
  }, id)
}
