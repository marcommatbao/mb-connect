// ============================================================
// File-level mutex using a per-key promise queue.
// Ensures concurrent async callers targeting the same key
// (file path) run sequentially, not in parallel.
// ============================================================

const queue = new Map<string, Promise<void>>();

/**
 * Run `fn` exclusively for the given `key` (typically a file path).
 * If another call with the same key is already running, this one
 * waits until the previous call finishes before starting.
 */
export async function withFileLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queue.get(key) ?? Promise.resolve();

  let resolve!: () => void;
  const slot = new Promise<void>((r) => { resolve = r; });
  // Lưu đúng promise đã đặt vào map để so lúc dọn (bản AdsCommand so với `slot` nên không bao giờ xoá khoá — review 22/10, điểm 10).
  const tail = prev.then(() => slot);
  queue.set(key, tail);

  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (queue.get(key) === tail) queue.delete(key);
  }
}
