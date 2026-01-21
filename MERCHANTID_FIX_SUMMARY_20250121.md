# [processPointCardPayment] 错误修复总结

## 错误信息

```
[processPointCardPayment] 错误: HttpsError: 用户未关联到商家
    at /workspace/src/pointCards/processPointCardPayment.js:102:13
{
  code: 'failed-precondition',
  details: undefined,
  httpErrorCode: { canonicalName: 'FAILED_PRECONDITION', status: 400 }
}
```

## 问题分析

### 根本原因
在 Firestore 数据模型中，用户的 `merchantOwner` 和 `merchantAsist` 字段应该包含 `merchantId` 单一字段来标识关联的商家。但是以下Cloud Functions 仍在使用旧的 `assignedMerchants` 数组字段，导致新创建的商家助理用户无法正确设置 `merchantId`：

1. ❌ **`functions/src/merchant/createMerchantHttp.js`** - 创建商家时
2. ❌ **`functions/src/merchant/updateMerchantHttp.js`** - 编辑商家时

### 连锁影响
- ✅ 当用户调用 `processPointCardPayment` 时
- 🔍 系统尝试读取 `callerData.merchantAsist?.merchantId` 或 `callerData.merchantOwner?.merchantId`
- ⚠️ 由于数据初始化不完整，这些字段为 null/undefined
- ❌ 触发错误："用户未关联到商家"

## 修复方案

### 第一阶段：修复 Cloud Functions（已实施）

#### 1️⃣ `functions/src/merchant/createMerchantHttp.js` (第 248-262 行)

**修改前：**
```javascript
transaction.update(asistRef, {
  'merchantAsist.assignedMerchants': admin.firestore.FieldValue.arrayUnion(merchantId),
  'updatedAt': now
});
```

**修改后：**
```javascript
transaction.update(asistRef, {
  'merchantAsist.merchantId': merchantId,           // ⭐ 新增：单一 merchantId
  'merchantAsist.stallName': stallName,              // ⭐ 新增：冗余摊位名
  'merchantAsist.assignedAt': now,                   // ⭐ 新增：分配时间
  'merchantAsist.assignedBy': callerId,              // ⭐ 新增：分配人
  'updatedAt': now
});
```

#### 2️⃣ `functions/src/merchant/updateMerchantHttp.js` (第 298-318 行)

**添加助理时：**
```javascript
transaction.update(asistRef, {
  'merchantAsist.merchantId': merchantId,
  'merchantAsist.stallName': updateData.stallName || currentData.stallName,
  'updatedAt': now
});
```

**移除助理时：**
```javascript
transaction.update(asistRef, {
  'merchantAsist.merchantId': admin.firestore.FieldValue.delete(),
  'merchantAsist.stallName': admin.firestore.FieldValue.delete(),
  'updatedAt': now
});
```

#### 3️⃣ `functions/src/pointCards/processPointCardPayment.js` (第 90-118 行)

**改进错误诊断：**
```javascript
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

**添加 merchantOwner 统计支持：**
```javascript
// 原本只有 merchantAsist 的统计更新
// 现在同时支持 merchantOwner 的统计更新
if (collectorRole === 'merchantOwner') {
  const newOwnerTotal = (callerData.merchantOwner?.statistics?.totalCollected || 0) + amount;
  const newOwnerCount = (callerData.merchantOwner?.statistics?.transactionCount || 0) + 1;
  
  transaction.update(callerRef, {
    'merchantOwner.statistics.totalCollected': newOwnerTotal,
    'merchantOwner.statistics.transactionCount': newOwnerCount,
    'activityData.updatedAt': admin.firestore.FieldValue.serverTimestamp()
  });
}
```

#### 4️⃣ `functions/src/merchant/confirmMerchantPayment.js` (第 103-127 行)

与 `processPointCardPayment.js` 相同的错误诊断改进

### 第二阶段：前端 UI 更新（已实施）

#### `src/views/merchantManager/components/CreateMerchantModal.jsx`
```jsx
// 修改前
{asist.merchantAsist?.assignedMerchants?.length > 0 && (
  <span>({asist.merchantAsist.assignedMerchants.length} 个摊位)</span>
)}

// 修改后
{asist.merchantAsist?.merchantId && (
  <span>(已关联商家)</span>
)}
```

#### `src/views/merchantManager/components/EditMerchantModal.jsx`
同上

### 第三阶段：历史数据修复（需要手动执行）

创建了数据迁移脚本：[fixMerchantIdMigration.js](functions/src/merchant/fixMerchantIdMigration.js)

**用途：** 修复在修复部署前创建的商家对应的助理用户

**使用方法：**
```bash
# 修复单个组织/事件下的所有用户
node functions/src/merchant/fixMerchantIdMigration.js orgId eventId fix

# 验证修复结果
node functions/src/merchant/fixMerchantIdMigration.js orgId eventId validate merchantId
```

## 部署状态

✅ **前端编译** - 成功  
✅ **Hosting 部署** - 成功  
⏳ **Functions 部署** - 进行中...

## 预期效果

部署完成后：

1. ✅ **新创建的商家** - 其助理用户将自动获得正确的 `merchantId`
2. ✅ **点数卡收款** - merchantOwner 和 merchantAsist 都能正确收款
3. ✅ **统计数据** - 收款人的统计数据将正确更新
4. ✅ **错误日志** - 遇到 merchantId 缺失时，日志将包含完整的诊断信息

## 需要执行的后续步骤

1. **确认部署完成**
   - 检查 Firebase Console 中的 Functions 部署状态

2. **测试新流程**
   - 创建新的测试商家
   - 分配测试助理
   - 执行点数卡支付测试

3. **修复历史数据**
   - 使用迁移脚本修复修复前创建的商家的助理用户
   - 验证修复结果

4. **验证统计数据**
   - 检查收款人的统计字段是否正确更新

## 相关文件变更

| 文件 | 行号 | 变更 | 影响 |
|------|------|------|------|
| functions/src/pointCards/processPointCardPayment.js | 90-118 | 添加错误诊断日志 | 提高故障排查效率 |
| functions/src/pointCards/processPointCardPayment.js | 249-273 | 添加 merchantOwner 统计支持 | 支持摊主收款统计 |
| functions/src/merchant/createMerchantHttp.js | 248-262 | 修复 merchantId 赋值 | **关键修复** |
| functions/src/merchant/updateMerchantHttp.js | 298-318 | 修复 merchantId 管理 | **关键修复** |
| functions/src/merchant/confirmMerchantPayment.js | 103-127 | 添加错误诊断日志 | 提高故障排查效率 |
| src/views/merchantManager/components/CreateMerchantModal.jsx | 225-228 | 更新 UI 显示逻辑 | 避免混淆 |
| src/views/merchantManager/components/EditMerchantModal.jsx | 305-308 | 更新 UI 显示逻辑 | 避免混淆 |
| functions/src/merchant/fixMerchantIdMigration.js | NEW | 数据迁移脚本 | 修复历史数据 |

## 总结

这是一个**数据结构不一致**导致的错误。通过统一使用新的 `merchantId` 单一字段设计，而不是旧的 `assignedMerchants` 数组，确保：

- ✅ 所有新创建的商家数据正确初始化
- ✅ 收款流程能正确识别用户的商家关联
- ✅ 统计数据能准确更新
- ✅ 错误信息更详细，便于诊断
