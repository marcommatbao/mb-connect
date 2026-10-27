// Trang HTML nhỏ do route trả (trang trung gian, trang lỗi). Mọi giá trị động đi qua esc().
// Các route /api/oauth/start/* KHÔNG nhận header bảo mật chung (next.config.ts) nên trang tự gắn đủ bộ ở đây,
// với form-action riêng: hai CSP chồng nhau thì trình duyệt lấy phần GIAO, không nới được bằng header thứ hai.
import { strings, type Lang } from "./i18n"
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)
}

const STYLE = `:root{--bg:#f3f5f9;--card:#fff;--ink:#0f172a;--text:#334155;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;
--brand:#d7262e;--accent:#0f172a;--warn-bg:#fff8eb;--warn-line:#f8d58a;--warn-ink:#8a4b08}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111a2e;--ink:#f1f5f9;--text:#cbd5e1;--muted:#94a3b8;--line:#22304a;
--soft:#0f172a;--warn-bg:#2a1f0a;--warn-line:#5c4312;--warn-ink:#f5c46b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:580px;margin:0 auto;padding:40px 16px}
.brandbar{display:flex;align-items:center;gap:8px;justify-content:center;margin-bottom:20px;color:var(--muted);font-size:14px;font-weight:600;letter-spacing:.02em}
.dot{width:10px;height:10px;border-radius:50%;background:var(--brand)}
.box{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(15,23,42,.06)}
.pair{display:flex;align-items:center;justify-content:center;gap:12px;margin:4px 0 20px}
.logo{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:22px}
.logo.mb{background:var(--brand)}.logo.meta{background:#1877f2}.logo.google{background:#fff;border:1px solid var(--line);color:#4285f4}
.link{color:var(--muted)}
h1{font-size:22px;line-height:1.3;color:var(--ink);margin:0 0 6px;text-align:center}
.lead{text-align:center;color:var(--muted);margin:0 0 20px;font-size:15px}
.steps{display:flex;gap:6px;justify-content:center;margin:0 0 22px;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.steps li{display:flex;align-items:center;gap:6px}.steps li+li:before{content:"";width:18px;height:1px;background:var(--line);margin-right:6px}
.steps b{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--soft);border:1px solid var(--line);font-size:11px}
.steps .on{color:var(--ink);font-weight:600}.steps .on b{background:var(--accent);border-color:var(--accent);color:#fff}
dl{margin:0 0 18px;border:1px solid var(--line);border-radius:12px;overflow:hidden}
dl div{display:grid;grid-template-columns:120px 1fr;gap:12px;padding:10px 14px;background:var(--soft)}dl div+div{border-top:1px solid var(--line)}
dt{color:var(--muted);font-size:14px}dd{margin:0;font-weight:600;color:var(--ink);overflow-wrap:anywhere}
.warn{background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn-ink);border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 20px}
.row{display:flex;gap:10px;flex-wrap:wrap}form .row button{flex:1 1 200px;white-space:nowrap}
button{font:inherit;font-weight:600;border-radius:10px;padding:12px 18px;cursor:pointer;border:1px solid var(--line);background:var(--card);color:var(--ink)}
button.primary{background:var(--accent);color:#fff;border-color:var(--accent)}button.primary.meta{background:#1877f2;border-color:#1877f2}
button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
.muted{color:var(--muted);font-size:13px;text-align:center;margin:18px 0 0}
@media (max-width:420px){.box{padding:20px}dl div{grid-template-columns:1fr;gap:0}.steps span{display:none}}`

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

export function htmlPage(title: string, body: string, status = 200, opts: { formAction?: string[]; lang?: Lang } = {}): Response {
  const S = strings(opts.lang ?? "vi")
  const html = `<!doctype html><html lang="${S.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main class="wrap">
<div class="brandbar"><span class="dot" aria-hidden="true"></span>${esc(S.brand)}</div><div class="box">${body}</div></main></body></html>`
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...securityHeaders(opts.formAction ?? []) },
  })
}

/** message: câu đã đúng ngôn ngữ (thường là strings(lang).expired). */
export function errorPage(message: string, status = 400, lang: Lang = "vi"): Response {
  const S = strings(lang)
  return htmlPage(S.errorTitle, `<h1>${esc(S.errorTitle)}</h1><p class="lead">${esc(message)}</p>
<p class="muted">${esc(S.errorHint)}</p>`, status, { lang })
}
