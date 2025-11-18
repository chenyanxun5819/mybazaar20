# Test OTP sending functionality

# Test phone number (change to your own)
$phoneNumber = "+60182762768"

# API endpoint
$sendOtpUrl = "https://us-central1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Testing SMS OTP Send" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[Phone] $phoneNumber" -ForegroundColor Yellow
Write-Host "[URL] $sendOtpUrl" -ForegroundColor Yellow
Write-Host ""

# Prepare request
$headers = @{
    "Content-Type" = "application/json"
}

$body = @{
    phoneNumber = $phoneNumber
    orgCode = "test"
    eventCode = "test"
} | ConvertTo-Json

Write-Host "[*] Sending request..." -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri $sendOtpUrl `
        -Method POST `
        -Headers $headers `
        -Body $body `
        -ErrorAction Stop

    Write-Host "[+] SUCCESS (HTTP 200)" -ForegroundColor Green
    Write-Host ""
    Write-Host "[Response]" -ForegroundColor Cyan
    
    $responseData = $response.Content | ConvertFrom-Json
    $responseData | ConvertTo-Json -Depth 10 | Write-Host
    
    if ($responseData.success) {
        Write-Host ""
        Write-Host "[+] OTP has been sent! Check your SMS." -ForegroundColor Green
        Write-Host "[Session ID] $($responseData.sessionId)" -ForegroundColor Yellow
        Write-Host "[Expires In] $($responseData.expiresIn) seconds" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "[-] Failed: $($responseData.error.message)" -ForegroundColor Red
    }
} catch {
    Write-Host "[-] Request failed" -ForegroundColor Red
    Write-Host "[Error] $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.Value__
        Write-Host "[HTTP Status] $statusCode" -ForegroundColor Red
        
        try {
            $errorBody = $_.Exception.Response.Content.ReadAsStringAsync().Result
            Write-Host "[Details]" -ForegroundColor Red
            $errorBody | ConvertFrom-Json | ConvertTo-Json | Write-Host
        } catch {
            Write-Host $errorBody
        }
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
