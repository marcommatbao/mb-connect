// ============================================================
// Mã hoá từng trường khi lưu (AES-256-GCM), chép cách làm của AdsCommand lib/crypto/data-encryption.ts.
// Khoá riêng của cổng: GATEWAY_ENCRYPTION_KEY (openssl rand -base64 32). Thiếu / sai độ dài → ném lỗi,
// không bao giờ lưu bản rõ thay thế.
// ============================================================
import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH_BYTES = 12

export interface EncryptedField {
  __enc: true
  iv: string
  tag: string
  data: string
}

export class MissingEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MissingEncryptionKeyError"
  }
}

let cachedKey: { raw: string; key: Buffer } | null = null

function getKey(): Buffer {
  const raw = process.env.GATEWAY_ENCRYPTION_KEY ?? ""
  if (cachedKey && cachedKey.raw === raw) return cachedKey.key
  if (!raw) {
    throw new MissingEncryptionKeyError("GATEWAY_ENCRYPTION_KEY chưa đặt. Tạo bằng: openssl rand -base64 32")
  }
  const key = Buffer.from(raw, "base64")
  if (key.length !== 32) {
    throw new MissingEncryptionKeyError(`GATEWAY_ENCRYPTION_KEY phải là 32 byte sau khi giải base64 (đang là ${key.length}).`)
  }
  cachedKey = { raw, key }
  return key
}

/** Gọi ở healthz để báo cấu hình sai sớm, thay vì chờ lượt lưu token đầu tiên mới hỏng. */
export function assertEncryptionKeyConfigured(): void {
  getKey()
}

export function encryptField(plaintext: string): EncryptedField {
  const iv = crypto.randomBytes(IV_LENGTH_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return { __enc: true, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") }
}

/** Ném lỗi khi sai khoá hoặc dữ liệu bị sửa (GCM auth tag không khớp). */
export function decryptField(field: EncryptedField): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(field.iv, "base64"))
  decipher.setAuthTag(Buffer.from(field.tag, "base64"))
  return Buffer.concat([decipher.update(Buffer.from(field.data, "base64")), decipher.final()]).toString("utf8")
}

export function isEncryptedField(value: unknown): value is EncryptedField {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).__enc === true
}

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex")
}

/** So hai chuỗi hex cùng độ dài trong thời gian hằng; khác độ dài → false. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex")
  const bb = Buffer.from(b, "hex")
  return ab.length === bb.length && ab.length > 0 && crypto.timingSafeEqual(ab, bb)
}
