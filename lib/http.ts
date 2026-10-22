// ============================================================
// Tiện ích HTTP chung: trả lỗi theo mã ổn định, lấy IP khách, xác thực bản cài và quản trị.
// ============================================================
import { BlockList, isIP } from "net"
import { safeEqualHex, sha256Hex } from "./crypto"
import { installIdFromKey, keyMatches } from "./keys"
import { getInstall, type Install } from "./store"

export type ErrorCode =
  | "unauthorized" | "forbidden" | "not_found" | "bad_request" | "rate_limited"
  | "install_suspended" | "install_revoked" | "connection_missing" | "provider_error" | "misconfigured"

export function jsonError(status: number, error: ErrorCode, extra?: Record<string, unknown>, headers?: HeadersInit): Response {
  return Response.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store", ...headers } })
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

/** Cùng quy tắc với AdsCommand lib/rate-limit.ts getClientIp: IP thật là mục thứ TRUSTED_PROXY_HOPS tính từ cuối X-Forwarded-For. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) {
    const parts = xff.split(",").map((p) => p.trim()).filter(Boolean)
    const hops = Math.max(1, Math.min(5, Number(process.env.TRUSTED_PROXY_HOPS) || 1))
    if (parts.length > 0) return parts[Math.max(0, parts.length - hops)]
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown"
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? ""
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1] : null
}

// ── Bản cài ────────────────────────────────────────────────────────────────

/**
 * Xác thực bản cài bằng khoá. Khoá sai dạng / không có bản cài / sai khoá → cùng một lỗi 401 (không cho dò).
 * Bản cài bị tạm ngưng / thu hồi → mã lỗi riêng để bản cài báo đúng cho khách.
 */
export function authInstall(req: Request): { install: Install } | { response: Response } {
  const key = bearer(req)
  const id = key ? installIdFromKey(key) : null
  const install = id ? getInstall(id) : null
  if (!key || !install || !keyMatches(install, key)) return { response: jsonError(401, "unauthorized") }
  if (install.status === "revoked") return { response: jsonError(403, "install_revoked") }
  if (install.status === "suspended") return { response: jsonError(403, "install_suspended") }
  return { install }
}

// ── Quản trị ───────────────────────────────────────────────────────────────

const MIN_ADMIN_TOKEN_LENGTH = 32

function adminCidrList(): BlockList | "any" | null {
  const raw = (process.env.GATEWAY_ADMIN_CIDRS ?? "").trim()
  if (!raw) return null
  if (raw === "any") return "any"
  const list = new BlockList()
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const [addr, bitsRaw] = item.split("/")
    const family = isIP(addr) === 6 ? "ipv6" : isIP(addr) === 4 ? "ipv4" : null
    if (!family) throw new Error(`GATEWAY_ADMIN_CIDRS: "${item}" không phải IP/CIDR hợp lệ`)
    const bits = bitsRaw === undefined ? (family === "ipv4" ? 32 : 128) : Number(bitsRaw)
    list.addSubnet(addr, bits, family)
  }
  return list
}

/**
 * Quản trị cần CẢ khoá quản trị (≥ 32 ký tự) LẪN IP nằm trong GATEWAY_ADMIN_CIDRS.
 * Thiếu cấu hình → 503 misconfigured (đóng khi thiếu, không bao giờ mở). Muốn bỏ lọc IP phải ghi rõ "any".
 */
export function authAdmin(req: Request): { ok: true } | { response: Response } {
  const expected = process.env.GATEWAY_ADMIN_TOKEN ?? ""
  let cidrs: BlockList | "any" | null
  try {
    cidrs = adminCidrList()
  } catch {
    return { response: jsonError(503, "misconfigured") }
  }
  if (expected.length < MIN_ADMIN_TOKEN_LENGTH || !cidrs) return { response: jsonError(503, "misconfigured") }

  const got = bearer(req)
  if (!got || !safeEqualHex(sha256Hex(got), sha256Hex(expected))) return { response: jsonError(401, "unauthorized") }

  if (cidrs !== "any") {
    // Proxy có thể ghi IPv4 dạng IPv6 bọc (::ffff:1.2.3.4) → đưa về IPv4 để so với dải IPv4 đã khai.
    const ip = clientIp(req).replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1")
    const family = isIP(ip) === 6 ? "ipv6" : isIP(ip) === 4 ? "ipv4" : null
    if (!family || !cidrs.check(ip, family)) return { response: jsonError(403, "forbidden") }
  }
  return { ok: true }
}
