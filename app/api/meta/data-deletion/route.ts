// POST /api/meta/data-deletion — Meta gửi yêu cầu xoá dữ liệu của khách (Data Deletion Request Callback URL).
import { handleMetaDataDeletion } from "@/lib/meta-callbacks"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return handleMetaDataDeletion(req)
}
