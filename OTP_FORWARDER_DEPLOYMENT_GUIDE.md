# OTP 轉發服務完整部署指南

## 🎯 架構概覽

```
用戶登入
    ↓
Cloud Functions sendOtpHttp (動態 IP ❌)
    ↓
OTP Forwarder (靜態 IP ✅)
34.123.222.228:3000
    ↓
360 SMS API (白名單: 34.123.222.228)
    ↓
用戶手機 SMS
```

---

## 📋 完整流程

### Phase 1: 部署 OTP Forwarder 到 WordPress VM

#### Step 1.1: SSH 連接到 WordPress VM

```bash
# 連接到 WordPress VM (GCP Compute Engine)
# 外部 IP: 34.123.222.228
# 用戶名: ubuntu

ssh -i ~/.ssh/gcp-key ubuntu@34.123.222.228
```

#### Step 1.2: 準備環境

```bash
# 更新系統
sudo apt update
sudo apt upgrade -y

# 安裝 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 驗證
node --version  # 應該 >= 14.0.0
npm --version
```

#### Step 1.3: 建立應用目錄

```bash
# 建立目錄
sudo mkdir -p /opt/mybazaar/otp-forwarder
cd /opt/mybazaar/otp-forwarder

# 更改所有者（使用當前用戶）
sudo chown ubuntu:ubuntu /opt/mybazaar -R
```

#### Step 1.4: 部署應用文件

```bash
# 複製 app.js, package.json, .env.example 到 /opt/mybazaar/otp-forwarder/
# 方式 1: 如果在本地機有代碼，使用 scp 複製：
scp -i ~/.ssh/gcp-key \
  ~/mybazaar20/otp-forwarder/{app.js,package.json,.env.example} \
  ubuntu@34.123.222.228:/opt/mybazaar/otp-forwarder/

# 方式 2: 或在 VM 上直接建立文件
# (複製粘貼代碼)
```

#### Step 1.5: 安裝依賴

```bash
cd /opt/mybazaar/otp-forwarder
npm install

# 驗證
npm list  # 查看安裝的包
```

#### Step 1.6: 設置環境變量

```bash
# 複製 .env.example 為 .env
cp .env.example .env

# 編輯 .env 文件
nano .env
```

在 .env 中填入：
```env
PORT=3000
API_KEY_360=your_actual_api_key_from_firebase
API_SECRET_360=your_actual_api_secret_from_firebase
API_BASE_URL_360=https://sms.360.my/gw/bulk360/v3_0/send.php
ALLOWED_SOURCES=127.0.0.1,::1,10.128.0.0/10,34.123.222.228
```

> ℹ️ 從何取得 API 認證？
> - 打開 GCP Console > Firebase Project (mybazaar-c4881)
> - 進入 Settings > Secret Manager
> - 查看 API_KEY_360 和 API_SECRET_360 的值
> - 複製到 .env 中

#### Step 1.7: 測試本地運行

```bash
# 在 VM 上測試
node app.js

# 預期輸出
# [2026-04-29T...] SERVER: ✅ OTP 轉發服務已啟動 {"port":3000,"api_url":"https://sms.360.my..."}
```

#### Step 1.8: 設置為系統服務（使用 PM2）

```bash
# 全域安裝 PM2
sudo npm install -g pm2

# 啟動服務
pm2 start app.js --name "otp-forwarder" --env /opt/mybazaar/otp-forwarder/.env

# 設置開機自動啟動
pm2 startup
pm2 save

# 檢查狀態
pm2 status
pm2 logs otp-forwarder
```

預期輸出：
```
┌─────────────────────────────────┬──────┬────────┬──────┬──────┬──────────┐
│ Name                            │ id   │ mode   │ pid  │ stat │ up time  │
├─────────────────────────────────┼──────┼────────┼──────┼──────┼──────────┤
│ otp-forwarder                   │ 0    │ fork   │ 1234 │ on   │ 5m       │
└─────────────────────────────────┴──────┴────────┴──────┴──────┴──────────┘
```

#### Step 1.9: 開放防火牆

