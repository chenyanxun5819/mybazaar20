# PointSeller 實時統計數據同步修復

## 📋 問題描述
當 IssuePointCard.jsx 和 DirectSale.jsx 完成銷售行為後，PointSellerTransactions.jsx 中的統計數據（statistics）無法即時更新，需要手動刷新頁面才能看到最新數據。

## 🔍 根本原因分析
1. **statistics** 狀態只在初始化時從 `userProfile.pointSeller` 讀取一次
2. **issuanceRecords**（交易記錄）有實時監聽機制 ✅
3. **statistics**（統計數據）沒有實時監聽機制 ❌
4. `onRefresh()` 回調只是重新讀取本地 `userProfile`，無法從 Cloud 重新獲取更新

## ✅ 解決方案

### 1. **在 PointSellerDashboard.jsx 中添加實時監聽器** (第 271-302 行)
新增 `useEffect` 來直接監聽用戶文檔中的 `pointSeller` 字段：

```javascript
// ===== 2.5. 实时监听 PointSeller 统计数据 =====
useEffect(() => {
  const orgId = userProfile?.organizationId || orgCode;
  const evtId = userProfile?.eventId || eventCode;
  const userId = userProfile?.userId;

  if (!orgId || !evtId || !userId) return;

  // 直接监听用户文档（使用 userId 作为文档 ID）
  const userDocRef = doc(db, 'organizations', orgId, 'events', evtId, 'users', userId);
  const unsubscribe = onSnapshot(
    userDocRef,
    (docSnap) => {
      if (docSnap.exists()) {
        const userData = docSnap.data();
        if (userData.pointSeller) {
          console.log('[PointSeller] 🔄 统计数据已实时更新:', userData.pointSeller);
          setStatistics({
            todayStats: userData.pointSeller.todayStats || {},
            totalStats: userData.pointSeller.totalStats || {}
          });
        }
      }
    },
    (error) => {
      console.error('[PointSeller] ❌ 监听统计数据失败:', error.message);
    }
  );

  return () => unsubscribe();
}, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, orgCode, eventCode]);
```

### 2. **更新 import 語句**
新增 `doc` 到 Firestore import：
```javascript
import { collection, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
```

### 3. **改進子組件的刷新日誌** 
在 `IssuePointCard.jsx` 和 `DirectSale.jsx` 中添加調試日誌，確認刷新已觸發：

**IssuePointCard.jsx (第 736 行):**
```javascript
console.log('[IssuePointCard] 📊 点数卡发行成功，触发数据刷新');
onRefresh();
```

**DirectSale.jsx (第 234 行):**
```javascript
console.log('[DirectSale] 📊 直销成功，触发数据刷新');
onRefresh();
```

## 📊 數據流更新流程

### 之前 (有延遲問題)
```
交易完成 
  ↓
Cloud Function 成功 → 更新 Firestore 用戶文檔
  ↓
調用 onRefresh() → 只從本地 userProfile 讀取（無反應）
  ↓
需要手動刷新頁面才能看到新數據
```

### 之後 (實時同步) ✅
```
交易完成 
  ↓
Cloud Function 成功 → 更新 Firestore 用戶文檔
  ↓
調用 onRefresh() 
  ↓
實時監聽器自動捕獲 Firestore 更新
  ↓
✅ 本地 statistics 狀態自動更新
  ↓
✅ 所有依賴 statistics 的組件自動重新渲染
  ↓
✅ IssuePointCard、DirectSale、PointSellerTransactions UI 立即反映新數據
```

## 📍 受影響的組件

1. **IssuePointCard.jsx** (第 982-1006 行的統計顯示)
   - 今日發行張數
   - 今日發行點數  
   - 今日收現金

2. **DirectSale.jsx** (第 266-287 行的統計顯示)
   - 今日直銷筆數
   - 今日直銷點數
   - 今日收現金

3. **PointSellerTransactions.jsx** (第 80-104 行的統計顯示)
   - 累計統計面板
   - 卡片總點數
   - 手機總點數
   - 累計收現金

## 🧪 測試步驟

1. 開啟 PointSeller Dashboard
2. 在 IssuePointCard 或 DirectSale 完成一筆交易
3. **無需手動刷新** ✨ 移動到 PointSellerTransactions 標籤
4. **驗證**：統計數據應該已自動更新
5. 開啟瀏覽器控制台，查看：
   - `[PointSeller] 🔄 统计数据已实时更新:` 日誌訊息
   - `[IssuePointCard] 📊 点数卡发行成功，触发数据刷新` 或
   - `[DirectSale] 📊 直销成功，触发数据刷新`

## 💡 技術細節

- 使用 Firestore `onSnapshot()` 配合 `doc()` 在用戶文檔級別實現實時監聽
- 監聽對象：`organizations/{orgId}/events/{evtId}/users/{userId}` 文檔的 `pointSeller` 字段
- 自動清理：useEffect 返回的取消訂閱函數確保內存無洩漏
- 依賴項：`[userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, orgCode, eventCode]`

## 🔄 修改文件

- ✏️ `src/views/PointSellerDashboard/PointSellerDashboard.jsx` 
  - 添加 `doc` import
  - 添加新的 useEffect 監聽器
  - 改進 handleRefresh 日誌

- ✏️ `src/views/PointSellerDashboard/components/IssuePointCard.jsx`
  - 改進成功後的日誌記錄

- ✏️ `src/views/PointSellerDashboard/components/DirectSale.jsx`
  - 改進成功後的日誌記錄

## ✨ 預期效果

- ✅ 交易完成後，統計數據立即更新（無延遲）
- ✅ 無需手動刷新頁面
- ✅ 所有標籤的統計數據保持同步
- ✅ 交易歷史和統計數據同時更新
