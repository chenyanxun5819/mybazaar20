### 问题摘要
浏览器报错显示跨域预检（CORS preflight）失败：对 URL https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin 的请求从 origin http://localhost:5173 被阻止，因为响应没有包含 Access-Control-Allow-Origin 等跨域头，导致 httpsCallable 调用在网络层被拦截，进而客户端收到“Internal”/登录失败错误。

---

### 最可能的根因（按优先级）
- 客户端 Functions 实例初始化 region 或 firebaseConfig 错误，导致 SDK 构造了错误或不匹配的请求 URL（常见表现：请求指向 wrong domain / missing projectId），浏览器发起预检到该 URL，而服务器没有正确处理预检响应。
- 前端没有使用 Firebase Functions SDK 的 httpsCallable（或被代理/改写为直接 fetch 到 onRequest endpoint），而目标 endpoint 未设置 CORS 响应头。
- 页面 origin 与函数部署域/自定义域不匹配，且没有通过 Firebase Hosting rewrites 或后端设置正确的 CORS 头。
- 函数名或部署 region 与客户端调用不一致（例如客户端用 us-central1，但函数部署到别的 region，或 firebaseConfig projectId 错误），导致请求命中非 callable 端点或 404，被预检阻断。

---

### 立即可执行的修复（优先级与代码片段）

1. 保证客户端用正确的 Functions region（通常这是最常见问题）
- 在 src/config/firebase.js 确认并导出 functions 实例时显式指定 region 与你部署的 region（截图指明函数 URL 为 us-central1，因此示例用 us-central1）：
```js
// src/config/firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// 指定 region，与部署 region 保持一致（例如 us-central1）
export const functions = getFunctions(app, 'us-central1');
```
- 重新构建并在浏览器控制台打印 `functions` 看是否为有效对象（见调试步骤）。

2. 确保前端真的在用 httpsCallable（你代码显示已用）且没有被代理为普通 fetch
- 保持调用方式：
```js
const loginWithPinFn = httpsCallable(functions, 'loginWithPin');
await loginWithPinFn({...});
```
- 不要直接用 fetch 去调用 callable endpoint。若确实需要用 fetch 调用 onRequest 函数，必须在函数里设置 CORS header（见下一条）。

3. 仅当你必须使用 onRequest 或直接 fetch 时，在后端加上 CORS 处理（你的 loginWithPin 已是 onCall，不需要此处修改；仅示例给出）
```js
const cors = require('cors')({ origin: true });
exports.myOnRequest = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    // 处理请求并返回
    res.json({ ok: true });
  });
});
```

4. 检查 firebaseConfig（projectId / apiKey / authDomain）是否与已部署的 Cloud Functions 属于同一 Firebase 项目
- 若 projectId 错误，SDK 会构造错误主机名，导致预检失败。核对前端 firebaseConfig 与你 firebase deploy 的 project。

5. 如果使用自定义域或反向代理（nginx/Cloudflare），确保转发时没有移除或阻断 CORS 头，并且代理转发到正确 region 的函数。

---

### 简短调试清单（按顺序执行）
1. 在浏览器 Network 面板，定位失败的预检（OPTIONS）请求：查看 Request URL、Request headers（Origin）与 Response headers（看是否含 Access-Control-Allow-Origin）。
2. 在前端运行时，在调用 httpsCallable 之前加：
   - console.log('functions instance:', functions);
   - console.log('firebaseConfig projectId:', firebaseConfig.projectId);
   确认 functions 不是 undefined 且 region 与 URL 相符。
3. 检查 Network 中实际发出的请求 URL 是否形如:
   - https://us-central1-<PROJECT_ID>.cloudfunctions.net/loginWithPin
   如果 URL 缺少 projectId 或看起来不完整，说明前端 config 或 getFunctions 初始化错了。
4. 在终端运行 firebase functions:log 或在 GCP Logs 查看函数是否收到了请求（若未收到，说明请求被浏览器预检就阻断了）。
5. 若 Network 的 Response headers 缺少 CORS 头且你使用 onRequest，请在函数中加入 cors 代码并重新部署；若函数为 onCall，则优先检查客户端 region/config。

---

### 快速故障排除建议（最短路径）
- 如果你本地开发（localhost）并且函数部署在 us-central1：
  1. 确认 src/config/firebase.js 中 export 的 functions = getFunctions(app, 'us-central1').
  2. 重启 dev server（确保新 build 使用新 config）。
  3. 清除浏览器缓存并重试登录，看是否还报 CORS。

---

### 我可以马上继续做的事
把你项目里的 src/config/firebase.js 内容贴上来，或把 Network 面板中失败请求的 Request URL、Request headers（尤其 Origin 与 Host）与 Response headers（如果有）复制过来，我会直接指出哪一处配置错，提供精确的修改代码并说明该如何重新部署/重建。