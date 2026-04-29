# OTP 轉發服務部署指南

## 概述

OTP 轉發服務運行在 WordPress VM 上 (34.123.222.228)，將 OTP 請求從 Cloud Functions 轉發到 360 SMS API。

```
Cloud Functions (動態 IP 403)
         ↓
    OTP Forwarder (靜態 IP ✅)
         ↓
    360 SMS API (白名單: 34.123.222.228)
```

## 部署步驟

### 1. 連接 WordPress VM

```bash
# SSH 登入 WordPress VM
# IP: 34.123.222.228
ssh -i ~/.ssh/gcp-key ubuntu@34.123.222.228
```

### 2. 安裝 Node.js

```bash
# 更新系統
sudo apt update
sudo apt upgrade -y

# 安裝 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 驗證安裝
node --version
npm --version
```

### 3. 部署 OTP Forwarder

```bash
# 建立目錄
sudo mkdir -p /opt/mybazaar/otp-forwarder
cd /opt/mybazaar/otp-forwarder

# 複製檔案（如果已有代碼）
# 或從倉庫 git clone

# 複製 package.json 和 app.js 到此目錄
# 然後安裝依賴
npm install

# 複製 .env.example 為 .env
cp .env.example .env

# 編輯 .env 檔案，設定 API 認證
sudo nano .env
```

### 4. 設定環境變量

編輯 `.env` 檔案：

```env
PORT=3000
API_KEY_360=your_api_key_from_firebase
API_SECRET_360=your_api_secret_from_firebase
API_BASE_URL_360=https://sms.360.my/gw/bulk360/v3_0/send.php
ALLOWED_SOURCES=127.0.0.1,::1,10.128.0.0/10,34.123.222.228
```

### 5. 啟動服務

```bash
# 測試運行
node app.js

# 或使用 npm
npm start
```

預期輸出：
```
[2026-04-29T...] SERVER: ✅ OTP 轉發服務已啟動 {"port":3000,"api_url":"https://sms.360.my/..."}
```

### 6. 設定為系統服務（PM2）

```bash
# 全域安裝 PM2
sudo npm install -g pm2

# 啟動服務
pm2 start app.js --name "otp-forwarder"

# 設定開機自動啟動
pm2 startup
pm2 save

# 檢查狀態
pm2 status
pm2 logs otp-forwarder
```

## 測試轉發服務

### 測試健康檢查端點

```bash
# 從本機或 VM
curl http://34.123.222.228:3000/health

# 預期回應
{
  "status": "ok",
  "timestamp": "2026-04-29T...",
  "uptime": 123.45
}
```

### 測試 OTP 轉發

```bash
# 準備測試請求
curl -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "+60123456789",
    "message": "測試 OTP: 123456"
  }'

# 預期回應（成功）
{
  "code": 200,
  "balance": 1234.56,
  "currency": "MYR"
}

# 或錯誤回應（失敗）
{
  "error": "360 API 錯誤 (code=403): ...",
  "code": "403"
}
```

## 防火牆配置

### 開啟 port 3000

```bash
# 如果使用 GCP 防火牆規則
# 確保入站 port 3000 對 Cloud Functions 網路開放

# 檢查本機防火牆
sudo ufw allow 3000/tcp
sudo ufw reload
```

## 日誌檢查

```bash
# 實時查看日誌
pm2 logs otp-forwarder

# 查看特定時間的日誌
pm2 logs otp-forwarder --lines 100

# 日誌範例
[2026-04-29T00:11:06.123Z] HTTP: 收到請求 (IP=10.128.0.100, path=/otp)
[2026-04-29T00:11:06.234Z] OTP: 轉發 SMS {"phoneNumber":"+60123456789","messageLength":50}
[2026-04-29T00:11:06.845Z] SMS: 360 API 回應 (code=200) {"code":200,"balance":1234.56}
[2026-04-29T00:11:06.846Z] OTP: ✅ SMS 轉發成功
```

## 故障排查

### OTP Forwarder 無法啟動

```bash
# 檢查 port 是否被占用
sudo lsof -i :3000

# 檢查 Node.js 版本
node --version  # 應該 >= 14.0.0

# 檢查日誌
pm2 logs otp-forwarder
```

### 收到 403 來源 IP 錯誤

- 確認 Cloud Functions 的出站 IP 在 `ALLOWED_SOURCES` 中
- 檢查防火牆規則
- 查看日誌中的客戶端 IP

### 360 API 回應 403

- 確認 API_KEY_360 和 API_SECRET_360 正確
- 檢查 34.123.222.228 是否已在 360 白名單中
- 查詢 360 的 API 配置

## 後續步驟

1. ✅ 部署 OTP Forwarder
2. 修改 Cloud Functions 指向轉發服務
3. 更新 360 SMS 白名單：`34.123.222.228`
4. 測試完整 OTP 流程

## 支援

需要協助？檢查日誌和以下資源：
- Cloud Functions 日誌：GCP Console > Cloud Functions > Logs
- OTP Forwarder 日誌：`pm2 logs otp-forwarder`
- 360 SMS API 文檔：https://sms.360.my/
