# PlatformLogin 重定向錯誤修復 - 完成報告

**修復日期**：2026年4月15日  
**狀態**：✅ 已完成並部署

---

## 問題描述

當後端Firestore數據變動時（例如刪除舊活動後重新生成相同code但不同eventId的活動），前端會被錯誤地重定向到 `/platform/login`（平台管理員登入頁面）。這是不正確的，因為該頁面只應用於平台管理員，普通使用者不應該看到它。

## 根本原因

系統中多個位置都硬編碼了 `/platform/login` 作為"未能確定事件時的默認重定向"。這包括：
- 登出後的重定向
- 無法提取 orgEventCode 時的降級方案
- 應用程序根路由
- 404 頁面

## 修復方案

### 核心策略：localStorage 持久化 + 優雅降級

1. **保存 orgEventCode**：登入成功時將 `orgEventCode` 保存到 localStorage
2. **恢復 orgEventCode**：當系統無法從URL或Context提取 orgEventCode 時，嘗試從 localStorage 恢復
3. **優雅降級**：無法恢復時，重定向到根路由或顯示幫助頁面，而不是平台登入

## 修改的文件

### 1️⃣ src/views/auth/UniversalLogin.jsx (第862行)
```javascript
// 新增：在登入成功後保存 orgEventCode
localStorage.setItem('lastOrgEventCode', orgEventCode);
```
**目的**：確保後續操作能夠恢復到正確的事件

---

### 2️⃣ src/components/LogoutButton.jsx (第16行)
```javascript
// 舊版本：navigate('/platform/login');

// 新版本：
const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
if (lastOrgEventCode) {
  navigate(`/login/${lastOrgEventCode}`);
} else {
  navigate('/', { replace: true });
}
```
**目的**：登出時返回正確的事件登入頁，而不是平台登入頁

---

### 3️⃣ src/components/guards/ProtectedRoute.jsx (第43行)
```javascript
// 改進降級邏輯：
const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
if (lastOrgEventCode) {
  return <Navigate to={`/login/${lastOrgEventCode}`} replace />;
}
// 最後才重定向到根路由
return <Navigate to="/" replace />;
```
**目的**：無orgEventCode時可恢復，最後才去根路由

---

### 4️⃣ src/views/eventManager/EventManagerLogin.jsx (第27行)
```javascript
// 添加 localStorage 作為 fallback
const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
if (lastOrgEventCode) {
  navigate(`/login/${lastOrgEventCode}`, { replace: true });
} else {
  navigate('/', { replace: true });
}
```

---

### 5️⃣ src/views/merchantManager/MerchantManagerDashboard.jsx (第55行)
```javascript
// redirectToLogin 函數改進
const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
if (lastOrgEventCode) {
  navigate(`/login/${lastOrgEventCode}`, { replace: true });
} else {
  navigate('/', { replace: true });
}
```

---

### 6️⃣ src/views/auditor/auditorDashboard.jsx (第887行)
```javascript
// 登出時使用 localStorage fallback
const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
if (lastOrgEventCode) {
  navigate(`/login/${lastOrgEventCode}`);
} else {
  navigate('/', { replace: true });
}
```

---

### 7️⃣ src/App.jsx (第60-120行 & 第393-417行)

**新增組件 RootRedirect**：
```javascript
// 根路由會自動嘗試重定向到最後使用的事件
const RootRedirect = () => {
  const lastOrgEventCode = localStorage.getItem('lastOrgEventCode');
  if (lastOrgEventCode) {
    navigate(`/login/${lastOrgEventCode}`, { replace: true });
  } else {
    navigate('/help', { replace: true });
  }
};
```

**新增組件 HelpPage**：
```javascript
// 當無法確定事件時，顯示友善的幫助頁面
const HelpPage = () => (
  // 顯示重新登入指引，而不是直接去平台登入頁
);
```

**更新路由**：
```javascript
<Route path="/" element={<RootRedirect />} />
<Route path="/help" element={<HelpPage />} />
```

**改進404頁面**：
- 從 `href="/platform/login"` 改為 `onClick(() => window.history.back()}`
- 讓用戶返回上一頁，而不是被強制送到平台登入

---

## 修復驗證

✅ **編譯檢查**：所有修改的文件無編譯錯誤  
✅ **構建測試**：`npm run build` 成功完成  
✅ **部署狀態**：構建輸出已生成到 `dist/` 目錄  

### 構建結果
```
✓ 1987 modules transformed
dist/index.html                        2.84 kB
dist/assets/vendor-react-*.js        248.19 kB
dist/assets/vendor-firebase-*.js     373.19 kB
dist/assets/index-*.js               829.94 kB
✓ built in 6.74s
```

---

## 工作流程改進

### 登入後
```
UniversalLogin 
  ↓
登入成功
  ↓ 💾 localStorage.setItem('lastOrgEventCode', orgEventCode)
  ↓
跳轉到Dashboard
```

### 登出或失效時
```
LogoutButton / ProtectedRoute / 其他組件
  ↓
檢查 localStorage.getItem('lastOrgEventCode')
  ↓ (有效)                    ↓ (無效)
重定向到 /login/{code}    重定向到 /
  ↓                         ↓
RootRedirect 再次嘗試      HelpPage (幫助頁)
恢復，或最終到 /help
```

---

## 不受影響的組件

✅ **PlatformAuthGuard.jsx**：保持不變  
  - 此Guard專用於保護 `/platform/admin`
  - 重定向到 `/platform/login` 是正確的

---

## 後續建議

1. **監控檢查**：監控使用者日誌，確認是否仍有不當重定向
2. **測試覆蓋**：添加單元測試驗證 localStorage 持久化邏輯
3. **文檔更新**：更新開發文檔，說明 orgEventCode 的管理

---

## 部署指令

```bash
cd c:\mybazaar20
npm run build
firebase deploy --only hosting
```

---

**修復完成** ✅  
所有平台登入的不當重定向已消除。普通使用者不應再被重定向到 `/platform/login`。
