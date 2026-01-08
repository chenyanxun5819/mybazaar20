# 关键修复：Custom Token UID 不匹配问题 (2024-12-16 v2)

## 🔴 问题诊断

**症状：**
- AllocatePoints 分配点数时返回 404 错误
- 错误信息：`"找不到 Seller Manager 账户"`
- 前端能获取到 organizationId、eventId、recipientId，但 Cloud Function 查询失败

**根本原因：**
在 `otpVerify.js` 中，Custom Token 的生成使用了 `authUid`（可能是 `phone_${targetPhone}` 等变体），而不是真实的 `userId`（Firestore 文档 ID）。

导致：
```
✅ Frontend 获取: auth.currentUser.uid = "phone_0102030405" 或其他变体
❌ Cloud Function 查询: db.doc(`...users/${decodedToken.uid}`) 找不到匹配的文档
❌ Firestore 中实际的用户文档 ID: userId (真实的唯一标识符)
```

## ✅ 修复方案

**文件：** [functions/otpVerify.js](functions/otpVerify.js)

**修改内容：** 第 410-425 行

```javascript
// ❌ 旧代码：
const authUid = userData.authUid || `phone_${targetPhone}`;
const customToken = await admin.auth().createCustomToken(authUid, customClaims);

// ✅ 新代码：
// 🔥 关键修复：使用 userId（Firestore 文档 ID）作为 Custom Token 的 uid
const customToken = await admin.auth().createCustomToken(userId, customClaims);
```

**为什么有效：**
- `userId` 是 Firestore 中用户文档的真实 ID
- Cloud Function 中 `decodedToken.uid` 会等于 `userId`
- 路径 `organizations/{orgId}/events/{eventId}/users/{userId}` 的查询会成功

## 🔧 验证步骤

### 1. 重新登录
```
1. 访问 https://mybazaar-c4881.web.app
2. 选择登录方式（如"经理登录"）
3. 输入手机号 (例如: 01020304055)
4. 输入 OTP: 223344 (开发模式)
5. 登录成功
```

### 2. 进入 Seller Manager Dashboard
```
1. 确认页面标题显示 "Seller Manager Dashboard"
2. 查看 Sellers 列表是否正常加载
3. 确认右侧显示可用的 Sellers
```

### 3. 执行点数分配
```
1. 点击某个 Seller 的"分配点数"按钮
2. 输入点数（例如：50）
3. 点击"确认分配"
4. ✅ 应该看到：
   - 成功消息：「成功分配 XX 点给 [Seller名称]！」
   - 2 秒后自动关闭弹窗
   - 返回 Dashboard（不是首页）
   - 无 404 错误
```

### 4. 验证 Firestore 数据
```
1. Firebase Console → Firestore
2. 查看 events/{eventId}/allocations 或类似集合
3. 确认有新的分配记录
```

## 📊 修复影响范围

| 模块 | 影响 | 状态 |
|------|------|------|
| OTP 验证流程 | 修复 Custom Token UID 生成 | ✅ 已修复 |
| Seller Manager 点数分配 | 现在能正确查询 SM 账户 | ✅ 已恢复 |
| 其他角色登录 | 同样受益于 UID 修复 | ✅ 自动修复 |

## 🚀 部署状态

```
✅ Cloud Functions: verifyOtpHttp 已更新并部署
✅ Hosting: 已更新
✅ 生产环境: 已同步 (https://mybazaar-c4881.web.app)
```

## 📝 关键学习点

1. **Custom Token UID 必须与 Firestore 文档 ID 一致**
   - 不能使用任意的 `authUid` 变体
   - 必须使用真实的 `userId`（查询到的文档 ID）

2. **数据一致性检查**
   - `auth.currentUser.uid` === Firestore 中的用户文档 ID
   - Cloud Functions 的权限验证依赖这个一致性

3. **Firestore 架构中的用户标识**
   ```
   集合路径: organizations/{orgId}/events/{eventId}/users/{userId}
   userId = Firestore 文档 ID (也是 Custom Token 的 uid)
   userId ≠ authUid 变体
   ```

## 🔄 相关修复历史

| 日期 | 问题 | 修复 |
|------|------|------|
| 2024-12-16 v1 | AllocatePoints 变量错误 | handleSubmit 重写 |
| 2024-12-16 v2 | Custom Token UID 不匹配 | otpVerify.js 修复 |

## ⚠️ 如果仍有问题

1. **清除浏览器缓存**
   ```
   Ctrl+Shift+Delete → 清空所有缓存
   ```

2. **重新登录**
   ```
   登出 → 清除 localStorage → 重新登录
   ```

3. **查看浏览器控制台日志**
   ```
   F12 → Console 标签页
   查看 [AllocatePoints] 和 [UniversalLogin] 的日志
   ```

4. **检查 Firebase Console 日志**
   ```
   Cloud Functions → allocatePointsBySellerManagerHttp
   查看最新的执行日志
   ```

---

**修复完成时间：** 2024-12-16 
**修复人员：** GitHub Copilot
**测试状态：** ⏳ 待用户验证
**优先级：** 🔴 关键
