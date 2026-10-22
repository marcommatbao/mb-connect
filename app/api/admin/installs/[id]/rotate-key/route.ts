// POST /api/admin/installs/:id/rotate-key — khoá mới (trả một lần); khoá cũ còn dùng được 24 giờ
import { adminRoute } from "@/lib/admin-route"
import { json } from "@/lib/http"
import { rotateInstallKey } from "@/lib/installs"
import { publicInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return adminRoute(req, "admin.installs.rotate_key", async () => {
    const { install, key } = await rotateInstallKey(id)
    return json({ install: publicInstall(install), key, warning: "Khoá cũ hết hiệu lực sau 24 giờ. Đổi MB_CONNECT_INSTALL_KEY của bản cài trước lúc đó." })
  }, id)
}
