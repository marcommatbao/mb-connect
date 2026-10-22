# mb-connect — Cổng kết nối Mắt Bão

Dịch vụ nhỏ giữ **khoá của Mắt Bão** (Google OAuth client secret, Meta app secret) và **token của từng khách** (mã hoá),
rồi cấp **access token ngắn hạn** cho các bản cài AdsCommand. Khách chỉ bấm "Kết nối Google Ads / Kết nối Facebook";
bản cài của khách không bao giờ giữ secret của Mắt Bão.

Thiết kế + quyết định: `ads-manager/docs/DESIGN-CONG-KET-NOI-MATBAO.md`, mini-spec `ads-manager/docs/mini-specs/GATEWAY-CONNECT-1.md`.

## Trạng thái (22/10/2026)

| Bước | Nội dung | |
|---|---|---|
| 1 | Khung: lưu trữ mã hoá, sổ bản cài + khoá, API quản trị, healthz, trang `/about` `/privacy` `/data-deletion` | **xong** |
| 2 | Google: connect/start, trang trung gian, callback, xác nhận nonce, token, thu hồi | **xong** (chưa deploy) |
| 5 | Meta: Facebook Login for Business, token, data-deletion callback | chưa |

## Chạy và kiểm

```bash
npm ci
npm test          # vitest
npm run typecheck
npm run build     # output standalone: .next/standalone/server.js
```

## Biến môi trường

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `GATEWAY_ENCRYPTION_KEY` | có | `openssl rand -base64 32`. Mất khoá = mất mọi token đã lưu (khách phải kết nối lại) |
| `GATEWAY_ADMIN_TOKEN` | có | ≥ 32 ký tự (`openssl rand -hex 32`). Thiếu/ngắn → API quản trị trả 503 |
| `GATEWAY_ADMIN_CIDRS` | có | Danh sách IP/CIDR được gọi API quản trị, cách nhau dấu phẩy. Ghi `any` để bỏ lọc IP (vẫn cần khoá) |
| `TRUSTED_PROXY_HOPS` | không | Mặc định 1. Đo theo `ads-manager/docs/VIBEHOST-PROXY-CHECK.md` sau khi deploy (xem lưu ý dưới) |
| `PUBLIC_CONTACT_EMAIL` | nên có | Email trên trang chính sách / xoá dữ liệu. Thiếu → trang hiện cảnh báo vàng |
| `PUBLIC_APP_NAME` | không | Mặc định `AdsCommand`. **Phải trùng** tên app ở Google Auth Platform → Branding |
| `PUBLIC_ORG_NAME`, `PUBLIC_ORG_ADDRESS`, `PUBLIC_POLICY_UPDATED` | không | |
| `MB_DATA_DIR` | không | Mặc định `<cwd>/data` (= `/app/data` trong Docker). Phải là **ổ bền** |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, `META_LOGIN_CONFIG_ID`, `META_GRAPH_API_VERSION`, `GATEWAY_URL` | bước 2, 5 | |

**Lưu ý IP (đo 22/10 trên bản build):** server Next **tự thêm** `X-Forwarded-For` = IP kết nối khi request không có header
này, nhưng **giữ nguyên** header khách gửi nếu đã có. Vì vậy IP cổng thấy phụ thuộc proxy của Vibe Host. Sau khi deploy
phải đo (gửi `X-Forwarded-For` giả, xem cổng có bị lừa không) rồi mới chốt `TRUSTED_PROXY_HOPS` và `GATEWAY_ADMIN_CIDRS`.

## Quản trị bản cài (curl)

```bash
G=https://mb-connect.vibe.tinhgon.xyz; A=<GATEWAY_ADMIN_TOKEN>
# Tạo bản cài → trả khoá MỘT LẦN, đặt vào MB_CONNECT_INSTALL_KEY của bản cài
curl -s -X POST -H "Authorization: Bearer $A" -H 'content-type: application/json' \
  -d '{"name":"Khách A","appUrl":"https://khach-a.vibe.tinhgon.xyz"}' $G/api/admin/installs
curl -s -H "Authorization: Bearer $A" $G/api/admin/installs                       # danh sách
curl -s -H "Authorization: Bearer $A" $G/api/admin/installs/<id>                  # chi tiết + kết nối
curl -s -X POST -H "Authorization: Bearer $A" $G/api/admin/installs/<id>/rotate-key # khoá mới; khoá cũ còn 24 giờ
curl -s -X POST -H "Authorization: Bearer $A" $G/api/admin/installs/<id>/suspend    # tạm ngưng (resume để mở lại)
curl -s -X POST -H "Authorization: Bearer $A" $G/api/admin/installs/<id>/revoke     # thu hồi vĩnh viễn
```

Bản cài tự kiểm khoá: `curl -s -H "Authorization: Bearer <khoá bản cài>" $G/api/v1/install`.

## Luồng kết nối Google (bước 2)

1. Bản cài `POST /api/v1/connect/start {provider:"google", returnPath:"/api/connect/google/return", createdBy, nonceHash}` → `{url}`.
   `nonceHash` = SHA-256 hex của nonce bản cài giữ trong cookie HttpOnly trên miền của nó.
2. Trình duyệt khách mở `url` → **trang trung gian** (tên bản cài, tên miền, người bắt đầu) → bấm Tiếp tục (POST) → cổng đặt
   cookie `mb_state` rồi sang Google (scope `adwords`, offline, consent).
3. Google → `GET /api/oauth/google/callback` (redirect URI duy nhất). Cổng kiểm state + cookie, đổi code, lưu refresh token
   mã hoá ở trạng thái **pending**, chuyển về `appUrl/api/connect/google/return?provider=google&ok=1&cid=…`
   (lỗi: `ok=0&reason=cancelled|access_denied|scope_denied|no_refresh_token|session_mismatch|install_inactive|provider_error|misconfigured`).
4. Bản cài `POST /api/v1/connections/:cid/confirm {nonce}` → **active** (kết nối active cũ cùng nhà cung cấp bị thu hồi).
   Pending quá 15 phút không xác nhận → bị xoá + thu hồi ở Google.
5. Bản cài `POST /api/v1/token {connectionId}` → `{accessToken, expiresAt, provider}` (30 lượt/giờ/kết nối; bản cài cache,
   xin lại trước hạn 60 giây). Google trả `invalid_grant` → kết nối bị đánh dấu revoked, bản cài nhận 409 `connection_missing`.
6. Ngắt kết nối: `DELETE /api/v1/connections/:cid` → xoá token ở cổng + thu hồi ở Google.

Google Cloud (project `mat-bao-marketing`, client Mat-bao-marcom): redirect URI `<GATEWAY_URL>/api/oauth/google/callback`.

## Dữ liệu

`data/installs.json` (hash khoá, không bao giờ khoá thô), `data/connections.json` (token mã hoá AES-256-GCM),
`data/audit/YYYY-MM-DD.jsonl` (nhật ký — không token, không khoá, không code). Chạy **một tiến trình**: khoá ghi và giới
hạn tần suất nằm trong bộ nhớ.

## Triển khai

Vibe Host (vibehost7), project riêng `mb-connect`, Dockerfile trong repo. Khai `/app/data` là thư mục bền và kiểm
`get_data_paths` thấy `attached: true` **trước** khi tạo kết nối đầu tiên. Lệnh bật lại / xem log ghi vào đây sau lần deploy đầu.
