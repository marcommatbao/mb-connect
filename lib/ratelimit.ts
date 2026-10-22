// Giới hạn tần suất cửa sổ cố định, trong bộ nhớ (bản 1 chạy một tiến trình). Khởi động lại thì đếm lại từ 0.
const buckets = new Map<string, { count: number; resetAt: number }>()

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
  }
  return { ok: b.count <= limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
}

/** Chỉ xem đã vượt chưa, không đếm thêm (để chặn trước khi xác thực mà không tính lượt hợp lệ). */
export function isOver(key: string, limit: number, now = Date.now()): { over: boolean; retryAfterSec: number } {
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) return { over: false, retryAfterSec: 0 }
  return { over: b.count > limit, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
}

export function resetRateLimitsForTests(): void {
  buckets.clear()
}
