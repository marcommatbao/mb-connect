// GET /api/healthz — công khai. ok=true chỉ khi GHI ĐƯỢC ổ dữ liệu và khoá mã hoá hợp lệ
// (bài học AdsCommand: /health xanh mà phụ thuộc chết là báo sai).
import { promises as fsp } from "fs"
import crypto from "crypto"
import { assertEncryptionKeyConfigured } from "@/lib/crypto"
import { dataDir, dataPath } from "@/lib/data-dir"
import { json } from "@/lib/http"
import pkg from "@/package.json"

export const dynamic = "force-dynamic"

async function storeWritable(): Promise<boolean> {
  const probe = dataPath(`.healthz-${crypto.randomBytes(4).toString("hex")}`)
  try {
    await fsp.mkdir(dataDir(), { recursive: true })
    await fsp.writeFile(probe, "ok")
    await fsp.unlink(probe)
    return true
  } catch {
    return false
  }
}

export async function GET() {
  let encryptionKey = true
  try {
    assertEncryptionKeyConfigured()
  } catch {
    encryptionKey = false
  }
  const writable = await storeWritable()
  const ok = writable && encryptionKey
  return json({ ok, version: pkg.version, checks: { storeWritable: writable, encryptionKey }, time: new Date().toISOString() }, ok ? 200 : 503)
}
