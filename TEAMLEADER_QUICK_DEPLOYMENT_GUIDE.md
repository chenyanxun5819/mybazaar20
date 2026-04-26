# TeamLeader 架构重构 - 快速部署指南

**日期**: 2026-04-26  
**版本**: v2026-04-26  
**状态**: ✅ 就绪部署

---

## 🚀 一键部署

```powershell
# 1. 部署 Cloud Functions
cd C:\mybazaar20\functions
firebase deploy --only functions

# 2. 构建并部署前端
cd C:\mybazaar20
npm run build
firebase deploy --only hosting
```

**预期时间**: ~5-10 分钟  
**预期输出**: 
```
✓ functions deployed successfully
✓ hosting deployed successfully
```

---

## ✅ 部署前检查清单

- [ ] 本地代码已提交到 Git
- [ ] 编译测试通过（`npm run build` 成功）
- [ ] Firebase CLI 已安装且已认证
- [ ] 有 Firebase 项目的部署权限
- [ ] 环境变量已配置（如需要）
- [ ] 备份当前生产环境状态

---

## 🔍 部署后验证

### 1. 检查 Cloud Functions
```bash
firebase functions:log
```
确保没有运行时错误，日志应该显示：
- `[INFO] Functions deployed successfully`
- 无 `ERROR` 或 `FATAL` 级别的日志

### 2. 检查前端部署
访问: `https://mybazaar-c4881.web.app`
- [ ] 页面能正常加载
- [ ] 登录功能正常
- [ ] TeamLeader 能进入新的"学生列表"页面

### 3. 功能验证
以 TeamLeader 账户登录，测试以下流程：

#### 流程 1：查看学生列表与应收现金
```
1. 进入 TeamLeader Dashboard
2. 点击"学生列表"标签
3. 应显示所有管理学生 + 应收现金
4. 可搜索、筛选、排序
```

#### 流程 2：确认单笔收款
```
1. 在学生列表找到有待收款的学生
2. 点击"✅ 确认收款"按钮
3. 系统应自动更新：
   - 学生的 confirmedCash 增加
   - pendingCash 减少
   - OverviewStats 中的进度更新
4. UI 显示 ✅ 成功提示
```

#### 流程 3：批量确认收款
```
1. 在 CollectCash 页面
2. 勾选多个学生
3. 点击"✅ 批量确认收款"
4. 系统应批量更新所有选中学生的现金账户
5. UI 显示确认成功
```

#### 流程 4：查看现金统计
```
1. 查看 OverviewStats 组件
2. 应显示：
   ✓ 应收现金总额（RM）
   ✓ 待支付 / 已支付分解
   ✓ 收款进度百分比和进度条
   ✓ EM vs TL 来源分解
   ✓ 学生支付状态统计
   ✓ 我的现金账户详情
```

---

## 🔧 故障排查

### 问题 1: Cloud Functions 部署失败

```
Error: Deployment failed with error details...
```

**解决方案**:
- [ ] 检查 Firebase 认证: `firebase login`
- [ ] 验证 functions/package.json 中的依赖
- [ ] 检查是否有语法错误: `npm run build` (在 functions 目录)
- [ ] 查看详细日志: `firebase deploy --only functions --debug`

### 问题 2: 学生列表不显示数据

**解决方案**:
- [ ] 打开浏览器 DevTools → Console 检查错误
- [ ] 验证 userInfo 中的 organizationId / eventId / userId
- [ ] 检查 Firestore 安全规则是否允许读取
- [ ] 检查管理部门配置是否正确

### 问题 3: 确认收款失败

```
Error: Permission denied or operation failed
```

**解决方案**:
- [ ] 检查网络连接
- [ ] 验证 Firestore 安全规则允许写入
- [ ] 查看 Cloud Functions 日志: `firebase functions:log`
- [ ] 检查是否选中了有效的学生

### 问题 4: OverviewStats 不显示数据

