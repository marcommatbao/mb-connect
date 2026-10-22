// POST /api/admin/installs/:id/revoke
import { adminRoute } from "@/lib/admin-route"
import { json } from "@/lib/http"
import { setInstallStatus } from "@/lib/installs"
import { publicInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return adminRoute(req, "admin.installs.revoke", async () => json({ install: publicInstall(await setInstallStatus(id, "revoke")) }), id)
}
