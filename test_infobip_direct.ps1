# 直接測試 Infobip API
$apiKey = "6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a"
$baseUrl = "51w5lj.api.infobip.com"
$sender = "+447491163443"
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
            text = "Test message from Infobip. Your code is: 123456"
        }
    )
} | ConvertTo-Json -Depth 5

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Direct Infobip API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[API Key] $($apiKey.Substring(0,10))***" -ForegroundColor Yellow
Write-Host "[Base URL] $baseUrl" -ForegroundColor Yellow
Write-Host "[Sender] $sender" -ForegroundColor Yellow
Write-Host "[Recipient] $recipient" -ForegroundColor Yellow
Write-Host "[URL] $url" -ForegroundColor Yellow
Write-Host ""
Write-Host "[Body]" -ForegroundColor Yellow
Write-Host $body -ForegroundColor Gray
Write-Host ""

try {
    Write-Host "[*] Sending request..." -ForegroundColor Cyan
    $response = Invoke-WebRequest -Uri $url -Method POST -Headers $headers -Body $body -ContentType "application/json"
    
    Write-Host ""
    Write-Host "[SUCCESS] Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "[Response]" -ForegroundColor Yellow
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host ($responseData | ConvertTo-Json -Depth 5) -ForegroundColor White
    
    Write-Host ""
    if ($responseData.messages) {
        foreach ($msg in $responseData.messages) {
            Write-Host "[Message Details]" -ForegroundColor Cyan
            Write-Host "  To: $($msg.to)" -ForegroundColor White
            Write-Host "  MessageId: $($msg.messageId)" -ForegroundColor White
            Write-Host "  Status Group: $($msg.status.groupId)" -ForegroundColor White
            Write-Host "  Status Name: $($msg.status.name)" -ForegroundColor White
            Write-Host "  Status Description: $($msg.status.description)" -ForegroundColor White
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
