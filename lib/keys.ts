// ============================================================
// Khoá bản cài: mbk_<installId>_<32 byte base64url>.
// Cổng chỉ lưu SHA-256 của khoá. installId nằm trong khoá để tra bản cài mà không phải dò mọi hash.
// Xoay khoá: khoá cũ còn dùng được PREV_KEY_GRACE_MS để bản cài kịp đổi biến môi trường.
// ============================================================
import crypto from "crypto"
import { safeEqualHex, sha256Hex } from "./crypto"

export const PREV_KEY_GRACE_MS = 24 * 60 * 60 * 1000

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789" // bỏ l, o, 0, 1 cho dễ đọc khi gõ tay
const ID_LENGTH = 12
const KEY_RE = /^mbk_([a-z2-9]{12})_([A-Za-z0-9_-]{43})$/

export function newInstallId(): string {
  const bytes = crypto.randomBytes(ID_LENGTH)
  let id = ""
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length]
  return id
}

export function newInstallKey(installId: string): string {
  return `mbk_${installId}_${crypto.randomBytes(32).toString("base64url")}`
}

export function hashInstallKey(key: string): string {
  return sha256Hex(key)
}

/** Trả installId nếu khoá đúng dạng, ngược lại null. Chưa kiểm khoá có hợp lệ không. */
export function installIdFromKey(key: string): string | null {
  const m = KEY_RE.exec(key)
  return m ? m[1] : null
}

export interface KeyHashes {
  keyHash: string
  prevKeyHash?: string
  prevKeyExpiresAt?: string
}

export function keyMatches(install: KeyHashes, key: string, now = Date.now()): boolean {
  const h = hashInstallKey(key)
  if (safeEqualHex(h, install.keyHash)) return true
  if (install.prevKeyHash && install.prevKeyExpiresAt && Date.parse(install.prevKeyExpiresAt) > now) {
    return safeEqualHex(h, install.prevKeyHash)
  }
  return false
}
