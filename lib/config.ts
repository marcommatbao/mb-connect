// Cấu hình đọc lúc chạy. Thiếu → hàm trả null, route trả 503 misconfigured (không bao giờ chạy nửa vời).
export function gatewayUrl(): string | null {
  const raw = process.env.GATEWAY_URL?.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.origin
  } catch {
    return null
  }
}

export function googleClient(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function googleRedirectUri(): string | null {
  const g = gatewayUrl()
  return g ? `${g}/api/oauth/google/callback` : null
}

/** Cookie Secure khi cổng chạy https (luôn đúng trên Vibe Host; chỉ tắt khi chạy http://localhost để phát triển). */
export function secureCookies(): boolean {
  return (gatewayUrl() ?? "https:").startsWith("https:")
}

/** Ứng dụng Meta "Mắt Bão Marketing": app id + secret + ID cấu hình Facebook Login for Business (mã truy cập người dùng hệ thống). */
export function metaApp(): { appId: string; appSecret: string; configId: string; version: string } | null {
  const appId = process.env.META_APP_ID?.trim()
  const appSecret = process.env.META_APP_SECRET?.trim()
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim()
  const version = (process.env.META_GRAPH_API_VERSION?.trim() || "v26.0").replace(/^(?!v)/, "v")
  return appId && appSecret && configId ? { appId, appSecret, configId, version } : null
}

export function metaRedirectUri(): string | null {
  const g = gatewayUrl()
  return g ? `${g}/api/oauth/meta/callback` : null
}
