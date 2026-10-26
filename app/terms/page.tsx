// Điều khoản dịch vụ của cổng (Google Auth Platform → Branding → Terms of service; Meta → Thông tin cơ bản → URL Điều khoản).
// Nội dung PHẢI khớp cách cổng vận hành: Mắt Bão giữ khoá ứng dụng, mỗi bản cài chỉ nhận token ngắn hạn cho tài khoản của chính nó.
import type { Metadata } from "next"
import Link from "next/link"
import { publicInfo } from "@/lib/public-info"
import { ContactLine } from "../contact-line"

export const dynamic = "force-dynamic"

export function generateMetadata(): Metadata {
  return { title: `Terms of Service — ${publicInfo().appName}` }
}

export default function TermsPage() {
  const info = publicInfo()
  const app = info.appName
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="muted">Last updated: {info.policyUpdated}</p>
      <p>
        These terms govern the use of {app} (“the service”), operated by {info.orgName} (“we”, “us”). By connecting a
        Google Ads or Meta advertising account through the service, you agree to these terms on behalf of the business you
        represent.
      </p>

      <h2>1. What the service does</h2>
      <p>
        {app} lets a business connect the advertising accounts it owns or manages to its own AdsCommand workspace, without
        creating developer credentials of its own. The service holds the application credentials registered by{" "}
        {info.orgName}, stores the authorization you grant in encrypted form, and gives your workspace short-lived access
        tokens for the accounts you selected — and only those accounts.
      </p>

      <h2>2. Who may use it</h2>
      <ul>
        <li>Only businesses whose AdsCommand workspace has been registered with and approved by {info.orgName}.</li>
        <li>The person connecting an account must be authorized by the business to manage that advertising account
          (for Meta, an administrator of the business portfolio or a person with full control of the asset).</li>
      </ul>

      <h2>3. Your responsibilities</h2>
      <ul>
        <li>Connect only accounts you are permitted to manage, and keep your workspace logins secure.</li>
        <li>Changes to campaigns, budgets or bids are made only when a user of your workspace starts and confirms them. You
          remain responsible for your advertising spend and for complying with Google Ads and Meta advertising policies.</li>
        <li>Do not use the service to access accounts of other businesses, to send spam, or for any unlawful purpose.</li>
      </ul>

      <h2>4. Data</h2>
      <p>
        How we access, use, store and delete data is described in the <Link href="/privacy">Privacy Policy</Link>. You can
        disconnect at any time from your workspace settings, revoke access from your Google Account or Meta Business
        settings, or request deletion as described on the <Link href="/data-deletion">data deletion</Link> page.
      </p>

      <h2>5. Suspension</h2>
      <p>
        We may suspend or revoke a workspace&apos;s access to the service if it is used in breach of these terms, of Google
        or Meta platform policies, or if continued access would put other customers or the platform credentials at risk.
        Where possible we will notify the workspace administrator first.
      </p>

      <h2>6. Availability and liability</h2>
      <p>
        The service depends on Google and Meta APIs, which may change or become unavailable. We provide the service on an
        “as is” basis and, to the extent permitted by law, are not liable for indirect losses or for advertising results.
      </p>

      <h2>7. Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version.</p>

      <h2>8. Contact</h2>
      <ContactLine info={info} />
    </article>
  )
}
