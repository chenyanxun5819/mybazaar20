// functions/src/eventManager/grantPointsByEventManagerHttp.js
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const cors = require('cors');

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
 * Event Manager 赠送点数给 Customer（按 identityTag 批量赠送）
 * HTTP Endpoint
 * 
 * @param {Object} request.body
 * @param {string} request.body.organizationId - 组织ID
 * @param {string} request.body.eventId - 活动ID
 * @param {string} request.body.identityTag - 身份标签（例如：'student', 'teacher'）
 * @param {number} request.body.points - 赠送点数
 * @param {string} request.body.note - 备注（可选）
 * 
 * @returns {Object} { success: true, grantedCount: number, totalPoints: number, userIds: string[] }
 */
exports.grantPointsByEventManagerHttp = onRequest(
  { region: 'asia-southeast1', timeoutSeconds: 540 },
  (req, res) => {
    corsHandler(req, res, async () => {
      console.log('[grantPointsByEventManager] 开始处理赠送请求');

      try {
        // 1. 验证请求方法
        if (req.method !== 'POST') {
          return res.status(405).json({
            error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
          });
        }

        // 2. 获取请求参数
        const { organizationId, eventId, identityTag, points, note } = req.body;

        console.log('[grantPointsByEventManager] 参数:', {
          organizationId,
          eventId,
          identityTag,
          points,
          note: note || '(无)'
        });

        // 3. 验证必需参数
        if (!organizationId || !eventId) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '缺少 organizationId 或 eventId' }
          });
        }

        if (!identityTag) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '缺少 identityTag' }
          });
        }

        if (!points || points <= 0) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '点数必须大于 0' }
          });
        }

        // 4. 验证调用者是否为 Event Manager
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '缺少身份验证' }
          });
        }

        const token = authHeader.split('Bearer ')[1];
        let decodedToken;
        
        try {
          decodedToken = await admin.auth().verifyIdToken(token);
        } catch (error) {
          console.error('[grantPointsByEventManager] Token 验证失败:', error);
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '身份验证失败' }
          });
        }

        const callerUid = decodedToken.uid;
        console.log('[grantPointsByEventManager] 调用者 UID:', callerUid);

        // 5. 检查调用者是否为 Event Manager
        const db = getDb();
        const userRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${callerUid}`);
        const userSnap = await userRef.get();

        if (!userSnap.exists) {
          return res.status(403).json({
            error: { code: 'permission-denied', message: '用户不存在于当前活动' }
          });
        }

        const userData = userSnap.data();
        const isEventManager = userData.roles && userData.roles.includes('eventManager');

        if (!isEventManager) {
          return res.status(403).json({
            error: { code: 'permission-denied', message: '只有 Event Manager 可以赠送点数' }
          });
        }

        console.log('[grantPointsByEventManager] ✅ Event Manager 权限验证通过');

        // 6. 查询符合条件的 Customer 用户
        const usersRef = db.collection(`organizations/${organizationId}/events/${eventId}/users`);
        const query = usersRef
          .where('roles', 'array-contains', 'customer')
          .where('identityTag', '==', identityTag);

        const usersSnapshot = await query.get();

        if (usersSnapshot.empty) {
          return res.status(404).json({
            error: { code: 'not-found', message: `没有找到 identityTag 为 ${identityTag} 的 Customer` }
          });
        }

        console.log(`[grantPointsByEventManager] 找到 ${usersSnapshot.size} 个符合条件的用户`);

        // 7. 批量赠送点数
        const batch = db.batch();
        const timestamp = admin.firestore.FieldValue.serverTimestamp();
        const grantedUserIds = [];
        let _transactionCount = 0; // prefixed to avoid unused-var lint

        for (const userDoc of usersSnapshot.docs) {
          const userId = userDoc.id;
          const userRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${userId}`);

          // 更新 Customer 的 availablePoints
          batch.update(userRef, {
            'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(points),
            'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(points),
            'customer.stats.lastActivityAt': timestamp
          });

          // 创建交易记录
          const transactionId = db.collection(`organizations/${organizationId}/events/${eventId}/transactions`).doc().id;
          const transactionRef = db.doc(`organizations/${organizationId}/events/${eventId}/transactions/${transactionId}`);

          batch.set(transactionRef, {
            transactionId,
            transactionType: 'free_grant',
            organizationId,
            eventId,
            fromUserId: callerUid,
            fromRole: 'eventManager',
            toUserId: userId,
            toRole: 'customer',
            amount: points,
            note: note || '组织赠送',
            status: 'completed',
            timestamp: timestamp,
            metadata: {
              grantedBy: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || 'Event Manager',
              identityTag: identityTag,
              source: 'event_manager_grant'
            }
          });

          grantedUserIds.push(userId);
          _transactionCount++;
        }

        // 8. 提交批量操作
        await batch.commit();

        console.log(`[grantPointsByEventManager] ✅ 成功赠送给 ${grantedUserIds.length} 个用户`);

        // 9. 返回成功响应
        return res.status(200).json({
          success: true,
          grantedCount: grantedUserIds.length,
          totalPoints: points * grantedUserIds.length,
          pointsPerUser: points,
          identityTag: identityTag,
          userIds: grantedUserIds,
          message: `成功赠送 ${points} 点数给 ${grantedUserIds.length} 个用户`
        });

      } catch (error) {
        console.error('[grantPointsByEventManager] 错误:', error);
        return res.status(500).json({
          error: {
            code: 'internal',
            message: error.message || '赠送点数失败'
          }
        });
      }
    });
  }
);