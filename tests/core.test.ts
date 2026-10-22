import crypto from "crypto"
import { beforeEach, describe, expect, it } from "vitest"
import { freshEnv } from "./setup-env"
import { decryptField, encryptField, safeEqualHex, MissingEncryptionKeyError } from "@/lib/crypto"
import { PREV_KEY_GRACE_MS, hashInstallKey, installIdFromKey, keyMatches, newInstallId, newInstallKey } from "@/lib/keys"
import { hit, resetRateLimitsForTests } from "@/lib/ratelimit"
import { audit } from "@/lib/audit"

beforeEach(() => { freshEnv(); resetRateLimitsForTests() })

describe("mã hoá trường", () => {
  it("mã hoá rồi giải mã ra đúng bản gốc, mỗi lần một IV khác", () => {
    const a = encryptField("1//refresh-token")
    const b = encryptField("1//refresh-token")
    expect(a.iv).not.toBe(b.iv)
    expect(JSON.stringify(a)).not.toContain("refresh-token")
    expect(decryptField(a)).toBe("1//refresh-token")
  })

  it("sai khoá → giải mã ném lỗi, không trả rác", () => {
    const enc = encryptField("secret")
    process.env.GATEWAY_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64")
    expect(() => decryptField(enc)).toThrow()
  })

  it("thiếu khoá hoặc khoá sai độ dài → ném MissingEncryptionKeyError", () => {
    delete process.env.GATEWAY_ENCRYPTION_KEY
    expect(() => encryptField("x")).toThrow(MissingEncryptionKeyError)
    process.env.GATEWAY_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64")
    expect(() => encryptField("x")).toThrow(MissingEncryptionKeyError)
  })

  it("safeEqualHex: khác độ dài hoặc rỗng → false", () => {
    expect(safeEqualHex("ab", "ab")).toBe(true)
    expect(safeEqualHex("ab", "abcd")).toBe(false)
    expect(safeEqualHex("", "")).toBe(false)
  })
})

describe("khoá bản cài", () => {
  it("định dạng mbk_<id>_<43 ký tự> và tách được installId", () => {
    const id = newInstallId()
    expect(id).toMatch(/^[a-z2-9]{12}$/)
    const key = newInstallKey(id)
    expect(installIdFromKey(key)).toBe(id)
    expect(installIdFromKey(key + "x")).toBeNull()
    expect(installIdFromKey("mbk_short_abc")).toBeNull()
  })

  it("khoá cũ chỉ còn hiệu lực trong hạn xoay", () => {
    const id = newInstallId()
    const oldKey = newInstallKey(id), newKey = newInstallKey(id)
    const now = Date.now()
    const install = { keyHash: hashInstallKey(newKey), prevKeyHash: hashInstallKey(oldKey), prevKeyExpiresAt: new Date(now + PREV_KEY_GRACE_MS).toISOString() }
    expect(keyMatches(install, newKey, now)).toBe(true)
    expect(keyMatches(install, oldKey, now)).toBe(true)
    expect(keyMatches(install, oldKey, now + PREV_KEY_GRACE_MS + 1)).toBe(false)
    expect(keyMatches(install, newInstallKey(id), now)).toBe(false)
  })
})

describe("giới hạn tần suất", () => {
  it("vượt ngưỡng trong cửa sổ → chặn, sang cửa sổ mới → mở", () => {
    const t = 1_000_000
    for (let i = 0; i < 3; i++) expect(hit("k", 3, 1000, t).ok).toBe(true)
    expect(hit("k", 3, 1000, t).ok).toBe(false)
    expect(hit("k", 3, 1000, t + 1001).ok).toBe(true)
  })
})

describe("nhật ký", () => {
  it("từ chối ghi trường nhạy cảm", async () => {
    await expect(audit({ event: "x", ok: true, token: "abc" } as never)).rejects.toThrow(/không được ghi/)
  })
})
