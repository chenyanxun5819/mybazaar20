/**
 * onCashCollection.js
 * Cash Collection 触发器 - 当收款记录创建时自动更新统计
 * 
 * 触发路径: organizations/{orgId}/events/{eventId}/cashCollections/{collectionId}
 * 触发时机: onCreate
 * 
 * 功能:
 * 1. 更新 Seller 的 cashFlow 统计
 * 2. 更新 SellerManager 的 cashFlow 统计
 * 3. 更新部门统计 (departmentStats)
 * 4. 更新 SellerManager 统计 (sellerManagerStats)
 * 5. 检查和更新收款警示
 * 
 * @version 1.0
 * @date 2024-12-04
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { logger } = require('firebase-functions');

exports.onCashCollection = onDocumentCreated(
  {
    document: 'organizations/{organizationId}/events/{eventId}/cashCollections/{collectionId}',
    region: 'asia-southeast1'
  },
  async (event) => {
    const requestId = Math.random().toString(36).substring(7);
    
    logger.info(`[${requestId}] [onCashCollection] 触发器开始`, {
      collectionId: event.params.collectionId,
      orgId: event.params.organizationId,
      eventId: event.params.eventId
    });

    try {
      const db = admin.firestore();
      const collectionData = event.data.data();
      
      if (!collectionData) {
        logger.warn(`[${requestId}] 收款记录数据为空，跳过处理`);
        return;
      }

      const { 
        organizationId,
        eventId,
        sellerId,
        sellerDepartment,
        collectedBy,
        amount,
        discrepancy,
        discrepancyType
      } = {
        organizationId: event.params.organizationId,
        eventId: event.params.eventId,
        ...collectionData
      };

      logger.info(`[${requestId}] 收款信息`, {
        sellerId,
        collectedBy,
        amount,
        discrepancy,
        discrepancyType
      });

      // ========== 第1步: 更新 Seller 的 cashFlow ==========
      // 注意：前端已经在 batch 中更新了，这里可以选择性地验证或补充更新
      const sellerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerId}`);
      const sellerDoc = await sellerRef.get();
      
      if (!sellerDoc.exists) {
        logger.error(`[${requestId}] Seller 不存在: ${sellerId}`);
        return;
      }

      // ========== 第2步: 更新部门统计 ==========
      if (sellerDepartment) {
        await updateDepartmentStats(
          db,
          organizationId,
          eventId,
          sellerDepartment,
          requestId
        );
      }

      // ========== 第3步: 更新 SellerManager 统计 ==========
      await updateSellerManagerStats(
        db,
        organizationId,
        eventId,
        collectedBy,
        requestId
      );

      // ========== 第4步: 检查收款警示 ==========
      await checkCollectionWarnings(
        db,
        organizationId,
        eventId,
        sellerId,
        requestId
      );

      logger.info(`[${requestId}] ✅ 收款记录处理完成`);
      
    } catch (error) {
      logger.error(`[${requestId}] ❌ 处理收款记录失败`, {
        error: error.message,
        stack: error.stack
      });
      // 不抛出错误，避免触发器重试
    }
  }
);

/**
 * 更新部门统计
 */
