**這個指令語法基本正確，但內容有誤：`allowedValues: - is:public` 是無效的設定值，因為 `constraints/iam.allowedPolicyMemberDomains` 只接受「已驗證網域」名稱，例如 `mybazaar.my`，而不是 `is:public`。**

---

### ✅ 正確用途與格式說明

#### 1. **constraint 名稱**
- `constraints/iam.allowedPolicyMemberDomains` 是用來限制 IAM 成員的網域來源。
- 它只接受「已驗證的 Google Workspace 網域」，例如：
  ```yaml
  allowedValues:
    - mybazaar.my
    - openapply.com
  ```

#### 2. **錯誤的設定值：`is:public`**
- `is:public` 是某些 constraint（如 `constraints/run.invoker`) 的特殊值，但**不是** `iam.allowedPolicyMemberDomains` 的合法值。
- 根據 [Google 官方文件](https://cloud.google.com/resource-manager/docs/organization-policy/restricting-domains?hl=zh-cn)，這個 constraint 只接受已驗證網域名稱。

---

### 🛠️ 修正建議

如果你想限制 IAM 成員只能來自 `mybazaar.my`，請改成：

```yaml
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allowedValues:
    - mybazaar.my
  inheritFromParent: false
```

然後執行：

```powershell
@"
constraint: constraints/iam.allowedPolicyMemberDomains
listPolicy:
  allowedValues:
    - mybazaar.my
  inheritFromParent: false
"@ | Out-File -FilePath org-policy.yaml -Encoding UTF8

gcloud resource-manager org-policies set-policy org-policy.yaml `
  --project=mybazaar-c4881
```

⚠️ 注意：這個 constraint 通常是設定在「組織層級」，而不是專案層級。如果組織層級已強制設定，你在專案層級設定可能會被忽略或拒絕。

---

### 📌 建議下一步

- ✅ 確認你是否要在「專案層級」設定，還是「組織層級」恢復原本限制。
- ✅ 若要回復組織層級限制，請使用：
  ```bash
  gcloud resource-manager org-policies set-policy org-policy.yaml \
  --organization=573196018254
  ```

---

Wes，如果你想恢復原本的限制（只允許來自 `mybazaar.my` 的帳號），我可以幫你產出一份完整的 `policy.yaml` 模板，並確認是否需要加上 `enforced: true` 或 `etag`。要我幫你整理嗎？