// Trang của cổng song ngữ (task #7135): theo ngôn ngữ bản cài gửi kèm → Accept-Language → vi.
import { beforeEach, describe, expect, it } from "vitest"
import { freshEnv, params, req } from "./setup-env"
import { createInstall } from "@/lib/installs"
import { resetFlowsForTests } from "@/lib/pending"
import { resetRateLimitsForTests } from "@/lib/ratelimit"
import * as start from "@/app/api/v1/connect/start/route"
import * as oauthStart from "@/app/api/oauth/start/[link]/route"
import * as callback from "@/app/api/oauth/google/callback/route"

const GW = "https://mb-connect.test"
const VI_CHARS = /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i

beforeEach(() => {
  freshEnv()
  process.env.GATEWAY_URL = GW
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid.apps.googleusercontent.com"
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "GOCSPX-x"
  resetFlowsForTests(); resetRateLimitsForTests()
})

let n = 0
async function link(lang?: unknown) {
  const { key } = await createInstall({ name: "Khách A", appUrl: `https://khach-${++n}.example.com` })
  const r = await start.POST(req("/x", { method: "POST", token: key, body: JSON.stringify({ provider: "google", returnPath: "/api/connect/google/return", createdBy: "a@b.vn", nonceHash: "a".repeat(64), ...(lang === undefined ? {} : { lang }) }) }))
  expect(r.status).toBe(200)
  return (await r.json()).url.split("/api/oauth/start/")[1] as string
}
const getPage = (l: string, headers: Record<string, string> = {}) => oauthStart.GET(new Request(`${GW}/api/oauth/start/${l}`, { headers }), params({ link: l }))
const body = async (r: Response) => (await r.text()).replace(/<style>[\s\S]*?<\/style>/, "")

describe("trang trung gian song ngữ", () => {
  it("lang=en từ bản cài → toàn tiếng Anh (trừ dữ liệu người dùng), Google nhận hl=en", async () => {
    const l = await link("en")
    const html = await body(await getPage(l, { "accept-language": "vi-VN" }))
    expect(html).toContain('<html lang="en"')
    expect(html).toContain("Connect Google Ads to AdsCommand")
    expect(html.replace("Khách A", "")).not.toMatch(VI_CHARS)
    const go = await oauthStart.POST(new Request(`${GW}/api/oauth/start/${l}`, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ link: l }))
    expect(new URL(go.headers.get("location")!).searchParams.get("hl")).toBe("en")
  })

  it("không gửi lang → theo Accept-Language; mặc định tiếng Việt, không có hl", async () => {
    expect(await body(await getPage(await link(), { "accept-language": "en-US,en;q=0.9" }))).toContain("Connect Google Ads to AdsCommand")
    const l = await link()
    const html = await body(await getPage(l))
    expect(html).toContain('<html lang="vi"')
    expect(html).toContain("Kết nối Google Ads vào AdsCommand")
    const go = await oauthStart.POST(new Request(`${GW}/api/oauth/start/${l}`, { method: "POST", body: new URLSearchParams({ action: "continue" }) }), params({ link: l }))
    expect(new URL(go.headers.get("location")!).searchParams.has("hl")).toBe(false)
  })

  it("lang lạ bị bỏ qua (không lọt vào trang)", async () => {
    const html = await body(await getPage(await link("<script>")))
    expect(html).toContain('<html lang="vi"')
  })

  it("trang lỗi (đường dẫn hết hạn / callback state lạ) theo Accept-Language", async () => {
    const e1 = await body(await getPage("khong-ton-tai", { "accept-language": "en" }))
    expect(e1).toContain("Couldn&#39;t connect")
    expect(e1).not.toMatch(VI_CHARS)
    const e2 = await body(await callback.GET(new Request(`${GW}/api/oauth/google/callback?state=x&code=y`, { headers: { "accept-language": "en-GB" } })))
    expect(e2).toContain("expired")
    expect(await body(await getPage("khong-ton-tai"))).toContain("Không kết nối được")
  })
})
