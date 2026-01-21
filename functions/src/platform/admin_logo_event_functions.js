const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const cors = require('cors');

// 配置允許的來源
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://mybazaar-c4881.web.app',
  'https://mybazaar-c4881.firebaseapp.com'
];

const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

function getDb() {
  return admin.firestore();
}

/**
 * 檢查是否為 Platform Admin
 */
async function checkPlatformAdmin(callerUid) {
  if (!callerUid) return false;
  
  const db = getDb();
  try {
    const adminDoc = await db.collection('admin_uids').doc(callerUid).get();
    return adminDoc.exists;
  } catch (error) {
    console.error('[checkPlatformAdmin] Error:', error);
    return false;
  }
}

// ========== 1. 更新組織 Logo ==========

/**
 * 更新組織 Logo URL
 * HTTP Endpoint: updateOrganizationLogoHttp
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   logoUrl: string (Storage URL)
 * }
 */
exports.updateOrganizationLogoHttp = onRequest(
  { region: 'asia-southeast1', cors: true },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      try {
        console.log('[updateOrganizationLogoHttp] 開始處理請求');

        // ========== 步驟 1: 驗證請求方法 ==========
        if (req.method !== 'POST') {
          return res.status(405).json({ error: '僅支持 POST 請求' });
        }

        // ========== 步驟 2: 獲取 caller UID ==========
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: '未授權：缺少 token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let callerUid;
        try {
          const decodedToken = await admin.auth().verifyIdToken(idToken);
          callerUid = decodedToken.uid;
        } catch (error) {
          console.error('[updateOrganizationLogoHttp] Token 驗證失敗:', error);
          return res.status(401).json({ error: '未授權：無效的 token' });
        }

        // ========== 步驟 3: 驗證 Platform Admin 權限 ==========
        const isPlatformAdmin = await checkPlatformAdmin(callerUid);
        if (!isPlatformAdmin) {
          return res.status(403).json({ error: '權限不足：需要 Platform Admin 權限' });
        }

        // ========== 步驟 4: 解析請求參數 ==========
        const { organizationId, logoUrl } = req.body;

        if (!organizationId) {
          return res.status(400).json({ error: '缺少 organizationId' });
        }

        if (!logoUrl) {
          return res.status(400).json({ error: '缺少 logoUrl' });
        }

        console.log('[updateOrganizationLogoHttp] 參數:', { organizationId, logoUrl });

        // ========== 步驟 5: 更新 Firestore ==========
        const db = getDb();
        const orgRef = db.collection('organizations').doc(organizationId);

        // 檢查組織是否存在
        const orgDoc = await orgRef.get();
        if (!orgDoc.exists) {
          return res.status(404).json({ error: '組織不存在' });
        }

        // 更新 logo 相關字段
        await orgRef.update({
          logoUrl: logoUrl,
          logoUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          logoUpdatedBy: callerUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[updateOrganizationLogoHttp] ✅ Logo 更新成功');

        // ========== 步驟 6: 返回成功響應 ==========
        return res.status(200).json({
          success: true,
          message: '組織 logo 更新成功',
          data: {
            organizationId,
            logoUrl
          }
        });

      } catch (error) {
        console.error('[updateOrganizationLogoHttp] ❌ 錯誤:', error);
        return res.status(500).json({
          error: '更新失敗',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  }
);

// ========== 2. 更新活動 Logo ==========

/**
 * 更新活動 Logo URL
 * HTTP Endpoint: updateEventLogoHttp
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   eventId: string,
 *   logoUrl: string (Storage URL)
 * }
 */
exports.updateEventLogoHttp = onRequest(
  { region: 'asia-southeast1', cors: true },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      try {
        console.log('[updateEventLogoHttp] 開始處理請求');

        // ========== 步驟 1: 驗證請求方法 ==========
        if (req.method !== 'POST') {
          return res.status(405).json({ error: '僅支持 POST 請求' });
        }

        // ========== 步驟 2: 獲取 caller UID ==========
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: '未授權：缺少 token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let callerUid;
        try {
          const decodedToken = await admin.auth().verifyIdToken(idToken);
          callerUid = decodedToken.uid;
        } catch (error) {
          console.error('[updateEventLogoHttp] Token 驗證失敗:', error);
          return res.status(401).json({ error: '未授權：無效的 token' });
        }

        // ========== 步驟 3: 驗證 Platform Admin 權限 ==========
        const isPlatformAdmin = await checkPlatformAdmin(callerUid);
        if (!isPlatformAdmin) {
          return res.status(403).json({ error: '權限不足：需要 Platform Admin 權限' });
        }

        // ========== 步驟 4: 解析請求參數 ==========
        const { organizationId, eventId, logoUrl } = req.body;

        if (!organizationId || !eventId) {
          return res.status(400).json({ error: '缺少 organizationId 或 eventId' });
        }

        if (!logoUrl) {
          return res.status(400).json({ error: '缺少 logoUrl' });
        }

        console.log('[updateEventLogoHttp] 參數:', { organizationId, eventId, logoUrl });

        // ========== 步驟 5: 更新 Firestore ==========
        const db = getDb();
        const eventRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId);

        // 檢查活動是否存在
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) {
          return res.status(404).json({ error: '活動不存在' });
        }

        // 更新 logo 相關字段
        await eventRef.update({
          logoUrl: logoUrl,
          logoUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
          logoUpdatedBy: callerUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[updateEventLogoHttp] ✅ Logo 更新成功');

        // ========== 步驟 6: 返回成功響應 ==========
        return res.status(200).json({
          success: true,
          message: '活動 logo 更新成功',
          data: {
            organizationId,
            eventId,
            logoUrl
          }
        });

      } catch (error) {
        console.error('[updateEventLogoHttp] ❌ 錯誤:', error);
        return res.status(500).json({
          error: '更新失敗',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  }
);

// ========== 3. 更新活動詳情（日期和 Logo）==========

/**
 * 更新活動詳情
 * HTTP Endpoint: updateEventDetailsHttp
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   eventId: string,
 *   updates: {
 *     fairDate?: timestamp,
 *     consumptionPeriod?: { start: timestamp, end: timestamp },
 *     logoUrl?: string
 *   }
 * }
 */
exports.updateEventDetailsHttp = onRequest(
  { region: 'asia-southeast1', cors: true },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      try {
        console.log('[updateEventDetailsHttp] 開始處理請求');

        // ========== 步驟 1: 驗證請求方法 ==========
        if (req.method !== 'POST') {
          return res.status(405).json({ error: '僅支持 POST 請求' });
        }

        // ========== 步驟 2: 獲取 caller UID ==========
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: '未授權：缺少 token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let callerUid;
        try {
          const decodedToken = await admin.auth().verifyIdToken(idToken);
          callerUid = decodedToken.uid;
        } catch (error) {
          console.error('[updateEventDetailsHttp] Token 驗證失敗:', error);
          return res.status(401).json({ error: '未授權：無效的 token' });
        }

        // ========== 步驟 3: 驗證 Platform Admin 權限 ==========
        const isPlatformAdmin = await checkPlatformAdmin(callerUid);
        if (!isPlatformAdmin) {
          return res.status(403).json({ error: '權限不足：需要 Platform Admin 權限' });
        }

        // ========== 步驟 4: 解析請求參數 ==========
        const { organizationId, eventId, updates } = req.body;

        if (!organizationId || !eventId) {
          return res.status(400).json({ error: '缺少 organizationId 或 eventId' });
        }

        if (!updates || typeof updates !== 'object') {
          return res.status(400).json({ error: '缺少 updates 對象' });
        }

        console.log('[updateEventDetailsHttp] 參數:', { organizationId, eventId, updates });

        // ========== 步驟 5: 構建更新對象 ==========
        const db = getDb();
        const eventRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId);

        // 檢查活動是否存在
        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) {
          return res.status(404).json({ error: '活動不存在' });
        }

        const updateData = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        // 更新活動日期
        if (updates.fairDate) {
          updateData['eventInfo.fairDate'] = admin.firestore.Timestamp.fromMillis(updates.fairDate);
          updateData.eventDateUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // 更新消費期間
        if (updates.consumptionPeriod) {
          if (updates.consumptionPeriod.start) {
            updateData['eventInfo.consumptionPeriod.start'] = admin.firestore.Timestamp.fromMillis(updates.consumptionPeriod.start);
          }
          if (updates.consumptionPeriod.end) {
            updateData['eventInfo.consumptionPeriod.end'] = admin.firestore.Timestamp.fromMillis(updates.consumptionPeriod.end);
          }
          updateData.eventDateUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
        }

        // 更新 Logo
        if (updates.logoUrl) {
          updateData.logoUrl = updates.logoUrl;
          updateData.logoUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
          updateData.logoUpdatedBy = callerUid;
        }

        // ========== 步驟 6: 執行更新 ==========
        await eventRef.update(updateData);

        console.log('[updateEventDetailsHttp] ✅ 活動詳情更新成功');

        // ========== 步驟 7: 返回成功響應 ==========
        return res.status(200).json({
          success: true,
          message: '活動詳情更新成功',
          data: {
            organizationId,
            eventId,
            updatedFields: Object.keys(updateData).filter(k => k !== 'updatedAt')
          }
        });

      } catch (error) {
        console.error('[updateEventDetailsHttp] ❌ 錯誤:', error);
        return res.status(500).json({
          error: '更新失敗',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  }
);

// ========== 4. 刪除所有 Users 並重新指定 Event Manager ==========

/**
 * 刪除活動中的所有 users 並重新創建 Event Manager
 * HTTP Endpoint: resetEventUsersHttp
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   eventId: string,
 *   newEventManager: {
 *     chineseName: string,
 *     englishName: string,
 *     phoneNumber: string,
 *     email: string (可選),
 *     password: string
 *   }
 * }
 */
exports.resetEventUsersHttp = onRequest(
  { region: 'asia-southeast1', cors: true },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      try {
        console.log('[resetEventUsersHttp] 開始處理請求');

        // ========== 步驟 1: 驗證請求方法 ==========
        if (req.method !== 'POST') {
          return res.status(405).json({ error: '僅支持 POST 請求' });
        }

        // ========== 步驟 2: 獲取 caller UID ==========
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: '未授權：缺少 token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        let callerUid;
        try {
          const decodedToken = await admin.auth().verifyIdToken(idToken);
          callerUid = decodedToken.uid;
        } catch (error) {
          console.error('[resetEventUsersHttp] Token 驗證失敗:', error);
          return res.status(401).json({ error: '未授權：無效的 token' });
        }

        // ========== 步驟 3: 驗證 Platform Admin 權限 ==========
        const isPlatformAdmin = await checkPlatformAdmin(callerUid);
        if (!isPlatformAdmin) {
          return res.status(403).json({ error: '權限不足：需要 Platform Admin 權限' });
        }

        // ========== 步驟 4: 解析請求參數 ==========
        const { organizationId, eventId, newEventManager } = req.body;

        if (!organizationId || !eventId) {
          return res.status(400).json({ error: '缺少 organizationId 或 eventId' });
        }

        if (!newEventManager || !newEventManager.chineseName || !newEventManager.phoneNumber || !newEventManager.password) {
          return res.status(400).json({ 
            error: '缺少 newEventManager 資料（需要 chineseName, phoneNumber, password）' 
          });
        }

        console.log('[resetEventUsersHttp] 參數:', { 
          organizationId, 
          eventId, 
          eventManagerName: newEventManager.chineseName 
        });

        // ========== 步驟 5: 獲取活動資料 ==========
        const db = getDb();
        const eventRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId);

        const eventDoc = await eventRef.get();
        if (!eventDoc.exists) {
          return res.status(404).json({ error: '活動不存在' });
        }

        const _eventData = eventDoc.data();

        // ========== 步驟 6: 刪除所有 users ==========
        const usersRef = eventRef.collection('users');
        const usersSnapshot = await usersRef.get();

        console.log(`[resetEventUsersHttp] 找到 ${usersSnapshot.size} 個 users，開始刪除...`);

        // 使用 batch 刪除
        const batch = db.batch();
        usersSnapshot.docs.forEach(doc => {
          batch.delete(doc.ref);
        });

        await batch.commit();

        console.log('[resetEventUsersHttp] ✅ 所有 users 已刪除');

        // ========== 步驟 7: 創建新的 Event Manager ==========
        const crypto = require('crypto');
        
        function sha256(str) {
          return crypto.createHash("sha256").update(str).digest("hex");
        }

        // 生成 authUid 和密碼 hash
        const phoneDigits = newEventManager.phoneNumber.replace(/\D/g, '');
        const authUid = `eventManager_${phoneDigits}`;
        const passwordSalt = crypto.randomBytes(16).toString('hex');
        const passwordHash = sha256(newEventManager.password + passwordSalt);

        // 創建 Event Manager 文檔
        const newEventManagerRef = usersRef.doc(authUid);

        await newEventManagerRef.set({
          userId: authUid,
          authUid: authUid,
          roles: ['eventManager'],
          
          basicInfo: {
            chineseName: newEventManager.chineseName,
            englishName: newEventManager.englishName || '',
            phoneNumber: newEventManager.phoneNumber,
            email: newEventManager.email || '',
            identityTag: 'staff',
            department: 'management',
            passwordSalt: passwordSalt,
            passwordHash: passwordHash
          },

          eventManager: {
            permissions: {
              canViewAllData: true,
              canManageUsers: true,
              canManageDepartments: true,
              canViewFinancialData: true,
              canAllocatePoints: true,
              canViewTransactions: true
            },
            restrictions: {
              cannotDeleteSelf: true
            },
            monitoringScope: {
              allDepartments: true,
              allRoles: true,
              allTransactions: true
            }
          },

          pointsStats: {
            totalReceived: 0,
            totalAllocated: 0,
            currentBalance: 0,
            totalSold: 0
          },

          status: 'active',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          createdBy: callerUid
        });

        console.log('[resetEventUsersHttp] ✅ 新 Event Manager 已創建');

        // ========== 步驟 8: 更新 Event 文檔的 usersResetAt 字段 ==========
        await eventRef.update({
          usersResetAt: admin.firestore.FieldValue.serverTimestamp(),
          usersResetBy: callerUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        console.log('[resetEventUsersHttp] ✅ Event 文檔已更新');

        // ========== 步驟 9: 返回成功響應 ==========
        return res.status(200).json({
          success: true,
          message: '所有 users 已重置，新 Event Manager 已創建',
          data: {
            organizationId,
            eventId,
            deletedUsersCount: usersSnapshot.size,
            newEventManager: {
              authUid: authUid,
              name: newEventManager.chineseName,
              phoneNumber: newEventManager.phoneNumber
            }
          }
        });

      } catch (error) {
        console.error('[resetEventUsersHttp] ❌ 錯誤:', error);
        return res.status(500).json({
          error: '重置失敗',
          message: error.message,
          details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });
  }
);