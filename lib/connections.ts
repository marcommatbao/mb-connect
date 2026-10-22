// ============================================================
// Vòng đời kết nối: pending (sau callback) → active (bản cài xác nhận nonce) → revoked.
// Thu hồi ở Google CHỈ khi người dùng chủ động ngắt kết nối hoặc Mắt Bão thu hồi bản cài: Google gỡ cả quyền của tài khoản
// Google với client Mắt Bão, nên revoke khi thay kết nối / dọn pending sẽ giết luôn kết nối mới cùng tài khoản (review 22/10, điểm 2).
// Cấp access token cho bản cài; cache theo kết nối, làm mới trước hạn 60 giây, một lượt làm mới cho nhiều lượt gọi cùng lúc.
// ============================================================
import crypto from "crypto"
import { decryptField, encryptField, safeEqualHex, sha256Hex } from "./crypto"
import { GoogleOAuthError, refreshGoogleAccessToken, revokeGoogleToken } from "./providers/google"
import { listConnections, listInstalls, mutateConnections, type Connection, type Provider } from "./store"

export const PENDING_CONFIRM_MS = 15 * 60 * 1000
const REFRESH_EARLY_MS = 60_000

export class ConnectionError extends Error {
  constructor(public code: "not_found" | "bad_request" | "connection_missing" | "provider_error", message: string) {
    super(message)
  }
}

async function revokeAtProvider(provider: Provider, secret: string): Promise<void> {
  if (provider === "google") await revokeGoogleToken(secret)
  // Meta: thêm ở bước 5 (mini-spec GATEWAY-CONNECT-1).
}

export async function createPendingConnection(input: {
  installId: string; provider: Provider; createdBy: string; scopes: string[]; secret: string; nonceHash: string
}): Promise<Connection> {
  const now = Date.now()
  const conn: Connection = {
    id: `c_${crypto.randomBytes(9).toString("base64url")}`,
    installId: input.installId,
    provider: input.provider,
    status: "pending",
    createdAt: new Date(now).toISOString(),
    createdBy: input.createdBy,
    scopes: input.scopes,
    secret: encryptField(input.secret),
    nonceHash: input.nonceHash,
    pendingExpiresAt: new Date(now + PENDING_CONFIRM_MS).toISOString(),
  }
  await mutateConnections((list) => { list.push(conn) })
  return conn
}

/** Gỡ bí mật khỏi bản ghi, đánh dấu revoked; trả bí mật (đã giải mã) để thu hồi ở nhà cung cấp SAU khi nhả khoá ghi (nếu cần). */
function stripAndRevoke(c: Connection, nowIso: string): string | null {
  let secret: string | null = null
  if (c.secret) {
    try { secret = decryptField(c.secret) } catch { /* sai khoá: vẫn xoá bản ghi */ }
  }
  delete c.secret
  delete c.nonceHash
  delete c.pendingExpiresAt
  c.status = "revoked"
  c.revokedAt = nowIso
  tokenCache.delete(c.id)
  return secret
}

/** Kết nối pending quá hạn xác nhận → xoá bí mật (KHÔNG revoke ở Google: có thể giết kết nối active cùng tài khoản). */
export async function sweepExpiredPending(now = Date.now()): Promise<number> {
  return mutateConnections((list) => {
    let count = 0
    for (const c of list) {
      if (c.status === "pending" && c.pendingExpiresAt && Date.parse(c.pendingExpiresAt) <= now) {
        stripAndRevoke(c, new Date(now).toISOString())
        count++
      }
    }
    return count
  })
}

/**
 * Dọn định kỳ (instrumentation.ts, 5 phút): pending quá hạn + kết nối còn sót của bản cài đã thu hồi
 * (thu hồi bản cài ghi trạng thái trước, kết nối sau — chết giữa chừng thì lượt dọn này làm nốt; review 22/10, điểm 8).
 */
export async function periodicSweep(now = Date.now()): Promise<{ expiredPending: number; orphaned: number }> {
  const expiredPending = await sweepExpiredPending(now)
  const revokedInstalls = new Set(listInstalls().filter((i) => i.status === "revoked").map((i) => i.id))
  let orphaned = 0
  const leftovers = new Set(listConnections().filter((c) => c.status !== "revoked" && revokedInstalls.has(c.installId)).map((c) => c.installId))
  for (const id of leftovers) orphaned += await revokeAllOfInstall(id)
  return { expiredPending, orphaned }
}

/**
 * Bản cài xác nhận kết nối bằng nonce. Đúng → active, và mọi kết nối active cũ cùng nhà cung cấp của bản cài bị thu hồi
 * (mỗi bản cài tối đa một kết nối active / nhà cung cấp).
 */
