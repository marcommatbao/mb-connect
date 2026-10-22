// GET  /api/admin/installs — danh sách bản cài (không có hash khoá)
// POST /api/admin/installs — tạo bản cài { name, appUrl, note? } → { install, key } (khoá thô chỉ hiện lần này)
import { adminRoute, readJsonBody } from "@/lib/admin-route"
import { json } from "@/lib/http"
import { createInstall } from "@/lib/installs"
import { listInstalls, publicInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return adminRoute(req, "admin.installs.list", async () => json({ installs: listInstalls().map(publicInstall) }))
}

export async function POST(req: Request) {
  return adminRoute(req, "admin.installs.create", async () => {
    const body = await readJsonBody(req)
    const { install, key } = await createInstall({
      name: String(body.name ?? ""),
      appUrl: String(body.appUrl ?? ""),
      note: typeof body.note === "string" ? body.note : undefined,
    })
    return json({ install: publicInstall(install), key, warning: "Khoá chỉ hiện một lần. Đặt vào MB_CONNECT_INSTALL_KEY của bản cài." }, 201)
  })
}
