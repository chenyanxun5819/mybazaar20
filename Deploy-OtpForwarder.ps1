# OTP Forwarder 部署腳本（PowerShell 版）
# 用法: .\Deploy-OtpForwarder.ps1

param(
    [string]$VmIp = "34.123.222.228",
    [string]$VmUser = "ubuntu",
    [string]$SshKey = "$env:USERPROFILE\.ssh\gcp-key",
    [string]$OtpDir = "/opt/mybazaar/otp-forwarder"
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message, [string]$Emoji = "📋")
    Write-Host ""
    Write-Host "$Emoji $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Warning-Custom {
    param([string]$Message)
    Write-Host "⚠️ $Message" -ForegroundColor Yellow
}

# 驗證文件
Write-Step "驗證文件..." "📂"

$files = @(
    "otp-forwarder/app.js",
    "otp-forwarder/package.json"
)

foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Error-Custom "缺少文件: $file"
        exit 1
    }
}
Write-Success "所有必要文件已找到"

# 驗證 SSH 密鑰
Write-Step "驗證 SSH 密鑰..." "🔑"
if (-not (Test-Path $SshKey)) {
    Write-Error-Custom "SSH 密鑰不存在: $SshKey"
    exit 1
}
Write-Success "SSH 密鑰已找到"

# 測試 SSH 連接
Write-Step "測試 SSH 連接..." "📡"
try {
    $result = ssh -i $SshKey -o ConnectTimeout=10 "$VmUser@$VmIp" "echo 'SSH連接成功'" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Custom "SSH 連接失敗"
        Write-Host "請確認："
        Write-Host "1. SSH 密鑰存在: $SshKey"
        Write-Host "2. VM 已啟動: $VmIp"
        Write-Host "3. 防火牆允許 SSH (port 22)"
        exit 1
    }
    Write-Success "SSH 連接成功"
} catch {
    Write-Error-Custom "SSH 連接失敗: $_"
    exit 1
}

# 建立遠程目錄
Write-Step "在 VM 上建立目錄..." "📁"
ssh -i $SshKey "$VmUser@$VmIp" "sudo mkdir -p $OtpDir && sudo chown $VmUser`:$VmUser $OtpDir" | Out-Null
Write-Success "目錄準備完成"

# 上傳文件
Write-Step "上傳 OTP Forwarder 文件..." "📤"
scp -i $SshKey "otp-forwarder/app.js" "$VmUser@$VmIp`:$OtpDir/" | Out-Null
scp -i $SshKey "otp-forwarder/package.json" "$VmUser@$VmIp`:$OtpDir/" | Out-Null
Write-Success "文件上傳成功"

# 檢查 Node.js
Write-Step "檢查 Node.js..." "🔍"
$nodeCheck = ssh -i $SshKey "$VmUser@$VmIp" "which node" 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "📥 安裝 Node.js 18..."
    ssh -i $SshKey "$VmUser@$VmIp" "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash - && sudo apt-get install -y nodejs" | Out-Null
    Write-Success "Node.js 安裝完成"
} else {
    Write-Success "Node.js 已安裝"
}

# 安裝依賴
Write-Step "安裝 npm 依賴..." "📦"
ssh -i $SshKey "$VmUser@$VmIp" "cd $OtpDir && npm install" | Out-Null
Write-Success "依賴安裝完成"

# 上傳 .env 文件（如果存在）
Write-Step "配置環境變數..." "⚙️"
if (Test-Path "otp-forwarder/.env") {
    scp -i $SshKey "otp-forwarder/.env" "$VmUser@$VmIp`:$OtpDir/" | Out-Null
    Write-Success ".env 文件已上傳"
} else {
    Write-Warning-Custom "未找到 .env 文件"
    Write-Host "請手動創建並上傳:"
    Write-Host "   scp -i $SshKey otp-forwarder/.env $VmUser@$VmIp`:$OtpDir/"
}

# 安裝並啟動 PM2
Write-Step "設置 PM2 服務..." "🔄"
ssh -i $SshKey "$VmUser@$VmIp" "sudo npm install -g pm2" | Out-Null
ssh -i $SshKey "$VmUser@$VmIp" "cd $OtpDir && pm2 start app.js --name 'otp-forwarder'" | Out-Null
ssh -i $SshKey "$VmUser@$VmIp" "pm2 startup systemd -u $VmUser --hp /home/$VmUser && pm2 save" | Out-Null
Write-Success "PM2 服務已啟動"

# 測試服務
Write-Step "測試 OTP Forwarder 服務..." "🧪"
Start-Sleep -Seconds 2
try {
    $healthCheck = curl -s "http://$VmIp:3000/health" 2>$null
    if ($healthCheck -like "*ok*") {
        Write-Success "OTP Forwarder 健康檢查通過"
    } else {
        Write-Warning-Custom "無法連接到 OTP Forwarder"
        Write-Host "請檢查:"
        Write-Host "   1. VM 防火牆是否開放 port 3000"
        Write-Host "   2. PM2 進程是否運行: ssh -i $SshKey $VmUser@$VmIp 'pm2 logs otp-forwarder'"
    }
} catch {
    Write-Warning-Custom "健康檢查失敗: $_"
}

# 完成
Write-Host ""
Write-Host "✅ 部署完成！" -ForegroundColor Green
Write-Host ""
Write-Host "📋 OTP Forwarder 部署信息:" -ForegroundColor Cyan
Write-Host "   位置: $OtpDir"
Write-Host "   URL: http://$VmIp:3000/otp"
Write-Host "   Health check: http://$VmIp:3000/health"
Write-Host ""
Write-Host "📝 後續步驟:" -ForegroundColor Cyan
Write-Host "   1. 檢查日誌: ssh -i $SshKey $VmUser@$VmIp 'pm2 logs otp-forwarder'"
Write-Host "   2. 重啟服務: ssh -i $SshKey $VmUser@$VmIp 'pm2 restart otp-forwarder'"
Write-Host "   3. 停止服務: ssh -i $SshKey $VmUser@$VmIp 'pm2 stop otp-forwarder'"
Write-Host ""
