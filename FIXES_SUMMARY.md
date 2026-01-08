# 修复总结：角色切换与登入问题

## 问题分析

### 问题1：分配新角色后，RoleSwitcher 不自动显示
**症状**：
- Event Manager 为用户分配 `sellerManager` 角色
- 返回 Dashboard，RoleSwitcher 中没有新角色选项
- 需要**登出再登入**才能看到新角色

**根本原因**：
1. 角色数据保存在 localStorage 中的 `userInfo.availableRoles`
2. 这个值**只在登录时设置**，Dashboard 中没有监听角色变化
3. 即使 Firestore 中的角色已更新，页面上显示的仍是旧数据

### 问题2：登出再登入后出现错误
**症状**：
- 截图显示复合查询失败错误（从问题截图看）
- 这与角色格式不一致有关

**根本原因**：
1. **Firestore 存储的角色格式**：`seller_manager`（下划线）
2. **前端保存的角色格式**：`sellerManager`（驼峰式）
3. **角色转换不完整**：
   - `UserManagement.handleSaveRoles()` 保存的是 `sellerManager`（驼峰式）❌
   - `UniversalLogin.filterRolesByDevice()` 没有转换下划线格式 ❌
   - 导致登录时无法正确识别和过滤角色

---

## 修复方案

### 修复1：修正 UserManagement.handleSaveRoles() 角色格式

**文件**：`src/components/common/UserManagement.jsx`

**改变**：
```javascript
// ❌ 之前（错误）
if (selectedRoles.sellerManager) newRoles.push('sellerManager');

// ✅ 之后（正确）
if (selectedRoles.sellerManager) newRoles.push('seller_manager');
if (selectedRoles.merchantManager) newRoles.push('merchant_manager');
if (selectedRoles.customerManager) newRoles.push('customer_manager');
```

**同时初始化 roleSpecificData**（用于点数管理）：
```javascript
const roleSpecificDataUpdates = {};

if (selectedRoles.sellerManager && !selectedUser.roles?.includes('seller_manager')) {
  roleSpecificDataUpdates['roleSpecificData.seller_manager'] = {
    managerId: `SM${Date.now()}`,
    assignedCapital: 0,
    availableCapital: 0,
    allocatedToSellers: 0,
    totalSellersManaged: 0
  };
}
// ... 类似处理 merchant_manager, customer_manager
```

### 修复2：添加角色格式转换函数 (UniversalLogin.jsx)

**文件**：`src/views/auth/UniversalLogin.jsx`

**新增函数**：
```javascript
const normalizeRole = (role) => {
  const roleMap = {
    'seller_manager': 'sellerManager',
    'merchant_manager': 'merchantManager',
    'customer_manager': 'customerManager',
    'event_manager': 'eventManager',
    'platform_admin': 'platformAdmin'
  };
  return roleMap[role] || role;
};
```

**改进 filterRolesByDevice**：
```javascript
const filterRolesByDevice = (roles) => {
  // 首先将所有角色转换为驼峰式
  const normalizedRoles = (roles || []).map(normalizeRole);
  
  if (isMobile) {
    const phoneRoles = ['customer', 'seller', 'merchant'];
    return normalizedRoles.filter(role => phoneRoles.includes(role));
  } else {
    const desktopRoles = ['eventManager', 'sellerManager', 'merchantManager', 'customerManager', 'platformAdmin'];
    return normalizedRoles.filter(role => desktopRoles.includes(role));
  }
};
```

### 修复3：Dashboard 中自动刷新角色信息

**文件**：`src/views/eventManager/EventManagerDashboard.jsx`

