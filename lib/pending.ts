// ============================================================
// Lượt kết nối đang mở (từ connect/start tới callback): trong bộ nhớ, sống 10 phút, dùng MỘT lần.
// Khởi động lại giữa chừng = khách bấm lại (chấp nhận ở bản 1, mini-spec mục 3.2).
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

const flows = new Map<string, PendingFlow>()

function sweep(now: number) {
  for (const [k, v] of flows) if (now - v.createdAt > PENDING_TTL_MS) flows.delete(k)
}

export function createFlow(flow: Omit<PendingFlow, "createdAt">, now = Date.now()): string {
  sweep(now)
  const state = crypto.randomBytes(32).toString("base64url")
  flows.set(state, { ...flow, createdAt: now })
  return state
}

/** Xem mà không tiêu (trang trung gian). */
export function peekFlow(state: string, now = Date.now()): PendingFlow | null {
  const f = flows.get(state)
  if (!f) return null
  if (now - f.createdAt > PENDING_TTL_MS) {
    flows.delete(state)
    return null
  }
  return f
}

/** Lấy và xoá — callback chỉ chạy được một lần cho mỗi state. */
export function consumeFlow(state: string, now = Date.now()): PendingFlow | null {
  const f = peekFlow(state, now)
  if (f) flows.delete(state)
  return f
}

export function resetFlowsForTests(): void {
  flows.clear()
}
