/**
 * Seller Manager HTTP Functions
 * 提供前端可调用的HTTP端点
 * 
 * @version 2025-12-03
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
// HTTP Function 1: allocatePointsBySellerManager
// ============================================================================

/**
 * Seller Manager 分配点数给部门内的 Seller
 * 
 * Request Body:
 * {
 *   organizationId: string,
 *   eventId: string,
 *   recipientId: string,
 *   points: number,
 *   notes: string (optional)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   allocationId: string,
 *   message: string
 * }
 */
exports.allocatePointsBySellerManagerHttp = onRequest(
  { 
    region: 'asia-southeast1',
    cors: allowedOrigins
  },
  async (req, res) => {
    // 使用CORS中间件
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
        const { organizationId, eventId, recipientId, points, notes } = req.body;

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

        logger.info(`[${requestId}] 验证通过，开始分配`, {
          sellerManagerId,
          recipientId,
          points
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
        const recipientDept = recipientData.department || recipientData.basicInfo?.department;
        const managedDepartments = smData.managedDepartments || [];

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

        // ========== 第4步: 创建分配记录 ==========
        const allocationData = {
          recipientId,
          recipientName: recipientData.basicInfo?.chineseName || '未知',
          recipientDepartment: recipientDept,
          points,
          notes: notes || '',
          allocatedBy: sellerManagerId,
          allocatedByName: smData.basicInfo?.chineseName || 'Seller Manager',
          allocatedByRole: 'sellerManager',
          status: 'completed',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          
          // 快照数据（用于审计）
          recipientStatsSnapshot: {
            beforeBalance: recipientData.seller?.availablePoints || 0,
            beforeTotalReceived: recipientData.pointsStats?.totalReceived || 0
          }
        };

        const allocationRef = await db
          .collection(`organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}/pointAllocations`)
          .add(allocationData);

        logger.info(`[${requestId}] ✅ 分配记录已创建`, {
          allocationId: allocationRef.id,
          recipientId,
          points
        });

        // 注意：点数的实际更新由 onSellerManagerAllocation 触发器自动完成

        return res.status(200).json({
          success: true,
          allocationId: allocationRef.id,
          message: '点数分配成功'
        });

      } catch (error) {
        logger.error(`[${requestId}] ❌ 分配失败`, {
          error: error.message,
          stack: error.stack
        });

        return res.status(500).json({
          error: { 
            code: 'internal', 
            message: '服务器内部错误，请稍后重试' 
          }
        });
      }
    });
  }
);

// ============================================================================
// HTTP Function 2: getSellerManagerDashboardData
// ============================================================================

/**
 * 获取 Seller Manager Dashboard 所需的所有数据
 * 
 * Request Query:
 * {
 *   organizationId: string,
 *   eventId: string
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     smStats: {...},
 *     departmentStats: [...],
 *     managedUsers: [...],
 *     eventData: {...}
 *   }
 * }
 */
exports.getSellerManagerDashboardDataHttp = onRequest(
  {
    region: 'asia-southeast1',
    cors: allowedOrigins
  },
  async (req, res) => {
    return corsHandler(req, res, async () => {
      const requestId = Math.random().toString(36).substring(7);
      
      logger.info(`[${requestId}] [getSellerManagerDashboardData] 请求开始`);

      try {
        // 验证认证
        if (!req.headers.authorization) {
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '缺少认证令牌' }
          });
        }

        const token = req.headers.authorization.replace('Bearer ', '');
        let decodedToken;
        try {
          decodedToken = await admin.auth().verifyIdToken(token);
        } catch (authError) {
          return res.status(401).json({
            error: { code: 'unauthenticated', message: '无效的认证令牌' }
          });
        }

        const sellerManagerId = decodedToken.uid;
        const { organizationId, eventId } = req.query;

        if (!organizationId || !eventId) {
          return res.status(400).json({
            error: { code: 'invalid-argument', message: '缺少必填参数' }
          });
        }

        const db = admin.firestore();

        // ========== 第1步: 获取 Seller Manager 统计 ==========
        const smStatsRef = db.doc(
          `organizations/${organizationId}/events/${eventId}/sellerManagerStats/${sellerManagerId}`
        );
        const smStatsDoc = await smStatsRef.get();
        const smStats = smStatsDoc.exists ? smStatsDoc.data() : null;

        // ========== 第2步: 获取管理的部门列表 ==========
        const smRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}`);
        const smDoc = await smRef.get();
        
        if (!smDoc.exists) {
          return res.status(404).json({
            error: { code: 'not-found', message: '找不到您的账户信息' }
          });
        }

        const managedDepartments = smDoc.data().managedDepartments || [];

        // ========== 第3步: 获取各部门统计 ==========
        const departmentStatsPromises = managedDepartments.map(async (deptCode) => {
          const deptStatsDoc = await db
            .doc(`organizations/${organizationId}/events/${eventId}/departmentStats/${deptCode}`)
            .get();
          
          if (deptStatsDoc.exists) {
            return {
              id: deptStatsDoc.id,
              ...deptStatsDoc.data()
            };
          }
          return null;
        });

        const departmentStats = (await Promise.all(departmentStatsPromises))
          .filter(dept => dept !== null);

        // ========== 第4步: 获取管理的用户列表 ==========
        const usersSnapshot = await db
          .collection(`organizations/${organizationId}/events/${eventId}/users`)
          .where('managedBy', 'array-contains', sellerManagerId)
          .get();

        const managedUsers = [];
        usersSnapshot.forEach(doc => {
          managedUsers.push({
            id: doc.id,
            ...doc.data()
          });
        });

        // ========== 第5步: 获取 Event 配置 ==========
        const eventDoc = await db.doc(`organizations/${organizationId}/events/${eventId}`).get();
        const eventData = eventDoc.exists ? eventDoc.data() : {};

        logger.info(`[${requestId}] ✅ 数据获取成功`, {
          smStats: !!smStats,
          departmentCount: departmentStats.length,
          userCount: managedUsers.length
        });

        return res.status(200).json({
          success: true,
          data: {
            smStats,
            departmentStats,
            managedUsers,
            eventData
          }
        });

      } catch (error) {
        logger.error(`[${requestId}] ❌ 获取数据失败`, {
          error: error.message,
          stack: error.stack
        });

        return res.status(500).json({
          error: { code: 'internal', message: '服务器内部错误' }
        });
      }
    });
  }
);

// ============================================================================
// 导出所有HTTP函数
// ============================================================================

module.exports = {
  allocatePointsBySellerManagerHttp: exports.allocatePointsBySellerManagerHttp,
  getSellerManagerDashboardDataHttp: exports.getSellerManagerDashboardDataHttp
};
