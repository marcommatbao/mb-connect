// Mỗi file test: thư mục dữ liệu tạm + khoá mã hoá + khoá quản trị riêng. Gọi ở đầu file, TRƯỚC khi import mã của app.
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"

export const ADMIN_TOKEN = "t".repeat(20) + crypto.randomBytes(16).toString("hex")

export function freshEnv(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mb-connect-test-"))
  process.env.MB_DATA_DIR = dir
  process.env.GATEWAY_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64")
  process.env.GATEWAY_ADMIN_TOKEN = ADMIN_TOKEN
  process.env.GATEWAY_ADMIN_CIDRS = "10.0.0.0/8,2001:db8::/32"
  delete process.env.TRUSTED_PROXY_HOPS
  return dir
}

/** Đọc toàn bộ tệp dưới thư mục dữ liệu (để quét xem có lộ khoá thô không). */
export function readAllData(dir: string): string {
  let out = ""
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out += fs.readFileSync(path.join(entry.parentPath, entry.name), "utf8")
  }
  return out
}

export function req(url: string, init: RequestInit & { ip?: string; token?: string } = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("x-forwarded-for", init.ip ?? "10.1.2.3")
  if (init.token) headers.set("authorization", `Bearer ${init.token}`)
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
  return new Request(`https://mb-connect.test${url}`, { ...init, headers })
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
