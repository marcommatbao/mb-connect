// Trang hướng dẫn xoá dữ liệu (Meta yêu cầu "Data Deletion Instructions URL" hoặc callback). Callback tự động
// POST /api/meta/data-deletion thêm ở bước nối Meta (mini-spec GATEWAY-CONNECT-1 bước 5).
import type { Metadata } from "next"
import { publicInfo } from "@/lib/public-info"
import { ContactLine } from "../contact-line"

export const dynamic = "force-dynamic"

export function generateMetadata(): Metadata {
  return { title: `Data deletion — ${publicInfo().appName}` }
}

export default function DataDeletionPage() {
  const info = publicInfo()
  return (
    <article>
      <h1>Data deletion</h1>
      <p>You can remove the data {info.appName} holds about your Google or Meta accounts in any of these ways:</p>
      <ol>
        <li><strong>Disconnect in the app.</strong> A customer administrator opens Settings and clicks “Disconnect” next to
          Google Ads or Facebook. We delete the stored token immediately and revoke it with Google or Meta.</li>
        <li><strong>Revoke from your account.</strong> Google: <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">myaccount.google.com/permissions</a>.
          Meta: Facebook Settings → Business Integrations → remove {info.appName}. Our stored token stops working at once.</li>
        <li><strong>Ask us.</strong> Email us from the address linked to your account and name the business or ad accounts
          concerned. We delete the stored tokens and related data within 30 days and confirm by email.</li>
      </ol>
      <h2>Contact</h2>
      <ContactLine info={info} />
    </article>
  )
}