export async function confirmConnection(installId: string, connectionId: string, nonce: string, now = Date.now()): Promise<Connection> {
  await sweepExpiredPending(now)
  const conn = await mutateConnections((list) => {
    const c = list.find((x) => x.id === connectionId && x.installId === installId)
    if (!c) throw new ConnectionError("not_found", "không có kết nối")
    if (c.status === "active") return c // xác nhận lặp lại (khách tải lại trang) — không lỗi
    if (c.status !== "pending" || !c.nonceHash) throw new ConnectionError("bad_request", "kết nối không còn chờ xác nhận")
    if (!safeEqualHex(sha256Hex(nonce), c.nonceHash)) throw new ConnectionError("bad_request", "nonce không khớp")
    const iso = new Date(now).toISOString()
    for (const old of list) {
      // Kết nối cũ bị thay: chỉ xoá token ở cổng. Khách kết nối lại bằng CÙNG tài khoản Google là chuyện thường.
      if (old.id !== c.id && old.installId === installId && old.provider === c.provider && old.status === "active") stripAndRevoke(old, iso)
    }
    c.status = "active"
    c.activatedAt = iso
    delete c.nonceHash
    delete c.pendingExpiresAt
    return c
  })
  return conn
}

/** Người dùng chủ động ngắt kết nối → xoá token ở cổng + thu hồi ở nhà cung cấp. */
export async function revokeConnection(installId: string | null, connectionId: string): Promise<Connection> {
  let secret: string | null = null
  const conn = await mutateConnections((list) => {
    const c = list.find((x) => x.id === connectionId && (installId === null || x.installId === installId))
    if (!c) throw new ConnectionError("not_found", "không có kết nối")
    if (c.status !== "revoked") secret = stripAndRevoke(c, new Date().toISOString())
    return c
  })
  if (secret) await revokeAtProvider(conn.provider, secret)
  return conn
}

/** Thu hồi mọi kết nối của một bản cài (khi Mắt Bão thu hồi bản cài). */
export async function revokeAllOfInstall(installId: string): Promise<number> {
  const toRevoke: Array<{ provider: Provider; secret: string }> = []
  const n = await mutateConnections((list) => {
    let count = 0
    const iso = new Date().toISOString()
    for (const c of list) {
      if (c.installId === installId && c.status !== "revoked") {
        const s = stripAndRevoke(c, iso)
        if (s) toRevoke.push({ provider: c.provider, secret: s })
        count++
      }
    }
    return count
  })
  for (const r of toRevoke) await revokeAtProvider(r.provider, r.secret)
  return n
}

// ── Cấp token ──────────────────────────────────────────────────────────────

const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>()
const inflight = new Map<string, Promise<{ accessToken: string; expiresAt: number }>>()

export function resetTokenCacheForTests(): void {
  tokenCache.clear()
  inflight.clear()
}

/** Ghi sẵn token vừa nhận lúc callback (đỡ một lượt làm mới đầu tiên). */
export function primeToken(connectionId: string, accessToken: string, expiresInSec: number, now = Date.now()): void {
  tokenCache.set(connectionId, { accessToken, expiresAt: now + expiresInSec * 1000 })
}

/** Token đã chết ở Google (invalid_grant): xoá ở cổng, không gọi revoke. */
async function markDead(connectionId: string): Promise<void> {
  await mutateConnections((list) => {
    const c = list.find((x) => x.id === connectionId)
    if (c && c.status !== "revoked") stripAndRevoke(c, new Date().toISOString())
  })
}

export async function issueAccessToken(installId: string, connectionId: string, now = Date.now()): Promise<{ accessToken: string; expiresAt: number; provider: Provider }> {
  const c = listConnections().find((x) => x.id === connectionId && x.installId === installId)
  if (!c || c.status !== "active" || !c.secret) throw new ConnectionError("connection_missing", "kết nối không còn hoạt động")

  const cached = tokenCache.get(c.id)
  if (cached && cached.expiresAt - REFRESH_EARLY_MS > now) return { ...cached, provider: c.provider }

  if (c.provider !== "google") throw new ConnectionError("provider_error", "nhà cung cấp chưa hỗ trợ ở bản này")

  let p = inflight.get(c.id)
  if (!p) {
    const secret = c.secret
    p = (async () => {
      try {
        const r = await refreshGoogleAccessToken(decryptField(secret))
        // Trong lúc chờ Google, kết nối có thể đã bị ngắt / thay → không cấp, không cache (review 22/10, điểm 7).
        const still = listConnections().find((x) => x.id === c.id)
        if (!still || still.status !== "active") throw new ConnectionError("connection_missing", "kết nối vừa bị ngắt")
        const entry = { accessToken: r.accessToken, expiresAt: Date.now() + r.expiresIn * 1000 }
        tokenCache.set(c.id, entry)
        return entry
      } catch (e) {
        if (e instanceof ConnectionError) throw e
        if (e instanceof GoogleOAuthError && e.reason === "invalid_grant") {
          // Khách đã thu hồi quyền ở Google (hoặc token hết hạn): kết nối chết thật → đánh dấu để bản cài báo "kết nối lại".
          await markDead(c.id)
          throw new ConnectionError("connection_missing", "khách đã thu hồi quyền ở Google — cần kết nối lại")
        }
        throw new ConnectionError("provider_error", e instanceof Error ? e.message : "lỗi Google")
      } finally {
        inflight.delete(c.id)
      }
    })()
    inflight.set(c.id, p)
  }
  return { ...(await p), provider: c.provider }
}
