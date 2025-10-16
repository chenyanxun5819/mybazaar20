# MyBazaar - 義賣會管理系統專案文檔

## 專案概述

MyBazaar 是一個為義賣會設計的無紙化固本管理系統。該系統支持多角色管理、點數交易、多語言界面（中文/英文），並基於 Firebase 進行數據管理。

**技術棧：**
- 前端：HTML5, CSS3, JavaScript (ES6+)
- 構建工具：Vite
- 後端服務：Firebase (Authentication, Firestore)
- 國際化：自定義 i18n 實現

---

## 系統角色說明

### 1. Super Admin（超級管理員）
- 系統最高權限管理員
- 負責管理組織和指派管理員
- 管理系統配置和資本分配

### 2. Manager（管理員）
- 管理活動的管理員
- 負責分配資本給銷售員
- 管理用戶和查看交易記錄

### 3. Seller（銷售員）
- 銷售點數給消費者
- 查看個人銷售記錄
- 管理庫存點數

### 4. Customer（消費者）
- 購買和消費點數
- 查看個人餘額和交易記錄

### 5. Merchant（商家）
- 接受點數消費
- 查看收款記錄

---

## 頁面結構與功能說明

### 📁 首頁與導航

#### 1. **系統首頁**
- **路徑：** `public-vite/src/home/index.html`
- **對應 JS：** `public-vite/src/home/main.js`
- **功能說明：**
  - 系統入口頁面
  - 支援中英文切換
  - 提供登入入口
  - 顯示系統簡介

#### 2. **導航中心**
- **路徑：** `public-vite/src/home/navigation-center.html`
- **對應 JS：** `public-vite/src/home/navigation-center.js`
- **功能說明：**
  - 登入後的導航樞紐
  - 根據用戶角色顯示對應的功能卡片
  - 快速導航到各角色的控制面板
  - 顯示用戶基本資訊
  - 支援多語言切換
  - 登出功能

---

### 🔐 認證相關

#### 3. **登入頁面**
- **路徑：** `public-vite/src/auth/login.html`
- **對應 JS：** `public-vite/src/auth/login.js`
- **功能說明：**
  - 用戶登入（手機號 + 密碼）
  - Firebase Authentication 整合
  - 登入後根據角色跳轉到對應頁面
  - 支援多語言界面
  - 記住我功能（可選）

#### 4. **註冊頁面（消費者）**
- **路徑：** `public-vite/src/customer/register.html`
- **對應 JS：** `public-vite/src/customer/register.js`
- **功能說明：**
  - 消費者自助註冊
  - 手機號驗證
  - 基本資料填寫（英文名、中文名）
  - 可選身份標籤（學生/教師/職員/外部用戶）
  - OTP 驗證支援
  - 設置 PIN 碼

---

### 👨‍💼 Super Admin 頁面

#### 5. **Super Admin 控制面板**
- **路徑：** `public-vite/src/admin/admin-dashboard.html`
- **對應 JS：** `public-vite/src/admin/admin-dashboard.js`
- **功能說明：**
  - 查看專案配置資訊
  - 顯示系統統計數據
    - 總參與者數
    - 總交易數
    - 資本分配概況
    - 各角色用戶數量
  - 管理人員列表（Manager 列表）
  - 編輯 Manager 資料
  - 修改密碼
  - 多語言切換
  - 登出功能

#### 6. **創建 Manager**
- **路徑：** `public-vite/src/admin/create-manager.html`
- **對應 JS：** `public-vite/src/admin/create-manager.js`
- **功能說明：**
  - 新增管理員帳號
  - 填寫管理員基本資料
    - 英文名字
    - 中文名字（可選）
    - 管理員編號
    - 聯繫電話
    - 電子郵箱
  - 設置初始密碼
  - 分配身份標籤（teacher/staff）
  - 自動創建 Firebase Authentication 帳號

