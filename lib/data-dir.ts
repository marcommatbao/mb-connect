import path from "path"

// Mọi tệp dữ liệu của cổng nằm dưới một thư mục. Trên Vibe Host là /app/data (ổ bền, cwd của bản standalone là /app).
// MB_DATA_DIR để test dùng thư mục tạm riêng.
export function dataDir(): string {
  // turbopackIgnore: thư mục dữ liệu lúc chạy, không phải mã — không để Next truy vết cả dự án vào bản build.
  return process.env.MB_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data")
}

export function dataPath(...parts: string[]): string {
  return path.join(/*turbopackIgnore: true*/ dataDir(), ...parts)
}
