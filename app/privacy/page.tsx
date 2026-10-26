// Chính sách quyền riêng tư của cổng. Nội dung PHẢI khớp những gì mã đang làm: scope adwords + quyền Meta liệt kê dưới đây,
// token mã hoá AES-256-GCM ở cổng, bản cài chỉ nhận access token ngắn hạn. Đổi hành vi dữ liệu thì sửa trang này cùng lúc.
import type { Metadata } from "next"
import Link from "next/link"
import { publicInfo } from "@/lib/public-info"
import { ContactLine } from "../contact-line"

export const dynamic = "force-dynamic"

export function generateMetadata(): Metadata {
  return { title: `Privacy Policy — ${publicInfo().appName}` }
}

export default function PrivacyPage() {
  const info = publicInfo()
  const app = info.appName
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {info.policyUpdated}</p>
      <p>
        This policy explains how {app} (“the app”), operated by {info.orgName} (“we”, “us”), accesses, uses, stores and
        shares data, including data received from Google APIs and Meta Platforms.
      </p>

      <h2>1. Who uses the app</h2>
      <p>
        {app} is a business tool operated by {info.orgName} for its business customers. Each customer connects advertising
        accounts that it owns or manages. We process this data on behalf of that customer, only to provide the app&apos;s
        features to that customer. Accounts are created by each customer&apos;s administrator; there is no public sign-up.
      </p>

      <h2>2. Data we access</h2>
      <p><strong>Google Ads</strong> (OAuth scope <code>https://www.googleapis.com/auth/adwords</code>): the list of ad accounts
        the signed-in Google user can access, account names and IDs, campaigns, ad groups, ads, assets, keywords, search terms,
        budgets, bidding settings, conversion actions, policy status, and performance metrics such as spend, impressions,
        clicks and conversions.</p>
      <p><strong>Meta (Facebook) Ads</strong>, through Facebook Login for Business (permissions <code>ads_read</code>,{" "}
        <code>ads_management</code>, <code>business_management</code>, <code>pages_show_list</code>,{" "}
        <code>pages_read_engagement</code>, <code>pages_manage_ads</code>): the business, ad accounts, pixels and Pages the customer chooses to share,
        and their campaigns, ad sets, ads, creatives and performance insights.</p>
      <p><strong>Account data</strong>: the name, work email address and role of each user of a customer&apos;s workspace,
        and a log of the actions they take in the app.</p>

      <h2>3. How we use the data</h2>
      <ul>
        <li>To show performance reports and dashboards to the customer&apos;s authorized users.</li>
        <li>To detect problems (for example wasted spend or budget pacing issues) and suggest improvements.</li>
        <li>To create or change campaigns, budgets, bids, keywords, assets and status <strong>only when a signed-in user of
          that customer starts and confirms the change</strong>. Every change made through the app is recorded in an
          activity log.</li>
      </ul>
      <p>We do not use data received from Google APIs or Meta Platforms for advertising, to build user profiles, or to train
        general-purpose AI models.</p>

      <h2>4. AI processing</h2>
      <p>
        To generate analyses and ad copy suggestions, the app sends selected campaign information (such as campaign names,
        ad text and performance metrics) to the Google Gemini API. Access tokens and passwords are never sent. Results are
        shown only to the customer&apos;s authorized users.
      </p>

      <h2>5. Storage and security</h2>
      <ul>
        <li>OAuth refresh tokens (Google) and business access tokens (Meta) are stored only on the connection service
          operated by {info.orgName}, encrypted at rest with AES-256-GCM. They are never sent to the browser.</li>
        <li>A customer&apos;s workspace receives only short-lived access tokens, and only for that customer&apos;s own
          connected accounts.</li>
        <li>Each customer&apos;s data is kept separate. All traffic uses HTTPS, and only a customer&apos;s administrators can
          connect or disconnect its accounts.</li>
      </ul>

      <h2>6. Sharing</h2>
      <p>
        We do not sell or rent any data. We do not share data received from Google APIs or Meta Platforms with third
        parties, except: (a) service providers that run the app for us (server hosting, and the Google Gemini API as
        described in section 4), or (b) when required by law.
      </p>

      <h2>7. Google API Services User Data Policy</h2>
      <p>
        {app}&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noopener noreferrer">Google API Services User Data Policy</a>,
        including the Limited Use requirements.
      </p>

      <h2>8. Retention and deletion</h2>
      <ul>
        <li>Tokens are kept until the customer disconnects the account in the app, revokes access, or asks us to delete
          them. Disconnecting deletes the stored token and revokes it with Google or Meta.</li>
        <li>You can revoke access at any time at{" "}
          <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">myaccount.google.com/permissions</a>{" "}
          (Google) or in Facebook Settings → Business Integrations (Meta).</li>
        <li>To ask us to delete data we hold, see the <Link href="/data-deletion">data deletion</Link> page or contact us using
          the details below. We will delete it within 30 days.</li>
      </ul>

      <h2>9. Children</h2>
      <p>The app is a business tool and is not directed at children under 16.</p>

      <h2>10. Changes to this policy</h2>
      <p>We will update the date at the top of this page when this policy changes.</p>

      <h2>11. Contact</h2>
      <ContactLine info={info} />
    </article>
  )
}