```bash
# 檢查 GCP 防火牆規則
# 1. 打開 GCP Console
# 2. 進入 VPC Network > Firewall rules
# 3. 確保有規則允許入站 port 3000

# 或在 VM 上開放 port
sudo ufw allow 3000/tcp
sudo ufw reload

# 檢查
sudo ufw status
```

#### Step 1.10: 測試轉發服務可訪問性

從本地或任何機器：

```bash
# 健康檢查
curl http://34.123.222.228:3000/health

# 預期回應
{
  "status": "ok",
  "timestamp": "2026-04-29T00:11:06.123Z",
  "uptime": 123.45
}
```

---

### Phase 2: 設置 Cloud Functions 參數

#### Step 2.1: 部署 Cloud Functions

確保 otpVerify.js 已修改為使用 OTP Forwarder：

```bash
# 在本地專案目錄
cd ~/mybazaar20/functions

# 設置 Firebase CLI 指向正確的項目
firebase use mybazaar-c4881

# 部署只部署 functions 部分
firebase deploy --only functions
```

#### Step 2.2: 設置 Firebase 參數（可選，但推薦）

```bash
# 使用 Firebase CLI 設置 OTP_FORWARDER_URL
firebase functions:config:set otp.forwarder_url="http://34.123.222.228:3000/otp"

# 驗證
firebase functions:config:get
```

---

### Phase 3: 更新 360 SMS 白名單

#### Step 3.1: 移除舊的 0.0.0.0 白名單

```
打開 360 SMS 控制臺
1. 登入 sms.360.my
2. 進入 Settings > IP Whitelist
3. 刪除 0.0.0.0（允許所有 IP）
⚠️ 警告：刪除後，其他 IP 的請求會被拒絕
```

#### Step 3.2: 添加 WordPress VM 的靜態 IP

```
在 360 SMS 控制臺：
1. 進入 Settings > IP Whitelist
2. 新增 IP 地址
   - IP: 34.123.222.228
   - 備註: MyBazaar OTP Forwarder (WordPress VM)
   - 狀態: Enabled
3. 儲存
```

#### Step 3.3: 驗證白名單

```bash
# SSH 到 WordPress VM
ssh -i ~/.ssh/gcp-key ubuntu@34.123.222.228

# 測試 OTP Forwarder 是否可以連接到 360 API
curl -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+60123456789",
    "message": "測試 OTP: 123456"
  }'

# 如果返回 code=200，表示白名單正確
# 如果返回 code=403，表示 IP 白名單設置有問題
```

---

### Phase 4: 測試完整 OTP 流程

#### Step 4.1: 從客戶端測試 OTP 發送

```bash
# 使用客戶端應用（如 React 前端）
# 或使用 curl 測試 Cloud Function

# 假設 Cloud Function URL:
# https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp

curl -X POST https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+60123456789",
    "scenario": "customerPayment",
    "userId": "user123"
  }'

# 預期回應（成功）
{
  "success": true,
  "otpRequired": true,
  "sessionId": "otp_1234567890_abc123def",
  "expiresIn": 300,
  "message": "驗證碼已發送"
}

# 預期回應（失敗 - IP 白名單問題）
{
  "error": {
    "code": "failed-precondition",
    "message": "SMS 發送失敗：360 API 未啟用或服務器 IP 未加入白名單"
  }
}
```

#### Step 4.2: 檢查日誌

**Cloud Functions 日誌：**
```bash
# 在 GCP Console
# > Cloud Functions > sendOtpHttp > Logs

# 應該看到類似
[sendOtpHttp] 使用 OTP Forwarder 轉發到 360 API
[sendOtpHttp] ✅ SMS 發送成功（Forwarder）
```

**OTP Forwarder 日誌：**
```bash
# SSH 到 WordPress VM
pm2 logs otp-forwarder

# 應該看到類似
[HTTP] 收到請求 (IP=10.128.x.x, path=/otp)
[OTP] 轉發 SMS
[SMS] 360 API 回應 (code=200)
[OTP] ✅ SMS 轉發成功
```

#### Step 4.3: 測試手機收到 SMS

