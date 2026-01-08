### 第三階段：用戶管理系統

#### 功能 1: Platform Admin 指派 Org Admin

**需求：**
- Platform Admin 可以為組織指派管理員
- 創建 Org Admin 帳號（手機號 + 密碼）
- 設置角色為 `org_admin`

**需要實作：**

1. **Cloud Function: `createOrgAdmin`**
```javascript
   // functions/index.js
   exports.createOrgAdmin = functions.https.onCall(async (data, context) => {
     // 1. 驗證調用者是 Platform Admin
     // 2. 驗證手機號格式
     // 3. 驗證密碼強度
     // 4. 生成 authUid = phone_60{phoneNumber}
     // 5. 生成 salt 和 passwordHash
     // 6. 創建 Firebase Auth 用戶
     // 7. 創建 Firestore 用戶文檔（在組織下或根層級）
     // 8. 更新組織的 admins 陣列
   });
```

2. **前端組件: `src/views/platform/AssignOrgAdmin.jsx`**
   - 表單欄位：
     - 手機號 *
     - 初始密碼 *
     - 英文名 *
     - 中文名
     - Email
     - 身份標籤（staff/teacher）
   - 調用 Cloud Function
   - 成功後重新載入組織列表

3. **修改 `PlatformDashboard.jsx`**
   - 在組織卡片加入「指派管理員」按鈕
   - 顯示管理員數量（`{organization.admins?.length || 0} 位管理員`）
   - 顯示 AssignOrgAdminModal

**資料結構：**
```javascript
// organizations/{orgId}
{
  admins: [
    {
      uid: "phone_60123456789",
      phoneNumber: "0123456789",
      name: "John Doe",
      addedAt: "2025-01-11T10:00:00Z"
    }
  ]
}

// users/{userId} 或 organizations/{orgId}/users/{userId}
{
  authUid: "phone_60123456789",
  roles: ["org_admin"],
  organizationId: "org123",
  basicInfo: { ... },
  // ...
}
```

**預估時間：** 3-4 小時  
**優先級：** 高（上線前必須完成）

---