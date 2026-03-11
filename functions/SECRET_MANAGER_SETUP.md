## SMS Secret Manager Setup

生產環境的 SMS 機密已改為使用 Firebase Functions Secret Manager。

### 目前分工

- `.env` 只放非機密設定
- `SMS_SECRETS` secret 放真正的 API key / password
- `sendOtpHttp` 會在部署後自動掛載 `SMS_SECRETS`

### `.env` 建議內容

```env
USE_DEV_OTP=false
DEV_OTP_CODE=223344
SMS_PROVIDER=360
API_BASE_URL_360=https://sms.360.my/gw/bulk360/v3_0/send.php
```

如果之後改回 Infobip，再補：

```env
SMS_PROVIDER=infobip
INFOBIP_API_BASE_URL=your_base_url.api.infobip.com
INFOBIP_SENDER_NUMBER=MyBazaar
```

### 建立 / 更新 Secret

PowerShell：

```powershell
$secretJson = @'
{
  "API_KEY_360": "your_360_api_key_here",
  "API_SECRET_360": "your_360_api_secret_here",
  "INFOBIP_API_KEY": ""
}
'@

$secretJson | firebase functions:secrets:set SMS_SECRETS
```

也可以用檔案：

```powershell
firebase functions:secrets:set SMS_SECRETS --data-file functions/SMS_SECRETS.example.json
```

### 驗證點

- `functions/otpVerify.js` 會優先讀 `SMS_SECRETS`
- `functions/.env` 不應再出現 `API_KEY_360`、`API_SECRET_360`、`INFOBIP_API_KEY`
- `functions/initPlatformSettings.js` 不再把 SMS 機密寫進 Firestore

### 部署

```powershell
firebase deploy --only functions
```