// GET /api/v1/install — bản cài tự kiểm khoá của mình: { id, name, status, connections } (không có secret).
import { json } from "@/lib/http"
import { installRoute } from "@/lib/install-route"
import { connectionsOf, publicConnection } from "@/lib/store"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return installRoute(req, "v1.install", async (install) => json({
    id: install.id,
    name: install.name,
    status: install.status,
    connections: connectionsOf(install.id).filter((c) => c.status !== "revoked").map(publicConnection),
  }))
}
