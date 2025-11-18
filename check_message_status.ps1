# 檢查 Infobip 訊息狀態
$apiKey = "6af983e84d2cd133e4afef095c5dd90e-b6ad3de7-5278-416d-916c-8bcb684a234a"
$baseUrl = "51w5lj.api.infobip.com"
$messageId = "4634545199877952322562"

$url = "https://$baseUrl/sms/1/logs"

$headers = @{
    "Authorization" = "App $apiKey"
    "Accept" = "application/json"
}

# 查詢特定 messageId 的狀態
$queryUrl = "$url`?messageId=$messageId"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Checking Message Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "[Message ID] $messageId" -ForegroundColor Yellow
Write-Host "[URL] $queryUrl" -ForegroundColor Yellow
Write-Host ""

try {
    Write-Host "[*] Fetching message status..." -ForegroundColor Cyan
    $response = Invoke-WebRequest -Uri $queryUrl -Method GET -Headers $headers
    
    Write-Host ""
    Write-Host "[SUCCESS] Status: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    
    $responseData = $response.Content | ConvertFrom-Json
    Write-Host ($responseData | ConvertTo-Json -Depth 10) -ForegroundColor White
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "訊息狀態詳情" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    
    if ($responseData.results) {
        foreach ($result in $responseData.results) {
            Write-Host ""
            Write-Host "[Message]" -ForegroundColor Yellow
            Write-Host "  To: $($result.to)" -ForegroundColor White
            Write-Host "  From: $($result.from)" -ForegroundColor White
            Write-Host "  Text: $($result.text)" -ForegroundColor White
            Write-Host "  Status: $($result.status.name) (ID: $($result.status.id))" -ForegroundColor $(
                if ($result.status.groupName -eq "DELIVERED") { "Green" }
                elseif ($result.status.groupName -eq "PENDING") { "Yellow" }
                else { "Red" }
            )
            Write-Host "  Group: $($result.status.groupName)" -ForegroundColor White
            Write-Host "  Description: $($result.status.description)" -ForegroundColor Gray
            Write-Host "  Sent At: $($result.sentAt)" -ForegroundColor White
            Write-Host "  Done At: $($result.doneAt)" -ForegroundColor White
            
            if ($result.error) {
                Write-Host "  ❌ Error Code: $($result.error.groupId)" -ForegroundColor Red
                Write-Host "  ❌ Error Name: $($result.error.name)" -ForegroundColor Red
                Write-Host "  ❌ Error Description: $($result.error.description)" -ForegroundColor Red
            }
            
            if ($result.price) {
                Write-Host "  Price: $($result.price.pricePerMessage) $($result.price.currency)" -ForegroundColor Cyan
            }
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
