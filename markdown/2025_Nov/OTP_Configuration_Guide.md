# OTP (One-Time Password) 設定指南

## 概述

MyBazaar 專案使用 OTP 作為登入驗證機制，通過 SMS 發送驗證碼給用戶。本文檔詳細記錄 OTP 實現的各項配置與管理方法。

## 架構

### 組件
- **Frontend**: `src/views/auth/UniversalLogin.jsx` - 使用者登入介面，調用 OTP 端點
- **Cloud Functions**: `functions/twilio.js` - OTP 生成、驗證、SMS 發送邏輯
- **Firestore**: `otp_sessions` 集合 - 儲存 OTP 會話與雜湊值
- **SMS Provider**: 360 SMS 或 Infobip（可配置切換）

### 數據流
```
用戶輸入手機號 
  → sendOtpHttp 生成 OTP
  → 儲存雜湊值到 otp_sessions
  → 發送 SMS
  → 用戶收到驗證碼
  → 輸入驗證碼調用 verifyOtpHttp
  → 雜湊比對驗證
  → 返回成功/失敗
```

---

## 配置

### 1. 環境變數 (`.env.local`)

在 `functions/` 目錄下建立 `.env.local` 文件，配置 SMS 提供商：

#### 方案 A: 360 SMS
```dotenv
SMS_PROVIDER=360
API_KEY_360=your_360_api_key
API_SECRET_360=your_360_api_secret
API_BASE_URL_360=https://sms.360.my/developers/v3.0
```

#### 方案 B: Infobip（備用）
```dotenv
SMS_PROVIDER=infobip
INFOBIP_API_KEY=your_infobip_api_key
INFOBIP_API_BASE_URL=your_base_url.api.infobip.com
INFOBIP_SENDER_NUMBER=MyBazaar
```

### 2. Firestore 安全規則

在 `firestore.rules` 中新增 OTP 集合規則：

```firestore
match /otp_sessions/{sessionId} {
  allow create: if request.auth != null || request.resource.data.phoneNumber != null;
  allow read, update, delete: if request.auth != null || false;
}
```

### 3. Firestore 複合索引

`firestore.indexes.json` 中配置 `verifyOtpHttp` 查詢所需的索引：

```json
{
  "indexes": [
    {
      "collectionGroup": "otp_sessions",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "phoneNumber", "order": "ASCENDING" },
        { "fieldPath": "orgCode", "order": "ASCENDING" },
        { "fieldPath": "eventCode", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**部署命令:**
```bash
firebase deploy --only firestore:indexes
```

---

## API 端點

### sendOtpHttp - 發送 OTP

**端點**: `POST /api/sendOtp` (由 Hosting rewrites 代理)

**實際 URL**: `https://us-central1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp`

**請求體**:
```json
{
  "phoneNumber": "0182762768",  // 或 "+60182762768" 或 "60182762768"
  "orgCode": "ORG001",           // 可選
  "eventCode": "EVT001"          // 可選
}
```

**成功回應 (200)**:
```json
{
  "success": true,
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "message": "驗證碼已發送，請檢查手機短信",
  "expiresIn": 300
}
```

**錯誤回應**:
- `400`: 缺少手機號碼
- `500`: 內部伺服器錯誤（SMS 發送失敗或 Firestore 錯誤）

### verifyOtpHttp - 驗證 OTP

**端點**: `POST /api/verifyOtp`

**實際 URL**: `https://us-central1-mybazaar-c4881.cloudfunctions.net/verifyOtpHttp`

**請求體**:
```json
{
  "phoneNumber": "0182762768",
  "otp": "123456",               // 6 位數字
  "orgCode": "ORG001",           // 可選，需與 sendOtp 一致
  "eventCode": "EVT001"          // 可選，需與 sendOtp 一致
}
```

**成功回應 (200)**:
```json
{
  "success": true,
  "message": "驗證成功",
  "phoneNumber": "0182762768",
  "verified": true
}
```

**錯誤回應**:
- `400`: OTP 格式不正確（非 6 位數字）或已過期
- `403`: OTP 錯誤（嘗試次數 +1）
- `404`: 找不到 OTP session
- `429`: 嘗試次數超過 5 次
- `500`: 內部伺服器錯誤

---

## Firestore 數據結構

### otp_sessions 集合

**文件 ID**: UUID (自動生成)

**欄位**:
| 欄位 | 型態 | 說明 |
|------|------|------|
| `sessionId` | String | OTP 會話 ID (UUID) |
| `phoneNumber` | String | 用戶手機號碼 |
| `orgCode` | String | 組織代碼（可選，預設空字串） |
| `eventCode` | String | 活動代碼（可選，預設空字串） |
| `otpCodeHash` | String | OTP 的 SHA256 雜湊值 |
| `expiresAt` | Number | Unix 時間戳（毫秒），OTP 過期時間 |
| `attempts` | Number | 驗證嘗試次數（預設 0） |
| `createdAt` | Timestamp | 建立時間 |

**文檔範例**:
```json
{
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "phoneNumber": "0182762768",
  "orgCode": "",
  "eventCode": "",
  "otpCodeHash": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
  "expiresAt": 1637259300000,
  "attempts": 0,
  "createdAt": {
    "_seconds": 1637259000,
    "_nanoseconds": 123000000
  }
}
```

---

## 手機號碼格式化

OTP 系統自動支持多種手機號碼格式轉換：

