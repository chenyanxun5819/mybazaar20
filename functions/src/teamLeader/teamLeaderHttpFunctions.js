/**
 * Team Leader HTTP Functions
 * 提供前端可调用的HTTP端点
 *
 * @version 2026-02-27 v4.0
 * - 删除 inventory 类型（SM 只做直销，即时收现金）
 * - SM 直销计入 globalPointsStats.totalSold / financeSummary.points.totalSold
 * @region asia-southeast1
 */

const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const cors = require('cors');

// CORS 配置
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://mybazaar-c4881.web.app',
  'https://mybazaar-c4881.firebaseapp.com',
  'https://system.mybazaar.my',
  'https://demo.mybazaar.my'
];

const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// ============================================================================
// HTTP Function: allocatePointsByteamLeader (SM 直销 - 即时收现金)
// ============================================================================

/**
 * Team Leader 直销点数给 Customer（即时收现金）
 *
 * 业务逻辑：
 * - SM 旗下 Seller 已售完 EM 分配的点数，有余裕可加值
 * - SM 收取等值现金，点数直接进入 customer.pointsAccount.availablePoints
 * - 计入 totalSold（非 totalAllocated），因为现金已即时收取
 *
 * @version 4.0
 * @date 2026-02-27
 */
exports.allocatePointsByTeamLeaderHttp = onRequest(
  {
    region: 'asia-southeast1',
    cors: allowedOrigins
  },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      const requestId = Math.random().toString(36).substring(7);

      logger.info(`[${requestId}] [allocatePointsByteamLeader] 请求开始`, {
        method: req.method,
        body: req.body
      });

      try {
        // 验证请求方法
        if (req.method !== 'POST') {
          return res.status(405).json({
            error: { code: 'method-not-allowed', message: '只支持 POST 请求' }
          });
        }

        // 验证认证
        if (!req.headers.authorization) {
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '缺少认证令牌' }
          });
        }

        // 验证 Firebase Token
        const token = req.headers.authorization.replace('Bearer ', '');
        let decodedToken;
        try {
          decodedToken = await admin.auth().verifyIdToken(token);
        } catch (authError) {
          logger.error(`[${requestId}] 认证失败`, authError);
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '无效的认证令牌' }
          });
        }

        const teamLeaderId = decodedToken.uid;

        // 提取请求参数（已删除 allocationType，SM 只做直销）
        const {
          organizationId,
          eventId,
          recipientId,
          points,
          notes
        } = req.body;

        // 验证必填字段
        if (!organizationId || !eventId || !recipientId || !points) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '缺少必填字段' }
          });
        }

        // 验证点数
        if (typeof points !== 'number' || points <= 0) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '点数必须为正数' }
          });
        }

        logger.info(`[${requestId}] 验证通过，开始直销`, {
          teamLeaderId, recipientId, points
        });

        // ========== 第1步: 验证 Team Leader 身份和权限 ==========
        const db = admin.firestore();
        const smRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${teamLeaderId}`);
        const smDoc = await smRef.get();

        if (!smDoc.exists) {
          return res.status(404).json({
            error: { code: 'not-found', message: '找不到 Team Leader 账户' }
          });
        }

        const smData = smDoc.data();
        if (!smData.roles?.includes('teamLeader')) {
          return res.status(403).json({
            error: { code: 'permission-denied', message: '您没有 Team Leader 权限' }
          });
        }

        // ========== 第2步: 验证接收者存在且在管理范围内 ==========
        const recipientRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${recipientId}`);
        const recipientDoc = await recipientRef.get();

        if (!recipientDoc.exists) {
          return res.status(404).json({
            error: { code: 'not-found', message: '找不到接收者账户' }
          });
        }

        const recipientData = recipientDoc.data();
        const recipientDept = recipientData.identityInfo?.department ||
          recipientData.department || recipientData.basicInfo?.department;
        const managedDepartments = smData.teamLeader?.managedDepartments ||
          smData.managedDepartments || [];

        if (!managedDepartments.includes(recipientDept)) {
          return res.status(403).json({
            error: { code: 'permission-denied', message: '该用户不在您的管理范围内' }
          });
        }

        // ========== 第3步: 读取分配规则 ==========
        const eventRef = db.doc(`organizations/${organizationId}/events/${eventId}`);
        const eventDoc = await eventRef.get();

        if (!eventDoc.exists) {
          return res.status(404).json({
            error: { code: 'not-found', message: '找不到活动信息' }
          });
        }

        const eventData = eventDoc.data();
        const maxPerAllocation = eventData.pointAllocationRules?.teamLeader?.maxPerAllocation || 100;

        if (points > maxPerAllocation) {
          return res.status(400).json({
            error: {
              code: 'invalid-argument',
              message: `超出单次销售限额（最多 ${maxPerAllocation} 点）`
            }
          });
        }

        // ========== 第4步: 使用事务执行直销 ==========
        const result = await db.runTransaction(async (transaction) => {
          const smDocInTx        = await transaction.get(smRef);
          const recipientDocInTx = await transaction.get(recipientRef);
          const eventDocInTx     = await transaction.get(eventRef);

          if (!smDocInTx.exists || !recipientDocInTx.exists || !eventDocInTx.exists) {
            throw new Error('数据已被删除，请刷新后重试');
          }

          const smDataInTx        = smDocInTx.data();
          const recipientDataInTx = recipientDocInTx.data();

          if (!recipientDataInTx.roles?.includes('customer')) {
            throw new Error('接收者没有 customer 角色');
          }

          const currentBalance = recipientDataInTx.customer?.pointsAccount?.availablePoints || 0;
          const now = admin.firestore.FieldValue.serverTimestamp();

          // 4.2 创建 pointAllocations 子集合记录
          // ⚠️ 触发 onTeamLeaderAllocation，触发器已修正为读取 allocationType
          //    personal 类型：触发器不重复写 customer 点数，只更新统计汇总
          const allocationRef = smRef.collection('pointAllocations').doc();
          const allocationId  = allocationRef.id;

          transaction.set(allocationRef, {
            allocationId,
            fromUserId:     teamLeaderId,
            toUserId:       recipientId,
            toDepartment:   recipientDept,
            points,
            allocationType: 'personal',
            sourceRole:     'teamLeader',
            reason:         notes || '直销消费点数（即时收现金）',
            allocatedAt:    now,
            status:         'completed',
            requiresCash:   true,
            cashAmount:     points,
            cashReceived:   points,
            cashReceivedAt: now,
            cashRecordedInSubmission: false,
            recipientSnapshot: {
              recipientName:       recipientDataInTx.basicInfo?.chineseName ||
                                   recipientDataInTx.basicInfo?.englishName || 'N/A',
              recipientDepartment: recipientDept,
              beforeBalance:       currentBalance,
              afterBalance:        currentBalance + points
            }
          });

          // 4.3 写入 transactions 集合（供 Auditor / 财务查阅）
          const transactionId = `SM2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const txRef = db.doc(
            `organizations/${organizationId}/events/${eventId}/transactions/${transactionId}`
          );

          transaction.set(txRef, {
            transactionId,
            transactionType: 'teamLeader_to_customer',
            organizationId,
            eventId,
            sellerId:         teamLeaderId,
            sellerName:       smDataInTx.basicInfo?.chineseName ||
                              smDataInTx.basicInfo?.englishName || 'Team Leader',
            sellerRole:       'teamLeader',
            sellerDepartment: recipientDept,
            customerId:         recipientId,
            customerName:       recipientDataInTx.basicInfo?.chineseName ||
                                recipientDataInTx.basicInfo?.englishName || 'Customer',
            customerDepartment: recipientDept,
            amount:  points,
            points:  points,
            note:    notes || '',
            sellerBalanceBefore:   0,
            sellerBalanceAfter:    0,
            customerBalanceBefore: currentBalance,
            customerBalanceAfter:  currentBalance + points,
            timestamp: now,
            status:    'completed',
            metadata: {
              createdAt:      now,
              source:         'allocatePointsByTeamLeaderHttp',
              allocationId,
              allocationType: 'personal'
            }
          });

          // 4.4 更新 Customer 消费点数 + 新增现金账户更新
          transaction.update(recipientRef, {
            'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(points),
            'customer.pointsAccount.totalReceived':   admin.firestore.FieldValue.increment(points),
            'customer.pointsAccount.allocatedPoints': admin.firestore.FieldValue.increment(points),
            'customer.pointsAccount.lastTransactionAt': now,
            // 🆕 更新现金账户：TeamLeader派发的点数需要支付现金
            'customer.cashAccount.totalAllocatedCash': admin.firestore.FieldValue.increment(points),
            'customer.cashAccount.pendingCash': admin.firestore.FieldValue.increment(points),
            'customer.cashAccount.tlAllocatedCash': admin.firestore.FieldValue.increment(points),
            'customer.cashAccount.lastAllocatedAt': now,
            updatedAt: now
          });

          // 4.5 更新 Team Leader 现金统计
          transaction.update(smRef, {
            'teamLeader.cashStats.cashOnHand':                    admin.firestore.FieldValue.increment(points),
            'teamLeader.cashStats.cashSources.fromPointPurchase': admin.firestore.FieldValue.increment(points),
            'teamLeader.totalAllocations':                        admin.firestore.FieldValue.increment(1),
            'teamLeader.totalPointsAllocated':                    admin.firestore.FieldValue.increment(points),
            'teamLeader.lastAllocationAt':                        now,
            updatedAt: now
          });

          // 4.6 ⭐ 新增（2026-02-27）：更新 Event 层级全局统计
          // SM 直销 = 即时收现金，属于"已售出"，计入 totalSold（不是 totalAllocated）
          transaction.update(eventRef, {
            'globalPointsStats.totalSold':                    admin.firestore.FieldValue.increment(points),
            'globalPointsStats.lastUpdated':                  admin.firestore.FieldValue.serverTimestamp(),
            'financeSummary.points.totalSold':                admin.firestore.FieldValue.increment(points),
            'roleStats.teamLeaders.totalDirectSales':      admin.firestore.FieldValue.increment(1),
            'roleStats.teamLeaders.totalPointsDirectSold': admin.firestore.FieldValue.increment(points)
          });

          logger.info(`[${requestId}] ✅ 事务完成`, { allocationId, transactionId, points });

          return {
            success:      true,
            allocationId,
            transactionId,
            points,
            recipientId,
            recipientName:  recipientDataInTx.basicInfo?.chineseName,
            newBalance:     currentBalance + points,
            cashReceived:   points
          };
        });

        logger.info(`[${requestId}] ✅ 直销成功`, result);
        return res.status(200).json(result);

      } catch (error) {
        logger.error(`[${requestId}] ❌ 直销失败`, {
          error: error.message,
          stack: error.stack
        });
        return res.status(500).json({
          error: {
            code:    'internal',
            message: error.message || '服务器内部错误，请稍后重试'
          }
        });
      }
    });
  }
);

// ============================================================================
// 导出所有HTTP函数
// ============================================================================

module.exports = {
  allocatePointsByTeamLeaderHttp: exports.allocatePointsByTeamLeaderHttp
};