// Trang HTML nhỏ do route trả (trang trung gian, trang lỗi). Mọi giá trị động đi qua esc().
// Các route /api/oauth/start/* KHÔNG nhận header bảo mật chung (next.config.ts) nên trang tự gắn đủ bộ ở đây,
// với form-action riêng: hai CSP chồng nhau thì trình duyệt lấy phần GIAO, không nới được bằng header thứ hai.
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

const STYLE = `body{margin:0;background:#f8fafc;color:#334155;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.box{max-width:560px;margin:48px auto;padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:12px}
h1{font-size:22px;color:#0f172a;margin:0 0 12px}dl{margin:16px 0;display:grid;grid-template-columns:auto 1fr;gap:6px 16px}
dt{color:#64748b}dd{margin:0;font-weight:600;word-break:break-all}.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:10px 12px;font-size:14px}
.row{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}button{font:inherit;border-radius:8px;padding:10px 18px;cursor:pointer;border:1px solid #cbd5e1;background:#fff}
button.primary{background:#0f172a;color:#fff;border-color:#0f172a}.muted{color:#64748b;font-size:14px}`

/** formAction: các origin form được phép đi tới (kể cả sau chuyển hướng). Mặc định không form nào được gửi. */
function securityHeaders(formAction: string[]): Record<string, string> {
  const fa = formAction.length ? ["'self'", ...formAction].join(" ") : "'none'"
  return {
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; form-action ${fa}; frame-ancestors 'none'; base-uri 'none'`,
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  }
}

export function htmlPage(title: string, body: string, status = 200, opts: { formAction?: string[] } = {}): Response {
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><div class="box">${body}</div></body></html>`
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders(opts.formAction ?? []) },
  })
}

export function errorPage(message: string, status = 400): Response {
  return htmlPage("Không kết nối được", `<h1>Không kết nối được</h1><p>${esc(message)}</p>
<p class="muted">Quay lại AdsCommand và bấm kết nối lại. Nếu vẫn lỗi, liên hệ Mắt Bão.</p>`, status)
}
