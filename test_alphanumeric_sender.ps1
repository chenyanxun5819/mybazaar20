# 測試使用字母發送者 ID
$apiKey = "6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a"
$baseUrl = "51w5lj.api.infobip.com"
$sender = "MyBazaar"  # 使用字母發送者 ID 而不是號碼
$recipient = "+60182762768"

$url = "https://$baseUrl/sms/2/text/advanced"

$headers = @{
    "Authorization" = "App $apiKey"
    "Content-Type" = "application/json"
}

$body = @{
    messages = @(
        @{
            destinations = @(
                @{
                    to = $recipient
                }
            )
            from = $sender
            text = "Your MyBazaar verification code is: 123456. Valid for 5 minutes."
        }
    )
} | ConvertTo-Json -Depth 5

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing Alphanumeric Sender ID" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[Sender] $sender (Alphanumeric)" -ForegroundColor Yellow
Write-Host "[Recipient] $recipient" -ForegroundColor Yellow
Write-Host ""

try {
    Write-Host "[*] Sending request..." -ForegroundColor Cyan
    $response = Invoke-WebRequest -Uri $url -Method POST -Headers $headers -Body $body -ContentType "application/json"
    
    Write-Host ""
    Write-Host "[SUCCESS] Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host ($responseData | ConvertTo-Json -Depth 5) -ForegroundColor White
    
    Write-Host ""
    if ($responseData.messages) {
        foreach ($msg in $responseData.messages) {
            Write-Host "[Message Status]" -ForegroundColor Cyan
            Write-Host "  Group: $($msg.status.groupName)" -ForegroundColor $(if ($msg.status.groupName -eq "PENDING") { "Yellow" } else { "Red" })
            Write-Host "  Status: $($msg.status.name)" -ForegroundColor White
            Write-Host "  Description: $($msg.status.description)" -ForegroundColor Gray
        }
    }
} catch {
    Write-Host ""
    Write-Host "[ERROR]" -ForegroundColor Red
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host ""
        Write-Host "[Error Response]" -ForegroundColor Yellow
        Write-Host $responseBody -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "提示: 請檢查手機是否收到來自 'MyBazaar' 的短信" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Cyan
