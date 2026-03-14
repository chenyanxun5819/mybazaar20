# Cloud NAT 和 VPC Connector 設置腳本
# 為 Cloud Functions 配置靜態出站 IP
# 執行時間: 約 10-15 分鐘

param(
    [string]$ProjectId = "mybazaar-c4881",
    [string]$Region = "asia-southeast1",
    [string]$VpcName = "mybazaar-vpc",
    [string]$SubnetName = "mybazaar-subnet",
    [string]$RouterName = "mybazaar-router",
    [string]$NatName = "mybazaar-nat",
    [string]$ConnectorName = "mybazaar-vpc-connector"
)

Write-Host "========== Cloud NAT 和 VPC Connector 設置 ==========" -ForegroundColor Cyan
Write-Host "項目: $ProjectId" -ForegroundColor Green
Write-Host "區域: $Region" -ForegroundColor Green
Write-Host ""

# 確保當前項目
Write-Host "📍 設置當前项目..." -ForegroundColor Yellow
gcloud config set project $ProjectId

Write-Host "✅ 項目設置完成`n" -ForegroundColor Green

# =====================================================
# 步驟 1：檢查是否已有 VPC
# =====================================================
Write-Host "📋 步驟 1/5：檢查現有 VPC..." -ForegroundColor Cyan

$existingVpc = gcloud compute networks list --filter="name:$VpcName" --format="value(name)" 2>$null

if ($existingVpc) {
    Write-Host "✅ VPC '$VpcName' 已存在" -ForegroundColor Green
    $vpcName = $existingVpc
} else {
    Write-Host "❌ VPC '$VpcName' 不存在，建立中..." -ForegroundColor Yellow
    gcloud compute networks create $VpcName `
        --subnet-mode=custom `
        --bgp-routing-mode=regional
    Write-Host "✅ VPC 已建立" -ForegroundColor Green
}

# =====================================================
# 步驟 2：檢查是否已有子網
# =====================================================
Write-Host "`n📋 步驟 2/5：檢查現有子網..." -ForegroundColor Cyan

$existingSubnet = gcloud compute networks subnets list `
    --network=$VpcName `
    --filter="name:$SubnetName" `
    --format="value(name)" 2>$null

if ($existingSubnet) {
    Write-Host "✅ 子網 '$SubnetName' 已存在" -ForegroundColor Green
} else {
    Write-Host "❌ 子網 '$SubnetName' 不存在，建立中..." -ForegroundColor Yellow
    gcloud compute networks subnets create $SubnetName `
        --network=$VpcName `
        --region=$Region `
        --range=10.0.0.0/24
    Write-Host "✅ 子網已建立 (10.0.0.0/24)" -ForegroundColor Green
}

# =====================================================
# 步驟 3：檢查是否已有 Cloud Router
# =====================================================
Write-Host "`n📋 步驟 3/5：檢查現有 Cloud Router..." -ForegroundColor Cyan

$existingRouter = gcloud compute routers list `
    --filter="name:$RouterName AND region:$Region" `
    --format="value(name)" 2>$null

if ($existingRouter) {
    Write-Host "OK Router '$RouterName' already exists" -ForegroundColor Green
} else {
    Write-Host "Creating Router '$RouterName'..." -ForegroundColor Yellow
    gcloud compute routers create $RouterName `
        --network=$VpcName `
        --region=$Region
    Write-Host "OK Router created" -ForegroundColor Green
}

# =====================================================
# 步驟 4：檢查並設置 Cloud NAT
# =====================================================
Write-Host "`n📋 步驟 4/5：檢查現有 Cloud NAT..." -ForegroundColor Cyan

$existingNat = gcloud compute routers nats list `
    --router=$RouterName `
    --region=$Region `
    --filter="name:$NatName" `
    --format="value(name)" 2>$null

if ($existingNat) {
    Write-Host "✅ NAT '$NatName' 已存在" -ForegroundColor Green
    
    # 取得現有的外部 IP
    Write-Host "`n🔍 檢查現有的靜態 IP..." -ForegroundColor Yellow
    gcloud compute addresses list `
        --filter="region:$Region" `
        --format="table(name,ADDRESS,status)" 2>$null
} else {
    Write-Host "❌ NAT '$NatName' 不存在，建立中..." -ForegroundColor Yellow
    gcloud compute routers nats create $NatName `
        --router=$RouterName `
        --region=$Region `
        --auto-allocate-nat-external-ips `
        --enable-logging
    Write-Host "✅ NAT 已建立（自動分配外部 IP）" -ForegroundColor Green
    
    # 等待 NAT 完全初始化
    Write-Host "⏳ 等待 NAT 初始化（30 秒）..." -ForegroundColor Yellow
    Start-Sleep -Seconds 30
    
    # 取得分配的外部 IP
    Write-Host "`n🔍 你的靜態出站 IP:" -ForegroundColor Cyan
    gcloud compute addresses list `
        --filter="region:$Region" `
        --format="table(name,ADDRESS,status)" 2>$null
}

# =====================================================
# 步驟 5：設置 VPC Connector
# =====================================================
Write-Host "`n📋 步驟 5/5：檢查現有 VPC Connector..." -ForegroundColor Cyan

$existingConnector = gcloud compute networks vpc-access connectors list `
    --region=$Region `
    --filter="name:$ConnectorName" `
    --format="value(name)" 2>$null

if ($existingConnector) {
    Write-Host "✅ VPC Connector '$ConnectorName' 已存在" -ForegroundColor Green
} else {
    Write-Host "❌ VPC Connector '$ConnectorName' 不存在，建立中..." -ForegroundColor Yellow
    Write-Host "⏳ 這可能需要 5-10 分鐘..." -ForegroundColor Yellow
    
    gcloud compute networks vpc-access connectors create $ConnectorName `
        --network=$VpcName `
        --region=$Region `
        --min-instances=2 `
        --max-instances=10 `
        --machine-type=e2-micro
    
    Write-Host "✅ VPC Connector 已建立" -ForegroundColor Green
}

# =====================================================
# 總結
# =====================================================
Write-Host "`n" -ForegroundColor Cyan
Write-Host "========= 設置完成 =========" -ForegroundColor Green
Write-Host ""
Write-Host "📝 下一步驟：" -ForegroundColor Cyan
Write-Host "1. 取得靜態 IP 地址："
Write-Host "   gcloud compute addresses list --filter='region:$Region' --format='table(name,ADDRESS)'" -ForegroundColor Gray
Write-Host ""
Write-Host "2. 修改 firebase.json，添加 vpcConnector 配置："
Write-Host "   {`"functions`": [{`"vpcConnector`": `"projects/$ProjectId/locations/$Region/connectors/$ConnectorName`"}]}" -ForegroundColor Gray
Write-Host ""
Write-Host "3. 部署 Cloud Functions："
Write-Host "   firebase deploy --only functions" -ForegroundColor Gray
Write-Host ""
Write-Host "4. 在 360 白名單中添加靜態 IP：" -ForegroundColor Cyan
Write-Host "   https://sms.360.my/ → Configurations → IP Whitelist" -ForegroundColor Gray
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