1. 使用真實馬來西亞手機號（或 Firebase 測試號碼）
2. 提交 OTP 請求
3. 檢查手機是否收到 SMS
4. 預期 SMS 內容：`您的MyBazaar驗證碼是：XXXXXX。有效期5分鐘。`

---

## 🔍 故障排查

### 問題 1: OTP Forwarder 無法啟動

```bash
# 檢查 port 是否被占用
sudo lsof -i :3000

# 檢查日誌
pm2 logs otp-forwarder --lines 50

# 檢查環境變量
cat /opt/mybazaar/otp-forwarder/.env

# 重新啟動
pm2 restart otp-forwarder
```

### 問題 2: 收到 403 IP 白名單錯誤

```bash
# 檢查 OTP Forwarder 是否可以連接到 360 API
# SSH 到 VM
ssh ubuntu@34.123.222.228

# 測試連接
curl -X POST https://sms.360.my/gw/bulk360/v3_0/send.php \
  -d "user=YOUR_API_KEY&pass=YOUR_API_SECRET&to=60123456789&text=test&detail=1"

# 預期回應應該是 JSON 且 code=200（如果白名單正確）
```

### 問題 3: Cloud Functions 無法連接到 OTP Forwarder

```bash
# 檢查 VPC 連接和網路配置
# 1. 確保 Cloud Functions 和 WordPress VM 在同一 VPC
# 2. 檢查防火牆規則允許連接

# 檢查 GCP 防火牆規則
gcloud compute firewall-rules list --filter="name~'allow.*'"

# 查看 Cloud Functions 的執行日誌
firebase functions:log
```

---

## ✅ 檢查清單

部署完成後，逐項檢查：

- [ ] 1️⃣ OTP Forwarder 已在 WordPress VM 上運行 (`pm2 status`)
- [ ] 2️⃣ 健康檢查端點可訪問 (`curl http://34.123.222.228:3000/health`)
- [ ] 3️⃣ Cloud Functions 已部署最新代碼 (`firebase deploy --only functions`)
- [ ] 4️⃣ OTP_FORWARDER_URL 參數已設置 (`firebase functions:config:get`)
- [ ] 5️⃣ 360 SMS 白名單已更新為 34.123.222.228
- [ ] 6️⃣ 360 SMS 白名單中移除了 0.0.0.0
- [ ] 7️⃣ Cloud Functions 日誌中沒有 403 IP 白名單錯誤
- [ ] 8️⃣ OTP Forwarder 日誌中看到成功的 SMS 轉發
- [ ] 9️⃣ 真實手機收到 OTP SMS
- [ ] 🔟 OTP 驗證流程完整工作

---

## 📊 成本對比

| 方案 | 月成本 | 優點 | 缺點 |
|------|-------|------|------|
| Cloud NAT | RM145 | 完全託管 | 太貴，固定費用 |
| OTP Forwarder | RM0（附加到現有 VM） | 最便宜，共用現有資源 | 需要管理 |
| Dedicated VPS | RM30-50 | 獨立服務 | 額外成本 |

---

## 🎉 部署完成

恭喜！OTP 轉發服務已成功部署。現在：
- ✅ Cloud Functions 使用靜態 IP（經由 OTP Forwarder）
- ✅ 360 SMS 白名單已正確配置
- ✅ OTP SMS 應該能夠正常發送
- ✅ 成本保持在最低水平（RM0 附加費用）

---

## 📞 支持

如有問題，檢查：
1. **OTP Forwarder 日誌**：`pm2 logs otp-forwarder`
2. **Cloud Functions 日誌**：GCP Console > Cloud Functions > Logs
3. **防火牆規則**：GCP Console > VPC Network > Firewall Rules
4. **360 SMS 配置**：https://sms.360.my/

---

## 📝 配置總結

```yaml
OTP Forwarder:
  位置: WordPress VM (34.123.222.228)
  端口: 3000
  路由: /otp
  方法: POST

Cloud Functions:
  函數: sendOtpHttp
  配置: OTP_FORWARDER_URL=http://34.123.222.228:3000/otp
  日誌: Firebase Console

360 SMS API:
  白名單: 34.123.222.228（已啟用）
  移除: 0.0.0.0（不安全，已刪除）
```