| 輸入格式 | 轉換結果 | 說明 |
|---------|--------|------|
| `0182762768` | `+60182762768` | 本地格式，自動轉換 |
| `60182762768` | `+60182762768` | 無國碼格式，加上 `+` |
| `+60182762768` | `+60182762768` | 標準國際格式，保持不變 |

**注意**: 360 SMS 內部使用 MSISDN 格式（無 `+` 前綴），系統會自動處理轉換。

---

## SMS 提供商對比

### 360 SMS
- **優點**: 馬來西亞本地提供商，文檔完善，API 簡單
- **缺點**: 需要有效的 API 金鑰與密碼
- **端點**: `https://sms.360.my/gw/bulk360/v3_0/send.php`
- **認證**: URL 參數 `user` 與 `pass`

### Infobip（備用）
- **優點**: 全球覆蓋，支持多種功能
- **缺點**: Demo 帳戶有白名單限制，需升級才能跨號發送
- **端點**: `https://{base_url}/sms/2/text/advanced`
- **認證**: Header `Authorization: App {api_key}`

---

## 常見問題與排查

### 1. OTP 收不到短信

**原因**:
- SMS 提供商 Demo 帳戶限制（Infobip）
- 手機號碼格式錯誤
- 提供商 API 金鑰或密碼錯誤

**排查步驟**:
1. 檢查 `functions/.env.local` 中的提供商配置
2. 確認手機號碼格式是否正確
3. 查看 Cloud Functions 日誌：
   ```bash
   firebase functions:log --only sendOtpHttp --limit 50
   ```
4. 若使用 Infobip，檢查是否需要白名單或升級帳戶

### 2. 驗證返回 500 錯誤

**原因**:
- 缺少 Firestore 複合索引
- Firestore 安全規則限制
- 資料庫連線問題

**解決方案**:
1. 確認 `firestore.indexes.json` 已部署：
   ```bash
   firebase deploy --only firestore:indexes
   ```
2. 檢查 Firestore 規則是否允許讀取 `otp_sessions`
3. 查看 Cloud Functions 日誌檢查詳細錯誤

### 3. OTP 已過期

**原因**: OTP 有效期為 5 分鐘，超過時限自動過期

**解決方案**: 用戶需重新請求 OTP（點擊「重新發送」）

### 4. 嘗試次數超過限制

**原因**: 同一 OTP session 嘗試驗證超過 5 次

**解決方案**: 用戶需重新請求 OTP

---

## 部署步驟

### 部署 Firestore 規則與索引
```bash
firebase deploy --only firestore
```

### 部署 Cloud Functions
```bash
firebase deploy --only functions
```

### 完整部署
```bash
firebase deploy
```

---

## 開發與測試

### 本地測試

使用 PowerShell 測試 OTP 端點：

```powershell
# 發送 OTP
$sendOtpUrl = "https://us-central1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp"
$body = @{
    phoneNumber = "0182762768"
    orgCode = "ORG001"
    eventCode = "EVT001"
} | ConvertTo-Json

$response = Invoke-WebRequest -Uri $sendOtpUrl -Method Post `
  -ContentType "application/json" -Body $body
$result = $response.Content | ConvertFrom-Json
$sessionId = $result.sessionId
$otp = "123456"  # 從 SMS 或日誌取得

# 驗證 OTP
$verifyOtpUrl = "https://us-central1-mybazaar-c4881.cloudfunctions.net/verifyOtpHttp"
$verifyBody = @{
    phoneNumber = "0182762768"
    otp = $otp
    orgCode = "ORG001"
    eventCode = "EVT001"
} | ConvertTo-Json

$verifyResponse = Invoke-WebRequest -Uri $verifyOtpUrl -Method Post `
  -ContentType "application/json" -Body $verifyBody
$verifyResponse.Content | ConvertFrom-Json
```

### 查看函式日誌
```bash
firebase functions:log --only sendOtpHttp --limit 50
firebase functions:log --only verifyOtpHttp --limit 50
```

---

## 代碼位置

- **OTP 邏輯**: `functions/twilio.js`
  - `sendSmsVia360()` - 360 SMS 發送函式
  - `sendSmsViaHttps()` - Infobip SMS 發送函式
  - `exports.sendOtpHttp` - OTP 發送端點
  - `exports.verifyOtpHttp` - OTP 驗證端點

- **前端整合**: `src/views/auth/UniversalLogin.jsx`
  - `handleSendOtp()` - 呼叫 sendOtp 端點
  - `handleVerifyOtp()` - 呼叫 verifyOtp 端點

- **配置**:
  - `.env.local` - 環境變數（SMS 提供商 API 金鑰）
  - `firestore.rules` - OTP 集合安全規則
  - `firestore.indexes.json` - 複合索引定義

---

## 未來改進

1. **多語言支持**: OTP 短信可支持中文/英文
2. **重試機制**: 前端實現指數退避重試
3. **速率限制**: 限制同一號碼在短時間內的 OTP 請求次數
4. **審計日誌**: 記錄所有 OTP 操作用於合規性檢查
5. **備用驗證**: 支持語音通話或郵件驗證作為備選

---

## 修訂歷史

| 版本 | 日期 | 說明 |
|------|------|------|
| 1.0 | 2025-11-19 | 初版，記錄 OTP 系統完整配置 |

---

## 相關文檔

- [Infobip Whitelist Setup](./Infobip_Whitelist_Setup.md)
- [SMS OTP Troubleshooting](./SMS_OTP_Troubleshooting.md)
- [360 MSISDN Normalization](./360_OTP_wrongLog.txt)