#### 7. **Admin Bootstrap**
- **路徑：** `public-vite/src/admin/admin-bootstrap.html`
- **對應 JS：** `public-vite/src/admin/admin-bootstrap.js`
- **功能說明：**
  - 系統初始化頁面
  - 創建第一個 Super Admin 帳號
  - 僅在系統首次部署時使用

---

### 👨‍💼 Manager 頁面

#### 8. **用戶管理頁面**
- **路徑：** `public-vite/src/manager/admin-manage-users.html`
- **對應 JS：** `public-vite/src/manager/admin-manage-users.js`
- **功能說明：**
  - 查看所有用戶列表
  - 用戶篩選功能
    - 按角色篩選（Customer/Seller/Merchant）
    - 按身份標籤篩選
    - 按手機號搜尋
  - 用戶統計卡片
    - 總用戶數
    - 各角色分佈
  - 編輯用戶資料
  - 批量導入銷售員
    - CSV 檔案上傳
    - 數據預覽與驗證
    - 批量創建帳號
  - 修改密碼功能
  - 回到首頁導航
  - 登出後跳轉到系統首頁

#### 9. **新增商家**
- **路徑：** `public-vite/src/manager/add-merchant.html`
- **對應 JS：** `public-vite/src/manager/add-merchant.js`
- **功能說明：**
  - 新增商家帳號
  - 填寫商家資料
    - 商家名稱（中英文）
    - 聯絡人資訊
    - 手機號碼
    - 電子郵箱（可選）
    - 營業時間
    - 商家類型
    - 商家描述
  - 可選擇是否為組織內部商家
  - 支援身份標籤（teacher/staff）
  - 表單驗證與錯誤提示

---

### 👨‍💼 Seller 頁面

#### 10. **銷售員控制面板**
- **路徑：** `public-vite/src/seller/seller-dashboard.html`
- **對應 JS：** `public-vite/src/seller/seller-dashboard.js`
- **功能說明：**
  - **總覽標籤頁**
    - 顯示可用點數（從 customer.currentBalance 讀取）
    - 顯示總銷售額
    - 顯示今日銷售
    - 顯示交易次數
    - 資本來源資訊（分配者、分配時間）
    - 最近交易記錄（最新 5 筆）
  - **新銷售標籤頁**
    - 輸入顧客手機號
    - 輸入銷售點數
    - 自動計算銷售金額（1 點 = RM 1）
    - 顯示可用點數
    - 提交銷售交易
    - 即時扣減賣家點數，增加顧客點數
  - **銷售記錄標籤頁**
    - 完整銷售歷史記錄
    - 顯示交易 ID、顧客、點數、金額、時間、狀態
  - **個人資料標籤頁**
    - 顯示聯繫資訊
    - 顯示身份資訊（依據 identityTag 動態顯示）
  - 語言切換（中文/英文）
  - 回首頁按鈕（導航到 navigation-center.html）
  - 登出功能（跳轉到 index.html）

---

### 🏪 Merchant 頁面

#### 11. **商家控制面板**
- **路徑：** `public-vite/src/merchant/merchant-dashboard.html`
- **對應 JS：** `public-vite/src/merchant/merchant-dashboard.js`
- **功能說明：**
  - 顯示商家基本資訊
  - 統計卡片
    - 今日收款
    - 本月收款
    - 總收款
  - QR Code 生成與管理
    - 生成支付 QR Code（包含商家 ID）
    - 下載 QR Code 圖片
    - 顧客掃描後進行點數消費
  - 銷售記錄列表
    - 顯示收款記錄
    - 交易時間、顧客、點數
  - 登出功能

---

### 👤 Customer 頁面

#### 12. **消費者控制面板**
- **路徑：** `public-vite/src/customer/customer-dashboard.html`
- **對應 JS：** `public-vite/src/customer/customer-dashboard.js`
- **功能說明：**
  - 顯示當前點數餘額
  - 顯示總購買點數
  - 顯示總消費點數
  - 交易歷史記錄
    - 購買記錄
    - 消費記錄
  - 掃描 QR Code 進行消費
  - 個人資料查看
  - 登出功能

