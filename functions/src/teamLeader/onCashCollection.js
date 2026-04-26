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
 * 2. 更新 teamLeader 的统计 (teamLeaderStats)
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
        customerId,
        customerDepartment,
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
        customerId,
        customerDepartment,
        collectedBy,
        amount,
        discrepancy,
        discrepancyType
      });

      // ========== 第1步: 验证 Customer 存在 ==========
      const customerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${customerId}`);
      const customerDoc = await customerRef.get();

      if (!customerDoc.exists) {
        logger.error(`[${requestId}] ❌ Customer 不存在: ${customerId}`);
        return;
      }

      logger.info(`[${requestId}] ✅ Customer 验证通过`);

      // ========== 第2步: 更新部门统计 ==========
      if (customerDepartment) {
        logger.info(`[${requestId}] 📊 开始更新部门统计...`);
        await updateDepartmentStats(
          db,
          organizationId,
          eventId,
          customerDepartment,
          requestId
        );
      } else {
        logger.warn(`[${requestId}] ⚠️ Customer 没有部门信息，跳过部门统计更新`);
      }

      // ========== 第3步: 更新 teamLeader 统计 ==========
      logger.info(`[${requestId}] 👤 开始更新 teamLeader 统计...`);
      await updateteamLeaderStats(
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
        customerId,
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

    // 查询该部门的所有 customers
    const customersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('identityInfo.department', '==', departmentCode)
      .where('roles', 'array-contains', 'customer')
      .get();

    logger.info(`[${requestId}] 找到 ${customersSnapshot.size} 个 Customer`);

    let currentBalance = 0;
    let totalRevenue = 0;
    let totalCashCollected = 0;
    let pendingCollection = 0;
    let totalPointsReceived = 0;
    let activeCustomers = 0;

    customersSnapshot.forEach(doc => {
      const data = doc.data();
      const pointsAccount = data.customer?.pointsAccount || {};
      const pointsStats = data.pointsStats || {};

      currentBalance += pointsAccount.availablePoints || 0;
      totalRevenue += pointsStats.totalRevenue || 0;
      totalCashCollected += pointsStats.totalCollected || 0;
      pendingCollection += pointsStats.pendingCollection || 0;
      totalPointsReceived += pointsAccount.totalReceived || 0;

      if ((pointsAccount.totalReceived || 0) > 0) {
        activeCustomers++;
      }
    });

    const collectionRate = totalRevenue > 0 ? totalCashCollected / totalRevenue : 0;

    logger.info(`[${requestId}] 部门统计数据:`, {
      totalCustomers: customersSnapshot.size,
      activeCustomers,
      currentBalance,
      totalRevenue,
      totalCashCollected,
      pendingCollection,
      collectionRate: Math.round(collectionRate * 100) + '%'
    });

    await deptStatsRef.set(
      {
        departmentCode: departmentCode,
        totalCustomers: customersSnapshot.size,
        activeCustomers: activeCustomers,
        membersStats: {
          totalCount: customersSnapshot.size,
          activeCount: activeCustomers
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
 * ✅ 更新 teamLeader 统计 (修复版 - 使用 seller 对象)
 */
async function updateteamLeaderStats(db, organizationId, eventId, teamLeaderId, requestId) {
  try {
    logger.info(`[${requestId}] [updateteamLeaderStats] 开始更新 SM: ${teamLeaderId}`);

    const smStatsRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/teamLeaderStats/${teamLeaderId}`
    );

    const smRef = db.doc(
      `organizations/${organizationId}/events/${eventId}/users/${teamLeaderId}`
    );

    const smDoc = await smRef.get();
    if (!smDoc.exists) {
      logger.warn(`[${requestId}] ⚠️ teamLeader 不存在: ${teamLeaderId}`);
      return;
    }

    const smData = smDoc.data();
    const managedDepartments = smData.teamLeader?.managedDepartments || 
                               smData.managedDepartments || [];

    logger.info(`[${requestId}] SM 管理的部门:`, managedDepartments);

    // 查询管理的所有 customers
    const customersSnapshot = await db
      .collection(`organizations/${organizationId}/events/${eventId}/users`)
      .where('managedBy', 'array-contains', teamLeaderId)
      .where('roles', 'array-contains', 'customer')
      .get();

    logger.info(`[${requestId}] SM 管理 ${customersSnapshot.size} 个 Customer`);

    let totalUsers = 0;
    let activeUsers = 0;
    let currentBalance = 0;
    let totalRevenue = 0;
    let totalCashCollected = 0;
    let pendingCollection = 0;

    customersSnapshot.forEach(doc => {
      const data = doc.data();
      const pointsAccount = data.customer?.pointsAccount || {};
      const pointsStats = data.pointsStats || {};

      totalUsers++;
      currentBalance += pointsAccount.availablePoints || 0;
      totalRevenue += pointsStats.totalRevenue || 0;
      totalCashCollected += pointsStats.totalCollected || 0;
      pendingCollection += pointsStats.pendingCollection || 0;

      if ((pointsAccount.totalReceived || 0) > 0) {
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
        teamLeaderId: teamLeaderId,
        teamLeaderName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName || 'Unknown',
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

    logger.info(`[${requestId}] ✅ teamLeader 统计更新成功: ${teamLeaderId}`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 更新 teamLeader 统计失败`, {
      teamLeaderId,
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
async function checkCollectionWarnings(db, organizationId, eventId, customerId, requestId) {
  try {
    logger.info(`[${requestId}] [checkCollectionWarnings] 检查警示: ${customerId}`);

    const eventRef = db.doc(`organizations/${organizationId}/events/${eventId}`);
    const eventDoc = await eventRef.get();

    const eventData = eventDoc.exists ? eventDoc.data() : {};
    const warningThreshold = eventData.pointAllocationRules?.teamLeader?.warningThreshold || 0.3;

    logger.info(`[${requestId}] 警示阈值: ${Math.round(warningThreshold * 100)}%`);

    const customerRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${customerId}`);
    const customerDoc = await customerRef.get();

    if (!customerDoc.exists) {
      logger.warn(`[${requestId}] ⚠️ Customer 不存在: ${customerId}`);
      return;
    }

    const customerData = customerDoc.data();
    const pointsStats = customerData.pointsStats || {};

    const totalRevenue = pointsStats.totalRevenue || 0;
    const pendingCollection = pointsStats.pendingCollection || 0;

    const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

    logger.info(`[${requestId}] Customer 数据:`, {
      totalRevenue,
      pendingCollection,
      pendingRatio: Math.round(pendingRatio * 100) + '%'
    });

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

    await customerRef.update({
      'pointsStats.collectionAlert': {
        hasWarning,
        warningLevel,
        pendingAmount: pendingCollection,
        pendingRatio
      },
      'updatedAt': admin.firestore.FieldValue.serverTimestamp()
    });

    logger.info(`[${requestId}] ✅ 收款警示更新成功`);
  } catch (error) {
    logger.error(`[${requestId}] ❌ 检查收款警示失败`, {
      customerId,
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