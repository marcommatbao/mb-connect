// ============================================================
// Gọi Google OAuth (chỉ ở cổng — nơi DUY NHẤT có client secret).
// Tài liệu: https://developers.google.com/identity/protocols/oauth2/web-server
// ============================================================
import { googleClient, googleRedirectUri } from "../config"

export const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords"
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
const TIMEOUT_MS = 10_000

export class GoogleOAuthError extends Error {
  constructor(public reason: string, message: string) {
    super(message)
  }
}

function requireConfig() {
  const client = googleClient()
  const redirectUri = googleRedirectUri()
  if (!client || !redirectUri) throw new GoogleOAuthError("misconfigured", "Thiếu GOOGLE_OAUTH_CLIENT_ID/SECRET hoặc GATEWAY_URL")
  return { ...client, redirectUri }
}

export function googleAuthUrl(state: string): string {
  const { clientId, redirectUri } = requireConfig()
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Chỉ một quyền: thêm openid/email là phình hồ sơ xác minh (mini-spec mục 4).
    scope: GOOGLE_ADS_SCOPE,
    access_type: "offline",
    // consent: luôn trả refresh token; select_account: khách chọn đúng tài khoản Google có quyền Ads.
    prompt: "consent select_account",
    state,
  })
  return `${AUTH_ENDPOINT}?${q}`
}

async function postForm(url: string, body: Record<string, string>): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch { /* revoke trả thân rỗng khi thành công */ }
  return { status: res.status, data }
}

/** Đổi code lấy refresh token. Khách bỏ tích quyền Google Ads trên màn hình đồng ý → scope_denied. */
export async function exchangeGoogleCode(code: string): Promise<{ refreshToken: string; accessToken: string; expiresIn: number; scopes: string[] }> {
  const { clientId, clientSecret, redirectUri } = requireConfig()
  const { data } = await postForm(TOKEN_ENDPOINT, { code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
  if (typeof data.error === "string") throw new GoogleOAuthError(data.error, String(data.error_description ?? data.error))
  const scopes = String(data.scope ?? "").split(/\s+/).filter(Boolean)
  if (!scopes.includes(GOOGLE_ADS_SCOPE)) {
    if (typeof data.access_token === "string") await revokeGoogleToken(data.access_token)
    throw new GoogleOAuthError("scope_denied", "Khách chưa cấp quyền Google Ads")
  }
  if (typeof data.refresh_token !== "string" || typeof data.access_token !== "string") {
    throw new GoogleOAuthError("no_refresh_token", "Google không trả refresh token")
  }
  return { refreshToken: data.refresh_token, accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600, scopes }
}

/** invalid_grant = khách đã thu hồi quyền / token hết hạn → kết nối phải đánh dấu revoked. */
export async function refreshGoogleAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const { clientId, clientSecret } = requireConfig()
  const { data } = await postForm(TOKEN_ENDPOINT, { refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" })
  if (typeof data.error === "string") throw new GoogleOAuthError(data.error, String(data.error_description ?? data.error))
  if (typeof data.access_token !== "string") throw new GoogleOAuthError("bad_response", "Google không trả access token")
  return { accessToken: data.access_token, expiresIn: Number(data.expires_in) || 3600 }
}

/** Thu hồi ở Google. Không ném lỗi: thất bại chỉ ghi log (token đã xoá phía cổng vẫn là xoá). */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  try {
    const { status } = await postForm(REVOKE_ENDPOINT, { token })
    return status === 200
  } catch (e) {
    console.error("[google.revoke]", (e as Error).message)
    return false
  }
}
