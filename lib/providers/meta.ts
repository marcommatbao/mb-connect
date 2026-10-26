// ============================================================
// Gọi Meta (chỉ ở cổng — nơi DUY NHẤT có app secret).
// Facebook Login for Business với cấu hình "mã truy cập người dùng hệ thống": khách chọn doanh nghiệp + tài sản (tài khoản
// quảng cáo, Trang, Pixel) trên hộp thoại của Meta; code đổi ra token của người dùng hệ thống tích hợp doanh nghiệp, KHÔNG hết hạn.
// Không có refresh token: cổng giữ chính token đó (mã hoá) và kiểm còn sống bằng debug_token trước khi cấp cho bản cài.
// Tài liệu: https://developers.facebook.com/docs/facebook-login/facebook-login-for-business
// ============================================================
import crypto from "crypto"
import { metaApp, metaRedirectUri } from "../config"

export const META_REQUIRED_SCOPE = "ads_management"
export const META_AUTH_ORIGINS = ["https://www.facebook.com", "https://web.facebook.com", "https://m.facebook.com"]
const TIMEOUT_MS = 10_000

export class MetaOAuthError extends Error {
  constructor(public reason: string, message: string) {
    super(message)
  }
}

function requireConfig() {
  const app = metaApp()
  const redirectUri = metaRedirectUri()
  if (!app || !redirectUri) throw new MetaOAuthError("misconfigured", "Thiếu META_APP_ID/META_APP_SECRET/META_LOGIN_CONFIG_ID hoặc GATEWAY_URL")
  return { ...app, redirectUri }
}

const graph = (version: string) => `https://graph.facebook.com/${version}`

export function metaAuthUrl(state: string): string {
  const { appId, configId, version, redirectUri } = requireConfig()
  const q = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    config_id: configId,
    response_type: "code",
    // Bắt buộc với cấu hình mã người dùng hệ thống: không có thì Meta trả token người dùng thay vì code.
    override_default_response_type: "true",
  })
  return `https://www.facebook.com/${version}/dialog/oauth?${q}`
}

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
  let data: Record<string, unknown> = {}
  try { data = (await res.json()) as Record<string, unknown> } catch { /* thân rỗng */ }
  return { status: res.status, data }
}

const graphError = (data: Record<string, unknown>) => {
  const e = data.error as { message?: string; type?: string; code?: number } | undefined
  return e ? `${e.message ?? "lỗi Meta"}${e.code ? ` (#${e.code})` : ""}` : null
}

export interface MetaTokenInfo {
  valid: boolean
  appId: string
  userId: string
  type: string
  /** 0 = không hết hạn. */
  expiresAt: number
  scopes: string[]
}

/** Hỏi Meta token còn sống không + quyền gì (dùng app access token = appId|secret, không cần lưu thêm gì). */
export async function inspectMetaToken(token: string): Promise<MetaTokenInfo> {
  const { appId, appSecret, version } = requireConfig()
  const q = new URLSearchParams({ input_token: token, access_token: `${appId}|${appSecret}` })
  const { data } = await getJson(`${graph(version)}/debug_token?${q}`)
  const err = graphError(data)
  if (err) throw new MetaOAuthError("provider_error", err)
  const d = (data.data ?? {}) as Record<string, unknown>
  return {
    valid: d.is_valid === true,
    appId: String(d.app_id ?? ""),
    userId: String(d.user_id ?? ""),
    type: String(d.type ?? ""),
    expiresAt: Number(d.expires_at ?? 0) || 0,
    // Token người dùng hệ thống doanh nghiệp: quyền có thể chỉ nằm trong granular_scopes (theo từng tài sản) — gộp cả hai.
    scopes: [...new Set([
      ...(Array.isArray(d.scopes) ? d.scopes.map(String) : []),
      ...(Array.isArray(d.granular_scopes) ? d.granular_scopes.map((g) => String((g as { scope?: unknown })?.scope ?? "")).filter(Boolean) : []),
    ])],
  }
}

/**
 * Đổi code lấy token doanh nghiệp, rồi kiểm bằng debug_token: đúng app của Mắt Bão, còn hiệu lực, có ads_management.
 * Khách bỏ tích quyền quảng cáo trên hộp thoại → scope_denied (token không được lưu).
 */
export async function exchangeMetaCode(code: string): Promise<{ token: string; userId: string; scopes: string[]; expiresAt: number }> {
  const { appId, appSecret, version, redirectUri } = requireConfig()
  const q = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code })
  const { data } = await getJson(`${graph(version)}/oauth/access_token?${q}`)
  const err = graphError(data)
  if (err) throw new MetaOAuthError("provider_error", err)
  if (typeof data.access_token !== "string") throw new MetaOAuthError("provider_error", "Meta không trả access token")
  const info = await inspectMetaToken(data.access_token)
  if (!info.valid || info.appId !== appId) throw new MetaOAuthError("provider_error", "Token Meta không hợp lệ cho ứng dụng này")
  if (!info.scopes.includes(META_REQUIRED_SCOPE)) {
    // Ghi đúng cái Meta trả (KHÔNG ghi token) để chẩn đoán — lần chạy thật đầu tiên 26/10 rơi vào nhánh này.
    console.warn(`[meta.exchange] thiếu ${META_REQUIRED_SCOPE}: type=${info.type} scopes=${JSON.stringify(info.scopes)}`)
    throw new MetaOAuthError("scope_denied", "Khách chưa cấp quyền quản lý quảng cáo")
  }
  return { token: data.access_token, userId: info.userId, scopes: info.scopes, expiresAt: info.expiresAt }
}

/** Gỡ quyền ở Meta (khách chủ động ngắt / Mắt Bão thu hồi bản cài). Không ném lỗi — token đã xoá ở cổng vẫn là xoá. */
export async function revokeMetaToken(token: string): Promise<boolean> {
  try {
    const { version } = requireConfig()
    const { status, data } = await getJson(`${graph(version)}/me/permissions?access_token=${encodeURIComponent(token)}`, { method: "DELETE" })
    return status === 200 && data.success === true
  } catch (e) {
    console.error("[meta.revoke]", (e as Error).message)
    return false
  }
}

/**
 * signed_request Meta gửi tới callback huỷ cấp quyền / xoá dữ liệu: base64url(chữ ký).base64url(JSON), ký HMAC-SHA256 bằng
 * app secret. Sai chữ ký / sai thuật toán → null (không tin bất kỳ trường nào).
 */
export function parseSignedRequest(signed: string): { userId: string; issuedAt: number } | null {
  const app = metaApp()
  if (!app) return null
  const [sigPart, payloadPart, extra] = signed.split(".")
  if (!sigPart || !payloadPart || extra !== undefined) return null
  const expected = crypto.createHmac("sha256", app.appSecret).update(payloadPart).digest()
  const got = Buffer.from(sigPart, "base64url")
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null
  try {
    const p = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as Record<string, unknown>
    if (String(p.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null
    const userId = String(p.user_id ?? "")
    return /^\d{1,30}$/.test(userId) ? { userId, issuedAt: Number(p.issued_at ?? 0) } : null
  } catch {
    return null
  }
}
