// GET    /api/v1/connections/:id — thông tin kết nối của CHÍNH bản cài (không có secret)
// DELETE /api/v1/connections/:id — khách bấm "Ngắt kết nối": xoá token ở cổng + thu hồi ở nhà cung cấp
import { revokeConnection } from "@/lib/connections"
import { json, jsonError } from "@/lib/http"
import { installRoute } from "@/lib/install-route"
import { listConnections, publicConnection } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return installRoute(req, "v1.connections.get", async (install) => {
    const c = listConnections().find((x) => x.id === id && x.installId === install.id)
    return c ? json(publicConnection(c)) : jsonError(404, "not_found")
  }, id)
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return installRoute(req, "v1.connections.revoke", async (install) => json(publicConnection(await revokeConnection(install.id, id))), id)
}
