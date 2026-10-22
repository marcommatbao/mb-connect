// GET /api/admin/installs/:id — một bản cài + danh sách kết nối (không có secret)
import { adminRoute } from "@/lib/admin-route"
import { json, jsonError } from "@/lib/http"
import { connectionsOf, getInstall, publicConnection, publicInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return adminRoute(req, "admin.installs.get", async () => {
    const install = getInstall(id)
    if (!install) return jsonError(404, "not_found")
    return json({ install: publicInstall(install), connections: connectionsOf(id).map(publicConnection) })
  }, id)
}
