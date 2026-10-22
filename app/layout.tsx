// Trang công khai của cổng (/about, /privacy, /data-deletion): tiếng Anh vì người duyệt Google/Meta đọc. BA rà câu chữ trước khi nộp.
import type { Metadata } from "next"
import Link from "next/link"
import { publicInfo } from "@/lib/public-info"
import "./globals.css"

export const dynamic = "force-dynamic"

export function generateMetadata(): Metadata {
  const { appName } = publicInfo()
  return { title: appName, robots: { index: true, follow: true } }
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const info = publicInfo()
  return (
    <html lang="en">
      <body>
        <header>
          <div className="wrap bar">
            <Link href="/about" className="brand">{info.appName}</Link>
            <nav>
              <Link href="/about">About</Link>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/data-deletion">Data deletion</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer>
          <div className="wrap">© 2026 {info.orgName}. {info.appName} is operated by {info.orgName}.</div>
        </footer>
      </body>
    </html>
  )
}
