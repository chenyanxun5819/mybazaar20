### 2) 為什麼 gcloud 查不到函數日誌？正確查法
你之前看到「There is no function named loginWithPin in region us-central1」有兩個關鍵原因：
- gcloud 預設 project 不是 mybazaar-c4881（你先前的指令其實打到別的專案）
- 你的函數是 Gen 2，需加上 --gen2 或改用 Cloud Run 日誌

請用下面的查詢方式：

- 確認專案
```powershell
gcloud config set project mybazaar-c4881
```

- 讀取 Functions Gen 2 日誌（注意 --gen2）
```powershell
gcloud functions logs read loginWithPin --gen2 --region=us-central1 --limit=50
```

- 也可以直接看 Cloud Run（Gen 2 背後就是 Cloud Run；服務名通常小寫）
```powershell
gcloud run services list --region=us-central1
gcloud run logs read loginwithpin --region=us-central1 --limit=50
```

- 需要時間範圍：
```powershell
gcloud functions logs read loginWithPin --gen2 --region=us-central1 --start-time="2025-10-15T00:00:00Z" --end-time="2025-10-15T23:59:59Z"
```


先幫你把兩個問題一次搞定：為什麼「Listed 0 items」和為什麼「gcloud run logs read」報錯，以及給你可用的正確指令。

## 為什麼會「Listed 0 items」
- 你用的是 UTC 時間窗：2025-10-15T15:35:00Z～23:59:59Z，但你的日誌時間其實在 06:52Z 左右，所以自然查不到任何項目。
- 解法：改用含 06:00–08:00Z 的時間窗，或直接不帶時間，用 limit 取最近的。

可用指令（Functions Gen 2）：
- 最近 50 筆（不帶時間窗）
```powershell
gcloud functions logs read loginWithPin --gen2 --region=us-central1 --limit=50
```
- 指定正確的 UTC 時間窗（依你的日誌在 06:52Z）
```powershell
gcloud functions logs read loginWithPin --gen2 --region=us-central1 --start-time="2025-10-15T06:00:00Z" --end-time="2025-10-15T08:00:00Z"
```
- 即時追蹤
```powershell
gcloud functions logs tail loginWithPin --gen2 --region=us-central1
```

若還是空的，先確認專案與區域：
```powershell
gcloud config get-value project
gcloud functions list --gen2 --region=us-central1
```
應該要看到 loginWithPin；如果看不到，多半是 project 或 region 不對。

## 為什麼「gcloud run logs read」會報錯
- 正確的子指令是「services logs read」，不是「run logs read」。
- 你的 Functions Gen 2 背後的 Cloud Run 服務名通常是全小寫（你日誌裡是 loginwithpin）。

可用指令（Cloud Run 服務層）：
- 列出服務名（確認 service name）
```powershell
gcloud run services list --region=us-central1
```
- 讀取最近 50 筆服務日誌
```powershell
gcloud run services logs read loginwithpin --region=us-central1 --limit=50
```
- 指定時間窗（UTC）
```powershell
gcloud run services logs read loginwithpin --region=us-central1 --start-time="2025-10-15T06:00:00Z" --end-time="2025-10-15T08:00:00Z"
```

## 萬用備案（直接查 Cloud Logging）
即使上述指令有阻礙，這個也能撈到：
```powershell
gcloud logging read `
  'resource.type="cloud_run_revision" AND resource.labels.service_name="loginwithpin" AND resource.labels.location="us-central1" AND timestamp>="2025-10-15T06:00:00Z" AND timestamp<="2025-10-15T08:00:00Z"' `
  --project=mybazaar-c4881 `
  --limit=50 `
  --format="value(textPayload)"
```

小提醒
- 所有時間是 UTC（Z 結尾）。你的錯誤截圖顯示 06:52Z；請把時間窗對準它。
- 先用 list 指令確認當前 project/region/service 名稱，再讀取日誌，成功率最高。

需要我幫你現在對準時間窗跑一次，或把 project/region 再檢查一下嗎？