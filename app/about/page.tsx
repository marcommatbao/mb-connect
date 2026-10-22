// Trang chủ công khai dùng cho hồ sơ xác minh Google (Application home page) và Meta (App Review).
import Link from "next/link"
import { publicInfo } from "@/lib/public-info"
import { ContactLine } from "../contact-line"

export const dynamic = "force-dynamic"

export default function AboutPage() {
  const info = publicInfo()
  return (
    <article>
      <h1>{info.appName}</h1>
      <p className="lead">
        {info.appName} is an advertising management platform operated by {info.orgName}. Business customers use it to
        monitor performance, find problems and manage campaigns across their own Google Ads and Meta (Facebook) Ads
        accounts.
      </p>

      <h2>What the app does</h2>
      <ul>
        <li><strong>Performance dashboards</strong> — spend, clicks, impressions, conversions and cost per result for the customer&apos;s Google Ads and Meta Ads campaigns.</li>
        <li><strong>Campaign diagnostics</strong> — detects wasted spend, budget pacing issues, low-quality keywords and policy problems, and explains each finding.</li>
        <li><strong>Recommendations and AI assistance</strong> — suggests next steps and drafts ad copy based on campaign performance.</li>
        <li><strong>Campaign management</strong> — authorized users can create campaigns and change budgets, bids, keywords, assets and status. Every change is started and confirmed by a signed-in user and recorded in an activity log.</li>
      </ul>

      <h2>Who can use it</h2>
      <p>
        {info.appName} is offered to business customers of {info.orgName}. Each customer&apos;s administrator creates
        accounts for their own staff; there is no public sign-up. The customer&apos;s administrator connects the
        customer&apos;s own advertising accounts with one click, using Google&apos;s standard consent screen and Facebook
        Login for Business, and then chooses which ad accounts the app may use. Each customer&apos;s data is kept separate and
        is visible only to that customer&apos;s users.
      </p>

      <h2>How we handle your data</h2>
      <p>
        Access granted through Google or Meta is used only to provide the features above to the customer that connected its
        accounts. We do not sell it, use it for advertising, or share it with third parties except as described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>. You can revoke access at any time from your Google Account at{" "}
        <a href="https://myaccount.google.com/permissions" rel="noopener noreferrer">myaccount.google.com/permissions</a>{" "}
        or from Facebook Business Integrations, and you can ask us to delete your data on the{" "}
        <Link href="/data-deletion">data deletion</Link> page.
      </p>

      <h2>Contact</h2>
      <ContactLine info={info} />
    </article>
  )
}
