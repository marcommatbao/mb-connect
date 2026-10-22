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

export function resetRateLimitsForTests(): void {
  buckets.clear()
}
