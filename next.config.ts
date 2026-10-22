import type { NextConfig } from "next"

// Cổng chỉ có route API + 3 trang công khai tĩnh: CSP chặt, không tải gì từ miền khác.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next App Router chèn script nội tuyến để nạp trang.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
]

const nextConfig: NextConfig = {
  output: "standalone",
  // Ghim gốc dự án: trong workspace có package-lock.json ở thư mục cha, Next sẽ nhận nhầm gốc và đặt server.js lệch chỗ.
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
}

export default nextConfig