---

### 💳 交易相關

#### 13. **消費者支付頁面**
- **路徑：** `public-vite/src/transaction/customer-payment.html`
- **對應 JS：** `public-vite/src/transaction/customer-payment.js`
- **功能說明：**
  - 掃描商家 QR Code 後進入
  - 顯示商家資訊
  - 輸入消費點數
  - 確認支付
  - PIN 碼驗證
  - 扣減顧客點數，增加商家收款
  - 顯示交易結果

---

### 🔧 共用模組與後端服務

#### 14. **Firebase 配置**
- **路徑：** `public-vite/src/shared/firebase.js`
- **功能說明：**
  - Firebase 初始化
  - 導出 auth（Authentication）
  - 導出 db（Firestore）
  - 統一的 Firebase 配置管理

#### 15. **國際化模組**
- **路徑：** `public-vite/src/shared/i18n.js`
- **功能說明：**
  - 多語言翻譯管理
  - 支援 zh-CN（簡體中文）和 en-US（英文）
  - 動態切換語言
  - 翻譯鍵值對管理
  - 頁面元素自動更新

#### 16. **認證 UI 模板**
- **路徑：** `public-vite/src/common/auth-ui-template.html`
- **功能說明：**
  - 通用的認證頁面 UI 樣式
  - 登入/註冊頁面共用模板

---

### ⚙️ Firebase Cloud Functions (後端服務)

#### 17. **主函數入口**
- **路徑：** `functions/src/index.js`
- **功能說明：**
  - Firebase Cloud Functions 主入口檔案
  - 導出所有 Cloud Functions

**主要功能函數：**

1. **`loginWithPin`** - PIN 碼登入
   - 接收手機號和 PIN 碼
   - 驗證用戶身份
   - 生成 Custom Token
   - 返回用戶資訊和跳轉 URL
   - 自動創建或更新 Firebase Auth 用戶

2. **`changePassword`** - 修改密碼
   - 驗證當前密碼
   - 檢查新密碼強度（至少 8 字符，包含英文和數字）
   - 更新密碼 hash
   - 向後兼容 pinHash 欄位

3. **`loginAndRedirect`** - 登入後跳轉
   - 根據用戶角色返回對應的跳轉 URL
   - 支援多角色處理
   - 優先級：super_admin > manager > merchant > seller > customer

4. **`sendOtpToPhone`** - 發送 OTP
   - 生成 6 位數 OTP
   - 創建 OTP session
   - 設定 5 分鐘過期時間
   - 整合 Twilio（生產環境）

5. **`getManagers`** - 獲取管理員列表
   - 查詢所有 Manager
   - 返回管理員資訊陣列

**角色跳轉邏輯：**
```javascript
- super_admin → ../admin/admin-dashboard.html
- manager → ../manager/admin-manage-users.html
- merchant → ../merchant/merchant-dashboard.html
- seller → ../seller/seller-dashboard.html
- customer → ../customer/consume.html
- default → ../home/index.html
```

#### 18. **管理員函數模組**
- **路徑：** `functions/src/admin.js`
- **功能說明：**
  - 管理員相關的 Cloud Functions
  - 系統初始化和配置管理

**主要功能函數：**

1. **`checkAdminExists`** - 檢查管理員是否存在
   - 查詢是否已有 super_admin
   - 用於系統初始化檢查

