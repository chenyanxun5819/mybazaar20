/**
 * onCashCollection.js (修复版 - 兼容 Seller 新数据结构)
 * Cash Collection 触发器 - 当收款记录创建时自动更新统计
 * 
 * ✅ 修复日期: 2024-12-14
 * ✅ 修复内容: 从 pointsStats 迁移到 seller 对象
 * 
 * 触发路径: organizations/{orgId}/events/{eventId}/cashCollections/{collectionId}
 * 触发时机: onCreate
 * 
 * 功能:
 * 1. 更新 Seller 的统计（seller 对象）
 * 2. 更新 SellerManager 的统计 (sellerManagerStats)
 * 3. 更新部门统计 (departmentStats)
 * 4. 检查和更新收款警示
 * 
 * @version 2.0 - 兼容新架构
 * @date 2024-12-14
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
    
    logger.info(`[${requestId}] [onCashCollection] ========== 触发器开始 ==========`, {
      collectionId: event.params.collectionId,
      orgId: event.params.organizationId,
      eventId: event.params.eventId
    });

    try {
      const db = admin.firestore();
      const collectionData = event.data.data();
      
      if (!collectionData) {
        logger.warn(`[${requestId}] ⚠️ 收款记录数据为空，跳过处理`);
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

      logger.info(`[${requestId}] 📋 收款信息`, {
        sellerId,
        sellerDepartment,
        collectedBy,
        amount,
        discrepancy,
        discrepancyType
      });

      // ========== 第1步: 验证 Seller 存在 ==========
      const sellerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerId}`);
      const sellerDoc = await sellerRef.get();
      
      if (!sellerDoc.exists) {
        logger.error(`[${requestId}] ❌ Seller 不存在: ${sellerId}`);
        return;
      }

      logger.info(`[${requestId}] ✅ Seller 验证通过`);

      // ========== 第2步: 更新部门统计 ==========
      if (sellerDepartment) {
        logger.info(`[${requestId}] 📊 开始更新部门统计...`);
        await updateDepartmentStats(
          db,
          organizationId,
          eventId,
          sellerDepartment,
          requestId
        );
      } else {
        logger.warn(`[${requestId}] ⚠️ Seller 没有部门信息，跳过部门统计更新`);
      }

      // ========== 第3步: 更新 SellerManager 统计 ==========
      logger.info(`[${requestId}] 👤 开始更新 SellerManager 统计...`);
      await updateSellerManagerStats(
        db,
        organizationId,
        eventId,
        collectedBy,
        requestId
      );

      // ========== 第4步: 检查收款警示 ==========
      logger.info(`[${requestId}] ⚠️ 开始检查收款警示...`);
      await checkCollectionWarnings(
        db,
        organizationId,
        eventId,
        sellerId,
        requestId
      );

      logger.info(`[${requestId}] ========== ✅ 收款记录处理完成 ==========`);
      
    } catch (error) {
      logger.error(`[${requestId}] ========== ❌ 处理收款记录失败 ==========`, {
        error: error.message,
        stack: error.stack
      });
      // 不抛出错误，避免触发器重试
    }
  }
);

/**
 * ✅ 更新部门统计 (修复版 - 使用 seller 对象)
 * 
 * 字段映射:
 * - seller.availablePoints → currentBalance
 * - seller.totalRevenue → totalRevenue
 * - seller.totalCashCollected → totalCashCollected
 * - seller.pendingCollection → pendingCollection
 * - seller.totalPointsSold → totalPointsSold
 */
