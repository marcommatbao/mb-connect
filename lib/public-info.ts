// Thông tin trên trang công khai, đọc lúc chạy. appName PHẢI trùng tên app ở Google Auth Platform → Branding
// và tên trong video xác minh (docs/GOOGLE-OAUTH-VERIFICATION.md của AdsCommand).
export interface PublicInfo {
  appName: string
  orgName: string
  contactEmail: string | null
  orgAddress: string | null
  policyUpdated: string
}

const env = (k: string): string | null => {
  const v = process.env[k]?.trim()
  return v ? v : null
}

export function publicInfo(): PublicInfo {
  return {
    appName: env("PUBLIC_APP_NAME") ?? "AdsCommand",
    orgName: env("PUBLIC_ORG_NAME") ?? "Mat Bao Corporation",
    contactEmail: env("PUBLIC_CONTACT_EMAIL"),
    orgAddress: env("PUBLIC_ORG_ADDRESS"),
    policyUpdated: env("PUBLIC_POLICY_UPDATED") ?? "2026-10-22",
  }
}
