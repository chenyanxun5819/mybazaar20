# 🚀 OTP Forwarder 部署指南（手動執行）

## 概述

本指南說明如何在 WordPress VM 上部署 OTP Forwarder 服務。

**部署目標**: `http://34.123.222.228:3000/otp`

---

## 📋 前置要求

- GCP 項目: `mybazaar-c4881`
- WordPress VM: `34.123.222.228` (asia-southeast1-a)
- 本機已安裝: gcloud CLI 或 SSH 客戶端

---

## 🔧 方法 1: 使用 gcloud compute ssh（推薦）

### Step 1: 查找 WordPress VM 名稱

```bash
# Windows PowerShell
gcloud compute instances list --filter="status:RUNNING AND zone:*asia-southeast1*" --format="table(name,status,EXTERNAL_IP,INTERNAL_IP)"
```

找到 External IP 為 `34.123.222.228` 的 VM 名稱（例如: `wordpress-vm`）

### Step 2: SSH 連接到 VM

```bash
# 使用 gcloud 連接（自動處理認證）
gcloud compute ssh wordpress-vm --zone=asia-southeast1-a --project=mybazaar-c4881

# 或者，如果 VM 在其他 zone：
gcloud compute ssh INSTANCE_NAME --zone=ZONE --project=mybazaar-c4881
```

### Step 3: 在 VM 上執行以下命令

進入 SSH 後，複製並執行以下所有命令：

```bash
# 1. 建立部署目錄
sudo mkdir -p /opt/mybazaar/otp-forwarder
sudo chown ubuntu:ubuntu /opt/mybazaar/otp-forwarder
cd /opt/mybazaar/otp-forwarder

# 2. 檢查 Node.js（應該已安裝在 WordPress 服務器上）
node --version
# 如果未安裝，執行：
# curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
# sudo apt-get install -y nodejs

# 3. 從本機上傳文件（在本機終端執行）
# 在您的本機（不是 VM）執行以下命令：
# gcloud compute scp app.js wordpress-vm:/opt/mybazaar/otp-forwarder/ --zone=asia-southeast1-a --project=mybazaar-c4881
# gcloud compute scp package.json wordpress-vm:/opt/mybazaar/otp-forwarder/ --zone=asia-southeast1-a --project=mybazaar-c4881

# 4. 回到 VM，安裝依賴
cd /opt/mybazaar/otp-forwarder
npm install

# 5. 配置環境變數
cat > .env << 'EOF'
API_KEY_360=YOUR_API_KEY_360
API_SECRET_360=YOUR_API_SECRET_360
API_BASE_URL_360=https://sms.360.my/gw/bulk360/v3_0/send.php
ALLOWED_SOURCES=127.0.0.1
LOG_LEVEL=info
EOF

# 填充以下值：
# - API_KEY_360: 從 Firebase Secret Manager 或本地配置取得
# - API_SECRET_360: 從 Firebase Secret Manager 或本地配置取得

# 6. 安裝 PM2（進程管理器）
sudo npm install -g pm2

# 7. 啟動服務
pm2 start app.js --name "otp-forwarder"

# 8. 設置開機自動啟動
pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save

# 9. 驗證服務運行
curl http://localhost:3000/health

# 應該返回類似:
# {"status":"ok","timestamp":"2026-04-29T01:53:08.131649Z","uptime":5}

# 10. 檢查日誌
pm2 logs otp-forwarder
```

---

## 📤 方法 2: 使用本機的 Deploy 腳本（需要 SSH 設置）

如果已配置 SSH 密鑰，可在本機執行：

```powershell
# Windows PowerShell
.\Deploy-OtpForwarder.ps1

# 自訂參數
.\Deploy-OtpForwarder.ps1 -VmIp "34.123.222.228" -VmUser "ubuntu" -SshKey "$env:USERPROFILE\.ssh\gcp-key"
```

---

## 🔐 配置 Firebase Secret Manager（取得 API 密鑰）

### 1. 查看 API 密鑰

```bash
# 使用 Firebase CLI（本機執行）
firebase functions:config:get

# 或使用 gcloud
gcloud secrets versions access latest --secret=API_KEY_360 --project=mybazaar-c4881
gcloud secrets versions access latest --secret=API_SECRET_360 --project=mybazaar-c4881
```

### 2. 設置 .env

將取得的值填入 VM 上的 `.env` 文件：

