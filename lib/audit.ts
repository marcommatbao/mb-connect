// ============================================================
// Nhật ký sự kiện: data/audit/YYYY-MM-DD.jsonl (ngày UTC), mỗi dòng một sự kiện.
// KHÔNG BAO GIỜ ghi token, code, khoá, state thô. Trường `ref` dùng 8 ký tự đầu SHA-256 nếu cần đối chiếu.
// ============================================================
import { promises as fsp } from "fs"
import { dataPath } from "./data-dir"
import { withFileLock } from "./file-lock"

export interface AuditEvent {
  event: string
  ok: boolean
  installId?: string
  connectionId?: string
  provider?: string
  ip?: string
  reason?: string
  ref?: string
}

const FORBIDDEN_KEYS = ["token", "secret", "code", "key", "state", "password"]

export async function audit(e: AuditEvent): Promise<void> {
  for (const k of Object.keys(e)) {
    if (FORBIDDEN_KEYS.includes(k)) throw new Error(`audit: trường "${k}" không được ghi vào nhật ký`)
  }
  const ts = new Date().toISOString()
  const file = dataPath("audit", `${ts.slice(0, 10)}.jsonl`)
  const line = JSON.stringify({ ts, ...e }) + "\n"
  try {
    await withFileLock(file, async () => {
      await fsp.mkdir(dataPath("audit"), { recursive: true })
      await fsp.appendFile(file, line, "utf8")
    })
  } catch (err) {
    // Không chặn luồng chính vì lỗi ghi nhật ký, nhưng phải để lại dấu vết trong log tiến trình.
    console.error("[audit] ghi nhật ký thất bại:", (err as Error).message)
  }
}
