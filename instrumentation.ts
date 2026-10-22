// Chạy một lần khi server khởi động: lượt dọn định kỳ 5 phút (pending quá hạn, kết nối sót của bản cài đã thu hồi).
// Trước đây chỉ dọn khi có bản cài gọi API → token của lượt bỏ dở có thể nằm trên đĩa vô thời hạn (review 22/10, điểm 6).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { periodicSweep } = await import("./lib/connections")
  const run = () => periodicSweep().catch((e: Error) => console.error("[sweep]", e.message))
  void run()
  setInterval(run, 5 * 60_000).unref()
}
