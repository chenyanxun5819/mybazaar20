# 快速測試流程：發送 OTP 並查看日誌

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OTP 測試 - 開發模式" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 步驟 1: 發送 OTP
Write-Host "[步驟 1] 發送 OTP..." -ForegroundColor Yellow
Write-Host ""

$sendOtpUrl = "https://us-central1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp"
$headers = @{
    "Content-Type" = "application/json"
}
$body = @{
    phoneNumber = "0182762768"
    orgCode = "test"
    eventCode = "test"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri $sendOtpUrl -Method POST -Headers $headers -Body $body -ContentType "application/json"
    $responseData = $response.Content | ConvertFrom-Json
    
    Write-Host "✅ OTP 請求已發送" -ForegroundColor Green
    Write-Host "SessionID: $($responseData.sessionId)" -ForegroundColor White
    Write-Host ""
} catch {
    Write-Host "❌ OTP 發送失敗: $($_.Exception.Message)" -ForegroundColor Red
    exit
}

# 等待幾秒讓日誌更新
Write-Host "[步驟 2] 等待 3 秒讓日誌更新..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
Write-Host ""

# 步驟 2: 查看日誌中的 OTP
Write-Host "[步驟 3] 從 Firebase 日誌中獲取 OTP..." -ForegroundColor Yellow
Write-Host ""

$logs = firebase functions:log 2>&1 | Out-String
$devModeLines = $logs -split "`n" | Where-Object { $_ -match "DEV MODE.*OTP Code" }

if ($devModeLines) {
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "✅ 找到 OTP!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    
    foreach ($line in $devModeLines | Select-Object -First 1) {
        if ($line -match "OTP Code:\s*(\d+)") {
            $otpCode = $matches[1]
            Write-Host "🔑 OTP Code: " -NoNewline -ForegroundColor Yellow
            Write-Host $otpCode -ForegroundColor White -BackgroundColor DarkGreen
            Write-Host ""
            Write-Host "請在登入頁面輸入此 OTP 完成驗證" -ForegroundColor Cyan
        }
    }
} else {
    Write-Host "⚠️ 未在日誌中找到 OTP" -ForegroundColor Yellow
    Write-Host "可能原因:" -ForegroundColor Gray
    Write-Host "  1. 函數尚未部署完成" -ForegroundColor Gray
    Write-Host "  2. 日誌延遲，請稍後手動查看" -ForegroundColor Gray
    Write-Host ""
    Write-Host "手動查看日誌命令:" -ForegroundColor Yellow
    Write-Host '  firebase functions:log | Select-String "DEV MODE"' -ForegroundColor White
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
