/**
 * Seller Manager Cloud Functions
 * 专门处理 Seller Manager 相关的点数分配、统计维护和警示检查
 * 
 * @version 2025-12-03
 * @region asia-southeast1
 */

const admin = require('firebase-admin');
const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');

// ============================================================================
// 核心函数 1: onSellerManagerAllocation
// ============================================================================

/**
 * 当 Seller Manager 分配点数时自动触发
 * 触发路径: organizations/{orgId}/events/{eventId}/users/{smId}/pointAllocations/{allocId}
 * 
 * 功能:
 * 1. 验证分配额度是否超出限制
 * 2. 更新接收者的 seller.availablePoints
 * 3. 更新接收者的 pointsStats
 * 4. 更新 departmentStats
 * 5. 更新 sellerManagerStats
 * 6. 更新 Event.globalPointsStats
 * 7. 触发收款警示检查
 */
exports.onSellerManagerAllocation = onDocumentCreated(
  {
    document: 'organizations/{orgId}/events/{eventId}/users/{smId}/pointAllocations/{allocId}',
    region: 'asia-southeast1'
  },
  async (event) => {
    const db = admin.firestore();
    const { orgId, eventId, smId, allocId } = event.params;
    const allocation = event.data.data();

    logger.info('[onSellerManagerAllocation] 开始处理分配', {
      orgId, eventId, smId, allocId,
      recipientId: allocation.recipientId,
      points: allocation.points
    });

    // 验证数据完整性
    if (!allocation || !allocation.recipientId || !allocation.points) {
      logger.error('[onSellerManagerAllocation] 分配数据不完整', allocation);
      return { success: false, error: 'Invalid allocation data' };
    }

    try {
      // ========== 第1步: 读取必要的配置和数据 ==========
      const eventRef = db.doc(`organizations/${orgId}/events/${eventId}`);
      const eventDoc = await eventRef.get();
      
      if (!eventDoc.exists) {
        logger.error('[onSellerManagerAllocation] Event 不存在', { eventId });
        return { success: false, error: 'Event not found' };
      }

      const eventData = eventDoc.data();
      const maxPerAllocation = eventData.pointAllocationRules?.sellerManager?.maxPerAllocation || 100;

      // 验证分配额度
      if (allocation.points > maxPerAllocation) {
        logger.warn('[onSellerManagerAllocation] 超出单次分配限额', {
          points: allocation.points,
          maxPerAllocation
        });
        // 不阻止分配，但记录警告
      }

      // ========== 第2步: 更新接收者的点数和统计 ==========
      const recipientRef = db.doc(
        `organizations/${orgId}/events/${eventId}/users/${allocation.recipientId}`
      );

      const recipientDoc = await recipientRef.get();
      if (!recipientDoc.exists) {
        logger.error('[onSellerManagerAllocation] 接收者不存在', {
          recipientId: allocation.recipientId
        });
        return { success: false, error: 'Recipient not found' };
      }

      const recipientData = recipientDoc.data();
      const recipientDept = recipientData.department || recipientData.basicInfo?.department || 'unknown';

      // 创建交易记录（使用时间戳作为键）
      const timestampKey = Date.now().toString();
      const transactionRecord = {
        type: 'allocation',
        amount: allocation.points,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        allocatedBy: 'sellerManager',
        allocatedByUserId: smId,
        allocatedByName: allocation.allocatedByName || 'Seller Manager',
        allocatedByRole: 'sellerManager',
        note: allocation.notes || 'Seller Manager 分配',
        allocationDocId: allocId
      };

      // 更新接收者数据
      await recipientRef.update({
        // 更新可用点数
        'seller.availablePoints': admin.firestore.FieldValue.increment(allocation.points),
        
        // 添加交易记录
        [`seller.transactions.${timestampKey}`]: transactionRecord,
        
        // 更新 pointsStats
        'pointsStats.totalReceived': admin.firestore.FieldValue.increment(allocation.points),
        'pointsStats.receivedFromSellerManager': admin.firestore.FieldValue.increment(allocation.points),
        'pointsStats.currentBalance': admin.firestore.FieldValue.increment(allocation.points),
        
        // 更新账户状态
        'accountStatus.lastUpdated': admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info('[onSellerManagerAllocation] ✅ 成功更新接收者点数', {
        recipientId: allocation.recipientId,
        points: allocation.points,
        department: recipientDept
      });

      // ========== 第3步: 使用批处理更新统计数据 ==========
      const batch = db.batch();

      // 3.1 更新 departmentStats
      const deptStatsRef = db.doc(
        `organizations/${orgId}/events/${eventId}/departmentStats/${recipientDept}`
      );
      
      batch.set(deptStatsRef, {
        departmentCode: recipientDept,
        managedBy: admin.firestore.FieldValue.arrayUnion(smId),
        'pointsStats.totalReceived': admin.firestore.FieldValue.increment(allocation.points),
        'pointsStats.currentBalance': admin.firestore.FieldValue.increment(allocation.points),
        'allocationStats.totalAllocations': admin.firestore.FieldValue.increment(1),
        'allocationStats.bySellerManager.count': admin.firestore.FieldValue.increment(1),
        'allocationStats.bySellerManager.totalPoints': admin.firestore.FieldValue.increment(allocation.points),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 3.2 更新 sellerManagerStats
      const smStatsRef = db.doc(
        `organizations/${orgId}/events/${eventId}/sellerManagerStats/${smId}`
      );
      
      batch.set(smStatsRef, {
        sellerManagerId: smId,
        'allocationStats.totalAllocations': admin.firestore.FieldValue.increment(1),
        'allocationStats.totalPointsAllocated': admin.firestore.FieldValue.increment(allocation.points),
        'allocationStats.lastAllocationAt': admin.firestore.FieldValue.serverTimestamp(),
        'managedUsersStats.totalUsers': recipientData.managedBy?.includes(smId) ? 
          admin.firestore.FieldValue.increment(0) : 
          admin.firestore.FieldValue.increment(1),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 3.3 更新 Event.globalPointsStats
      batch.update(eventRef, {
        'globalPointsStats.totalAllocated': admin.firestore.FieldValue.increment(allocation.points),
        'globalPointsStats.currentCirculation': admin.firestore.FieldValue.increment(allocation.points),
        'globalPointsStats.lastUpdated': admin.firestore.FieldValue.serverTimestamp(),
        
        // 更新角色统计
        'roleStats.sellerManagers.totalAllocations': admin.firestore.FieldValue.increment(1),
        'roleStats.sellerManagers.totalPointsAllocated': admin.firestore.FieldValue.increment(allocation.points)
      });

      // 3.4 提交批处理
      await batch.commit();

      logger.info('[onSellerManagerAllocation] ✅ 成功更新所有统计数据');

      // ========== 第4步: 异步触发收款警示检查 ==========
      // 注意：这里不等待，让它异步执行
      checkCollectionWarningForUser(db, orgId, eventId, allocation.recipientId, eventData)
        .catch(err => {
          logger.error('[onSellerManagerAllocation] 收款警示检查失败', err);
        });

      return { success: true };

    } catch (error) {
      logger.error('[onSellerManagerAllocation] ❌ 处理失败', {
        error: error.message,
        stack: error.stack,
        orgId, eventId, smId, allocId
      });
      
      // 不要抛出错误，避免触发重试
      return { success: false, error: error.message };
    }
  }
);

// ============================================================================
// 核心函数 2: updateUserPointsStats
// ============================================================================

/**
 * 当用户点数相关数据变化时自动维护统计
 * 触发路径: organizations/{orgId}/events/{eventId}/users/{userId}
 * 
 * 功能:
 * 1. 重新计算用户的 pointsStats（基于 seller.transactions）
 * 2. 传播更新到 departmentStats
 * 3. 传播更新到 sellerManagerStats
 * 4. 传播更新到 Event.globalPointsStats
 */
exports.updateUserPointsStats = onDocumentWritten(
  {
    document: 'organizations/{orgId}/events/{eventId}/users/{userId}',
    region: 'asia-southeast1'
  },
  async (event) => {
    const db = admin.firestore();
    const { orgId, eventId, userId } = event.params;
    
    // 获取变更后的数据
    const afterData = event.data?.after?.data();
    const beforeData = event.data?.before?.data();

    // 如果文档被删除，跳过
    if (!afterData) {
      logger.info('[updateUserPointsStats] 用户文档已删除，跳过', { userId });
      return { success: true, skipped: true };
    }

    // 检查是否是 seller.transactions 或 pointsStats 的变化
    const transactionsBefore = beforeData?.seller?.transactions || {};
    const transactionsAfter = afterData?.seller?.transactions || {};
    
    const transactionsChanged = JSON.stringify(transactionsBefore) !== JSON.stringify(transactionsAfter);
    
    if (!transactionsChanged) {
      logger.info('[updateUserPointsStats] 交易未变化，跳过统计更新', { userId });
      return { success: true, skipped: true };
    }

    logger.info('[updateUserPointsStats] 检测到交易变化，开始更新统计', { userId });

    try {
      // ========== 第1步: 重新计算 pointsStats ==========
      const transactions = Object.values(transactionsAfter || {});
      
      const stats = {
        totalReceived: 0,
        receivedFromEventManager: 0,
        receivedFromSellerManager: 0,
        currentBalance: afterData.seller?.availablePoints || 0,
        totalSold: 0,
        totalRevenue: 0,
        totalCollected: 0,
        pendingCollection: 0,
        collectionRate: 0
      };

      transactions.forEach(tx => {
        if (!tx || typeof tx !== 'object') return;

        if (tx.type === 'allocation') {
          stats.totalReceived += tx.amount || 0;
          
          if (tx.allocatedByRole === 'eventManager') {
            stats.receivedFromEventManager += tx.amount || 0;
          } else if (tx.allocatedByRole === 'sellerManager') {
            stats.receivedFromSellerManager += tx.amount || 0;
          }
        } else if (tx.type === 'sale') {
          stats.totalSold += tx.amount || 0;
          stats.totalRevenue += tx.amount || 0;
          
          if (tx.cashCollected) {
            stats.totalCollected += tx.amount || 0;
          }
        }
      });

      stats.pendingCollection = stats.totalRevenue - stats.totalCollected;
      stats.collectionRate = stats.totalRevenue > 0 ? 
        stats.totalCollected / stats.totalRevenue : 0;

      // 更新用户的 pointsStats
      await db.doc(`organizations/${orgId}/events/${eventId}/users/${userId}`).update({
        'pointsStats': stats,
        'accountStatus.lastStatsUpdate': admin.firestore.FieldValue.serverTimestamp()
      });

      logger.info('[updateUserPointsStats] ✅ 成功更新用户统计', {
        userId,
        stats
      });

      // ========== 第2步: 传播到部门统计 ==========
      const department = afterData.department || afterData.basicInfo?.department;
      if (department) {
        await updateDepartmentStatsFromUsers(db, orgId, eventId, department);
      }

      // ========== 第3步: 传播到 Seller Manager 统计 ==========
      const managedBy = afterData.managedBy || [];
      for (const smId of managedBy) {
        await updateSellerManagerStatsFromUsers(db, orgId, eventId, smId);
      }

      // ========== 第4步: 传播到全局统计 ==========
      await updateGlobalPointsStats(db, orgId, eventId);

      return { success: true };

    } catch (error) {
      logger.error('[updateUserPointsStats] ❌ 更新失败', {
        error: error.message,
        userId, orgId, eventId
      });
      return { success: false, error: error.message };
    }
  }
);

// ============================================================================
// 核心函数 3: checkCollectionWarnings
// ============================================================================

/**
 * 检查并更新收款警示
 * 触发路径: organizations/{orgId}/events/{eventId}/users/{userId}
 * 
 * 功能:
 * 1. 计算待收款比例
 * 2. 根据阈值判断警示等级
 * 3. 更新用户的 collectionAlert
 * 4. 更新部门的 collectionAlerts
 * 5. 更新 Seller Manager 的 alerts
 */
exports.checkCollectionWarnings = onDocumentWritten(
  {
    document: 'organizations/{orgId}/events/{eventId}/users/{userId}',
    region: 'asia-southeast1'
  },
  async (event) => {
    const db = admin.firestore();
    const { orgId, eventId, userId } = event.params;
    
    const afterData = event.data?.after?.data();
    if (!afterData) {
      return { success: true, skipped: true };
    }

    // 只在 pointsStats 变化时检查
    const beforeStats = event.data?.before?.data()?.pointsStats;
    const afterStats = afterData.pointsStats;
    
    if (JSON.stringify(beforeStats) === JSON.stringify(afterStats)) {
      return { success: true, skipped: true };
    }

    try {
      // ========== 第1步: 读取警示阈值配置 ==========
      const eventDoc = await db.doc(`organizations/${orgId}/events/${eventId}`).get();
      const eventData = eventDoc.data();
      
      const warningThreshold = eventData?.pointAllocationRules?.sellerManager?.warningThreshold || 0.3;
      const enableWarnings = eventData?.pointAllocationRules?.sellerManager?.enableWarnings !== false;

      if (!enableWarnings) {
        logger.info('[checkCollectionWarnings] 收款警示已禁用', { eventId });
        return { success: true, skipped: true };
      }

      // ========== 第2步: 计算警示等级 ==========
      await checkCollectionWarningForUser(db, orgId, eventId, userId, eventData);

      return { success: true };

    } catch (error) {
      logger.error('[checkCollectionWarnings] ❌ 检查失败', {
        error: error.message,
        userId, orgId, eventId
      });
      return { success: false, error: error.message };
    }
  }
);

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 为单个用户检查并更新收款警示
 */
async function checkCollectionWarningForUser(db, orgId, eventId, userId, eventData) {
  const userRef = db.doc(`organizations/${orgId}/events/${eventId}/users/${userId}`);
  const userDoc = await userRef.get();
  
  if (!userDoc.exists) return;
  
  const userData = userDoc.data();
  const pointsStats = userData.pointsStats || {};
  
  const totalRevenue = pointsStats.totalRevenue || 0;
  const pendingCollection = pointsStats.pendingCollection || 0;
  const collectionRate = pointsStats.collectionRate || 0;
  
  const warningThreshold = eventData?.pointAllocationRules?.sellerManager?.warningThreshold || 0.3;
  
  // 计算警示等级
  let warningLevel = 'none';
  let warningMessage = '';
  
  if (totalRevenue > 0 && pendingCollection > 0) {
    const pendingRatio = pendingCollection / totalRevenue;
    
    if (pendingRatio >= 0.5) {
      warningLevel = 'high';
      warningMessage = `待收款比例高达 ${Math.round(pendingRatio * 100)}%`;
    } else if (pendingRatio >= warningThreshold) {
      warningLevel = 'medium';
      warningMessage = `待收款比例 ${Math.round(pendingRatio * 100)}%`;
    } else if (pendingRatio > 0) {
      warningLevel = 'low';
      warningMessage = `有少量待收款项`;
    }
  }
  
  // 更新用户的 collectionAlert
  await userRef.update({
    'collectionAlert': {
      level: warningLevel,
      message: warningMessage,
      pendingAmount: pendingCollection,
      collectionRate: collectionRate,
      lastChecked: admin.firestore.FieldValue.serverTimestamp()
    }
  });
  
  logger.info('[checkCollectionWarningForUser] ✅ 更新收款警示', {
    userId,
    warningLevel,
    pendingCollection,
    collectionRate
  });
}

/**
 * 从用户数据重新计算部门统计
 */
async function updateDepartmentStatsFromUsers(db, orgId, eventId, departmentCode) {
  const usersSnapshot = await db
    .collection(`organizations/${orgId}/events/${eventId}/users`)
    .where('department', '==', departmentCode)
    .get();
  
  const stats = {
    totalCount: 0,
    activeCount: 0,
    totalReceived: 0,
    currentBalance: 0,
    totalSold: 0,
    totalRevenue: 0,
    totalCollected: 0,
    pendingCollection: 0,
    collectionRate: 0
  };
  
  let usersWithWarnings = 0;
  const highRiskUsers = [];
  
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    const ps = data.pointsStats || {};
    
    stats.totalCount++;
    if (ps.totalRevenue > 0) stats.activeCount++;
    
    stats.totalReceived += ps.totalReceived || 0;
    stats.currentBalance += ps.currentBalance || 0;
    stats.totalSold += ps.totalSold || 0;
    stats.totalRevenue += ps.totalRevenue || 0;
    stats.totalCollected += ps.totalCollected || 0;
    stats.pendingCollection += ps.pendingCollection || 0;
    
    // 收款警示统计
    const alert = data.collectionAlert;
    if (alert && alert.level !== 'none') {
      usersWithWarnings++;
      if (alert.level === 'high') {
        highRiskUsers.push(doc.id);
      }
    }
  });
  
  stats.collectionRate = stats.totalRevenue > 0 ? 
    stats.totalCollected / stats.totalRevenue : 0;
  
  // 更新部门统计文档
  await db.doc(`organizations/${orgId}/events/${eventId}/departmentStats/${departmentCode}`).set({
    departmentCode,
    'membersStats': {
      totalCount: stats.totalCount,
      activeCount: stats.activeCount
    },
    'pointsStats': {
      totalReceived: stats.totalReceived,
      currentBalance: stats.currentBalance,
      totalSold: stats.totalSold,
      totalRevenue: stats.totalRevenue,
      totalCollected: stats.totalCollected,
      pendingCollection: stats.pendingCollection,
      collectionRate: stats.collectionRate
    },
    'collectionAlerts': {
      usersWithWarnings,
      highRiskUsers
    },
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  
  logger.info('[updateDepartmentStatsFromUsers] ✅ 更新部门统计', {
    departmentCode,
    stats
  });
}

/**
 * 从用户数据重新计算 Seller Manager 统计
 */
async function updateSellerManagerStatsFromUsers(db, orgId, eventId, sellerManagerId) {
  const usersSnapshot = await db
    .collection(`organizations/${orgId}/events/${eventId}/users`)
    .where('managedBy', 'array-contains', sellerManagerId)
    .get();
  
  const stats = {
    totalUsers: 0,
    activeUsers: 0,
    totalReceived: 0,
    currentBalance: 0,
    totalSold: 0,
    totalRevenue: 0,
    totalCollected: 0,
    pendingCollection: 0,
    collectionRate: 0
  };
  
  let usersWithWarnings = 0;
  let highRiskUsers = 0;
  
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    const ps = data.pointsStats || {};
    
    stats.totalUsers++;
    if (ps.totalRevenue > 0) stats.activeUsers++;
    
    stats.totalReceived += ps.totalReceived || 0;
    stats.currentBalance += ps.currentBalance || 0;
    stats.totalSold += ps.totalSold || 0;
    stats.totalRevenue += ps.totalRevenue || 0;
    stats.totalCollected += ps.totalCollected || 0;
    stats.pendingCollection += ps.pendingCollection || 0;
    
    const alert = data.collectionAlert;
    if (alert && alert.level !== 'none') {
      usersWithWarnings++;
      if (alert.level === 'high') highRiskUsers++;
    }
  });
  
  stats.collectionRate = stats.totalRevenue > 0 ? 
    stats.totalCollected / stats.totalRevenue : 0;
  
  // 更新 Seller Manager 统计文档
  await db.doc(`organizations/${orgId}/events/${eventId}/sellerManagerStats/${sellerManagerId}`).set({
    sellerManagerId,
    'managedUsersStats': stats,
    'collectionManagement': {
      usersWithWarnings,
      highRiskUsers
    },
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  
  logger.info('[updateSellerManagerStatsFromUsers] ✅ 更新 Seller Manager 统计', {
    sellerManagerId,
    stats
  });
}

/**
 * 重新计算全局点数统计
 */
async function updateGlobalPointsStats(db, orgId, eventId) {
  const usersSnapshot = await db
    .collection(`organizations/${orgId}/events/${eventId}/users`)
    .get();
  
  const globalStats = {
    totalAllocated: 0,
    currentCirculation: 0,
    totalSold: 0,
    totalRevenue: 0,
    totalCollected: 0,
    pendingCollection: 0,
    collectionRate: 0
  };
  
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    const ps = data.pointsStats || {};
    
    globalStats.totalAllocated += ps.totalReceived || 0;
    globalStats.currentCirculation += ps.currentBalance || 0;
    globalStats.totalSold += ps.totalSold || 0;
    globalStats.totalRevenue += ps.totalRevenue || 0;
    globalStats.totalCollected += ps.totalCollected || 0;
    globalStats.pendingCollection += ps.pendingCollection || 0;
  });
  
  globalStats.collectionRate = globalStats.totalRevenue > 0 ? 
    globalStats.totalCollected / globalStats.totalRevenue : 0;
  
  // 更新 Event 的全局统计
  await db.doc(`organizations/${orgId}/events/${eventId}`).update({
    'globalPointsStats': {
      ...globalStats,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      lastCalculated: admin.firestore.FieldValue.serverTimestamp()
    }
  });
  
  logger.info('[updateGlobalPointsStats] ✅ 更新全局统计', { globalStats });
}

// ============================================================================
// 导出所有函数
// ============================================================================

module.exports = {
  onSellerManagerAllocation: exports.onSellerManagerAllocation,
  updateUserPointsStats: exports.updateUserPointsStats,
  checkCollectionWarnings: exports.checkCollectionWarnings
};