async function updateDepartmentStats(db, organizationId, eventId, departmentCode, requestId) {
  try {
    logger.info(`[${requestId}] [updateDepartmentStats] 开始更新部门: ${departmentCode}`);

    const deptStatsRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/departmentStats/${departmentCode}`
    );

    // 查询该部门的所有 sellers
    const sellersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('identityInfo.department', '==', departmentCode)
      .where('roles', 'array-contains', 'seller')
      .get();

    logger.info(`[${requestId}] 找到 ${sellersSnapshot.size} 个 Seller`);

    // ✅ 使用 seller 对象的字段
    let currentBalance = 0;           // seller.availablePoints
    let totalRevenue = 0;             // seller.totalRevenue
    let totalCashCollected = 0;       // seller.totalCashCollected
    let pendingCollection = 0;        // seller.pendingCollection
    let totalPointsSold = 0;          // seller.totalPointsSold
    let activeSellers = 0;

    sellersSnapshot.forEach(doc => {
      const data = doc.data();
      const seller = data.seller || {};  // ✅ 使用 seller 对象

      currentBalance += seller.availablePoints || 0;
      totalRevenue += seller.totalRevenue || 0;
      totalCashCollected += seller.totalCashCollected || 0;
      pendingCollection += seller.pendingCollection || 0;
      totalPointsSold += seller.totalPointsSold || 0;

      if ((seller.totalRevenue || 0) > 0) {
        activeSellers++;
      }
    });

    // 计算收款率
    const collectionRate = totalRevenue > 0 ? totalCashCollected / totalRevenue : 0;

    logger.info(`[${requestId}] 部门统计数据:`, {
      totalSellers: sellersSnapshot.size,
      activeSellers,
      currentBalance,
      totalRevenue,
      totalCashCollected,
      pendingCollection,
      collectionRate: Math.round(collectionRate * 100) + '%'
    });

    // ✅ 更新部门统计（使用新字段名）
    await deptStatsRef.set(
      {
        departmentCode: departmentCode,
        totalSellers: sellersSnapshot.size,
        activeSellers: activeSellers,
        membersStats: {
          totalCount: sellersSnapshot.size,
          activeCount: activeSellers
        },
        pointsStats: {
          currentBalance,          // 当前持有点数
          totalRevenue,            // 累计销售额
          totalCashCollected,      // 累计已收现金
          pendingCollection,       // 待收款
          totalPointsSold,         // 累计售出点数
          collectionRate           // 收款率
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info(`[${requestId}] ✅ 部门统计更新成功: ${departmentCode}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 更新部门统计失败`, {
      departmentCode,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * ✅ 更新 SellerManager 统计 (修复版 - 使用 seller 对象)
 */
async function updateSellerManagerStats(db, organizationId, eventId, sellerManagerId, requestId) {
  try {
    logger.info(`[${requestId}] [updateSellerManagerStats] 开始更新 SM: ${sellerManagerId}`);

    const smStatsRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/sellerManagerStats/${sellerManagerId}`
    );

    const smRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}`
    );

    const smDoc = await smRef.get();
    if (!smDoc.exists) {
      logger.warn(`[${requestId}] ⚠️ SellerManager 不存在: ${sellerManagerId}`);
      return;
    }

    const smData = smDoc.data();
    const managedDepartments = smData.sellerManager?.managedDepartments || 
                               smData.managedDepartments || [];

    logger.info(`[${requestId}] SM 管理的部门:`, managedDepartments);

    // 查询管理的所有 sellers
    const sellersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('managedBy', 'array-contains', sellerManagerId)
      .where('roles', 'array-contains', 'seller')
      .get();

    logger.info(`[${requestId}] SM 管理 ${sellersSnapshot.size} 个 Seller`);

    // ✅ 使用 seller 对象的字段
    let totalUsers = 0;
    let activeUsers = 0;
    let currentBalance = 0;
    let totalRevenue = 0;
    let totalCashCollected = 0;
    let pendingCollection = 0;

    sellersSnapshot.forEach(doc => {
      const data = doc.data();
      const seller = data.seller || {};  // ✅ 使用 seller 对象

      totalUsers++;
      currentBalance += seller.availablePoints || 0;
      totalRevenue += seller.totalRevenue || 0;
      totalCashCollected += seller.totalCashCollected || 0;
      pendingCollection += seller.pendingCollection || 0;

      if ((seller.totalRevenue || 0) > 0) {
        activeUsers++;
      }
    });

    const collectionRate = totalRevenue > 0 ? totalCashCollected / totalRevenue : 0;

    logger.info(`[${requestId}] SM 统计数据:`, {
      totalUsers,
      activeUsers,
      currentBalance,
      totalRevenue,
      totalCashCollected,
      pendingCollection,
      collectionRate: Math.round(collectionRate * 100) + '%'
    });

    // ✅ 更新统计（使用新字段名）
    await smStatsRef.set(
      {
        sellerManagerId: sellerManagerId,
        sellerManagerName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName || 'Unknown',
        managedDepartments: managedDepartments,
        managedUsersStats: {
          totalUsers,
          activeUsers,
          currentBalance,          // 管理的 Seller 当前持有点数总和
          totalRevenue,            // 管理的 Seller 累计销售额
          totalCashCollected,      // 管理的 Seller 已收现金总和
          pendingCollection,       // 管理的 Seller 待收款总和
          collectionRate           // 收款率
        },
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );

    logger.info(`[${requestId}] ✅ SellerManager 统计更新成功: ${sellerManagerId}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 更新 SellerManager 统计失败`, {
      sellerManagerId,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * ✅ 检查收款警示 (修复版 - 使用 seller 对象)
 * 
 * 警示等级:
 * - none: pendingRatio <= warningThreshold (默认 0.3)
 * - low: 0.3 < pendingRatio <= 0.4
 * - medium: 0.4 < pendingRatio <= 0.5
 * - high: pendingRatio > 0.5
 */
async function checkCollectionWarnings(db, organizationId, eventId, sellerId, requestId) {
  try {
    logger.info(`[${requestId}] [checkCollectionWarnings] 检查警示: ${sellerId}`);

    // 获取 Event 的警示阈值
    const eventRef = db.doc(`organizations/${organizationId}/events/${eventId}`);
    const eventDoc = await eventRef.get();
    
    if (!eventDoc.exists) {
      logger.warn(`[${requestId}] ⚠️ Event 不存在，使用默认阈值`);
    }

    const eventData = eventDoc.exists ? eventDoc.data() : {};
    const warningThreshold = eventData.pointAllocationRules?.sellerManager?.warningThreshold || 0.3;

    logger.info(`[${requestId}] 警示阈值: ${Math.round(warningThreshold * 100)}%`);

    // 获取 Seller 数据
    const sellerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${sellerId}`);
    const sellerDoc = await sellerRef.get();

    if (!sellerDoc.exists) {
      logger.warn(`[${requestId}] ⚠️ Seller 不存在: ${sellerId}`);
      return;
    }

    const sellerData = sellerDoc.data();
    const seller = sellerData.seller || {};  // ✅ 使用 seller 对象

    // ✅ 使用新字段名
    const totalRevenue = seller.totalRevenue || 0;
    const pendingCollection = seller.pendingCollection || 0;

    // 计算待收款比例
    const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

    logger.info(`[${requestId}] Seller 数据:`, {
      totalRevenue,
      pendingCollection,
      pendingRatio: Math.round(pendingRatio * 100) + '%'
    });

    // 判断警示等级
    let warningLevel = 'none';
    let hasWarning = false;

    if (pendingRatio > warningThreshold) {
      hasWarning = true;
      if (pendingRatio > 0.5) {
        warningLevel = 'high';
      } else if (pendingRatio > 0.4) {
        warningLevel = 'medium';
      } else {
        warningLevel = 'low';
      }
    }

    logger.info(`[${requestId}] 警示判定:`, {
      hasWarning,
      warningLevel,
      threshold: Math.round(warningThreshold * 100) + '%'
    });

    // ✅ 更新警示状态（使用新的嵌套结构）
    await sellerRef.update({
      'seller.collectionAlert': {
        hasWarning: hasWarning,
        warningLevel: warningLevel,
        pendingAmount: pendingCollection,
        pendingRatio: pendingRatio
      },
      'updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`[${requestId}] ✅ 收款警示更新成功`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 检查收款警示失败`, {
      sellerId,
      error: error.message,
      stack: error.stack
    });
  }
}

// ============================================================================
// 导出
// ============================================================================

module.exports = {
  onCashCollection: exports.onCashCollection
};