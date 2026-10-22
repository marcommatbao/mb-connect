// ============================================================
// Nghiệp vụ sổ bản cài: tạo, xoay khoá, tạm ngưng / mở lại / thu hồi.
// Khoá thô chỉ trả ra ĐÚNG MỘT LẦN lúc tạo hoặc xoay; cổng chỉ giữ hash.
// ============================================================
import { PREV_KEY_GRACE_MS, hashInstallKey, newInstallId, newInstallKey } from "./keys"
import { mutateConnections, mutateInstalls, type Install, type InstallStatus } from "./store"

export class InstallError extends Error {
  constructor(public code: "bad_request" | "not_found", message: string) {
    super(message)
  }
}

/**
 * appUrl phải là origin https (không path, không query). Cho phép http://localhost để phát triển.
 * Cổng ghép đường quay về từ đây — nhận URL lộn xộn là mở đường chuyển hướng sai chỗ.
 */
export function normalizeAppUrl(input: string): string {
  let u: URL
  try {
    u = new URL(input.trim())
  } catch {
    throw new InstallError("bad_request", "appUrl không phải URL hợp lệ")
  }
  const localhost = u.hostname === "localhost" || u.hostname === "127.0.0.1"
  if (u.protocol !== "https:" && !(u.protocol === "http:" && localhost)) {
    throw new InstallError("bad_request", "appUrl phải dùng https")
  }
  if (u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) {
    throw new InstallError("bad_request", "appUrl chỉ gồm giao thức + tên miền (+ cổng), không có đường dẫn")
  }
  return u.origin
}

export async function createInstall(input: { name: string; appUrl: string; note?: string }): Promise<{ install: Install; key: string }> {
  const name = (input.name ?? "").trim()
  if (!name || name.length > 100) throw new InstallError("bad_request", "name bắt buộc, tối đa 100 ký tự")
  const appUrl = normalizeAppUrl(input.appUrl ?? "")
  const note = input.note?.trim().slice(0, 500) || undefined

  return mutateInstalls((installs) => {
    if (installs.some((i) => i.appUrl === appUrl && i.status !== "revoked")) {
      throw new InstallError("bad_request", "đã có bản cài đang hoạt động với appUrl này")
    }
    let id = newInstallId()
    while (installs.some((i) => i.id === id)) id = newInstallId()
    const key = newInstallKey(id)
    const now = new Date().toISOString()
    const install: Install = { id, name, appUrl, keyHash: hashInstallKey(key), status: "active", note, createdAt: now, updatedAt: now }
    installs.push(install)
    return { install, key }
  })
}

export async function rotateInstallKey(id: string): Promise<{ install: Install; key: string }> {
  return mutateInstalls((installs) => {
    const install = installs.find((i) => i.id === id)
    if (!install) throw new InstallError("not_found", "không có bản cài")
    if (install.status === "revoked") throw new InstallError("bad_request", "bản cài đã thu hồi, không xoay khoá được")
    const key = newInstallKey(id)
    const now = Date.now()
    install.prevKeyHash = install.keyHash
    install.prevKeyExpiresAt = new Date(now + PREV_KEY_GRACE_MS).toISOString()
    install.keyHash = hashInstallKey(key)
    install.updatedAt = new Date(now).toISOString()
    return { install, key }
  })
}

const TRANSITIONS: Record<"suspend" | "resume" | "revoke", { from: InstallStatus[]; to: InstallStatus }> = {
  suspend: { from: ["active"], to: "suspended" },
  resume: { from: ["suspended"], to: "active" },
  revoke: { from: ["active", "suspended"], to: "revoked" },
}

/**
 * Đổi trạng thái bản cài. Thu hồi = vĩnh viễn: xoá cả khoá cũ đang trong hạn xoay và đánh dấu mọi kết nối revoked.
 * (Thu hồi phía Google/Meta thêm ở bước nối OAuth — xem mini-spec GATEWAY-CONNECT-1 bước 2 và 5.)
 */
export async function setInstallStatus(id: string, action: keyof typeof TRANSITIONS): Promise<Install> {
  const rule = TRANSITIONS[action]
  const install = await mutateInstalls((installs) => {
    const i = installs.find((x) => x.id === id)
    if (!i) throw new InstallError("not_found", "không có bản cài")
    if (!rule.from.includes(i.status)) throw new InstallError("bad_request", `không thể ${action} khi đang ${i.status}`)
    i.status = rule.to
    i.updatedAt = new Date().toISOString()
    if (rule.to === "revoked") {
      delete i.prevKeyHash
      delete i.prevKeyExpiresAt
    }
    return i
  })
  if (rule.to === "revoked") {
    const now = new Date().toISOString()
    await mutateConnections((conns) => {
      for (const c of conns) if (c.installId === id && c.status !== "revoked") Object.assign(c, { status: "revoked", revokedAt: now })
    })
  }
  return install
}
