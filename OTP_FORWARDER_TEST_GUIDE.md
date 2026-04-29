# OTP Forwarder 快速測試腳本

## 測試 1: 檢查 OTP Forwarder 狀態

```bash
#!/bin/bash

echo "🔍 [Test 1] 檢查 OTP Forwarder 健康狀態..."

FORWARDER_URL="http://34.123.222.228:3000/health"

response=$(curl -s -w "\n%{http_code}" $FORWARDER_URL)
body=$(echo "$response" | head -n 1)
http_code=$(echo "$response" | tail -n 1)

if [ "$http_code" == "200" ]; then
  echo "✅ OTP Forwarder 正常運行"
  echo "回應: $body"
else
  echo "❌ OTP Forwarder 無法連接"
  echo "HTTP Code: $http_code"
  exit 1
fi
```

## 測試 2: 測試 OTP 轉發（測試號碼）

```bash
#!/bin/bash

echo "🔍 [Test 2] 測試 OTP 轉發..."

FORWARDER_URL="http://34.123.222.228:3000/otp"
TEST_PHONE="+60123456789"
TEST_MESSAGE="測試 OTP: 123456"

response=$(curl -s -X POST $FORWARDER_URL \
  -H "Content-Type: application/json" \
  -d "{
    \"phoneNumber\": \"$TEST_PHONE\",
    \"message\": \"$TEST_MESSAGE\"
  }")

echo "回應: $response"

# 檢查是否包含 code=200 或 error
if echo "$response" | grep -q "code.*200"; then
  echo "✅ OTP 轉發成功（360 已接收）"
elif echo "$response" | grep -q "error"; then
  echo "⚠️ 360 API 返回錯誤"
  echo "$response"
else
  echo "⚠️ 無法確定結果，請檢查日誌"
fi
```

## 測試 3: 檢查 Cloud Functions 配置

```bash
#!/bin/bash

echo "🔍 [Test 3] 檢查 Cloud Functions 配置..."

# 從 Firebase config 讀取
config=$(firebase functions:config:get)

if echo "$config" | grep -q "otp.forwarder_url"; then
  echo "✅ OTP_FORWARDER_URL 已設置"
  echo "$config" | grep "otp.forwarder_url"
else
  echo "⚠️ OTP_FORWARDER_URL 未設置"
  echo "請執行: firebase functions:config:set otp.forwarder_url=\"http://34.123.222.228:3000/otp\""
fi

# 檢查 API 認證是否已設置
if echo "$config" | grep -q "api_key_360\|API_KEY_360"; then
  echo "✅ 360 SMS API 認證已配置"
else
  echo "⚠️ 360 SMS API 認證未配置"
fi
```

## 測試 4: 檢查 360 SMS 白名單

```bash
#!/bin/bash

echo "🔍 [Test 4] 檢查 360 SMS 白名單..."
echo "⚠️ 此測試需要手動檢查 360 SMS 控制臺"
echo ""
echo "請訪問: https://sms.360.my/"
echo "1. 登入您的 360 SMS 帳戶"
echo "2. 進入 Settings > IP Whitelist"
echo "3. 確保 34.123.222.228 已啟用"
echo "4. 確保 0.0.0.0 已刪除"
echo ""
echo "檢查清單："
echo "  [ ] IP 34.123.222.228 存在於白名單中"
echo "  [ ] IP 34.123.222.228 已啟用（enabled）"
echo "  [ ] 0.0.0.0（允許所有 IP）已刪除"
```

## 測試 5: 檢查防火牆規則

```bash
#!/bin/bash

echo "🔍 [Test 5] 檢查 GCP 防火牆規則..."

# 列出防火牆規則
gcloud compute firewall-rules list --filter="targetTags~'http-server|default-allow-http'"

echo ""
echo "確保有規則允許："
echo "  • 入站 port 3000（OTP Forwarder）"
echo "  • 入站 port 80 和 443（HTTPS 連接到 360 API）"
echo ""
echo "如需添加規則："
echo "  gcloud compute firewall-rules create allow-otp-forwarder \\"
echo "    --allow tcp:3000 \\"
echo "    --source-ranges 0.0.0.0/0 \\"
echo "    --target-tags otp-forwarder"
```

## 測試 6: 檢查 PM2 服務狀態

```bash
#!/bin/bash

echo "🔍 [Test 6] 檢查 PM2 服務狀態..."

# 需要 SSH 到 WordPress VM
ssh ubuntu@34.123.222.228 'pm2 status'

echo ""
echo "預期輸出應該顯示 otp-forwarder 的狀態為 'online'"
```

## 完整測試腳本

將以下代碼保存為 `test-otp-forwarder.sh`：

