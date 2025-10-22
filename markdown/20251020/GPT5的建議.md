先幫你把選項攤開說清楚，然後給到位的做法與指令，讓你可以選「直接修 IAM 一次到位」或「先用 Emulator 快速開發，之後一次處理 IAM」。

## 你現在的 403 是什麼
- 你的 HTTP 函式 `loginEventManagerHttp` 是 Gen2（Cloud Run 服務），而且 invoker 設為 private。
- 前端走 `/api/loginEventManagerHttp` → Firebase Hosting rewrite → Hosting 要去呼叫 Cloud Run，但因為缺少「Cloud Run Invoker」授權給 Hosting 的服務身分，Cloud Run 回 403。
- 所以不是程式或 CORS 問題，是 IAM 連結沒打通。

## A. 你是 Org Admin，直接修 IAM（可以不用 Emulator）
這條路一旦打通，開發與上線都用同一條鏈路，最一致、省麻煩。

你要做的是把「Firebase Hosting 的服務帳號」加到 Cloud Run 服務（logineventmanagerhttp-...）的 IAM，給「Cloud Run Invoker」角色。常見做法有兩種：

- 最簡單但較寬鬆：把該 Cloud Run 服務設為「公開存取」（allUsers → roles/run.invoker）。
  - 優點：立刻通。
  - 缺點：對外可直打 Cloud Run 端點（仍可靠你在程式裡限制方法/來源/資料校驗，但從資安角度較寬鬆）。
  - 若你 Org Policy 原本擋 public，需要先在組織政策放行這個服務的例外。

- 安全且推薦：授權 Firebase Hosting 的服務代理帳號作 Invoker。
  - 去 Cloud Console → Cloud Run → 找你的服務 logineventmanagerhttp-… → 權限（Permissions）→ Grant access
  - 新增主體（principal），角色選「Cloud Run Invoker」
  - 主體要選「Firebase Hosting 服務代理帳號」。在 UI 搜尋時通常可以找到「Firebase Hosting service agent」。
  - 如 UI 找不到，請檢查：
    - 專案是否已啟用 Firebase Hosting API（通常 deploy Hosting 時會啟用）
    - 在「IAM 與管理員」→「服務帳號」搜尋 hosting 字樣
  - 若你們組織有「網域限制分享（Domain Restricted Sharing）」政策，可能會擋掉 Google-managed 的 system service account（例如 firebase-hosting@system.gserviceaccount.com 或 gcp-sa-firebasehosting 這類），要在 Org Policy 為「這個服務帳號」或「這個服務」加例外，或由管理員在上層放行。

可選（但未必必要）的 CLI 方式（需已存在對應主體）：
```powershell
# 先拿到專案編號
gcloud projects describe mybazaar-c4881 --format="value(projectNumber)"

# 授權（以下主體需依你實際可用的 Hosting 服務帳號為準）
gcloud run services add-iam-policy-binding logineventmanagerhttp `
  --region us-central1 `
  --project mybazaar-c4881 `
  --member="serviceAccount:service-<PROJECT_NUMBER>@gcp-sa-firebasehosting.iam.gserviceaccount.com" `
  --role="roles/run.invoker"
```
如果出現「服務帳號不存在」或「不屬於允許的客戶」之類訊息，表示該 system SA 尚未建立或被組織政策擋下。改從 Console UI 挑選「Firebase Hosting service agent」通常較不會出錯；若仍被 Org Policy 擋，請在 Org Policy 增加例外。

結論：如果你能直接調整 IAM / Org Policy，這是最好且未來最省事的路，基本不需要 Emulator。

## B. 先用 Emulator 開發（最快速、今天就能跑），之後一次處理 IAM
- 在開發階段，Emulator 不受 IAM/Org Policy 限制，前端同源代理到本機 Hosting Emulator → Functions Emulator → Firestore Emulator，全都在本機網路內，零 CORS、零 403。
- 等功能穩了，再由你一次調整 IAM/Org Policy，上線時就不會再卡。

你問「是不是要把資料移到 Emulator？」答案：不用「移」，只要「種測試資料」即可。我已幫你加了種資料腳本，會用你附件的 JSON。

- 檔案：seed-emulator.js
- 使用：
  1) 啟動 emulator（至少 hosting、functions、firestore、auth）
     ```powershell
     firebase emulators:start --only hosting,functions,firestore,auth
     ```
  2) 另開終端執行種資料
     ```powershell
     node functions/scripts/seed-emulator.js
     ```
     會從 firestore_架構更新正确版.json 匯入 organizations/events/users 結構。
  3) 啟動前端，讓代理走本機 Hosting Emulator（我已改好 vite.config.js）
     ```powershell
     $env:VITE_USE_EMULATOR="1"
     npm run dev
     ```
     這時前端呼叫 `http://localhost:5173/api/loginEventManagerHttp`，由 Vite → 本機 Hosting Emulator → Functions Emulator，不會有 403/CORS。

注意：你附的 JSON 只有雜湊密碼，未必知道明文。要快速測登入，可在 Emulator UI 直接呼叫我們的 `createEventManager` callable 建一個可登入的 EM（我在程式裡有測試模式跳過權限），或自己在 Emulator 裡改一筆使用者的 `passwordSalt/passwordHash`。

## 你應該選哪一條？
- 如果你現在就能（且願意）在組織層調整 IAM/Org Policy：直接走 A，永續解決，最省事。
- 如果你想先把功能衝起來，不想卡在權限：先走 B（Emulator），等完成後一次處理 IAM。未來部署只要把「Cloud Run Invoker」授權給「Firebase Hosting 服務代理帳號」就好，程式與前端不需要改。

## 小結
- loginEventManager（callable）可以暫留；等 HTTP 版穩定再刪，避免中間沒有後備方案。
- 403 的根因是 IAM，不是 CORS/程式問題。
- 你是 Org Admin，建議直接修 IAM（給 Hosting 的服務身分 roles/run.invoker），就能不用 Emulator。
- 若要先用 Emulator 開發，我已幫你準備好「一鍵種資料」腳本與代理切換；上線前你只需要在一次調整 IAM，之後不會再遇到 403。

需要的話，我也可以幫你提供 Cloud Console 的逐步截圖路徑（Cloud Run → 服務 → 權限 → 加「Firebase Hosting service agent」→ 賦予「Cloud Run Invoker」），或協助你設定前端 firebase 連 Emulator 的設定切換。