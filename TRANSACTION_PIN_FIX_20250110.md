# 交易密码验证问题修复报告
**修复日期**: 2026年1月10日

## 问题诊断

用户反馈支付失败时显示"functions/permission-denied"错误，但确认没有输入错误的密码。经过代码审计发现了根本原因。

### 核心问题：bcrypt Salt 处理不当

**文件**: `functions/utils/bcryptHelper.js`

在原有代码中：
```javascript
// ❌ 错误做法
const salt = hash.substring(0, 29); // 提取 bcrypt hash 的前29字符
return {
  hash: hash,
  salt: salt  // 返回不完整的值
};
```

这导致：
1. **设置密码时**：存储了一个不完整的"salt"（实际上是 bcrypt hash 的前29字符）
2. **验证密码时**：代码检测到有 `pinSalt`，就认为使用了旧的 SHA256 加密方式
3. **验证失败**：用 SHA256 验证 bcrypt 密码 → 失败 → 返回 "permission-denied"

## 修复方案

### 1. 修复 bcryptHelper.js
```javascript
// ✅ 正确做法
async function hashPassword(plainPassword) {
  const hash = await bcrypt.hash(plainPassword, SALT_ROUNDS);
  return {
    hash: hash,
    salt: ""  // bcrypt 的 salt 已完全包含在 hash 中，返回空字符串表示新格式
  };
}
```

**关键点**：
- `bcrypt` 会自动生成 salt 并编码在 hash 中
- 不需要单独存储 salt
- 返回空字符串作为标记，表示这是新的 bcrypt 格式

### 2. 更新验证逻辑

在 `functions/src/customer/customerFunctions.js` 中修改 `verifyTransactionPinInternal`：

```javascript
// ✅ 修复后
if (pinSalt && pinSalt.length > 0) {
  // 有非空 pinSalt：使用 SHA256（旧格式，向后兼容）
  const inputHash = sha256(transactionPin + pinSalt);
  isPinCorrect = (inputHash === pinHash);
} else {
  // 无 pinSalt（空字符串或 null）：使用 bcrypt（新格式）
  isPinCorrect = await verifyPin(transactionPin, pinHash);
}
```

### 3. 更新存储逻辑

在 `setupTransactionPin.js` 和 `resetTransactionPin.js` 中：

```javascript
const updateData = {
  'basicInfo.transactionPinHash': pinHash,
  'basicInfo.transactionPinSalt': pinSalt || null,  // 空字符串转 null
  // ... 其他字段
};
```

## 修改的文件

1. ✅ `functions/utils/bcryptHelper.js` - 修复 hashPassword 函数
2. ✅ `functions/setupTransactionPin.js` - 更新 salt 存储逻辑
3. ✅ `functions/resetTransactionPin.js` - 更新 salt 存储逻辑
4. ✅ `functions/src/customer/customerFunctions.js` - 修复 verifyTransactionPinInternal 验证逻辑

## 后向兼容性

修复后的代码完全向后兼容：
- **旧数据**（有 pinSalt）：继续使用 SHA256 验证
- **新数据**（pinSalt 为空/null）：使用 bcrypt 验证
- **混合环境**：可以安全地处理两种格式

## 验证步骤

### 对于已有密码的用户（使用旧格式）
1. 部署修复后，他们的密码仍可正常验证（使用 SHA256）

### 对于新用户（使用新格式）
1. 首次设置交易密码时，会使用 bcrypt 加密
2. `transactionPinSalt` 会被设置为 `null`
3. 验证时会正确使用 bcrypt 进行验证

### 迁移现有用户
如果需要将所有用户的密码升级到 bcrypt，可以：
1. 在用户下次设置或重置密码时自动升级
2. 或创建批量迁移脚本

## 部署说明

```bash
# 前端
npm run build
firebase deploy --only hosting

# 后端 Cloud Functions
firebase deploy --only functions
```

## 预期效果

部署后：
- ✅ 交易密码验证将正确工作
- ✅ 支付流程不再出现"permission-denied"错误
- ✅ 密码安全性提升（新用户使用 bcrypt）
- ✅ 完全向后兼容现有用户

## 相关文件位置

- 数据结构定义：[firestore最新架構.json](firestore最新架構.json#L424-L425)
- 前端支付页面：[src/views/customer/CustomerPayment.jsx](src/views/customer/CustomerPayment.jsx)
- 后端支付函数：[functions/src/customer/customerFunctions.js](functions/src/customer/customerFunctions.js)
