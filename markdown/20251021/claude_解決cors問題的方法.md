# 步驟 1：建立並套用政策
@"
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allValues: ALLOW
"@ | Out-File -FilePath org-policy-project.yaml -Encoding UTF8

gcloud resource-manager org-policies set-policy org-policy-project.yaml --project=mybazaar-c4881

# 步驟 2：等待 3 分鐘讓政策生效
Write-Host "等待政策生效..." -ForegroundColor Yellow
Start-Sleep -Seconds 180

# 步驟 3：設定 Cloud Run 權限
gcloud run services add-iam-policy-binding logineventmanagerhttp `
  --region=us-central1 `
  --project=mybazaar-c4881 `
  --member="allUsers" `
  --role="roles/run.invoker"

# 步驟 4：驗證
Write-Host "`n檢查政策..." -ForegroundColor Cyan
gcloud resource-manager org-policies describe iam.allowedPolicyMemberDomains --project=mybazaar-c4881

Write-Host "`n檢查 IAM..." -ForegroundColor Cyan
gcloud run services get-iam-policy logineventmanagerhttp --region=us-central1 --project=mybazaar-c4881

Write-Host "`n完成！現在可以測試了。" -ForegroundColor Green