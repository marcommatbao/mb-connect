// ============================================================
// Lượt kết nối đang mở: trong bộ nhớ, sống 10 phút.
// Hai mã khác nhau (review 22/10, điểm 3):
//   - linkToken: nằm trong đường dẫn trang trung gian /api/oauth/start/<linkToken>. Đường dẫn có thể lộ (lịch sử trình duyệt,
//     chat) nên CHỈ dùng để hiện trang và bấm Tiếp tục MỘT lần.
//   - oauthState: sinh mới lúc bấm Tiếp tục, chỉ nằm trong cookie của trình duyệt đó + tham số state gửi Google.
// Ai thấy đường dẫn cũng không biết oauthState → không chen được tài khoản Google của mình vào lượt của người khác.
// ============================================================
import crypto from "crypto"
import type { Provider } from "./store"

export const PENDING_TTL_MS = 10 * 60 * 1000

export interface PendingFlow {
  installId: string
  provider: Provider
  returnUrl: string
  createdBy: string
  nonceHash: string
  createdAt: number
}

const byLink = new Map<string, PendingFlow>()
const byState = new Map<string, PendingFlow>()

const token = () => crypto.randomBytes(32).toString("base64url")
const alive = (f: PendingFlow, now: number) => now - f.createdAt <= PENDING_TTL_MS

function sweep(now: number) {
  for (const m of [byLink, byState]) for (const [k, v] of m) if (!alive(v, now)) m.delete(k)
}

export function createFlow(flow: Omit<PendingFlow, "createdAt">, now = Date.now()): string {
  sweep(now)
  const linkToken = token()
  byLink.set(linkToken, { ...flow, createdAt: now })
  return linkToken
}

/** Xem lượt theo đường dẫn mà không tiêu (hiện trang trung gian). */
export function peekLink(linkToken: string, now = Date.now()): PendingFlow | null {
  const f = byLink.get(linkToken)
  if (!f || !alive(f, now)) {
    byLink.delete(linkToken)
    return null
  }
  return f
}

/** Bấm Tiếp tục: tiêu đường dẫn, sinh oauthState mới. Đường dẫn không dùng lại được. */
export function beginOAuth(linkToken: string, now = Date.now()): { flow: PendingFlow; oauthState: string } | null {
  const f = peekLink(linkToken, now)
  if (!f) return null
  byLink.delete(linkToken)
  const oauthState = token()
  byState.set(oauthState, f)
  return { flow: f, oauthState }
}

/** Bấm Huỷ: tiêu đường dẫn. */
export function cancelLink(linkToken: string, now = Date.now()): PendingFlow | null {
  const f = peekLink(linkToken, now)
  if (f) byLink.delete(linkToken)
  return f
}

/** Callback: lấy và xoá theo state Google trả về — chạy được đúng một lần. */
export function consumeState(oauthState: string, now = Date.now()): PendingFlow | null {
  const f = byState.get(oauthState)
  byState.delete(oauthState)
  return f && alive(f, now) ? f : null
}

export function resetFlowsForTests(): void {
  byLink.clear()
  byState.clear()
}
