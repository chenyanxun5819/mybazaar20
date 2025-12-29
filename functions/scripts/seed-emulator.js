/*
  種資料到 Firestore Emulator：
  - 來源：markdown/任務階段記錄/firestore_架構更新正确版.json
  - 結構：organizations -> events 子集合 -> users 子集合
  使用方式：
    1) 先啟動 Emulator（至少要有 firestore）
    2) 在專案根目錄執行：node functions/scripts/seed-emulator.js
*/

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

// 指向本機 Firestore Emulator
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';

// 以專案 ID 初始化（Emulator 模式下不需要憑證）
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'mybazaar-c4881' });
}

const db = admin.firestore();

async function seed() {
  const jsonPath = path.resolve(__dirname, '../../markdown/任務階段記錄/firestore_架構更新正确版.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('找不到資料檔案：', jsonPath);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(raw);

  const orgs = data.organizations || {};
  let orgCount = 0, eventCount = 0, userCount = 0;

  for (const [orgId, orgDoc] of Object.entries(orgs)) {
    const { events: eventsMap = {}, ...orgFields } = orgDoc;

    // 寫入 organization 文件（不含 events Map，events 以子集合方式寫入）
    await db.collection('organizations').doc(orgId).set(orgFields, { merge: true });
    orgCount++;

    // 處理 events 子集合
    for (const [eventId, eventDoc] of Object.entries(eventsMap)) {
      const { users: usersMap = {}, ...eventFields } = eventDoc;
      await db.collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .set(eventFields, { merge: true });
      eventCount++;

      // 處理 users 子集合
      for (const [userId, userDoc] of Object.entries(usersMap)) {
        // 某些 JSON 末尾可能有非文件鍵（例如 updatedAt），過濾非 object 或特殊鍵
        if (!userDoc || typeof userDoc !== 'object') continue;
        if (userId === 'updatedAt') continue;

        await db.collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('users').doc(userId)
          .set(userDoc, { merge: true });
        userCount++;
      }
    }
  }

  console.log(`Seeding 完成：orgs=${orgCount}, events=${eventCount}, users=${userCount}`);
}

seed().then(() => process.exit(0)).catch((e) => {
  console.error('Seeding 發生錯誤：', e);
  process.exit(1);
});
