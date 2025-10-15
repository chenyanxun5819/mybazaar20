# 第一步：
## 錯誤的直接原因是後端 Auth 未初始化（configuration-not-found）
```
讀取 [](file:///d%3A/mybazaar20/functions/index.js#1-1)，1 至 260 行

讀取 [](file:///d%3A/mybazaar20/functions/index.js#260-260)，260 至 511 行

正在使用 "套用修補檔"


```

```


已建立 5 個待辦事項

我看完你貼的日誌和目前的程式後，問題點很明確：後端在呼叫 Firebase Admin 的 Auth API 時拋出 auth/configuration-not-found，導致整個 loginWithPin 回傳 500。下面先說根因與修復兩條路，再告訴你我已經幫你在程式裡做了無痛降級，讓你先能繼續測試。

## 問題根因
- 你已成功在 Firestore 找到使用者並驗證了密碼，錯誤發生在這段：
  - admin.auth().getUser(authUid) 擲出錯誤：
    - code: auth/configuration-not-found
    - message: There is no configuration corresponding to the provided identifier.
- 這通常代表：
  - 尚未在 Firebase Console 的 Authentication 頁面按「Get started」啟用 Auth；
  - 或對應的 Google Cloud「Identity Toolkit API」沒有啟用；
  - 或專案的 Auth 設定不完整（例如多租戶/Provider 設定缺失）。

因此，任何 admin.auth().getUser 或 createUser 都會因為後端 Auth 未設定而報 500。

## 我已做的程式修復（無痛降級）
我已在 index.js 的 `loginWithPin` 中加入 fallback：
- 當捕捉到 `auth/configuration-not-found`（或訊息含 configuration not found）時：
  - 跳過 getUser/createUser 這一步；
  - 直接使用 `admin.auth().createCustomToken(authUid, {...})` 來簽發自訂 Token。
- 這能避免 500，讓你先不開 Auth 的情況下也能把流程走完，持續驗證 Firestore 與前端串接。

此變更不影響既有功能；等你把 Auth 配好後，它會自動恢復正常的 getUser/createUser 流程。

建議你部署指定函數後再測：
- firebase deploy --only functions:loginWithPin

若部署成功，前端再試一次登入，觀察會不會拿到 200 與 customToken。

## 從根本解決（建議）
要讓 getUser/createUser 正常運作，請把專案的 Auth 配起來：

1) 在 Firebase Console 啟用 Auth
- 進到 Firebase Console > Authentication
- 點「Get started」啟用
- 至 Providers 先開啟 Email/Password（就算目前不用 Email 登入，也能讓整體 Auth 初始化完成）

2) 在 GCP 啟用 Identity Toolkit API
- 打開 Google Cloud Console > APIs & Services > Library
- 搜尋「Identity Toolkit API」，按 Enable
- 確認沒有被組織政策阻擋

3) 再次部署並測試
- firebase deploy --only functions:loginWithPin
- 然後用你剛才的帳號再登一次，看日誌中是否還有 configuration-not-found

## 若仍需要查日誌
- Firebase CLI：firebase functions:log --only loginWithPin
- gcloud（限定時間與數量，因為你是 Gen 2，仍可用 functions logs read 指令查到）： 
  gcloud functions logs read loginWithPin --region=us-central1 --limit=50 --start-time="2025-10-15T00:00:00Z" --end-time="2025-10-15T23:59:59Z"

提示：
- 你目前的函數為 Functions Gen 2，實際運行於 Cloud Run（日誌中可看到 a.run.app 的 URL）。這是正常的，仍然使用 Cloud Functions 的開發部署方式與命名，但背後執行平台是 Cloud Run。

## 小結
- 錯誤的直接原因是後端 Auth 未初始化（configuration-not-found）。
- 我已在程式內加入防護，遇到該錯誤就跳過 getUser/createUser，直接簽發 customToken，避免 500。
- 要從根本修好：在 Firebase Console 啟用 Authentication，並在 GCP 啟用 Identity Toolkit API，再部署一次。

要不要我幫你現在就部署這個函數，或協助檢查專案的 API 啟用狀態？

已進行變更。
```

# 第二步
## 案的 Firebase Authentication 沒「Get started」初始化，Identity Toolkit 就會回 400 並給 auth/configuration-not-found。

搜尋符合 `**/src/**/authService.js`、2 相符的檔案

讀取 [](file:///d%3A/mybazaar20/src/services/authService.js#1-1)，1 至 220 行

讀取 [](file:///d%3A/mybazaar20/src/config/firebase.js)

我看了你新的截圖與 log，現在的錯誤核心已經很明確：前端在呼叫 Identity Toolkit 的 signInWithCustomToken 時回 400，錯誤碼是 auth/configuration-not-found。這代表「專案的 Firebase Authentication 尚未初始化/啟用」，不是 Cloud Function 端的程式錯誤。

下面給你一步到位的修復步驟與驗證方式。

### 需要做的事

1)*** 在 Firebase Console 啟用 Authentication***
- 進到 Firebase Console > 選擇專案 mybazaar-c4881
- 左側選單：Build > Authentication
- 點「Get started」初始化
- 至「Sign-in method」頁籤，先啟用任一個提供者（建議 Email/Password），按「Save」
- 等 1–3 分鐘讓設定生效

2) 確認必要 API 都有啟用
在 PowerShell 執行（請先確保 gcloud 的專案是 mybazaar-c4881）：
```powershell
gcloud config set project mybazaar-c4881
gcloud services enable identitytoolkit.googleapis.com
gcloud services enable iamcredentials.googleapis.com
```

3) 確認 Functions 執行服務帳號有簽 Token 的權限
你之前已做過，補上核對命令（可選）：
```powershell
gcloud projects get-iam-policy mybazaar-c4881 --format="table(bindings.role, bindings.members)"
```
若看不到 1069326034581-compute@developer.gserviceaccount.com 具備 roles/iam.serviceAccountTokenCreator，可補授：
```powershell
gcloud projects add-iam-policy-binding mybazaar-c4881 `
  --member="serviceAccount:1069326034581-compute@developer.gserviceaccount.com" `
  --role="roles/iam.serviceAccountTokenCreator"
```

4) 檢查前端連到的專案是同一個
你的 firebase.js 使用的是：
- projectId: mybazaar-c4881
- apiKey: AIza...6wQ

請到 Firebase Console > Project settings > General > 你的 Web app，確認 Web API Key 與專案 ID 與檔案一致。若曾複製到別的專案的 key，就會出現 configuration-not-found。

5) 再測一次登入
- 前端重新整理或清掉快取後重試
- 若想保險，可重新部署函數（通常不必要）：
```powershell
firebase deploy --only functions:loginWithPin
```

預期：不再出現 auth/configuration-not-found，也不會再看到 identitytoolkit 400。


```

### 為什麼會變成這個錯誤？
- 先前的 signBlob/配置錯誤已逐步排除，現在流程能走到「前端用 custom token 登入」這一步。
- 但若專案的 Firebase Authentication 沒「Get started」初始化，Identity Toolkit 就會回 400 並給 auth/configuration-not-found。
- 啟用後就會正常接受 custom token。

如果你完成上面 1–4 步後還看到同樣錯誤，請回覆：
- Firebase Console 的 Authentication 截圖（顯示已啟用且至少一個 provider On）
- Project settings > General 的 Web API Key 與你 firebase.js 的比對
我再幫你精準追。


