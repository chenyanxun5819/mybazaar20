User: 1、增加一個使用rfid的id卡的購物頁面，使用者須有merchantOwner或merchantAsists的身份才能使用。
2、rfid并不是所有人都會有。
3、rfid的購物，與customer的點數必須連動，也就是可以從customer銷費記錄中看到是rfid付費的資料。
請先幫我規畫這個功能，譬如頁面顯示哪些資料？數據傳遞到哪裡？驗証有rfid購物頁面的身份驗証？

GitHub Copilot: 我来帮你规划这个 RFID 卡购物功能。首先，让我探索现有的架构，了解 merchant 角色、支付流程和交易系统。 

探索 merchant 和支付系统架构

Searched codebase for "merchant owner assistant authentication permission Firebase token claims", no results

Searched for regex `merchantOwner|merchantAsists|merchantAssists`, 20 results

Searched for regex `confirmMerchantPayment|processCustomerPayment|createPayment`, 20 results

Searched for regex `rfid|RFID|idCard|id卡`, no results

Searched for regex `transactionType|transactions`, 20 results

Searched for regex `merchant.*management|MerchantManagement|merchant.*payment|payment.*confirm` (`**/src/**/*.{jsx,js}`), 20 results

Searched for regex `hasRole|customClaims|claims\.roles` (`**/src/**/*.{jsx,js}`), 9 results

Searched for files matching `**/src/**/merchant*.jsx`, 9 matches

Searched for files matching `**/functions/*admin.js`, 1 match