async function updateDepartmentStats(db, organizationId, eventId, departmentCode, requestId) {
  try {
    logger.info(`[${requestId}] 更新部门统计: ${departmentCode}`);

    const deptStatsRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/departmentStats/${departmentCode}`
    );

    // 查询该部门的所有 sellers
    const sellersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('identityInfo.department', '==', departmentCode)
      .where('roles', 'array-contains', 'seller')
      .get();

    let totalReceived = 0;
    let currentBalance = 0;
    let totalSold = 0;
    let totalRevenue = 0;
    let totalCollected = 0;
    let pendingCollection = 0;
    let activeSellers = 0;

    sellersSnapshot.forEach(doc => {
      const data = doc.data();
      const ps = data.pointsStats || {};
      const cashFlow = ps.cashFlow || {};

      totalReceived += ps.totalReceived || 0;
      currentBalance += ps.currentBalance || 0;
      totalSold += ps.totalSold || 0;
      totalRevenue += ps.totalRevenue || 0;
      totalCollected += ps.totalCollected || 0;
      pendingCollection += ps.pendingCollection || 0;

      if ((ps.totalRevenue || 0) > 0) {
        activeSellers++;
      }
    });

    const collectionRate = totalRevenue > 0 ? totalCollected / totalRevenue : 0;

    // 更新部门统计
    await deptStatsRef.set(
      {
        departmentCode: departmentCode,
        totalSellers: sellersSnapshot.size,
        activeSellers: activeSellers,
        pointsStats: {
          totalReceived,
          currentBalance,
          totalSold,
          totalRevenue,
          totalCollected,
          pendingCollection,
          collectionRate
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info(`[${requestId}] ✅ 部门统计更新成功: ${departmentCode}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 更新部门统计失败`, {
      departmentCode,
      error: error.message
    });
  }
}

/**
 * 更新 SellerManager 统计
 */
async function updateSellerManagerStats(db, organizationId, eventId, sellerManagerId, requestId) {
  try {
    logger.info(`[${requestId}] 更新 SellerManager 统计: ${sellerManagerId}`);

    const smStatsRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/sellerManagerStats/${sellerManagerId}`
    );

    const smRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}`
    );

    const smDoc = await smRef.get();
    if (!smDoc.exists) {
      logger.warn(`[${requestId}] SellerManager 不存在: ${sellerManagerId}`);
      return;
    }

    const smData = smDoc.data();
    const managedDepartments = smData.sellerManager?.managedDepartments || [];
    const cashFlow = smData.pointsStats?.cashFlow || {};

    // 查询管理的所有 sellers
    const sellersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('managedBy', 'array-contains', sellerManagerId)
      .where('roles', 'array-contains', 'seller')
      .get();

    let totalUsers = 0;
    let activeUsers = 0;
    let currentBalance = 0;
    let totalRevenue = 0;
    let totalCollected = 0;
    let pendingCollection = 0;

    sellersSnapshot.forEach(doc => {
      const data = doc.data();
      const ps = data.pointsStats || {};

      totalUsers++;
      currentBalance += ps.currentBalance || 0;
      totalRevenue += ps.totalRevenue || 0;
      totalCollected += ps.totalCollected || 0;
      pendingCollection += ps.pendingCollection || 0;

      if ((ps.totalRevenue || 0) > 0) {
        activeUsers++;
      }
    });

    const collectionRate = totalRevenue > 0 ? totalCollected / totalRevenue : 0;

    // 更新统计
    await smStatsRef.set(
      {
        sellerManagerId: sellerManagerId,
        sellerManagerName: smData.basicInfo?.chineseName || 'Unknown',
        managedDepartments: managedDepartments,
        managedUsersStats: {
          totalUsers,
          activeUsers,
          currentBalance,
          totalRevenue,
          totalCollected,
          pendingCollection,
          collectionRate
        },
        cashFlowStats: {
          collectedFromSellers: cashFlow.collectedFromSellers || 0,
          cashHolding: cashFlow.cashHolding || 0,
          submittedToFinance: cashFlow.submittedToFinance || 0,
          confirmedByFinance: cashFlow.confirmedByFinance || 0
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info(`[${requestId}] ✅ SellerManager 统计更新成功: ${sellerManagerId}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 更新 SellerManager 统计失败`, {
      sellerManagerId,
      error: error.message
    });
  }
}

/**
 * 检查收款警示
 */
async function checkCollectionWarnings(db, organizationId, eventId, sellerId, requestId) {
  try {
    logger.info(`[${requestId}] 检查收款警示: ${sellerId}`);

    // 获取 Event 的警示阈值
    const eventRef = db.doc(`organizations/${organizationId}/events/${eventId}`);
    const eventDoc = await eventRef.get();
    
    if (!eventDoc.exists) {
      return;
    }

    const eventData = eventDoc.data();
    const warningThreshold = eventData.pointAllocationRules?.sellerManager?.warningThreshold || 0.3;

    // 获取 Seller 数据
    const sellerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerId}`);
    const sellerDoc = await sellerRef.get();

    if (!sellerDoc.exists) {
      return;
    }

    const sellerData = sellerDoc.data();
    const ps = sellerData.pointsStats || {};
    const totalRevenue = ps.totalRevenue || 0;
    const pendingCollection = ps.pendingCollection || 0;

    // 计算待收款比例
    const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

    // 判断是否需要警示
    const shouldAlert = pendingRatio > warningThreshold;

    // 更新警示状态
    await sellerRef.update({
      'seller.collectionAlert': shouldAlert,
      'updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`[${requestId}] ✅ 收款警示更新: ${sellerId}, alert: ${shouldAlert}, ratio: ${pendingRatio}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 检查收款警示失败`, {
      sellerId,
      error: error.message
    });
  }
}

module.exports = {
  onCashCollection: exports.onCashCollection
};
