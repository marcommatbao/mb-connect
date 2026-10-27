// Trang trung gian trước khi sang Google (mini-spec GATEWAY-CONNECT-1 mục 12, điểm A):
// GET  → hiện "đang kết nối vào bản cài ‹tên› (‹tên miền›) do ‹email› bắt đầu", nút Tiếp tục / Huỷ (form POST).
// POST → Tiếp tục: tiêu đường dẫn, sinh state MỚI, đặt cookie riêng cho lượt này rồi sang Google; Huỷ: về bản cài.
// Dùng POST để công cụ xem trước đường dẫn (chat, email) không tự kích hoạt lượt kết nối.
// Trang này có CSP riêng (đã loại khỏi CSP chung ở next.config.ts): form-action phải cho phép Google + bản cài, vì
// Chrome áp form-action cả cho bước chuyển hướng sau khi gửi form (review 22/10, điểm 1).
import { audit } from "@/lib/audit"
import { clientIp } from "@/lib/http"
import { errorPage, esc, htmlPage } from "@/lib/html"
import { redirectToInstall, stateCookie } from "@/lib/oauth-flow"
import { beginOAuth, cancelLink, peekLink, type PendingFlow } from "@/lib/pending"
import { GoogleOAuthError, GOOGLE_AUTH_ORIGIN, googleAuthUrl } from "@/lib/providers/google"
import { META_AUTH_ORIGINS, MetaOAuthError, metaAuthUrl } from "@/lib/providers/meta"
import { getInstall } from "@/lib/store"
import { fill, langFromRequest, strings, type Lang } from "@/lib/i18n"

export const dynamic = "force-dynamic"

const PROVIDER_LABEL = { google: "Google Ads", meta: "Facebook" } as const

function activeInstall(flow: PendingFlow | null) {
  const install = flow ? getInstall(flow.installId) : null
  return install && install.status === "active" ? install : null
}

/** Ngôn ngữ trang: theo lượt kết nối (nút VI/EN ở bản cài) → Accept-Language. */
const pageLang = (req: Request, flow: PendingFlow | null): Lang => flow?.lang ?? langFromRequest(req)

export async function GET(req: Request, { params }: { params: Promise<{ link: string }> }) {
  const { link } = await params
  const flow = peekLink(link)
  const install = activeInstall(flow)
  const lang = pageLang(req, flow)
  const S = strings(lang)
  if (!flow || !install) return errorPage(S.expired, 410, lang)

  const label = PROVIDER_LABEL[flow.provider]
  const v = { label }
  const mark = flow.provider === "meta" ? `<span class="logo meta" aria-hidden="true">f</span>` : `<span class="logo google" aria-hidden="true">G</span>`
  return htmlPage(fill(S.pageTitle, v), `
<div class="pair">${mark}<span class="link" aria-hidden="true">⇄</span><span class="logo mb" aria-hidden="true">M</span></div>
<h1>${esc(fill(S.heading, v))}</h1>
<p class="lead">${esc(fill(S.lead, v))}</p>
<ol class="steps">
  <li class="on"><b>1</b><span>${esc(S.stepConfirm)}</span></li>
  <li><b>2</b><span>${esc(label)}</span></li>
  <li><b>3</b><span>${esc(S.stepChoose)}</span></li>
</ol>
<dl>
  <div><dt>${esc(S.install)}</dt><dd>${esc(install.name)}</dd></div>
  <div><dt>${esc(S.address)}</dt><dd>${esc(new URL(install.appUrl).host)}</dd></div>
  <div><dt>${esc(S.startedBy)}</dt><dd>${esc(flow.createdBy)}</dd></div>
</dl>
<p class="warn">${esc(S.warn)}</p>
<form method="post">
  <div class="row">
    <button class="primary${flow.provider === "meta" ? " meta" : ""}" type="submit" name="action" value="continue">${esc(fill(S.continue, v))}</button>
    <button type="submit" name="action" value="cancel">${esc(S.cancel)}</button>
  </div>
</form>
<p class="muted">${esc(S.footer)}</p>`,
    200, { formAction: [...(flow.provider === "meta" ? META_AUTH_ORIGINS : [GOOGLE_AUTH_ORIGIN]), install.appUrl], lang })
}

export async function POST(req: Request, { params }: { params: Promise<{ link: string }> }) {
  const { link } = await params
  const ip = clientIp(req)
  let action = "continue"
  try {
    action = String((await req.formData()).get("action") ?? "continue")
  } catch { /* thân rỗng = tiếp tục */ }

  const lang = pageLang(req, peekLink(link))
  const EXPIRED = strings(lang).expired
  if (!activeInstall(peekLink(link))) return errorPage(EXPIRED, 410, lang)

  if (action === "cancel") {
    const flow = cancelLink(link)
    if (!flow) return errorPage(EXPIRED, 410, lang)
    await audit({ event: "oauth.start", ok: false, ip, installId: flow.installId, provider: flow.provider, reason: "cancelled" })
    return redirectToInstall(flow, { ok: false, reason: "cancelled" })
  }

  const begun = beginOAuth(link)
  if (!begun) return errorPage(EXPIRED, 410, lang)
  const { flow, oauthState } = begun
  try {
    const url = flow.provider === "meta" ? metaAuthUrl(oauthState) : googleAuthUrl(oauthState, flow.lang)
    await audit({ event: "oauth.start", ok: true, ip, installId: flow.installId, provider: flow.provider })
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": stateCookie(oauthState), "Cache-Control": "no-store" } })
  } catch (e) {
    const reason = (e instanceof GoogleOAuthError || e instanceof MetaOAuthError) && e.reason === "misconfigured" ? "misconfigured" : "provider_error"
    await audit({ event: "oauth.start", ok: false, ip, installId: flow.installId, provider: flow.provider, reason })
    return redirectToInstall(flow, { ok: false, reason })
  }
}