**解决方案**:
- [ ] 确认 useManagedUsers Hook 能正常返回学生列表
- [ ] 检查学生数据中是否存在 cashAccount 字段
- [ ] 查看浏览器 DevTools 的 Network 标签
- [ ] 验证 React 组件是否正常渲染

---

## 📝 重要文件位置

| 文件 | 用途 | 备注 |
|------|------|------|
| `firestore最新架构.json` | Firestore 数据架构 | 已更新至 v23 |
| `functions/admin.js` | Cloud Functions | 已修改 allocatePointsHttp |
| `functions/src/teamLeader/teamLeaderHttpFunctions.js` | TL 函数 | 已修改 allocatePointsByTeamLeaderHttp |
| `src/views/teamLeader/components/OverviewStats.jsx` | 统计页面 | 新版本 |
| `src/views/teamLeader/components/CollectCash.jsx` | 收款管理 | 新版本 |
| `src/views/teamLeader/components/CustomerList.jsx` | 学生列表 | 已创建 |
| `src/views/teamLeader/TeamLeaderDashboard.jsx` | 仪表板 | 已更新 |

---

## 🆘 故障恢复

### 快速回滚

如果部署后发现严重问题，可以快速回滚到上一个版本：

```bash
# 回滚前端
firebase hosting:channel:delete main
# 或重新部署前一个版本的 dist/

# 回滚 Cloud Functions
firebase deploy --only functions --force
# 并手动恢复 functions 目录的代码
```

### 手动修复

如果需要手动修复数据不一致的问题：

1. **打开 Firestore Console**
   - 网址: https://console.firebase.google.com/
   - 项目: mybazaar-c4881
   - Firestore → customers 集合

2. **手动编辑 cashAccount 字段**
   - 找到错误的学生文档
   - 编辑 cashAccount 中的字段
   - 确保 totalAllocatedCash = emAllocatedCash + tlAllocatedCash + others

3. **验证修复**
   - 在前端刷新页面
   - 检查数据是否正确显示

---

## 📊 性能指标

部署后建议监控以下指标：

| 指标 | 目标值 | 说明 |
|------|--------|------|
| Cloud Functions 执行时间 | < 2s | 性能基准 |
| Firestore 查询延迟 | < 500ms | 正常范围 |
| 前端加载时间 | < 3s | 用户体验 |
| 错误率 | < 0.1% | 稳定性 |

**监控位置**:
- Firebase Console → Functions → Metrics
- Firebase Console → Firestore → Usage
- DevTools → Network & Performance

---

## 👥 技术支持

### 联系信息

| 角色 | 职责 | 联系方式 |
|------|------|---------|
| 开发人员 | 代码问题 | GitHub Copilot |
| DevOps | 部署问题 | Firebase Console |
| QA | 功能测试 | 测试计划 |
| PM | 业务需求 | 产品文档 |

### 常见文档

- **详细改造报告**: `TEAMLEADER_COMPLETE_REFACTORING_FINAL.md`
- **改造总结**: `TEAMLEADER_REFACTORING_SUMMARY_2026-04-26.md`
- **完成报告**: `TEAMLEADER_REFACTORING_COMPLETE_REPORT.md`

---

## ✨ 部署后下一步

### 即时
- [ ] 验证所有流程正常工作
- [ ] 检查日志中是否有错误
- [ ] 确认用户能进入新界面

### 24 小时内
- [ ] 用户反馈收集
- [ ] 性能监控
- [ ] Bug 修复（如有）

### 本周
- [ ] 用户培训
- [ ] 文档更新
- [ ] 持续优化

---

## 🎉 成功标志

部署完成的标志：
- ✅ 前端页面正常加载
- ✅ TeamLeader 能进入新"学生列表"页面
- ✅ 显示学生和应收现金数据
- ✅ 确认收款操作成功执行
- ✅ OverviewStats 显示现金统计
- ✅ 没有浏览器控制台错误
- ✅ Cloud Functions 日志无错误

---

**文档版本**: v2026-04-26  
**创建时间**: 2026-04-26  
**最后更新**: 2026-04-26  

*如有任何问题，请参考上述文档或联系技术支持。*
