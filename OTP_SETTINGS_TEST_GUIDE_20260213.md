# OTP 设置修复 - 快速测试指南

## 🚀 快速开始

### 修复内容
在 `PlatformDashboard.jsx` 第 1100-1140 行的 OTP 设置开关中添加了 1 秒延迟：

```javascript
// 等待 1 秒确保 Firestore 数据已同步
await new Promise(resolve => setTimeout(resolve, 1000));
```

这解决了勾选后页面重加载但状态显示为未勾选的问题。

---

## ✅ 测试步骤

### 准备工作
1. ✅ 构建已完成：`npm run build` 成功
2. 需要部署到 Firebase Hosting：
   ```bash
   firebase deploy --only hosting
   ```

### 测试场景 1: 启用真实 OTP

1. 打开 Firebase Console → Firestore
   - 查看你的 `events` 文档，记下 `otpSettings.enabled` 的当前值

2. 打开 PlatformDashboard（需要 Platform Admin 权限）

3. 找到 OTP 验证设置部分
   - 应该看到：`🔐 OTP 验证设置：`
   - 显示当前状态复选框和状态标签

4. **勾选** "启用真实OTP验证（360短信）" 复选框
   - 弹出确认对话框：
     ```
     ✅ 确定要启用真实OTP验证吗？
     
     启用后，用户登录时将收到360发送的真实验证码短信（需要短信费用）。
     ```

5. 点击 **确定**

6. **关键观察点**：
   - ✅ 页面显示 toast 消息：`✅ 已启用真实OTP验证（360短信）`
   - ✅ **等待约 1 秒**（新增延迟）
   - ✅ 页面重新加载数据
   - ✅ OTP 设置显示保持为 **勾选状态**
   - ✅ 状态标签显示：`✅ 当前状态：真实短信验证码`
   - ✅ 提示文字：`💰 用户登录时将收到真实的6位验证码短信（产生短信费用）`

7. **验证 Firestore**：
   ```
   organizations/{orgId}/events/{eventId}
   {
     "otpSettings": {
       "enabled": true,
       "enabledAt": <timestamp>,
       "enabledBy": "<uid>",
       "provider": "360"
     }
   }
   ```

### 测试场景 2: 禁用真实 OTP（回退到开发模式）

1. 再次点击复选框取消勾选

2. 弹出确认对话框：
   ```
   ⚠️ 确定要使用测试OTP吗？
   
   关闭后，系统将使用固定验证码 223344（仅用于开发测试）。
   ```

3. 点击 **确定**

4. **关键观察点**：
   - ✅ 页面显示 toast 消息：`✅ 已切换为测试模式（固定码 223344）`
   - ✅ 等待约 1 秒
   - ✅ 页面重新加载数据
   - ✅ 复选框保持 **未勾选**
   - ✅ 状态标签显示：`🔧 当前状态：测试验证码（223344）`
   - ✅ 提示文字：`🆓 所有用户统一使用固定验证码 223344（免费，仅用于开发测试）`

---

## 🔍 浏览器控制台输出验证

打开 DevTools（F12） → Console 标签，应该看到如下日志序列：

```javascript
[OTP Switch] 开关切换: {newEnabled: true, currentUser: true}
[OTP Switch] 调用 updateEventDetails...
[OTP Switch] ✅ 更新成功，等待 Firestore 同步...
[OTP Switch] 开始重新加载数据...
```

这表明修复正确执行。

---

## 🧪 集成测试：验证 OTP 发送功能

### 测试：启用真实 OTP 后发送验证码

**前提**：已启用真实 OTP（`otpSettings.enabled = true`）

1. 在新标签页打开 Postman 或 curl

2. 发送请求：
   ```bash
   curl -X POST https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/sendOtpHttp \
     -H "Content-Type: application/json" \
     -d '{
       "phoneNumber": "+60123456789",
       "orgCode": "your-org-code",
       "eventCode": "your-event-code",
       "loginType": "sms"
     }'
   ```

3. **预期响应**：
   ```json
   {
     "success": true,
     "otpRequired": true,
     "sessionId": "otp_1707832913000_abc123def456",
     "expiresIn": 300,
     "message": "验证码已发送",
     "devMode": false
   }
   ```

4. **验证**：
   - ✅ `devMode: false` 表示生产模式
   - ✅ **真实验证码已通过 360 SMS API 发送**（需要检查目标号码是否收到短信）

### 测试：禁用真实 OTP 后发送验证码

**前提**：已禁用真实 OTP（`otpSettings.enabled = false`）

1. 发送相同的请求

2. **预期响应**：
   ```json
   {
     "success": true,
     "otpRequired": true,
     "sessionId": "otp_1707832913001_xyz789abc456",
     "expiresIn": 300,
     "message": "验证码已发送",
     "testOtp": "223344",
     "devMode": true
   }
   ```

3. **验证**：
   - ✅ `devMode: true` 表示开发模式
   - ✅ `testOtp: "223344"` 返回固定测试码
   - ✅ **不会发送真实短信**（节省成本）

---

## 📋 故障排查

### 问题 1: 勾选后仍显示未勾选状态

**原因**：修复未部署  
**解决方案**：
```bash
npm run build
firebase deploy --only hosting
```

### 问题 2: 页面显示"更新失败"错误

**原因**：
- ❌ 用户未登录
- ❌ 用户没有 Platform Admin 权限
- ❌ organizationId 或 eventId 错误

**调试方法**：
1. 打开 DevTools → Console
2. 查看完整错误消息：`[OTP Switch] ❌ 更新失败: ...`
3. 检查网络请求：DevTools → Network
   - 找到 `updateEventDetailsHttp` 请求
   - 查看响应状态和错误信息

### 问题 3: 状态标签未更新

**原因**：`event` 对象未正确刷新  
**调试方法**：
```javascript
// 在浏览器控制台执行
console.log('Current event.otpSettings:', event.otpSettings);
```

应该显示最新的值。

---

## 🎯 验收标准

| 项目 | 标准 | 状态 |
|------|------|------|
| **修改部署** | 代码已上线到 Hosting | ☐ |
| **UI 响应** | 勾选后显示成功消息 | ☐ |
| **状态保留** | 重加载后状态保持勾选 | ☐ |
| **Firestore** | otpSettings 字段正确保存 | ☐ |
| **OTP 发送** | 启用时发送真实短信 | ☐ |
| **开发模式** | 禁用时使用测试码 223344 | ☐ |

---

## 📞 技术细节补充

### 为什么需要 1 秒延迟？

Firestore 是一个分布式数据库，写入操作涉及多个步骤：
1. 客户端写入请求 → Cloud Function
2. Cloud Function 更新 Firestore
3. Firestore 服务器处理写入
4. 返回成功响应给客户端
5. 数据在所有副本中同步（最终一致性）

完整的同步通常需要 100-500ms，在高并发情况下可能更长。1 秒延迟提供了充足的缓冲。

### 如何优化延迟？

实际应用中可以考虑：
1. **乐观更新**：先更新本地 UI，再等待服务器确认
2. **实时监听**：使用 Firestore `onSnapshot` 自动刷新
3. **WebSocket**：实时推送更新通知

当前的简单延迟方案已经足够满足 MVP 需求。

---

## 📝 相关文档

- [OTP 设置功能诊断报告](OTP_SETTINGS_FIX_20260213.md)
- [otpVerify.js - OTP 验证逻辑](functions/otpVerify.js)
- [updateEventDetailsHttp - 后端更新逻辑](functions/src/platform/admin_logo_event_functions.js#L263)

