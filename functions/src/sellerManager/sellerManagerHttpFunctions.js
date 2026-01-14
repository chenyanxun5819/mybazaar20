/**
 * Seller Manager HTTP Functions
 * 提供前端可调用的HTTP端点
 * 
 * @version 2026-01-12 v3.1 (修复 Firestore 错误)
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
  'https://mybazaar-c4881.firebaseapp.com'
];

const corsHandler = cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

// ============================================================================
// HTTP Function: allocatePointsBySellerManager (销售点数 - 收现金)
// ============================================================================

/**
 * Seller Manager 销售点数给 Seller
 * 
 * - Seller 付现金购买点数
 * - 更新 customer.pointsAccount.availablePoints
 * - 记录现金收入到 sellerManager.cashStats
 * 
 * @version 3.1
 * @date 2026-01-12
 */
exports.allocatePointsBySellerManagerHttp = onRequest(
  {
    region: 'asia-southeast1',
    cors: allowedOrigins
  },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      const requestId = Math.random().toString(36).substring(7);

      logger.info(`[${requestId}] [allocatePointsBySellerManager] 请求开始`, {
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

        const sellerManagerId = decodedToken.uid;

        // 提取请求参数
        const { 
          organizationId, 
          eventId, 
          recipientId, 
          points, 
          allocationType,  // 'personal' 或 'inventory'
          notes 
        } = req.body;

        // 验证必填字段
        if (!organizationId || !eventId || !recipientId || !points) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '缺少必填字段' }
          });
        }

        // 验证分配类型（如果未提供，默认为 personal）
        const finalAllocationType = allocationType || 'personal';
        if (!['inventory', 'personal'].includes(finalAllocationType)) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '无效的分配类型' }
          });
        }

        // 验证点数
        if (typeof points !== 'number' || points <= 0) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '点数必须为正数' }
          });
        }

        logger.info(`[${requestId}] 验证通过，开始分配`, {
          sellerManagerId,
          recipientId,
          points,
          allocationType: finalAllocationType
        });

        // ========== 第1步: 验证 Seller Manager 身份和权限 ==========
        const db = admin.firestore();
        const smRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}`);
        const smDoc = await smRef.get();

        if (!smDoc.exists) {
          return res.status(404).json({
            error: { code: 'not-found', message: '找不到 Seller Manager 账户' }
          });
        }

        const smData = smDoc.data();
        const roles = smData.roles || [];

        if (!roles.includes('sellerManager')) {
          return res.status(403).json({
            error: { code: 'permission-denied', message: '您没有 Seller Manager 权限' }
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
          recipientData.department ||
          recipientData.basicInfo?.department;
        const managedDepartments = smData.sellerManager?.managedDepartments ||
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
        const maxPerAllocation = eventData.pointAllocationRules?.sellerManager?.maxPerAllocation || 100;

        // 验证分配限额
        if (points > maxPerAllocation) {
          return res.status(400).json({
            error: {
              code: 'invalid-argument',
              message: `超出单次分配限额（最多 ${maxPerAllocation} 点）`
            }
          });
        }

        // ========== 第4步: 使用事务执行分配 ==========
        const result = await db.runTransaction(async (transaction) => {
          // 4.1 重新读取最新数据
          const smDocInTx = await transaction.get(smRef);
          const recipientDocInTx = await transaction.get(recipientRef);

          if (!smDocInTx.exists || !recipientDocInTx.exists) {
            throw new Error('用户数据已被删除');
          }

          const smDataInTx = smDocInTx.data();
          const recipientDataInTx = recipientDocInTx.data();

          // 4.2 获取当前余额（根据类型）
          let currentBalance;
          if (finalAllocationType === 'inventory') {
            currentBalance = recipientDataInTx.seller?.availablePoints || 0;
          } else {
            currentBalance = recipientDataInTx.customer?.pointsAccount?.availablePoints || 0;
          }

          // 4.3 创建分配记录
          const allocationRef = smRef.collection('pointAllocations').doc();
          const allocationId = allocationRef.id;
          const now = admin.firestore.FieldValue.serverTimestamp();

          const allocationData = {
            allocationId: allocationId,
            fromUserId: sellerManagerId,
            toUserId: recipientId,
            toDepartment: recipientDept,
            points: points,
            allocationType: finalAllocationType,
            reason: notes || (finalAllocationType === 'inventory' ? '分配销售库存' : '购买消费点数'),
            allocatedAt: now,
            status: 'completed',
            
            // 接收者快照
            recipientSnapshot: {
              recipientName: recipientDataInTx.basicInfo?.chineseName || 
                            recipientDataInTx.basicInfo?.englishName || 'N/A',
              recipientDepartment: recipientDept,
              beforeBalance: currentBalance,
              afterBalance: currentBalance + points
            }
          };

          // 只有 personal 类型才记录现金
          if (finalAllocationType === 'personal') {
            allocationData.cashReceived = points;
            allocationData.cashReceivedAt = now;
            allocationData.cashRecordedInSubmission = false;
          }

          transaction.set(allocationRef, allocationData);

          // 4.3.1 写入 transactions（仅 personal=收现金 购买消费点数）
          // 说明：目前前端 SellerManager 的“直接销售”走 HTTP 端点 /api/allocatePointsBySellerManager
          // 若不写入 transactions，Firestore 的 transactions 集合将看不到 SellerManager 的销售记录。
          let transactionId = null;
          if (finalAllocationType === 'personal') {
            transactionId = `SM2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const txRef = db.doc(
              `organizations/${organizationId}/events/${eventId}/transactions/${transactionId}`
            );

            const txData = {
              transactionId,

              // 兼容旧读取逻辑
              type: 'sellerManager_to_customer',
              // 对齐 firestore最新架構.json: transactions.transactionType
              transactionType: 'sellerManager_to_customer',

              organizationId,
              eventId,

              // Seller Manager 信息
              sellerId: sellerManagerId,
              sellerName:
                smDataInTx.basicInfo?.chineseName ||
                smDataInTx.basicInfo?.englishName ||
                'Seller Manager',
              sellerRole: 'sellerManager',
              sellerDepartment: recipientDept,

              // Customer 信息（Seller 购买消费点数时，身份是 customer）
              customerId: recipientId,
              customerName:
                recipientDataInTx.basicInfo?.chineseName ||
                recipientDataInTx.basicInfo?.englishName ||
                'Customer',
              customerDepartment: recipientDept,

              // 交易信息
              amount: points,
              points: points,
              note: notes || '',

              // 余额快照
              sellerBalanceBefore: 0,
              sellerBalanceAfter: 0,
              customerBalanceBefore: currentBalance,
              customerBalanceAfter: currentBalance + points,

              timestamp: now,
              status: 'completed',

              metadata: {
                createdAt: now,
                source: 'allocatePointsBySellerManagerHttp',
                allocationId,
                allocationType: finalAllocationType
              }
            };

            transaction.set(txRef, txData);
          }

          logger.info(`[${requestId}] 创建分配记录`, {
            allocationId,
            points,
            allocationType: finalAllocationType,
            cashReceived: finalAllocationType === 'personal' ? points : 0
          });

          // 4.4 更新接收者的点数（根据类型）
          if (finalAllocationType === 'inventory') {
            // 免费分配销售库存
            transaction.update(recipientRef, {
              'seller.availablePoints': admin.firestore.FieldValue.increment(points),
              'seller.totalReceived': admin.firestore.FieldValue.increment(points),
              updatedAt: now
            });

            logger.info(`[${requestId}] 更新销售库存`, {
              recipientId,
              pointsAdded: points
            });

          } else {
            // 付费购买消费点数
            transaction.update(recipientRef, {
              'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(points),
              'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(points),
              updatedAt: now
            });

            logger.info(`[${requestId}] 更新消费余额`, {
              recipientId,
              pointsAdded: points
            });
          }

          // 4.5 更新 Seller Manager 统计
          const smUpdates = {
            'sellerManager.totalAllocations': admin.firestore.FieldValue.increment(1),
            'sellerManager.totalPointsAllocated': admin.firestore.FieldValue.increment(points),
            'sellerManager.lastAllocationAt': now,
            updatedAt: now
          };

          // ✅ 只有 personal 类型才更新现金统计
          if (finalAllocationType === 'personal') {
            // ✅ 修复：直接更新子字段，不设置整个对象
            // Firestore 会自动创建父对象
            
            const currentCashSources = smDataInTx.sellerManager?.cashStats?.cashSources;
            
            // 更新现金手上
            smUpdates['sellerManager.cashStats.cashOnHand'] = admin.firestore.FieldValue.increment(points);
            
            // 更新购点收入
            smUpdates['sellerManager.cashStats.cashSources.fromPointPurchase'] = admin.firestore.FieldValue.increment(points);
            
            // ✅ 只在第一次时初始化 fromPointSales（如果需要）
            if (!currentCashSources || currentCashSources.fromPointSales === undefined) {
              const currentCashOnHand = smDataInTx.sellerManager?.cashStats?.cashOnHand || 0;
              // 使用单独的字段路径，不会冲突
              smUpdates['sellerManager.cashStats.cashSources.fromPointSales'] = currentCashOnHand;
            }

            logger.info(`[${requestId}] ✅ 更新 SM 现金统计`, {
              cashReceived: points
            });
          }

          transaction.update(smRef, smUpdates);

          return {
            success: true,
            allocationId: allocationId,
            transactionId,
            points: points,
            allocationType: finalAllocationType,
            cashReceived: finalAllocationType === 'personal' ? points : 0,
            recipientId: recipientId,
            recipientName: recipientDataInTx.basicInfo?.chineseName,
            newBalance: currentBalance + points
          };
        });

        logger.info(`[${requestId}] ✅ 分配成功`, result);

        return res.status(200).json(result);

      } catch (error) {
        logger.error(`[${requestId}] ❌ 分配失败`, {
          error: error.message,
          stack: error.stack
        });

        return res.status(500).json({
          error: {
            code: 'internal',
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
  allocatePointsBySellerManagerHttp: exports.allocatePointsBySellerManagerHttp
};
