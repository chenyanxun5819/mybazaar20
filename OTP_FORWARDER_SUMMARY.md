# OTP 轉發服務實現摘要

**日期**: 2026-04-29  
**狀態**: ✅ 代碼完成，準備部署

---

## 📦 已完成的工作

### 1. OTP 轉發服務應用 (otp-forwarder)

#### 文件清單
```
otp-forwarder/
├── app.js                    # 主應用代碼（277 行）
├── package.json              # Node.js 依賴管理
├── .env.example              # 環境變量範本
├── DEPLOYMENT.md             # 簡要部署指南
```

#### 功能
- ✅ 監聽 `http://0.0.0.0:3000/otp`
- ✅ 接收 OTP 轉發請求：`POST /otp`
- ✅ 電話號碼標準化（馬來西亞 +60 格式）
- ✅ 轉發到 360 SMS API
- ✅ 安全檢查：來源 IP 驗證
- ✅ 健康檢查端點：`GET /health`
- ✅ 詳細日誌記錄
- ✅ CORS 支援

#### 核心功能
```javascript
POST /otp
請求格式:
{
  "phoneNumber": "+60123456789",
  "message": "您的驗證碼: 123456"
}

回應格式（成功）:
{
  "code": 200,
  "balance": 1234.56,
  "currency": "MYR"
}

回應格式（失敗）:
{
  "error": "錯誤信息",
  "code": "403"
}
```

---

### 2. Cloud Functions 修改 (functions/otpVerify.js)

#### 變更內容

**新增參數：**
```javascript
const OTP_FORWARDER_URL_PARAM = defineString('OTP_FORWARDER_URL', {
  default: 'http://34.123.222.228:3000/otp',
});
```

**新增函數：`sendSmsViaForwarder()`**
- 負責轉發 SMS 請求到 OTP Forwarder
- 處理 JSON 請求體和回應
- 錯誤處理和超時管理

**修改函數：`sendOtpHttp()`**
- 改為使用 `sendSmsViaForwarder()` 而不是 `sendSmsVia360()`
- 日誌更新：`使用 OTP Forwarder 轉發到 360 API`

**修改函數：`getRuntimeSmsConfig()`**
- 添加 `otpForwarderUrl` 到配置

#### 代碼行數
- 新增 ~70 行 (`sendSmsViaForwarder` 函數)
- 修改 ~5 行 (`sendOtpHttp` 調用)
- 修改 ~10 行 (`getRuntimeSmsConfig`)

---

### 3. 部署和測試文檔

#### 文檔清單
```
├── OTP_FORWARDER_DEPLOYMENT_GUIDE.md    # 完整部署指南（260+ 行）
│   ├── Phase 1: OTP Forwarder 部署
│   ├── Phase 2: Cloud Functions 配置
│   ├── Phase 3: 360 白名單更新
│   ├── Phase 4: 完整測試流程
│   ├── 故障排查
│   └── 檢查清單

├── OTP_FORWARDER_TEST_GUIDE.md           # 測試指南（200+ 行）
│   ├── 5 個測試場景
│   ├── 完整測試腳本 (shell)
│   ├── 快速診斷命令
│   └── 故障排查命令

└── otp-forwarder/
    └── DEPLOYMENT.md                    # 簡要部署指南
```

---

## 🏗️ 架構流程

```
用戶登入/付款
    ↓
Cloud Function: sendOtpHttp (動態 IP ❌ 403 error)
    ↓
HTTP POST http://34.123.222.228:3000/otp
    ↓
OTP Forwarder (靜態 IP ✅)
    ├─ 電話號碼標準化
    ├─ 驗證來源 IP
    └─ 轉發請求
    ↓
360 SMS API (white list: 34.123.222.228) ✅
    ↓
Malaysian SMS Gateway
    ↓
用戶手機 SMS ✅
```

---

## 💰 成本分析

| 方案 | 月成本 | 部署狀態 |
|------|-------|--------|
| Cloud NAT | RM145 | 棄用 |
| 外部 VPS | RM30-50 | 備選 |
| **OTP Forwarder** | **RM0** | ✅ **已實施** |

> OTP Forwarder 運行在現有 WordPress VM 上，無額外成本

---

## 🚀 後續部署步驟

### Step 1: 準備 WordPress VM
```bash
# SSH 到 VM (34.123.222.228)
ssh -i ~/.ssh/gcp-key ubuntu@34.123.222.228

# 安裝 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

### Step 2: 部署 OTP Forwarder
```bash
# 建立目錄
sudo mkdir -p /opt/mybazaar/otp-forwarder
cd /opt/mybazaar/otp-forwarder