**新增函数**：`handleRolesUpdated()`
```javascript
const handleRolesUpdated = async () => {
  console.log('[EventManagerDashboard] 检测到角色变化，重新加载用户信息...');
  
  // 从 Firestore 重新加载当前用户信息
  const currentUserDoc = await getDoc(
    doc(db, 'organizations', organizationId, 'events', eventId, 'users', userInfo.userId)
  );
  
  if (currentUserDoc.exists()) {
    const userData = currentUserDoc.data();
    const roles = userData.roles || [];
    const normalizedRoles = roles.map(normalizeRole);
    
    // 更新 localStorage 并刷新 state
    const updatedUserInfo = {
      ...userInfo,
      roles: normalizedRoles,
      availableRoles: normalizedRoles,
      currentRole: userInfo.currentRole
    };
    
    localStorage.setItem('eventManagerInfo', JSON.stringify(updatedUserInfo));
    setUserInfo(updatedUserInfo);
  }
};
```

**将回调传给 UserManagement**：
```jsx
{showUserManagement && (
  <UserManagement
    organizationId={organizationId}
    eventId={eventId}
    onClose={() => {
      setShowUserManagement(false);
      loadDashboardData();
    }}
    onUpdate={handleRolesUpdated}  // ✨ 新增
  />
)}
```

---

## 工作流程变化

### 之前（有问题）
```
1. Event Manager 分配角色 → 保存为 'sellerManager'（驼峰式）
2. Firestore 中存储为 'sellerManager'（错误！应该是 'seller_manager'）
3. Dashboard 不刷新 availableRoles → RoleSwitcher 不显示新角色
4. 用户登出再登入 → filterRolesByDevice 无法正确转换 'seller_manager'
5. 显示错误或角色丢失
```

### 之后（修复后）
```
1. Event Manager 分配角色 → 转换为 'seller_manager'（下划线式）
2. 保存到 Firestore 为 'seller_manager'（正确）✓
3. handleRolesUpdated() 自动刷新 → availableRoles 包含新角色 ✓
4. RoleSwitcher 立即显示新角色选项（无需登出） ✓
5. 用户登出再登入 → normalizeRole() 正确转换 'seller_manager' → 'sellerManager' ✓
6. 一切正常工作 ✓
```

---

## 角色命名规范（规范化）

### Firestore 中的存储格式（下划线）
- `seller_manager` - 销售经理
- `merchant_manager` - 商家经理
- `customer_manager` - 客户经理
- `event_manager` - 活动经理
- `platform_admin` - 平台管理员
- `seller` - 销售员
- `merchant` - 商家
- `customer` - 客户

### 前端显示格式（驼峰式）
- `sellerManager`
- `merchantManager`
- `customerManager`
- `eventManager`
- `platformAdmin`
- `seller`
- `merchant`
- `customer`

**转换点**：
- 从 Firestore 读取时：下划线 → 驼峰（`normalizeRole()`）
- 保存到 Firestore 时：驼峰 → 下划线
- localStorage 中：使用驼峰式

---

## 部署信息

✅ 已部署到：https://mybazaar-c4881.web.app

**变更文件**：
- `src/components/common/UserManagement.jsx` - 修复角色保存格式
- `src/views/auth/UniversalLogin.jsx` - 添加角色转换函数
- `src/views/eventManager/EventManagerDashboard.jsx` - 添加角色更新回调

---

## 测试步骤

1. **测试问题1修复**（RoleSwitcher 自动显示）
   - [ ] Event Manager 登录
   - [ ] 进入"角色分配 & 点数"
   - [ ] 为某用户分配 sellerManager 角色
   - [ ] 点击保存 → RoleSwitcher 应立即显示新角色选项
   - [ ] 无需登出即可看到变化 ✓

2. **测试问题2修复**（登出再登入）
   - [ ] 用户登出
   - [ ] 用新角色（sellerManager）登入
   - [ ] 应正确进入 `/seller-manager/{orgEventCode}/dashboard`
   - [ ] 无错误提示 ✓

3. **测试角色切换**
   - [ ] 在 RoleSwitcher 中切换到其他角色
   - [ ] 跳转到对应 Dashboard ✓
   - [ ] 数据加载正常 ✓

---

## 相关代码参考

- **角色枚举**：见 `functions/admin.js` roleSpecificData 初始化部分
- **Firestore 结构**：`organizations/{orgId}/events/{eventId}/users/{userId}`
- **安全规则**：`firestore.rules` 中的 eventUser 权限检查
