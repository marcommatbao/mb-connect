import { defineConfig } from "vitest/config"
import path from "node:path"

// Test chỉ chạy hàm và route handler trong tiến trình — không gọi mạng; mỗi test dùng thư mục dữ liệu tạm riêng.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 30_000 },
})
