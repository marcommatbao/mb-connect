// POST /api/meta/deauthorize — Meta báo khách đã gỡ ứng dụng (Bỏ uỷ quyền URL gọi lại).
import { handleMetaDeauthorize } from "@/lib/meta-callbacks"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleMetaDeauthorize(req)
}