Read [](file:///c%3A/mybazaar20/src/views/customer/CustomerTransactions.jsx#110-110), lines 110 to 200

Read [](file:///c%3A/mybazaar20/src/views/merchant/MerchantDashboard.jsx#1-1), lines 1 to 100

Read [](file:///c%3A/mybazaar20/functions/src/merchant/confirmMerchantPayment.js#1-1), lines 1 to 80

Read [](file:///c%3A/mybazaar20/src/contexts/AuthContext.jsx#250-250), lines 250 to 280

Read [](file:///c%3A/mybazaar20/src/contexts/AuthContext.jsx#150-150), lines 150 to 560

Searched for regex `processCustomerPayment|transferPoints` (`**/functions/**/*.js`), 20 results

Searched for regex `confirmMerchantPayment|cancelMerchantPayment` (`**/src/**/*.jsx`), 2 results

Read [](file:///c%3A/mybazaar20/src/views/merchantManager/MerchantManagerDashboard.jsx#1-1), lines 1 to 50

Searched for regex `transactionType|transaction.*type|customer_to_merchant|customer_transfer|point_card` (`**/firestore最新架构*.json`), 20 results

Read [](file:///c%3A/mybazaar20/src/components/merchant/MerchantTransactions.jsx#100-100), lines 100 to 540

Read [](file:///c%3A/mybazaar20/functions/src/customer/customerFunctions.js#80-80), lines 80 to 600

Searched for regex `hasRole\(.*merchant|isMerchantOwner|isMerchantAsist` (`**/src/**/*.jsx`), 13 results

Read memory

Created memory file [](file:///c%3A/Users/wes%20chen/AppData/Roaming/Code/User/workspaceStorage/5ae615afede2bcec97951d395dc13160/GitHub.copilot-chat/memory-tool/memories/ZWNjN2UzNDktNmZkZi00MWU3LTgyOGItZDA4NmUwYzM2NDA0/mybazaar_analysis.md)

Read [](file:///c%3A/Users/wes%20chen/AppData/Roaming/Code/User/workspaceStorage/5ae615afede2bcec97951d395dc13160/GitHub.copilot-chat/chat-session-resources/ecc7e349-6fdf-41e7-828b-d086e0c36404/toolu_bdrk_01Lo1VnWk2TFdt5NNtYhTUzQ__vscode-1779024252437/content.txt)

Created memory file [](file:///c%3A/Users/wes%20chen/AppData/Roaming/Code/User/workspaceStorage/5ae615afede2bcec97951d395dc13160/GitHub.copilot-chat/memory-tool/memories/ZWNjN2UzNDktNmZkZi00MWU3LTgyOGItZDA4NmUwYzM2NDA0/plan.md)

基于现有架构的深度分析，我为你规划了完整的 **RFID 卡购物功能**。这里是核心规划：

---

## 📋 **Plan: RFID 卡购物收款系统**

### **TL;DR**
为 Merchant（摊位）添加 RFID ID 卡结账功能。用户必须是 merchantOwner 或 merchantAsist。Merchant 扫描客户的 RFID 卡后，系统**立即从该客户点数中扣款**，并在客户的消费记录中显示该交易。

---

### **核心流程**

```
Merchant 打开 RFID 收款页
    ↓
扫描/输入客户 RFID ID
    ↓
显示持卡人信息 + 当前余额
    ↓
Merchant 输入购物金额
    ↓
点击"确认支付"
    ↓
后端立即扣款 + 增加商家收入
    ↓
创建交易记录 (类型: rfid_card_payment)
    ↓
成功提示，Customer 消费记录显示该笔交易
```

---

### **分阶段实现方案**

#### **阶段 1：Firestore 数据架构**（后端）

| 新增内容 | 说明 | 关键字段 |
|---------|------|--------|
| **rfidDevices** 集合 | RFID 扫描器设备管理 | `deviceId`, `deviceName`, `status`, `apiKey` |
| **customerRfidCards** 集合 | 客户 RFID 卡与 ID 映射 | `rfidId`, `customerId`, `cardNumber`, `cardHolderName`, `status` |
| **transactions** 扩充 | 新增交易类型 | `transactionType: 'rfid_card_payment'`, `rfidId`, `deviceId` |

**数据流向**：
```
RFID 卡 (rfidId) 
    ↓
customerRfidCards 表 (查询 customerId)
    ↓
users 集合 (获取客户点数余额)
    ↓
创建 transaction 记录
```

---

#### **阶段 2：后端 Cloud Functions**（后端）

**新增 2 个函数**:

| 函数 | 触发方式 | 参数 | 主要动作 |
|------|---------|------|--------|
| **processRfidPayment** | HTTP Callable | `rfidId, amount, merchantId` | ✅ 验证身份 → 查询客户 → 扣款 → 增加收入 → 创建交易 |
| **queryCustomerByRfid** | HTTP Callable | `rfidId` | 返回客户名字、卡号、当前余额 (用于前端预加载) |

**权限**: 仅限 `merchantOwner` 或 `merchantAsist` 调用

**验证步骤**:
1. ✅ 用户身份验证（Custom Claims）
2. ✅ RFID 卡存在且状态为 'active'
3. ✅ 客户点数余额 ≥ 购物金额
4. ✅ Firestore Transaction 原子性扣款

**返回字段**:
```javascript
{
  success: true,
  transactionId: "xxx",
  customerId: "xxx",
  cardholderName: "张三",
  previousBalance: 500,    // 扣款前
  newBalance: 400,         // 扣款后
  amount: 100,
  message: "交易成功"
}
```

---

#### **阶段 3：前端页面 - RFID 购物页** (新增)

**路由**: `/merchant/{orgEventCode}/rfid-payment`

**页面结构**:
```
┌──────────────────────────────────────────┐
│    RFID 卡购物收款                         │
├──────────────────────────────────────────┤
│                                            │
│  [扫描 RFID 卡] 或 [手动输入]              │
│                                            │
│  ┌─ 卡信息卡片 ─────────────────────────┐│
│  │ 👤 持卡人: 张三                      ││
│  │ 🎫 卡号: ****1234                   ││
│  │ 💰 当前余额: 500 点                 ││
│  └────────────────────────────────────┘│
│                                            │
│  [金额输入] 100                           │
│  💬 扣款后余额: 400 点                    │
│                                            │
│  [确认支付] [取消]                        │
│                                            │
│  ┌─ 最近交易 ────────────────────────────┐│
│  │ 14:30 | 王五 | -100点 ✅              ││
│  │ 14:25 | 李四 | -50点 ✅               ││
│  │ 14:20 | 赵六 | -200点 ✅              ││
│  └────────────────────────────────────┘│
│                                            │
└──────────────────────────────────────────┘
```

**功能模块**:
- 📱 **RFID 输入方式**: Web NFC API (Android) / 手动输入卡号
- 💳 **卡信息卡片**: 扫描后显示持卡人、卡号末位、当前余额
- 🔢 **金额输入**: 数字键盘 + 实时显示扣款后余额
- ✅ **支付确认**: 调用 `processRfidPayment()` → 加载动画 → 成功/失败提示
- 📋 **最近交易**: 显示该 merchant 最近 10 笔 RFID 交易

---

#### **阶段 4：前端页面 - Customer 消费记录集成**

**修改**: CustomerTransactions.jsx

**新增功能**:
1. **筛选选项** 新增: "RFID卡购物" (在现有 全部/付款/转出/转入/充值 基础上)
2. **查询** 新增: `transactionType == 'rfid_card_payment'`
3. **显示卡片**:
   ```
   🎫 RFID卡购物 | 去王海鲜摊 消费 | -100点
   持卡人卡号: ****1234
   ```
4. **交易详情弹窗** 新增:
   - 持卡人卡号
   - 商家名字
   - 收款人（merchantOwner/merchantAsist）
   - 设备信息（若有）

---

#### **阶段 5：身份验证与权限**

| 检查点 | 实现位置 | 逻辑 |
|-------|---------|------|
| **前端路由** | `AuthContext.jsx` | 检查 `hasRole('merchantOwner') \|\| hasRole('merchantAsist')` |
| **后端权限** | `processRfidPayment` Cloud Function | 验证 Custom Claims + 检查 merchantId 所有权 |
| **Firestore Rules** | firestore.rules | 限制 rfidDevices / customerRfidCards 的读写权限 |

---

### **Firestore 数据结构**

#### **新增 1：rfidDevices 集合**
```
organizations/{orgId}/events/{eventId}/rfidDevices/{deviceId}
{
  deviceId: "string",          // RFID 扫描器 ID
  deviceName: "string",        // 如 "摊位A收银机"
  deviceType: "string",        // 'fixed' 固定 | 'mobile' 移动
  merchantId: "string",        // 可选，限制设备使用范围
  status: "string",            // 'active' | 'inactive'
  apiKey: "string",            // 设备认证密钥
  lastUsedAt: "timestamp",
  createdAt: "timestamp",
  createdBy: "string"
}
```

#### **新增 2：customerRfidCards 集合**
```
organizations/{orgId}/events/{eventId}/customerRfidCards/{rfidId}
{
  rfidId: "string",            // 文档 ID，同时是卡的唯一标识
  customerId: "string",        // 关联的 Customer UID
  cardNumber: "string",        // 卡号末位，如 "****1234"
  cardHolderName: "string",    // 持卡人名字
  status: "string",            // 'active' | 'inactive' | 'blocked'
  issuedAt: "timestamp",
  issuedBy: "string",
  blockedAt: "timestamp",      // 禁用时间
  blockedBy: "string",
  blockReason: "string"
}
```

#### **修改：transactions 集合**
```javascript
{
  transactionType: "rfid_card_payment",  // 新增类型
  
  // RFID 特有字段
  rfidId: "string",            // RFID 卡 ID
  cardNumber: "string",        // 卡号末位
  deviceId: "string",          // 扫描设备 ID（审计用）
  
  // 标准字段（继承现有）
  customerId: "string",
  merchantId: "string",
  merchantName: "string",
  amount: "number",
  timestamp: "timestamp",
  status: "string",            // 'completed' | 'failed' | 'cancelled'
  
  // 收款人信息
  collectedBy: "string",       // 收款商家 UID
  collectorRole: "string",     // 'merchantOwner' | 'merchantAsist'
  notes: "string"
}
```

---

### **验证清单**

**前端**：
- ✅ 路由守卫工作正常
- ✅ RFID 输入方式支持（NFC / 手动）
- ✅ 页面实时计算余额
- ✅ 成功/失败提示
- ✅ Customer 消费记录显示 RFID 交易

**后端**：
- ✅ Cloud Function 权限验证
- ✅ Transaction 原子性扣款
- ✅ 各类错误处理（卡不存在、余额不足、卡被禁用）

**Firestore**：
- ✅ 集合与索引创建
- ✅ 权限规则配置
- ✅ 数据一致性

---

### **需要你确认的 5 个问题**

1. **RFID 卡创建流程**：由谁创建 RFID 卡与客户的绑定？
   - Option A: Event Manager 后台批量导入
   - Option B: Customer 自行输入卡号（注册时）
   - Option C: 首次使用 RFID 时自动创建

2. **设备管理**：是否需要限制每个商家只能用特定的 RFID 设备？
   - 是 → 需要在 `processRfidPayment` 中检查 device 所有权
   - 否 → 任何商家都可以用任何设备

3. **前端优先语言**：支持哪种语言？
   - 中文、英文、还是多语言？

4. **支付失败后重试**：失败的交易是否允许重试？
   - 是 → 需要幂等性设计
   - 否 → 只能刷新页面重新开始

5. **失败/取消记录显示**：Customer 的消费记录中是否显示失败或取消的 RFID 交易？
   - 显示全部（含失败）
   - 仅显示成功的

请逐个确认这些问题，我会据此细化实现方案。