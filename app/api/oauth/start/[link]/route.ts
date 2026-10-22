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
import { getInstall } from "@/lib/store"

export const dynamic = "force-dynamic"

const EXPIRED = "Đường dẫn kết nối đã hết hạn hoặc đã dùng."
const PROVIDER_LABEL = { google: "Google Ads", meta: "Facebook" } as const

function activeInstall(flow: PendingFlow | null) {
  const install = flow ? getInstall(flow.installId) : null
  return install && install.status === "active" ? install : null
}

export async function GET(_req: Request, { params }: { params: Promise<{ link: string }> }) {
  const { link } = await params
  const flow = peekLink(link)
  const install = activeInstall(flow)
  if (!flow || !install) return errorPage(EXPIRED, 410)

  const label = PROVIDER_LABEL[flow.provider]
  return htmlPage(`Kết nối ${label}`, `
<h1>Kết nối ${esc(label)} vào AdsCommand</h1>
<p>Bạn sắp cho phép bản AdsCommand dưới đây truy cập tài khoản ${esc(label)} của bạn:</p>
<dl>
  <dt>Bản cài</dt><dd>${esc(install.name)}</dd>
  <dt>Địa chỉ</dt><dd>${esc(new URL(install.appUrl).host)}</dd>
  <dt>Người bắt đầu</dt><dd>${esc(flow.createdBy)}</dd>
</dl>
<p class="warn">Chỉ tiếp tục nếu đây là AdsCommand của chính doanh nghiệp bạn. Nếu ai đó gửi đường dẫn này cho bạn mà bạn không biết bản cài trên, hãy bấm Huỷ.</p>
<form method="post">
  <div class="row">
    <button class="primary" type="submit" name="action" value="continue">Tiếp tục tới ${esc(label)}</button>
    <button type="submit" name="action" value="cancel">Huỷ</button>
  </div>
</form>
<p class="muted">Cổng kết nối Mắt Bão — Mắt Bão giữ khoá ứng dụng; bản cài chỉ nhận quyền truy cập ngắn hạn vào đúng tài khoản bạn chọn.</p>`,
    200, { formAction: [GOOGLE_AUTH_ORIGIN, install.appUrl] })
}

export async function POST(req: Request, { params }: { params: Promise<{ link: string }> }) {
  const { link } = await params
  const ip = clientIp(req)
  let action = "continue"
  try {
    action = String((await req.formData()).get("action") ?? "continue")
  } catch { /* thân rỗng = tiếp tục */ }

  if (!activeInstall(peekLink(link))) return errorPage(EXPIRED, 410)

  if (action === "cancel") {
    const flow = cancelLink(link)
    if (!flow) return errorPage(EXPIRED, 410)
    await audit({ event: "oauth.start", ok: false, ip, installId: flow.installId, provider: flow.provider, reason: "cancelled" })
    return redirectToInstall(flow, { ok: false, reason: "cancelled" })
  }

  const begun = beginOAuth(link)
  if (!begun) return errorPage(EXPIRED, 410)
  const { flow, oauthState } = begun
  try {
    const url = googleAuthUrl(oauthState)
    await audit({ event: "oauth.start", ok: true, ip, installId: flow.installId, provider: flow.provider })
    return new Response(null, { status: 303, headers: { Location: url, "Set-Cookie": stateCookie(oauthState), "Cache-Control": "no-store" } })
  } catch (e) {
    const reason = e instanceof GoogleOAuthError && e.reason === "misconfigured" ? "misconfigured" : "provider_error"
    await audit({ event: "oauth.start", ok: false, ip, installId: flow.installId, provider: flow.provider, reason })
    return redirectToInstall(flow, { ok: false, reason })
  }
}
