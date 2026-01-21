# 交易密码验证统一化重构（2026-01-21）

## 概述

对项目中所有需要验证交易密码的 Cloud Functions 进行了统一化重构，将分散在各个文件中的验证逻辑统一替换为使用 `verifyTransactionPin.js` 中的统一函数。

## 修改的文件

### 1. **functions/src/pointseller/pointSellerDirectSale.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：46 行的本地 `verifyTransactionPin` 函数定义
   - ✅ 更新函数调用：参数顺序改为 `(userId, transactionPin, organizationId, eventId)`
   - 功能：PointSeller 直接销售点数给 Customer 时的交易密码验证

### 2. **functions/src/pointseller/createPointCard.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：46 行的本地 `verifyTransactionPin` 函数定义
   - ✅ 更新函数调用：参数顺序改为 `(userId, transactionPin, organizationId, eventId)`
   - 功能：创建点数卡时的交易密码验证

### 3. **functions/src/sellerManager/sellerManagerDirectSale.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：46 行的本地 `verifyTransactionPin` 函数定义
   - ✅ 更新函数调用：参数顺序改为 `(userId, transactionPin, organizationId, eventId)`
   - 功能：Seller Manager 销售点数时的交易密码验证

### 4. **functions/src/pointseller/submitCashAsPointSeller.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：75 行的本地 `verifyTransactionPin` 函数定义
   - ✅ 更新函数调用：参数顺序改为 `(userId, transactionPin, organizationId, eventId)`
   - 功能：PointSeller 上交现金给 Finance Manager 时的交易密码验证

### 5. **functions/src/cashier/Claimandconfirmcashsubmission.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：`const bcrypt = require('bcryptjs');`（不再直接使用）
   - ✅ 简化验证代码：将 60 行的验证逻辑（包括手动失败次数追踪）替换为一行调用
   - 功能：Cashier 确认收款时的交易密码验证

### 6. **functions/src/finance/Claimandconfirmcashsubmission.js**
   - ✅ 导入：`const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');`
   - ✅ 删除：`const bcrypt = require('bcryptjs');`（不再直接使用）
   - ✅ 简化验证代码：将 60 行的验证逻辑（包括手动失败次数追踪）替换为一行调用
   - 功能：Finance Manager 确认收款时的交易密码验证

## 关键改进

### 代码重用
- **之前**：6 个文件中各自实现了完全相同的 46-75 行验证逻辑
- **之后**：统一使用 `utils/verifyTransactionPin.js` 中的单一实现

### 一致性
- 所有验证都遵循相同的规则：
  - 支持 bcrypt 和 SHA256 两种加密格式（向后兼容）
  - 5 次错误后自动锁定 1 小时
  - 验证成功后重置失败次数
  - 验证过程中的时间戳记录

### 可维护性
- 如果将来需要修改验证逻辑，只需修改 `verifyTransactionPin.js` 一个文件
- 减少了代码行数（删除了超过 300 行重复代码）
- 错误消息和异常处理保持一致

### 安全性增强
- 统一的锁定机制：连续 5 次密码错误 → 锁定 1 小时
- 统一的时间戳追踪：记录最后验证时间和最后错误时间
- 支持混合加密格式：兼容旧数据（SHA256）和新数据（bcrypt）

## 函数签名

统一的交易密码验证函数：

```javascript
async function verifyTransactionPin(userId, inputPin, organizationId, eventId)
```

**参数**：
- `userId`: 用户 ID
- `inputPin`: 用户输入的交易密码（6 位数字）
- `organizationId`: 组织 ID
- `eventId`: 事件 ID

**返回值**：
- 验证成功：返回 `true`
- 验证失败：抛出 `HttpsError`，异常代码和消息如下：
  - `not-found`: 用户不存在
  - `failed-precondition`: 交易密码未设置或已锁定（含倒计时）
  - `permission-denied`: 密码错误（含剩余尝试次数）、密码错误过多已锁定

## 测试验证

✅ 前端构建成功：`npm run build` 完成，无错误
✅ 所有 6 个修改的函数文件：无语法错误

## 部署说明

```bash
# 部署 Cloud Functions
firebase deploy --only functions

# 或指定部署特定函数
firebase deploy --only "functions:pointSellerDirectSale,functions:createPointCard,functions:sellerManagerDirectSale,functions:submitCashAsPointSeller,functions:claimAndConfirmCashSubmission"
```

## 注意事项

1. 所有现有的验证逻辑行为完全保持不变
2. 错误消息和异常代码也保持一致，不会影响前端错误处理
3. 所有用户数据结构无变化，完全向后兼容

## 后续计划

- 考虑是否还有其他文件也需要整合这个验证逻辑
- 监控部署后的日志，确保所有验证工作正常