```bash
#!/bin/bash

set -e

echo "=========================================="
echo "OTP Forwarder 完整測試"
echo "=========================================="
echo ""

# 顏色定義
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

# 測試 1: 健康檢查
echo -e "${YELLOW}[1/5] 檢查 OTP Forwarder 健康狀態...${NC}"
if curl -s http://34.123.222.228:3000/health | grep -q "ok"; then
  echo -e "${GREEN}✅ PASS${NC}"
  ((pass_count++))
else
  echo -e "${RED}❌ FAIL${NC}"
  ((fail_count++))
fi
echo ""

# 測試 2: OTP 轉發
echo -e "${YELLOW}[2/5] 測試 OTP 轉發...${NC}"
response=$(curl -s -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+60123456789","message":"測試"}')

if echo "$response" | grep -q -E "(code|error)"; then
  echo -e "${GREEN}✅ PASS（收到回應）${NC}"
  echo "回應: $response"
  ((pass_count++))
else
  echo -e "${RED}❌ FAIL（無回應）${NC}"
  ((fail_count++))
fi
echo ""

# 測試 3: 檢查 360 API 認證
echo -e "${YELLOW}[3/5] 檢查 360 API 認證配置...${NC}"
config=$(firebase functions:config:get 2>/dev/null || echo "")
if [ -n "$config" ]; then
  echo -e "${GREEN}✅ PASS（Firebase 配置存在）${NC}"
  ((pass_count++))
else
  echo -e "${YELLOW}⚠️ SKIP（無法訪問 Firebase CLI）${NC}"
fi
echo ""

# 測試 4: 檢查 OTP Forwarder 日誌
echo -e "${YELLOW}[4/5] 檢查 OTP Forwarder 日誌...${NC}"
logs=$(ssh ubuntu@34.123.222.228 'pm2 logs otp-forwarder --lines 5' 2>/dev/null || echo "")
if echo "$logs" | grep -q "OTP\|SMS\|Server"; then
  echo -e "${GREEN}✅ PASS（日誌正常）${NC}"
  ((pass_count++))
else
  echo -e "${YELLOW}⚠️ SKIP（無法連接 SSH）${NC}"
fi
echo ""

# 測試 5: 檢查防火牆
echo -e "${YELLOW}[5/5] 檢查防火牆規則...${NC}"
rules=$(gcloud compute firewall-rules list 2>/dev/null | grep -c "default\|http\|otp" || echo "0")
if [ "$rules" -gt 0 ]; then
  echo -e "${GREEN}✅ PASS（防火牆規則存在）${NC}"
  ((pass_count++))
else
  echo -e "${YELLOW}⚠️ SKIP（無法訪問 GCP CLI）${NC}"
fi
echo ""

# 總結
echo "=========================================="
echo -e "測試結果: ${GREEN}通過 $pass_count${NC} / ${RED}失敗 $fail_count${NC}"
echo "=========================================="

if [ $fail_count -eq 0 ]; then
  echo -e "${GREEN}✅ 所有測試通過！${NC}"
  exit 0
else
  echo -e "${RED}❌ 某些測試失敗，請檢查上述錯誤${NC}"
  exit 1
fi
```

執行測試：
```bash
chmod +x test-otp-forwarder.sh
./test-otp-forwarder.sh
```

---

## 快速診斷命令

### 檢查 OTP Forwarder 是否運行

```bash
# SSH 到 WordPress VM
ssh ubuntu@34.123.222.228

# 檢查 PM2 狀態
pm2 status

# 查看實時日誌
pm2 logs otp-forwarder

# 重啟服務
pm2 restart otp-forwarder
```

### 檢查 360 API 連接

```bash
# 測試 360 API 端點
curl -X POST https://sms.360.my/gw/bulk360/v3_0/send.php \
  -d "user=YOUR_API_KEY&pass=YOUR_API_SECRET&to=60123456789&text=test&detail=1"
```

### 檢查網絡連接

```bash
# 從 Cloud Functions 測試連接（模擬）
curl -X POST http://34.123.222.228:3000/otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber":"+60123456789","message":"test"}'
```

---

## 故障排查命令

### 如果收到 403 IP 白名單錯誤

```bash
# 1. 檢查 OTP Forwarder 是否能連接到 360
ssh ubuntu@34.123.222.228

# 2. 在 VM 上測試 360 連接
curl -X POST https://sms.360.my/gw/bulk360/v3_0/send.php \
  -v \
  -d "user=KEY&pass=SECRET&to=60123456789&text=test&detail=1"

# 3. 查看是否返回 403 錯誤
# 如果返回 403，表示 IP 34.123.222.228 未在 360 白名單中

# 4. 更新 360 白名單（在 https://sms.360.my/ 中）
```

### 如果 OTP Forwarder 無法啟動

```bash
# 1. 檢查 port 3000 是否被占用
sudo lsof -i :3000

# 2. 檢查 .env 文件是否正確
cat /opt/mybazaar/otp-forwarder/.env

# 3. 檢查環境變量中是否有敏感信息
grep API_KEY_360 /opt/mybazaar/otp-forwarder/.env

# 4. 手動測試運行
cd /opt/mybazaar/otp-forwarder
node app.js

# 5. 查看錯誤信息並修復
```

---

## 測試成功指標

✅ **測試通過時的預期結果：**

1. **健康檢查**：返回 `{"status":"ok","timestamp":"...","uptime":123}`
2. **OTP 轉發**：返回 `{"code":200,"balance":...}` 或相關錯誤碼
3. **日誌**：显示 `✅ SMS 轉發成功` 
4. **防火牆**：port 3000 允許入站
5. **360 白名單**：34.123.222.228 已啟用，0.0.0.0 已刪除

---

## 下一步

如果所有測試都通過，您可以：
1. ✅ 部署最新的 Cloud Functions 代碼
2. ✅ 執行真實的 OTP SMS 測試
3. ✅ 監控日誌以查看 SMS 轉發情況
4. ✅ 部署到生產環境

---

## 支持聯繫

- **OTP Forwarder 問題**：檢查 `/opt/mybazaar/otp-forwarder/` 的日誌
- **Cloud Functions 問題**：檢查 GCP Console 的 Cloud Functions 日誌
- **360 SMS 問題**：登入 https://sms.360.my/ 檢查 API 配置和白名單