2. **`createInitialAdmin`** - 創建初始超級管理員
   - 系統首次部署時創建第一個 super_admin
   - 支援多角色分配（super_admin + seller + customer + merchant 可選）
   - 驗證身份標籤（僅允許 staff 或 teacher）
   - 創建 Firebase Auth 帳號
   - 初始化 Firestore 用戶文檔（完全符合新架構）
   - 設置初始資本額度
   - 保存專案配置資訊
   - 初始化全局設定
   
   **必填欄位：**
   - phoneNumber: 手機號碼
   - englishName: 英文名字
   - email: 電子郵箱
   - password: 初始密碼
   - identityTag: 身份標籤（staff/teacher）
   
   **可選欄位：**
   - chineseName: 中文名字
   - department: 部門名稱
   - includeMerchant: 是否包含 merchant 角色
   - projectInfo: 專案配置資訊

3. **`createManager`** - 創建管理員
   - 僅 super_admin 可執行
   - 驗證權限（雙重檢查：authUid 和 docId）
   - 驗證密碼強度（至少 8 字符，英文+數字）
   - 檢查手機號是否已存在
   - 驗證分配額度是否超過可用額度
   - 自動生成 Manager ID（M001, M002...）
   - 創建 Firebase Auth 帳號
   - 創建 Firestore 用戶文檔
   - 更新系統統計資料
   - 記錄資本分配來源
   
   **必填欄位：**
   - phoneNumber: 手機號碼
   - password: 初始密碼
   - englishName: 英文名字
   - identityTag: 身份標籤（staff/teacher）
   - assignedCapital: 分配資本額度
   
   **可選欄位：**
   - chineseName: 中文名字

4. **`sendOtpToPhone`** - 發送 OTP（管理員版本）
   - 驗證用戶 PIN 碼
   - 生成 6 位數 OTP
   - 創建 OTP session
   - 存儲到 otp_collection
   - 5 分鐘過期時間

5. **`verifyOtpCode`** - 驗證 OTP
   - 檢查 OTP session 是否存在
   - 驗證是否過期
   - 驗證 OTP 正確性
   - 記錄失敗次數
   - 生成 Custom Token
   - 刪除已使用的 OTP session

6. **`setProjectInfo`** - 設置專案配置
   - 保存專案資訊到 system_config
   - 包含活動名稱、日期、地點等

7. **`getTotalCapital`** - 獲取總資本資訊
   - 查詢專案總資本
   - 返回已分配和可用資本
   - 用於資本分配管理

8. **`getAssignedCapitalSum`** - 獲取已分配資本總和
   - 統計所有 Manager 的已分配資本
   - 用於驗證分配額度

**安全機制：**
- 使用 SHA-256 進行密碼加密
- 隨機生成 salt 值
- OTP 雙重驗證
- 權限驗證（super_admin 專屬功能）
- 資本額度驗證
- 手機號唯一性檢查
- 密碼強度驗證

---

### 🔐 Cloud Functions 調用方式

前端通過 Firebase SDK 調用 Cloud Functions：

```javascript
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions();

// 調用登入函數
const loginWithPin = httpsCallable(functions, 'loginWithPin');
const result = await loginWithPin({ 
  phoneNumber: '0123456789', 
  pin: 'password123' 
});

// 調用創建 Manager 函數
const createManager = httpsCallable(functions, 'createManager');
const result = await createManager({
  phoneNumber: '0123456788',
  password: 'Manager123',
  englishName: 'John Doe',
  chineseName: '張三',
  identityTag: 'staff',
  assignedCapital: 100000
});
```

---

### 🔧 共用工具函數

**密碼哈希函數：**
```javascript
function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}
```

**Auth UID 生成規則：**
```javascript
// 馬來西亞國碼 60，去除手機號前導 0
const authUid = `phone_60${phoneNumber.replace(/^0/, "")}`;
// 例如：0123456789 → phone_60123456789
```

---

### 🔧 原有的共用模組（續）

#### 19. **認證 UI 模板**
- **路徑：** `public-vite/src/common/auth-ui-template.html`
  - 動態切換語言
  - 翻譯鍵值對管理
  - 頁面元素自動更新

#### 16. **認證 UI 模板**
- **路徑：** `public-vite/src/common/auth-ui-template.html`
- **功能說明：**
  - 通用的認證頁面 UI 樣式
  - 登入/註冊頁面共用模板

