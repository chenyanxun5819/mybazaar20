# merchantId 缺失错误修复 (2025-01-21)

## 问题诊断

用户错误：`[processPointCardPayment] 错误: HttpsError: 用户未关联到商家`
- 位置：`functions/src/pointCards/processPointCardPayment.js:102`
- 原因：`merchantOwner?.merchantId` 或 `merchantAsist?.merchantId` 为 null/undefined

## 根本原因

Firestore 数据结构在以下文件中使用了旧的 `assignedMerchants` 数组字段，而不是新的 `merchantId` 单一字段：

1. **`functions/src/merchant/createMerchantHttp.js`** (关键)
   - 第 254 行：创建新商家时，仍在用 `arrayUnion` 更新旧的 `assignedMerchants` 字段
   - 导致新建商家时，助理用户的 `merchantAsist.merchantId` 为空

2. **`functions/src/merchant/updateMerchantHttp.js`**
   - 第 304, 316 行：编辑商家时，仍在用 `arrayUnion/arrayRemove` 操作旧字段

## 修复内容

### 1. `functions/src/pointCards/processPointCardPayment.js`

**改进1：添加详细的错误日志**
```javascript
// 第 90-118 行
if (!callerMerchantId) {
  console.error('[processPointCardPayment] merchantId 缺失:', {
    uid: auth.uid,
    roles: callerRoles,
    merchantOwner: callerData.merchantOwner,
    merchantAsist: callerData.merchantAsist,
    callerData: callerData
  });
  throw new HttpsError('failed-precondition', 
    '用户未关联到商家 - 请联系管理员重新分配商家');
}
```

**改进2：完整的收款人统计更新**
```javascript
// 第 249-273 行
// 支持 merchantOwner 的统计更新
if (collectorRole === 'merchantOwner') {
  // 更新摊主的统计数据
  const newOwnerTotal = (callerData.merchantOwner?.statistics?.totalCollected || 0) + amount;
  const newOwnerCount = (callerData.merchantOwner?.statistics?.transactionCount || 0) + 1;
  // ... 更新逻辑
}
```

### 2. `functions/src/merchant/createMerchantHttp.js`

**修复点：创建商家时正确赋值 merchantId**
```javascript
// 第 248-262 行（之前）：
transaction.update(asistRef, {
  'merchantAsist.assignedMerchants': admin.firestore.FieldValue.arrayUnion(merchantId),
  'updatedAt': now
});

// 修改后：
transaction.update(asistRef, {
  'merchantAsist.merchantId': merchantId,
  'merchantAsist.stallName': stallName,
  'merchantAsist.assignedAt': now,
  'merchantAsist.assignedBy': callerId,
  'updatedAt': now
});
```

**更新注释**：第 7 行从 "更新 users.merchantAsist.assignedMerchants" 改为 "更新 users.merchantAsist.merchantId（新的单一字段）"

### 3. `functions/src/merchant/updateMerchantHttp.js`

**修复点：编辑商家时正确管理 merchantId**
```javascript
// 第 298-318 行（修复前后对比）
// 添加助理时：
transaction.update(asistRef, {
  'merchantAsist.merchantId': merchantId,
  'merchantAsist.stallName': updateData.stallName || currentData.stallName,
  'updatedAt': now
});

// 移除助理时：
transaction.update(asistRef, {
  'merchantAsist.merchantId': admin.firestore.FieldValue.delete(),
  'merchantAsist.stallName': admin.firestore.FieldValue.delete(),
  'updatedAt': now
});
```

### 4. `functions/src/merchant/confirmMerchantPayment.js`

**改进：添加详细的错误日志**
```javascript
// 第 103-127 行
// 与 processPointCardPayment.js 相同的改进
// 添加 console.log 记录用户的实际数据结构
// 改进错误信息
```

### 5. 前端UI更新

**`src/views/merchantManager/components/CreateMerchantModal.jsx`** (第 225-228 行)
```jsx
// 修改前：显示 ({count} 个摊位)
{asist.merchantAsist?.assignedMerchants?.length > 0 && (
  <span>(数量)</span>
)}

// 修改后：显示 (已关联商家)
{asist.merchantAsist?.merchantId && (
  <span>(已关联商家)</span>
)}
```

**`src/views/merchantManager/components/EditMerchantModal.jsx`** (第 305-308 行)
- 同上修改

## 影响范围

### 直接影响
- ✅ `processPointCardPayment.js` - 点数卡付款功能
- ✅ `confirmMerchantPayment.js` - 确认付款功能
- ✅ 所有新创建的商家及其关联的助理用户
- ✅ 编辑商家时添加或移除助理

### 需要手动恢复的数据
对于在修复前创建的商家和关联的助理，需要执行以下操作：

1. **查询受影响的用户**
```firestore
users where merchantAsist.assignedMerchants 存在 AND merchantAsist.merchantId 不存在
```

2. **修复脚本**（需要在 Firebase 控制台运行）
```javascript
// 对每个受影响的用户文档：
// 如果 merchantAsist.assignedMerchants 数组有值
// 将 assignedMerchants[0] 复制到 merchantAsist.merchantId
```

## 测试建议

1. **创建新商家**
   - 选择新的 merchantOwner 和 merchantAsists
   - 验证 Firestore 中用户文档的 `merchantOwner.merchantId` 和 `merchantAsist.merchantId` 已正确赋值

2. **点数卡付款流程**
   - 使用 merchantOwner 收款
   - 使用 merchantAsist 收款
   - 验证统计数据正确更新
   - 查看控制台日志中的详细信息

3. **数据恢复**
   - 对已存在但缺少 `merchantId` 的用户运行恢复脚本
   - 重新测试支付流程

## 部署说明

```bash
# 构建前端
npm run build

# 部署所有更新
firebase deploy --only "functions,hosting"

# 或分别部署
firebase deploy --only functions
firebase deploy --only hosting
```

## 错误日志改进

从此版本开始，当遇到 "用户未关联到商家" 错误时，函数日志将输出：
- 用户 UID
- 用户的角色列表
- 完整的 `merchantOwner` 对象
- 完整的 `merchantAsist` 对象
- 完整的用户数据

这有助于快速诊断问题根源。
