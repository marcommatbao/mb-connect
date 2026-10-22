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
