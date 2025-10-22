我將在後端加入一個符合 httpsCallable 的 createEventManager（onCall）雲端函式，避免 CORS 預檢問題，並將 Event Manager 建立在 organizations/{org}/events/{event}/users 之下且回寫到活動文件。接著會提供部署與驗證步驟。 

正在使用 "套用修補檔"


```

```
我看到你在前端用 httpsCallable 呼叫 createEventManager，但後端沒有對應的 onCall 函式，瀏覽器就直接打到 https 端點，因為沒有回傳 CORS header 才被預檢擋下。已幫你把後端補上 createEventManager（onCall），這樣就不會再走 CORS 預檢，前端的 httpsCallable 也能正常通了。

以下是我做了什麼、為什麼有效、以及你接下來需要做的：

## 已完成的修正
- 在 admin.js 新增了 `exports.createEventManager = functions.https.onCall(...)`：
  - 驗證呼叫者是否已登入且是平台管理者（`admin_uids/{uid}` 中存在）。
  - 驗證輸入參數：`organizationId`、`eventId`、`phoneNumber`、`password`、`englishName`。
  - 檢查該活動是否已經有 Event Manager、手機號碼是否重複。
  - 在 `organizations/{org}/events/{event}/users/{userId}` 建立使用者文件，給 `roles: ['manager','seller']`，寫入 passwordHash/pinHash（與現有登入驗證邏輯相容）。
  - 更新活動文件的 `eventManager` 欄位，以及 `statistics.totalManagers += 1`。
- 你的 index.js 已經有 `exports.createEventManager = createEventManager;`，不需再改。
- 前端 AssignEventManager.jsx 已正確透過 `httpsCallable(functions, 'createEventManager')` 呼叫，無需調整。

為什麼能修好 CORS
- `httpsCallable` 需要後端用 `functions.https.onCall` 才會由 Firebase 平台自動處理 CORS 與驗證上下文。先前是打到一般 HTTPS 路由（或根本不存在），所以瀏覽器做了預檢（OPTIONS）卻拿不到 `Access-Control-Allow-Origin`，因此被擋。

## 你現在需要做的
1) 部署 Cloud Functions（只部署這支也可以）
- 部署全數 functions（簡單）：
  - 在專案根目錄執行
    ```powershell
    npm run deploy:functions
    ```
- 只部署 createEventManager（更快）：
  - 在專案根目錄執行
    ```powershell
    firebase deploy --only functions:createEventManager
    ```

2) 確保前端呼叫者是已登入的管理者
- 我在後端要求呼叫者要是平台管理者：`context.auth.uid` 必須存在，且 `admin_uids/{uid}` 文件存在。
- 若你的平台頁（PlatformDashboard）目前沒做登入流程，請先用你現有的登入流程取得 customToken，然後在前端呼叫：
  ```js
  import { signInWithCustomToken } from 'firebase/auth';
  import { auth } from '../../config/firebase';

  await signInWithCustomToken(auth, customToken);
  ```
- 登入後再打 `createEventManager`，`context.auth` 才會帶上 uid。

3) 驗證
- 部署完成後，重新整理前端，開啟指派 Event Manager 視窗，填表送出。
- 成功：前端會 alert 成功訊息；Firestore 會看到：
  - `organizations/{org}/events/{event}/users/{usr_xxx}`
  - `organizations/{org}/events/{event}` 的 `eventManager` 欄位被寫入
  - `statistics.totalManagers` 自動 +1
- 若前端仍報錯，請注意：
  - `FirebaseError: functions/unauthenticated` → 尚未登入
  - `functions/permission-denied` → 不是平台管理者（`admin_uids/{uid}` 沒有）
  - `functions/already-exists` → 活動已有 manager 或手機重複
  - `functions/invalid-argument` → 資料未填齊或格式不對

## 關於截圖裡的另外一條提示
- “Node cannot be found in the current page.” 多半是某個元件在查找不存在的 DOM 節點（例如第三方套件初始化時找不到目標元素）。和本次 CORS 問題無直接關係；等指派流程通了後，如果它還在出現，我可以幫你根據堆疊追出是哪個元件拋的。

## 品質檢查
- 前端 Build: PASS（我已編譯過前端）
- Functions 語法：新增程式碼使用現有依賴，無新增套件；待你部署驗證

需要我幫你把「登入後再進入 PlatformDashboard」的流程補在前端，或是加上一個「未登入時提示先登入」的保護嗎？

已進行變更。