# 複製檔案
scp -i ~/.ssh/gcp-key ~/mybazaar20/otp-forwarder/* \
  ubuntu@34.123.222.228:/opt/mybazaar/otp-forwarder/

# 安裝依賴
npm install

# 配置環境變量
cp .env.example .env
nano .env  # 編輯 API 認證

# 安裝為系統服務
sudo npm install -g pm2
pm2 start app.js --name "otp-forwarder"
pm2 startup
pm2 save
```

### Step 3: 部署 Cloud Functions
```bash
cd ~/mybazaar20/functions
firebase use mybazaar-c4881
firebase deploy --only functions
```

### Step 4: 更新 360 SMS 白名單
```
登入 https://sms.360.my/
1. Settings > IP Whitelist
2. 新增: 34.123.222.228 (啟用)
3. 刪除: 0.0.0.0 (不安全)
```

### Step 5: 測試
```bash
# 測試 OTP Forwarder
curl http://34.123.222.228:3000/health

# 測試 OTP 轉發
curl -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+60123456789","message":"test"}'

# 測試完整流程
# 使用應用送出 OTP 請求
```

---

## 📋 檢查清單

部署前：
- [ ] Node.js 18+ 已安裝在 WordPress VM
- [ ] OTP Forwarder 代碼已複製到 VM
- [ ] 環境變量 .env 已設置（API 認證）
- [ ] PM2 已安裝並配置為系統服務

部署時：
- [ ] Cloud Functions 已部署（firebaseFunctions 含 OTP Forwarder 代碼)
- [ ] OTP_FORWARDER_URL 參數已設置
- [ ] OTP Forwarder 服務已啟動 (`pm2 status`)
- [ ] 防火牆允許 port 3000 入站

部署後：
- [ ] 健康檢查端點可訪問
- [ ] 360 白名單已更新為 34.123.222.228
- [ ] 360 白名單中已刪除 0.0.0.0
- [ ] 完整 OTP 流程可正常運行
- [ ] 手機成功收到 SMS

---

## 🔍 日誌位置

**OTP Forwarder 日誌：**
```bash
pm2 logs otp-forwarder
```

**Cloud Functions 日誌：**
```
GCP Console > Cloud Functions > sendOtpHttp > Logs
或
firebase functions:log
```

**360 SMS 日誌：**
```
https://sms.360.my/ > Dashboard/Logs
```

---

## 📊 配置總結

```yaml
OTP Forwarder:
  應用: Node.js HTTP 伺服器
  位置: WordPress VM 
  IP: 34.123.222.228 (靜態)
  Port: 3000
  認證: API_KEY_360, API_SECRET_360 (來自 Firebase Secret Manager)
  
Cloud Functions:
  函數: sendOtpHttp (HTTP-triggered)
  修改: 使用 sendSmsViaForwarder() 轉發
  配置: OTP_FORWARDER_URL 參數
  區域: asia-southeast1
  
360 SMS API:
  端點: https://sms.360.my/gw/bulk360/v3_0/send.php
  白名單: 34.123.222.228 ✅
  移除: 0.0.0.0 ❌
  協定: HTTPS POST
  認證: API Key + Secret
```

---

## ⚠️ 重要事項

1. **不要忘記 360 白名單更新**
   - 必須刪除 0.0.0.0（安全風險）
   - 必須添加 34.123.222.228
   - 否則 SMS 將繼續失敗

2. **確保 OTP Forwarder 持續運行**
   - 使用 PM2 管理（開機自動啟動）
   - 定期監控日誌
   - 設置日誌輪轉防止磁盤滿

3. **環境變量安全**
   - 不要將 .env 提交到 Git
   - 使用 Firebase Secret Manager 管理敏感數據
   - 限制 VM 上的文件權限

4. **防火牆配置**
   - 確保 port 3000 允許 Cloud Functions 訪問
   - 確保 port 80/443 允許出站到 360 API
   - 檢查 GCP 防火牆規則

---

## 🎯 預期結果

**部署成功後：**

✅ Cloud Functions 不再收到 403 IP 白名單錯誤  
✅ OTP SMS 正常發送到馬來西亞手機  
✅ 使用者收到驗證碼  
✅ 成本控制在最低水平（RM0 附加費用）  
✅ 系統穩定性提高（無依賴於 VPS 的外部服務）

---

## 📞 故障排查快速鏈接

- **OTP Forwarder 無法啟動？** → 檢查 port 3000 占用
- **403 白名單錯誤？** → 檢查 360 SMS 白名單設置
- **Forwarder 無法連接到 360？** → 檢查網絡和防火牆
- **Cloud Functions 無法連接 Forwarder？** → 檢查 VPC 和 DNS 解析

---

## ✅ 實現完畢

所有代碼已完成，準備部署。請按照 `OTP_FORWARDER_DEPLOYMENT_GUIDE.md` 中的步驟進行部署。

**預計部署時間：30-45 分鐘**

---

## 檔案清單

新建立的檔案：
```
otp-forwarder/
├── app.js                              # OTP 轉發服務 (277 行)
├── package.json                        # NPM 依賴
├── .env.example                        # 環境變量範本
└── DEPLOYMENT.md                       # 簡要指南

修改的檔案：
└── functions/otpVerify.js              # +100 行修改
    ├── 新增 OTP_FORWARDER_URL 參數
    ├── 新增 sendSmsViaForwarder() 函數
    └── 修改 sendOtpHttp() 調用

文檔檔案：
├── OTP_FORWARDER_DEPLOYMENT_GUIDE.md   # 完整部署 (270+ 行)
├── OTP_FORWARDER_TEST_GUIDE.md         # 測試指南 (200+ 行)
└── OTP_FORWARDER_SUMMARY.md            # 本檔案
```

**總共代碼行數**: ~650 行 (包括文檔和註釋)

---

**開始部署？參考** → `OTP_FORWARDER_DEPLOYMENT_GUIDE.md`  
**需要測試？參考** → `OTP_FORWARDER_TEST_GUIDE.md`