---

## 數據結構說明

### Firestore Collections

#### 1. **users** Collection
儲存所有用戶資料，包含多角色支援

**主要欄位：**
```javascript
{
  userId: string,
  authUid: string,
  roles: array, // ['customer', 'seller', 'merchant', 'manager', 'super_admin']
  identityTag: string, // 'student', 'teacher', 'staff', null
  basicInfo: {
    phoneNumber: string,
    englishName: string,
    chineseName: string,
    email: string,
    pinHash: string,
    passwordHash: string,
    isPhoneVerified: boolean
  },
  identityInfo: {
    // 依據 identityTag 不同而有不同欄位
    studentId: string,
    className: string,
    teacherId: string,
    department: string,
    staffId: string,
    position: string
  },
  roleSpecificData: {
    customer: {
      currentBalance: number, // 當前點數餘額
      totalPointsPurchased: number,
      totalPointsConsumed: number
    },
    seller: {
      totalPointsSold: number,
      currentSalesAmount: number,
      capitalSource: {
        assignedBy: string,
        assignedAt: timestamp,
        allocationId: string
      }
    },
    merchant: {
      totalReceivedPoints: number,
      monthlyReceivedPoints: number
    },
    manager: {
      managerId: string,
      assignedCapital: number,
      allocatedToSellers: number,
      availableCapital: number,
      totalSellersManaged: number
    },
    super_admin: {
      superAdminId: string,
      totalCapitalManaged: number,
      allocatedCapital: number,
      availableCapital: number
    }
  },
  accountStatus: {
    status: string, // 'active', 'suspended', 'inactive'
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
```

#### 2. **transactions** Collection
儲存所有交易記錄

**主要欄位：**
```javascript
{
  transactionId: string,
  transactionType: string, // 'sale', 'consumption', 'allocation'
  sellerId: string,
  sellerName: string,
  customerId: string,
  customerName: string,
  merchantId: string,
  merchantName: string,
  points: number,
  amount: number,
  status: string, // 'completed', 'pending', 'failed'
  timestamp: timestamp,
  createdAt: timestamp
}
```

#### 3. **system_config** Collection
儲存系統配置資訊

**主要欄位：**
- `global_settings`: 全域設定
- `project_info`: 專案資訊
- 支援語言、時區、貨幣等配置

#### 4. **role_definitions** Collection
角色定義和權限管理

#### 5. **identity_tag_definitions** Collection
身份標籤定義

#### 6. **capital_allocations** Collection
資本分配記錄

#### 7. **admin_uids** Collection
管理員 UID 白名單

---

## 重要功能流程

### 1. 用戶登入流程
1. 用戶在登入頁面輸入手機號和密碼
2. 系統驗證 Firebase Authentication
3. 根據 authUid 查詢 Firestore users collection
4. 讀取用戶角色（roles 陣列）
5. 跳轉到導航中心或對應角色的控制面板

### 2. 銷售員銷售流程
1. 銷售員在控制面板選擇「新銷售」
2. 輸入顧客手機號、銷售點數
3. 系統檢查銷售員可用點數（從 customer.currentBalance 讀取）
4. 查詢顧客資料
5. 使用 Firestore Transaction 執行：
   - 扣減銷售員的 `customer.currentBalance`
   - 增加銷售員的 `seller.totalPointsSold`
   - 增加顧客的 `customer.currentBalance`
   - 創建交易記錄
6. 更新界面顯示

### 3. 消費者付款流程
1. 消費者掃描商家 QR Code
2. 跳轉到支付頁面，顯示商家資訊
3. 輸入消費點數
4. 輸入 PIN 碼驗證
5. 使用 Firestore Transaction 執行：
   - 扣減消費者的 `customer.currentBalance`
   - 增加商家的 `merchant.totalReceivedPoints`
   - 創建交易記錄
6. 顯示交易成功訊息

