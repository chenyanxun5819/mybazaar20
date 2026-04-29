#!/bin/bash

# OTP Forwarder 部署腳本
# 用法: bash deploy-otp-forwarder.sh

set -e

VM_IP="34.123.222.228"
VM_USER="ubuntu"
SSH_KEY="$HOME/.ssh/gcp-key"
OTP_DIR="/opt/mybazaar/otp-forwarder"

echo "🚀 開始部署 OTP Forwarder 到 WordPress VM"
echo "目標 VM: $VM_IP"
echo "部署目錄: $OTP_DIR"
echo ""

# Step 1: 檢查 SSH 連接
echo "📡 測試 SSH 連接..."
if ! ssh -i "$SSH_KEY" -o ConnectTimeout=10 "$VM_USER@$VM_IP" "echo 'SSH 連接成功'" > /dev/null 2>&1; then
  echo "❌ SSH 連接失敗"
  echo "請確認："
  echo "1. SSH 密鑰存在: $SSH_KEY"
  echo "2. VM 已啟動: $VM_IP"
  echo "3. 防火牆允許 SSH (port 22) 從您的 IP"
  exit 1
fi
echo "✅ SSH 連接成功"
echo ""

# Step 2: 在 VM 上建立目錄
echo "📁 在 VM 上建立目錄..."
ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "sudo mkdir -p $OTP_DIR && sudo chown $VM_USER:$VM_USER $OTP_DIR"
echo "✅ 目錄準備完成"
echo ""

# Step 3: 上傳文件
echo "📤 上傳 OTP Forwarder 文件..."
scp -i "$SSH_KEY" otp-forwarder/app.js "$VM_USER@$VM_IP:$OTP_DIR/"
scp -i "$SSH_KEY" otp-forwarder/package.json "$VM_USER@$VM_IP:$OTP_DIR/"
echo "✅ 文件上傳成功"
echo ""

# Step 4: 檢查 Node.js
echo "🔍 檢查 Node.js..."
if ! ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "which node" > /dev/null 2>&1; then
  echo "📥 安裝 Node.js 18..."
  ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "✅ Node.js 安裝完成"
else
  echo "✅ Node.js 已安裝"
fi
echo ""

# Step 5: 安裝依賴
echo "📦 安裝 npm 依賴..."
ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "cd $OTP_DIR && npm install"
echo "✅ 依賴安裝完成"
echo ""

# Step 6: 上傳 .env 文件
echo "⚙️ 配置環境變數..."
if [ -f "otp-forwarder/.env" ]; then
  scp -i "$SSH_KEY" otp-forwarder/.env "$VM_USER@$VM_IP:$OTP_DIR/"
  echo "✅ .env 文件已上傳"
else
  echo "⚠️ 未找到 .env 文件，請手動創建："
  echo "   scp -i ~/.ssh/gcp-key otp-forwarder/.env ubuntu@$VM_IP:$OTP_DIR/"
fi
echo ""

# Step 7: 安裝並啟動 PM2
echo "🔄 設置 PM2 服務..."
ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "sudo npm install -g pm2"
ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "cd $OTP_DIR && pm2 start app.js --name 'otp-forwarder'"
ssh -i "$SSH_KEY" "$VM_USER@$VM_IP" "pm2 startup systemd -u $VM_USER --hp /home/$VM_USER && pm2 save"
echo "✅ PM2 服務已啟動"
echo ""

# Step 8: 測試服務
echo "🧪 測試 OTP Forwarder 服務..."
sleep 2
if curl -s "http://$VM_IP:3000/health" | grep -q "ok"; then
  echo "✅ OTP Forwarder 健康檢查通過"
else
  echo "⚠️ 無法連接到 OTP Forwarder，請檢查："
  echo "   1. VM 防火牆是否開放 port 3000"
  echo "   2. PM2 進程是否運行: ssh -i $SSH_KEY $VM_USER@$VM_IP 'pm2 logs otp-forwarder'"
fi
echo ""

echo "✅ 部署完成！"
echo ""
echo "📋 OTP Forwarder 部署信息："
echo "   位置: $OTP_DIR"
echo "   URL: http://$VM_IP:3000/otp"
echo "   Health check: http://$VM_IP:3000/health"
echo ""
echo "📝 後續步驟："
echo "   1. 檢查日誌: ssh -i $SSH_KEY $VM_USER@$VM_IP 'pm2 logs otp-forwarder'"
echo "   2. 重啟服務: ssh -i $SSH_KEY $VM_USER@$VM_IP 'pm2 restart otp-forwarder'"
echo "   3. 停止服務: ssh -i $SSH_KEY $VM_USER@$VM_IP 'pm2 stop otp-forwarder'"
