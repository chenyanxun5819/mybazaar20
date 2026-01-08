## Copilot / AI Agent Instructions for mybazaar20

Purpose: help an AI coding agent become immediately productive in this repository. Focus on the project's architecture, developer workflows, conventions, integration points and concrete examples.

- Repository high-level: frontend is a Vite + React app under `src/` (entry points, views, components). Backend uses Firebase Cloud Functions in `functions/`. Firebase services used: Authentication, Firestore and Cloud Functions. Hosting is configured to serve `dist/` produced by `vite build`.

- Key files to read first:
  - `src/config/firebase.js` — Firebase app initialization, `auth`, `db`, `functions` (region `asia-southeast1`) exports. Any work touching Firebase should refer to this file.
  - `src/views/auth/PhoneOtpLogin.jsx` — current phone OTP flow and reCAPTCHA handling. This is the main area where Firebase Auth client logic lives and where most recent edits occurred.
  - `functions/admin.js` — large collection of admin-related Cloud Functions (callables and HTTP endpoints). Contains phone auth helper functions (`sendPhoneAuthOtp`, `verifyPhoneOtp`, `authWithPhoneOtp`), normalization `normalizeE164`, and admin authorization logic.
  - `functions/index.js` — functions export entry (check which functions are exported and region settings).

- Big-picture architecture & flow:
  - Frontend (Vite + React) calls Firebase Auth client SDK for Phone sign-in (`signInWithPhoneNumber`) and interacts with Firebase Cloud Functions (callable and HTTP) for server-side operations.
  - Cloud Functions live in `functions/` and use the Firebase Admin SDK to read/write Firestore and create custom tokens. `phoneAuthSessions` is the Firestore collection used to store OTP sessions when applicable.
  - Hosting serves the built `dist/` from Vite. `npm run build` runs `vite build`; `firebase deploy --only hosting` deploys the output.

- Developer workflows & useful commands:
  - Local dev build: `npm run dev` (if configured) or `vite` for local dev server.
  - Production build: `npm run build` (produces `dist/`).
  - Deploy hosting: `firebase deploy --only hosting` (must be authenticated with Firebase CLI using a user that has project permissions).
  - Deploy functions: `firebase deploy --only functions` (if you change functions, deploy them separately).
  - Tests: repository currently does not include automated test suites — add unit tests under `__tests__` if needed.

- Project-specific conventions & patterns:
  - Phone numbers are normalized to E.164 for Malaysia (+60) by helper functions both on client and server. When editing phone logic, follow `formatPhoneNumber` (client) and `normalizeE164` (server).
  - Cloud Functions mix both callable (`functions.https.onCall`) and HTTP (`functions.https.onRequest`) entry points; check `functions/admin.js` for examples.
  - Error handling: functions throw `functions.https.HttpsError` with codes; front-end parses `error.code` or `customData.serverResponse` in some cases. When adding errors, use these patterns for compatibility.
  - `auth` usage: client uses Firebase Auth's phone sign-in; server sometimes issues custom tokens with `admin.auth().createCustomToken(userId)` for session migration — preserve this pattern where applicable.

- Integration points and external dependencies:
  - Firebase project config is in `src/config/firebase.js` — includes `apiKey`, `authDomain`, `projectId`, and uses `getFunctions(app, 'asia-southeast1')`.
  - reCAPTCHA Enterprise integration is controlled via Firebase Console > Authentication > Settings (reCAPTCHA config). Domain whitelists and API key restrictions can cause `INVALID_APP_CREDENTIAL` and other failures.
  - If you change reCAPTCHA or phone auth behavior, update both client (`PhoneOtpLogin.jsx`) and server (`functions/admin.js`) and consider API key/referrer settings in Google Cloud Console.

- Debugging tips and concrete examples:
  - When OTP send fails, open DevTools Network tab and inspect POST to `https://identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=...` — response JSON often contains `error.message` (e.g. `INVALID_APP_CREDENTIAL`, `TOO_MANY_ATTEMPTS_TRY_LATER`) which is the authoritative reason.
  - The codebase already includes a `debug bar` in the phone login page capturing `lastErrorJson`. Use the "复制错误详情" button to copy the full response.
  - To reproduce locally without SMS costs use Firebase Console → Authentication → Phone → add a test phone number + test code. This bypasses SMS sending.

- What to avoid / gotchas:
  - Do NOT mix API keys / authDomain from different Firebase projects. `apiKey` must match the `authDomain`/project used by functions.
  - Be careful when re-initializing `RecaptchaVerifier` — multiple widgets or clearing at wrong time causes runtime errors. `PhoneOtpLogin.jsx` has patterns to clear and reinitialize the verifier — follow that style.
  - Do not change unrelated files or reformat entire files in small patches — keep diffs minimal and focused.

- Suggested first tasks for an AI agent entering this repo:
  1. Read `src/config/firebase.js`, `src/views/auth/PhoneOtpLogin.jsx`, and `functions/admin.js` end-to-end to understand phone auth flow.
  2. Run `npm run build` locally to validate the changes compile; if touching hosting, run `firebase deploy --only hosting` to publish.
  3. When debugging OTP issues, replicate with a test phone number in Firebase Console first.

- If you modify Cloud Functions:
  - Run `firebase deploy --only functions` to publish only functions.
  - Inspect logs with `firebase functions:log` (or in Firebase Console) for runtime errors.

If anything in this file is unclear or you want more examples (e.g., how to write a safe unit test for `normalizeE164`), tell me which area to expand and I will update this file.
