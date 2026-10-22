// ============================================================
// Kho dữ liệu của cổng (bản 1: tệp JSON trong data/, mã hoá trường bí mật).
// Mọi lượt ghi đi qua withFileLock + ghi nguyên tử. Chạy MỘT tiến trình (khoá chỉ trong tiến trình).
// Giữ giao diện hàm nhỏ để sau này thay bằng Postgres mà không đụng route.
// ============================================================
import fs from "fs"
import { dataPath } from "./data-dir"
import { withFileLock } from "./file-lock"
import { writeFileAtomic } from "./fs-atomic"
import type { EncryptedField } from "./crypto"

export type InstallStatus = "active" | "suspended" | "revoked"

export interface Install {
  id: string
  name: string
  /** Origin của bản cài (vd https://ads-manager.vibe.tinhgon.xyz) — cổng chỉ chuyển hướng về đây. */
  appUrl: string
  keyHash: string
  prevKeyHash?: string
  prevKeyExpiresAt?: string
  status: InstallStatus
  note?: string
  createdAt: string
  updatedAt: string
}

export type Provider = "google" | "meta"
export type ConnectionStatus = "pending" | "active" | "revoked"

export interface Connection {
  id: string
  installId: string
  provider: Provider
  status: ConnectionStatus
  createdAt: string
  createdBy: string
  scopes: string[]
  /** Google: refresh token; Meta: token doanh nghiệp. Luôn mã hoá. */
  secret: EncryptedField
  metaUserId?: string
  metaBusinessId?: string
  activatedAt?: string
  revokedAt?: string
}

interface InstallsFile { installs: Install[] }
interface ConnectionsFile { connections: Connection[] }

const installsPath = () => dataPath("installs.json")
const connectionsPath = () => dataPath("connections.json")

function readJson<T>(file: string, empty: T): T {
  let raw: string
  try {
    raw = fs.readFileSync(file, "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return empty
    throw e
  }
  // Tệp hỏng thì NÉM lỗi, không trả rỗng: trả rỗng rồi ghi đè là mất sạch sổ bản cài.
  return JSON.parse(raw) as T
}

export function listInstalls(): Install[] {
  return readJson<InstallsFile>(installsPath(), { installs: [] }).installs
}

export function getInstall(id: string): Install | null {
  return listInstalls().find((i) => i.id === id) ?? null
}

/** Đọc-sửa-ghi sổ bản cài dưới khoá. `fn` trả giá trị muốn đưa ra ngoài. */
export async function mutateInstalls<T>(fn: (installs: Install[]) => T): Promise<T> {
  const file = installsPath()
  return withFileLock(file, async () => {
    const data = readJson<InstallsFile>(file, { installs: [] })
    const result = fn(data.installs)
    await writeFileAtomic(file, JSON.stringify(data, null, 2))
    return result
  })
}

export function listConnections(): Connection[] {
  return readJson<ConnectionsFile>(connectionsPath(), { connections: [] }).connections
}

export function connectionsOf(installId: string): Connection[] {
  return listConnections().filter((c) => c.installId === installId)
}

export async function mutateConnections<T>(fn: (connections: Connection[]) => T): Promise<T> {
  const file = connectionsPath()
  return withFileLock(file, async () => {
    const data = readJson<ConnectionsFile>(file, { connections: [] })
    const result = fn(data.connections)
    await writeFileAtomic(file, JSON.stringify(data, null, 2))
    return result
  })
}

/** Dạng trả ra ngoài: không bao giờ có hash khoá. */
export function publicInstall(i: Install) {
  return { id: i.id, name: i.name, appUrl: i.appUrl, status: i.status, note: i.note, createdAt: i.createdAt, updatedAt: i.updatedAt,
    keyRotatedPendingUntil: i.prevKeyExpiresAt && Date.parse(i.prevKeyExpiresAt) > Date.now() ? i.prevKeyExpiresAt : undefined }
}

/** Dạng trả ra ngoài: không bao giờ có secret. */
export function publicConnection(c: Connection) {
  return { id: c.id, installId: c.installId, provider: c.provider, status: c.status, createdAt: c.createdAt, createdBy: c.createdBy,
    scopes: c.scopes, activatedAt: c.activatedAt, revokedAt: c.revokedAt, metaBusinessId: c.metaBusinessId }
}
