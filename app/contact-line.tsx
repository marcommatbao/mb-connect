import type { PublicInfo } from "@/lib/public-info"

/** Thiếu PUBLIC_CONTACT_EMAIL thì hiện cảnh báo rõ — Google/Meta bắt chính sách có cách liên hệ, không được bịa email. */
export function ContactLine({ info }: { info: PublicInfo }) {
  return (
    <div>
      <p>{info.orgName}{info.orgAddress ? ` — ${info.orgAddress}` : ""}</p>
      {info.contactEmail ? (
        <p>Email: <a href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a></p>
      ) : (
        <p className="warn">Contact email is not configured yet (administrator: set PUBLIC_CONTACT_EMAIL).</p>
      )}
    </div>
  )
}
