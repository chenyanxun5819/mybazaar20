# ========================================
# Cloud Functions 權限檢查與修復腳本
# ========================================

$project = "mybazaar-c4881"
$region = "us-central1"
$serviceAccount = "1069326034581-compute@developer.gserviceaccount.com"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Cloud Functions 權限檢查與修復工具" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# ========================================
# 步驟 1: 列出所有 Cloud Functions (Gen 2)
# ========================================
Write-Host "[1/4] 正在列出所有 Cloud Run 服務 (Gen2 Functions)..." -ForegroundColor Yellow

$services = gcloud run services list `
    --region=$region `
    --project=$project `
    --format="value(metadata.name)" 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "錯誤：無法列出服務" -ForegroundColor Red
    exit 1
}

$serviceList = $services -split "`n" | Where-Object { $_ -ne "" }
Write-Host "找到 $($serviceList.Count) 個服務`n" -ForegroundColor Green

# ========================================
# 步驟 2: 檢查每個服務的權限
# ========================================
Write-Host "[2/4] 檢查每個服務的權限..." -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Gray

$results = @()

foreach ($service in $serviceList) {
    Write-Host "檢查: $service" -ForegroundColor Cyan
    
    # 獲取 IAM 政策
    $policy = gcloud run services get-iam-policy $service `
        --region=$region `
        --project=$project `
        --format=json 2>$null | ConvertFrom-Json
    
    $hasAllUsers = $false
    $hasComputeAccount = $false
    $otherMembers = @()
    
    if ($policy.bindings) {
        foreach ($binding in $policy.bindings) {
            if ($binding.role -eq "roles/run.invoker") {
                foreach ($member in $binding.members) {
                    if ($member -eq "allUsers") {
                        $hasAllUsers = $true
                        Write-Host "  ⚠️  發現公開存取 (allUsers)" -ForegroundColor Red
                    }
                    elseif ($member -eq "serviceAccount:$serviceAccount") {
                        $hasComputeAccount = $true
                        Write-Host "  ✅ 已設定 Compute Engine 服務帳號" -ForegroundColor Green
                    }
                    else {
                        $otherMembers += $member
                        Write-Host "  ℹ️  其他成員: $member" -ForegroundColor Gray
                    }
                }
            }
        }
    }
    
    if (-not $hasAllUsers -and -not $hasComputeAccount -and $otherMembers.Count -eq 0) {
        Write-Host "  ℹ️  無任何 Invoker 權限（私有）" -ForegroundColor Yellow
    }
    
    $results += [PSCustomObject]@{
        Service = $service
        HasAllUsers = $hasAllUsers
        HasComputeAccount = $hasComputeAccount
        OtherMembers = $otherMembers
    }
    
    Write-Host ""
}

# ========================================
# 步驟 3: 顯示摘要
# ========================================
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "[3/4] 檢查結果摘要" -ForegroundColor Yellow
Write-Host "========================================`n" -ForegroundColor Cyan

$publicServices = $results | Where-Object { $_.HasAllUsers }
$secureServices = $results | Where-Object { $_.HasComputeAccount }
$privateServices = $results | Where-Object { -not $_.HasAllUsers -and -not $_.HasComputeAccount }

Write-Host "🔴 公開存取 (allUsers): $($publicServices.Count)" -ForegroundColor Red
if ($publicServices.Count -gt 0) {
    foreach ($svc in $publicServices) {
        Write-Host "   - $($svc.Service)" -ForegroundColor Red
    }
}

Write-Host "`n🟢 已設定 Compute Engine 帳號: $($secureServices.Count)" -ForegroundColor Green
if ($secureServices.Count -gt 0) {
    foreach ($svc in $secureServices) {
        Write-Host "   - $($svc.Service)" -ForegroundColor Green
    }
}

Write-Host "`n⚪ 私有（無 Invoker 權限）: $($privateServices.Count)" -ForegroundColor Gray
if ($privateServices.Count -gt 0) {
    foreach ($svc in $privateServices) {
        Write-Host "   - $($svc.Service)" -ForegroundColor Gray
    }
}

# ========================================
# 步驟 4: 詢問是否修復
# ========================================
if ($publicServices.Count -gt 0) {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "[4/4] 修復公開存取的服務" -ForegroundColor Yellow
    Write-Host "========================================`n" -ForegroundColor Cyan
    
    Write-Host "發現 $($publicServices.Count) 個服務開放公開存取" -ForegroundColor Red
    Write-Host "建議操作：" -ForegroundColor Yellow
    Write-Host "  1. 移除 allUsers 權限" -ForegroundColor Yellow
    Write-Host "  2. 改用 Compute Engine 服務帳號" -ForegroundColor Yellow
    Write-Host ""
    
    $response = Read-Host "是否要自動修復這些服務？(y/n)"
    
    if ($response -eq "y" -or $response -eq "Y") {
        Write-Host "`n開始修復..." -ForegroundColor Green
        
        foreach ($svc in $publicServices) {
            Write-Host "`n處理: $($svc.Service)" -ForegroundColor Cyan
            
            # 移除 allUsers
            Write-Host "  - 移除 allUsers 權限..." -ForegroundColor Yellow
            gcloud run services remove-iam-policy-binding $svc.Service `
                --region=$region `
                --project=$project `
                --member="allUsers" `
                --role="roles/run.invoker" `
                --quiet 2>$null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    ✅ allUsers 已移除" -ForegroundColor Green
            } else {
                Write-Host "    ⚠️  移除失敗" -ForegroundColor Red
            }
            
            # 添加 Compute Engine 服務帳號
            Write-Host "  - 添加 Compute Engine 服務帳號..." -ForegroundColor Yellow
            gcloud run services add-iam-policy-binding $svc.Service `
                --region=$region `
                --project=$project `
                --member="serviceAccount:$serviceAccount" `
                --role="roles/run.invoker" `
                --quiet 2>$null
            
            if ($LASTEXITCODE -eq 0) {
                Write-Host "    ✅ Compute Engine 帳號已添加" -ForegroundColor Green
            } else {
                Write-Host "    ⚠️  添加失敗" -ForegroundColor Red
            }
        }
        
        Write-Host "`n========================================" -ForegroundColor Green
        Write-Host "修復完成！" -ForegroundColor Green
        Write-Host "========================================`n" -ForegroundColor Green
        
        Write-Host "建議：重新執行此腳本驗證結果" -ForegroundColor Yellow
    }
    else {
        Write-Host "`n取消修復操作" -ForegroundColor Gray
    }
}
else {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "✅ 沒有發現公開存取的服務" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
}

# ========================================
# 完成
# ========================================
Write-Host "`n腳本執行完成！" -ForegroundColor Cyan
Write-Host "如需手動修改特定服務，請使用：" -ForegroundColor Gray
Write-Host "gcloud run services get-iam-policy <服務名稱> --region=$region --project=$project" -ForegroundColor Gray