```bash
# VM 上執行
nano /opt/mybazaar/otp-forwarder/.env
```

填入以下內容：

```
API_KEY_360=<YOUR_API_KEY_HERE>
API_SECRET_360=<YOUR_API_SECRET_HERE>
API_BASE_URL_360=https://sms.360.my/gw/bulk360/v3_0/send.php
ALLOWED_SOURCES=127.0.0.1
LOG_LEVEL=info
```

---

## 🧪 測試 OTP Forwarder

### 1. 本機測試（HTTP 請求）

```bash
# 測試健康檢查
curl http://34.123.222.228:3000/health

# 應返回:
# {"status":"ok","timestamp":"...","uptime":...}

# 測試 OTP 轉發（需要正確的 API 密鑰）
curl -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+60191234567","message":"Test OTP"}'

# 應返回:
# {"code":200,"balance":"...","desc":"Success"}
```

### 2. VM 上測試

```bash
# SSH 連接到 VM，執行
curl http://localhost:3000/health

# 檢查日誌
pm2 logs otp-forwarder

# 重啟服務
pm2 restart otp-forwarder
```

---

## 🐛 故障排查

### 問題 1: PM2 進程未運行

```bash
# 查看進程狀態
pm2 status

# 查看日誌
pm2 logs otp-forwarder

# 重新啟動
pm2 restart otp-forwarder

# 檢查 port 是否被佔用
netstat -tlnp | grep 3000
# 或
lsof -i :3000
```

### 問題 2: 無法連接到 OTP Forwarder

1. **檢查防火牆規則**
   ```bash
   # GCP Console → VPC network → Firewall rules
   # 確認允許 TCP 3000 入站流量
   ```

2. **檢查服務運行狀態**
   ```bash
   # SSH 到 VM
   gcloud compute ssh wordpress-vm --zone=asia-southeast1-a
   pm2 status
   curl http://localhost:3000/health
   ```

3. **檢查 VM 防火牆**
   ```bash
   sudo ufw status
   # 如果啟用，確認允許 3000 端口
   sudo ufw allow 3000/tcp
   ```

### 問題 3: 360 API 返回 403 錯誤

- 確認 API 密鑰正確
- 確認 360 SMS 白名單已更新（見下一步）
- 檢查 `.env` 配置

---

## ✅ 驗證部署

### Step 1: 檢查服務狀態

```bash
# SSH 到 VM
gcloud compute ssh wordpress-vm --zone=asia-southeast1-a

# 查看進程
pm2 status

# 輸出應包含:
# ┌────────────────────┬──────┬──────┬─────────┐
# │ id  │ name          │ mode │ ↺    │ status  │
# ├────────────────────┼──────┼──────┼─────────┤
# │ 0   │ otp-forwarder │ fork │ 0    │ online  │
```

### Step 2: 測試健康檢查

```bash
curl http://34.123.222.228:3000/health
```

應返回 `{"status":"ok",...}`

### Step 3: 查看日誌

```bash
pm2 logs otp-forwarder
```

應顯示啟動日誌，無錯誤信息

---

## 📝 後續步驟

部署完成後：

1. **更新 360 SMS 白名單**（見: [OTP_SETTINGS_FIX_20260213.md](OTP_SETTINGS_FIX_20260213.md)）
   - 添加: `34.123.222.228` (Forwarder IP)
   - 刪除: `0.0.0.0` (所有 IP)

2. **測試完整的 OTP 流程**
   - 發送 OTP
   - 驗證 SMS 收到
   - 完成驗證流程

3. **監控日誌**
   ```bash
   # 持續監控
   pm2 logs otp-forwarder --lines 100
   ```

---

## 🔗 相關資源

- [OTP Forwarder 應用代碼](otp-forwarder/app.js)
- [OTP_SETTINGS_FIX_20260213.md](OTP_SETTINGS_FIX_20260213.md) - 360 白名單配置
- [OTP_FORWARDER_SUMMARY.md](OTP_FORWARDER_SUMMARY.md) - 架構概述

---

## 🆘 需要幫助？

執行出現問題時：

1. 收集日誌: `pm2 logs otp-forwarder`
2. 檢查配置: `cat /opt/mybazaar/otp-forwarder/.env`
3. 測試連接: `curl http://34.123.222.228:3000/health`
4. 查看防火牆規則（GCP Console）
