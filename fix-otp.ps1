# EventManagerLogin OTP 問題修復腳本 (Windows PowerShell)

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "🔧 EventManagerLogin OTP 問題修復腳本" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# 檢查是否在項目根目錄
if (-not (Test-Path "package.json")) {
    Write-Host "❌ 錯誤: 請在項目根目錄運行此腳本" -ForegroundColor Red
    exit 1
}

Write-Host "Step 1/4: 檢查 firebase.json 配置..." -ForegroundColor Yellow
if (-not (Test-Path "firebase.json")) {
    Write-Host "❌ firebase.json 不存在" -ForegroundColor Red
    Write-Host "請手動創建或複製提供的 firebase.json 範例文件"
    exit 1
}

# 檢查是否包含 sendOtpHttp rewrite
$firebaseJson = Get-Content "firebase.json" -Raw
if ($firebaseJson -match "sendOtpHttp") {
    Write-Host "✓ firebase.json 包含 OTP rewrites 配置" -ForegroundColor Green
} else {
    Write-Host "❌ firebase.json 缺少 OTP rewrites 配置" -ForegroundColor Red
    Write-Host "請將以下內容添加到 firebase.json 的 rewrites 數組中："
    Write-Host '  {'
    Write-Host '    "source": "/api/sendOtpHttp",'
    Write-Host '    "function": "sendOtpHttp"'
    Write-Host '  },'
    Write-Host '  {'
    Write-Host '    "source": "/api/verifyOtpHttp",'
    Write-Host '    "function": "verifyOtpHttp"'
    Write-Host '  }'
    exit 1
}

Write-Host ""
Write-Host "Step 2/4: 檢查 Cloud Functions 代碼..." -ForegroundColor Yellow
if (-not (Test-Path "functions/otpVerify.js")) {
    Write-Host "❌ functions/otpVerify.js 不存在" -ForegroundColor Red
    Write-Host "請確保已將 otpVerify.js 複製到 functions/ 目錄"
    exit 1
} else {
    Write-Host "✓ otpVerify.js 存在" -ForegroundColor Green
}

if (-not (Test-Path "functions/index.js")) {
    Write-Host "❌ functions/index.js 不存在" -ForegroundColor Red
    exit 1
}

# 檢查 index.js 是否導出 OTP functions
$indexJs = Get-Content "functions/index.js" -Raw
if (($indexJs -match "exports\.sendOtpHttp") -and ($indexJs -match "exports\.verifyOtpHttp")) {
    Write-Host "✓ index.js 正確導出 OTP functions" -ForegroundColor Green
} else {
    Write-Host "❌ index.js 缺少 OTP functions 導出" -ForegroundColor Red
    Write-Host "請確保 functions/index.js 包含以下內容："
    Write-Host 'const { sendOtpHttp, verifyOtpHttp } = require("./otpVerify");'
    Write-Host 'exports.sendOtpHttp = sendOtpHttp;'
    Write-Host 'exports.verifyOtpHttp = verifyOtpHttp;'
    exit 1
}

Write-Host ""
Write-Host "Step 3/4: 部署 Cloud Functions..." -ForegroundColor Yellow
$deployFunctions = Read-Host "是否要部署 Cloud Functions? (y/n)"
if ($deployFunctions -eq 'y' -or $deployFunctions -eq 'Y') {
    Push-Location functions
    
    # 檢查是否需要安裝依賴
    if (-not (Test-Path "node_modules")) {
        Write-Host "安裝 npm 依賴..."
        npm install
    }
    
    Pop-Location
    
    Write-Host "部署 OTP Functions..."
    firebase deploy --only functions:sendOtpHttp,functions:verifyOtpHttp
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Functions 部署成功" -ForegroundColor Green
    } else {
        Write-Host "❌ Functions 部署失敗" -ForegroundColor Red
        Write-Host "請檢查錯誤訊息並手動修復"
        exit 1
    }
} else {
    Write-Host "⚠ 跳過 Functions 部署" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Step 4/4: 部署 Hosting 配置..." -ForegroundColor Yellow
$deployHosting = Read-Host "是否要部署 Hosting? (y/n)"
if ($deployHosting -eq 'y' -or $deployHosting -eq 'Y') {
    # 構建前端（如果需要）
    if (Test-Path "package.json") {
        Write-Host "構建前端..."
        npm run build
        
        if ($LASTEXITCODE -ne 0) {
            Write-Host "❌ 前端構建失敗" -ForegroundColor Red
            exit 1
        }
    }
    
    Write-Host "部署 Hosting..."
    firebase deploy --only hosting
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Hosting 部署成功" -ForegroundColor Green
    } else {
        Write-Host "❌ Hosting 部署失敗" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "⚠ 跳過 Hosting 部署" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "✅ 修復完成！" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "請訪問以下 URL 測試 Event Manager 登錄："
Write-Host "https://YOUR-PROJECT.web.app/event-manager/chhsban-2025/login"
Write-Host ""
Write-Host "開發模式已啟用，固定 OTP 為: 223344" -ForegroundColor Yellow
Write-Host ""
Write-Host "如果仍有問題，請查看："
Write-Host "1. Firebase Console Functions 頁面"
Write-Host "2. 瀏覽器 Console (F12)"
Write-Host "3. Firebase Functions 日誌: firebase functions:log"
Write-Host ""