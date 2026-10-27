// Song ngữ VN/EN cho các trang HTML của cổng (trang trung gian, trang lỗi) — task #7135.
// Thứ tự chọn: ngôn ngữ bản cài gửi kèm lượt kết nối (theo nút VI/EN của người bấm) → Accept-Language → vi.
export type Lang = "vi" | "en"

export function isLang(v: unknown): v is Lang {
  return v === "vi" || v === "en"
}

/** Accept-Language: lấy ngôn ngữ đầu tiên mà cổng hỗ trợ (bỏ qua q-value — đủ cho 2 ngôn ngữ). */
export function langFromRequest(req: Request): Lang {
  for (const part of (req.headers.get("accept-language") ?? "").split(",")) {
    const tag = part.trim().split(";")[0].toLowerCase()
    if (tag.startsWith("vi")) return "vi"
    if (tag.startsWith("en")) return "en"
  }
  return "vi"
}

const VI = {
  htmlLang: "vi",
  brand: "Cổng kết nối Mắt Bão",
  expired: "Đường dẫn kết nối đã hết hạn hoặc đã dùng.",
  errorTitle: "Không kết nối được",
  errorHint: "Quay lại AdsCommand và bấm kết nối lại. Nếu vẫn lỗi, liên hệ Mắt Bão.",
  pageTitle: "Kết nối {label}",
  heading: "Kết nối {label} vào AdsCommand",
  lead: "Bạn sắp cho phép bản AdsCommand dưới đây truy cập tài khoản {label} của bạn.",
  stepConfirm: "Xác nhận",
  stepChoose: "Chọn tài khoản",
  install: "Bản cài",
  address: "Địa chỉ",
  startedBy: "Người bắt đầu",
  warn: "Chỉ tiếp tục nếu đây là AdsCommand của chính doanh nghiệp bạn. Nếu ai đó gửi đường dẫn này cho bạn mà bạn không biết bản cài trên, hãy bấm Huỷ.",
  continue: "Tiếp tục tới {label}",
  cancel: "Huỷ",
  footer: "Mắt Bão giữ khoá ứng dụng; bản cài chỉ nhận quyền truy cập ngắn hạn vào đúng tài khoản bạn chọn.",
}

const EN: typeof VI = {
  htmlLang: "en",
  brand: "Mắt Bão Connect",
  expired: "This connection link has expired or has already been used.",
  errorTitle: "Couldn't connect",
  errorHint: "Go back to AdsCommand and click Connect again. If the problem continues, contact Mắt Bão.",
  pageTitle: "Connect {label}",
  heading: "Connect {label} to AdsCommand",
  lead: "You are about to allow the AdsCommand workspace below to access your {label} account.",
  stepConfirm: "Confirm",
  stepChoose: "Choose accounts",
  install: "Workspace",
  address: "Address",
  startedBy: "Started by",
  warn: "Only continue if this is your own business's AdsCommand. If someone sent you this link and you don't recognise the workspace above, click Cancel.",
  continue: "Continue to {label}",
  cancel: "Cancel",
  footer: "Mắt Bão keeps the application credentials; the workspace only receives short-lived access to the accounts you choose.",
}

export type Strings = typeof VI
export function strings(lang: Lang): Strings {
  return lang === "en" ? EN : VI
}

export function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
}