### 4. Manager 批量導入銷售員
1. Manager 在用戶管理頁面選擇「批量導入銷售員」
2. 上傳 CSV 檔案
3. 系統解析並驗證數據
4. 顯示預覽和驗證結果
5. 確認後批量創建：
   - Firebase Authentication 帳號
   - Firestore user 文檔
   - 設置初始密碼和角色
6. 顯示導入結果

---

## 國際化支援

系統支援中英文雙語界面：

### 支援語言
- **zh-CN**: 簡體中文
- **en-US**: 英文

### 切換方式
- 每個頁面都有語言切換按鈕
- 語言偏好儲存在 localStorage
- 頁面載入時自動應用用戶偏好語言

### 翻譯內容
- 界面文字
- 按鈕標籤
- 提示訊息
- 錯誤訊息
- 表單標籤

---

## 權限控制

### 角色權限矩陣

| 功能 | Customer | Seller | Merchant | Manager | Super Admin |
|------|----------|--------|----------|---------|-------------|
| 購買點數 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 銷售點數 | ❌ | ✅ | ❌ | ✅ | ✅ |
| 接受消費 | ❌ | ❌ | ✅ | ❌ | ❌ |
| 創建銷售員 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 創建商家 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 用戶管理 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 創建 Manager | ❌ | ❌ | ❌ | ❌ | ✅ |
| 系統配置 | ❌ | ❌ | ❌ | ❌ | ✅ |
| 資本分配 | ❌ | ❌ | ❌ | ✅ | ✅ |

### 角色互斥規則
- `super_admin` 與 `manager` 互斥
- 其他角色可以組合（例如：seller + customer + merchant）

---

## 部署與配置

### 環境要求
- Node.js 14+
- Firebase 專案
- Vite 構建工具

### Firebase 配置
在 `public-vite/src/shared/firebase.js` 中配置 Firebase：

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### 本地開發
```bash
# 安裝依賴
npm install

# 啟動開發伺服器
npm run dev

# 構建生產版本
npm run build
```

### 訪問路徑
- 開發環境：`http://localhost:5173`
- 系統首頁：`http://localhost:5173/home/index.html`
- 導航中心：`http://localhost:5173/home/navigation-center.html`

---

## 安全性考慮

1. **密碼加密**：使用 SHA-256 進行密碼哈希
2. **PIN 碼保護**：交易時需要 PIN 碼驗證
3. **OTP 驗證**：支援手機號 OTP 驗證（可選）
4. **Firebase Rules**：配置 Firestore 安全規則
5. **角色驗證**：前後端雙重角色權限檢查
6. **交易原子性**：使用 Firestore Transaction 確保數據一致性

---

## 已知問題與注意事項

1. **點數儲存位置**：
   - 銷售員的可用點數存儲在 `roleSpecificData.customer.currentBalance`
   - 不是 `roleSpecificData.seller.availablePoints`（此欄位已廢棄）

2. **登出跳轉**：
   - Seller Dashboard 登出後跳轉到 `http://localhost:5173/home/index.html`
   - Manager 頁面登出後跳轉到 `http://localhost:5173/home/index.html`

3. **多角色支援**：
   - 用戶可以同時擁有多個角色
   - 導航中心會顯示所有可用角色的入口

4. **數據初始化**：
   - 首次部署需要使用 `init_data_20251003.json` 初始化 Firestore
   - Super Admin 預設密碼：`password`（生產環境請立即修改）

---

## 未來規劃

- [ ] 交易報表生成
- [ ] 資本分配審批流程
- [ ] 郵件通知功能
- [ ] 手機 APP 版本
- [ ] 數據匯出功能（Excel/CSV）
- [ ] 即時庫存警告
- [ ] 交易統計圖表
- [ ] 多組織支援

---

## 聯絡資訊

如有問題或建議，請聯繫開發團隊。

---

**最後更新：** 2025-10-10
**版本：** 4.2.0