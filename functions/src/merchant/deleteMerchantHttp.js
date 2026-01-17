/**
 * deleteMerchantHttp
 * 删除摊位
 * 
 * ⭐ 修复内容（2026-01-17）:
 * 1. 清除 merchantAsist 时使用 merchantId 单一字段（不再使用 assignedMerchants 数组）
 * 2. 完整清空 merchantAsist 对象的所有字段
 * 3. 记录删除信息到 assignmentInfo
 * 
 * 功能：
 * 1. 验证权限（仅 merchantManager 或 eventManager）
 * 2. 检查是否有未完成的交易
 * 3. 软删除：设置 isActive=false + deletedAt（默认）
 * 4. 硬删除：删除 merchant 文档（需明确指定）
 * 5. 清除相关 users 的关联
 * 6. 更新 events.roleStats
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织 ID
 * @param {string} data.eventId - 活动 ID
 * @param {string} data.merchantId - 摊位 ID
 * @param {boolean} data.hardDelete - 是否硬删除（默认 false，软删除）
 * @param {string} data.deleteReason - 删除原因（可选）
 * 
 * @returns {object} 删除结果
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.deleteMerchantHttp = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;
  
  // ============================================
  // 1. 权限验证
  // ============================================
  if (!auth) {
    throw new HttpsError('unauthenticated', '用户未认证');
  }
  
  const callerId = auth.uid;

  const { organizationId, eventId, merchantId, hardDelete, deleteReason } = data;

  // 验证必填参数
  if (!organizationId || !eventId || !merchantId) {
    throw new HttpsError(
      'invalid-argument',
      '缺少必填参数：organizationId, eventId, merchantId'
    );
  }

  const db = admin.firestore();
  
  // 获取 merchant 文档
  const merchantRef = db.collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('merchants').doc(merchantId);
  
  const merchantDoc = await merchantRef.get();
  if (!merchantDoc.exists) {
    throw new HttpsError(
      'not-found',
      `摊位 ${merchantId} 不存在`
    );
  }

  const merchantData = merchantDoc.data();

  // 获取调用者信息
  const callerRef = db.collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users').doc(callerId);
  
  const callerDoc = await callerRef.get();
  if (!callerDoc.exists) {
    throw new HttpsError(
      'permission-denied',
      '用户不属于此活动'
    );
  }

  const callerData = callerDoc.data();
  
  // 权限检查：只有 merchantManager 或 eventManager 可以删除
  const isMerchantManager = callerData.roles?.includes('merchantManager');
  const isEventManager = callerData.roles?.includes('eventManager');
  
  if (!isMerchantManager && !isEventManager) {
    throw new HttpsError(
      'permission-denied',
      '只有 merchantManager 或 eventManager 可以删除摊位'
    );
  }

  // ============================================
  // 2. 检查未完成的交易
  // ============================================
  const transactionsRef = db.collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('transactions');
  
  const pendingTransactions = await transactionsRef
    .where('merchantId', '==', merchantId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (!pendingTransactions.empty) {
    throw new HttpsError(
      'failed-precondition',
      '该摊位还有未完成的交易，无法删除。请先处理所有待处理的交易。'
    );
  }

  // ============================================
  // 3. 执行删除
  // ============================================
  const now = admin.firestore.FieldValue.serverTimestamp();
  const ownerId = merchantData.merchantOwnerId;
  const asistIds = merchantData.merchantAsists || [];

  try {
    await db.runTransaction(async (transaction) => {
      if (hardDelete) {
        // ============================================
        // 硬删除：删除 merchant 文档
        // ============================================
        transaction.delete(merchantRef);

        console.log(`🗑️ 硬删除摊位: ${merchantId}`);

      } else {
        // ============================================
        // 软删除：标记为删除
        // ============================================
        transaction.update(merchantRef, {
          'operationStatus.isActive': false,
          'operationStatus.pauseReason': deleteReason || '已删除',
          'metadata.deletedAt': now,
          'metadata.deletedBy': callerId,
          'metadata.deleteReason': deleteReason || '',
          'metadata.updatedAt': now
        });

        console.log(`📦 软删除摊位: ${merchantId}`);
      }

      // ============================================
      // 清除 merchantOwner 关联
      // ============================================
      if (ownerId) {
        const ownerRef = db.collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(ownerId);
        
        transaction.update(ownerRef, {
          'merchantOwner.merchantId': null,
          'merchantOwner.stallName': null,
          'merchantOwner.assignedAt': null,
          'merchantOwner.assignedBy': null,
          'updatedAt': now
        });
      }

      // ============================================
      // ⭐ 清除 merchantAsists 关联（使用 merchantId 单一字段）
      // ============================================
      for (const asistId of asistIds) {
        const asistRef = db.collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(asistId);
        
        // ⭐ 核心修复：清空 merchantId 和相关字段，不再使用 assignedMerchants 数组
        transaction.update(asistRef, {
          'merchantAsist.merchantId': null,
          'merchantAsist.stallName': null,
          'merchantAsist.merchantOwnerId': null,
          'merchantAsist.assignmentInfo.isActive': false,
          'merchantAsist.assignmentInfo.removedAt': now,
          'merchantAsist.assignmentInfo.removedBy': callerId,
          'merchantAsist.assignmentInfo.removedReason': deleteReason || '摊位已删除',
          'updatedAt': now
        });
      }

      // ============================================
      // 更新 events.roleStats
      // ============================================
      const eventRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId);
      
      const eventUpdates = {
        'roleStats.merchants.count': admin.firestore.FieldValue.increment(-1),
        'roleStats.merchants.totalAsistsCount': admin.firestore.FieldValue.increment(-asistIds.length),
        'updatedAt': now
      };

      // 如果摊位有助理，减少 withAsistsCount
      if (asistIds.length > 0) {
        eventUpdates['roleStats.merchants.withAsistsCount'] = admin.firestore.FieldValue.increment(-1);
      }

      transaction.update(eventRef, eventUpdates);
    });

    // ============================================
    // 4. 返回成功结果
    // ============================================
    console.log(`✅ 删除摊位成功: ${merchantId} (${hardDelete ? '硬删除' : '软删除'}) by ${callerId}`);
    
    return {
      success: true,
      message: `摊位已${hardDelete ? '永久删除' : '删除'}`,
      merchantId: merchantId,
      deleteType: hardDelete ? 'hard' : 'soft',
      deletedBy: callerId,
      deletedAt: new Date().toISOString(),
      clearedRelations: {
        merchantOwner: ownerId ? 1 : 0,
        merchantAsists: asistIds.length
      }
    };

  } catch (error) {
    console.error('❌ 删除摊位失败:', error);
    throw new HttpsError(
      'internal',
      `删除摊位失败: ${error.message}`
    );
  }
});

// ============================================
// 使用示例
// ============================================
/*
// 前端调用示例

// 示例 1: 软删除（默认，推荐）
const deleteMerchant = httpsCallable(functions, 'deleteMerchantHttp');

const result1 = await deleteMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  hardDelete: false,  // 或不传此参数（默认 false）
  deleteReason: '摊位已撤展'
});

// 示例 2: 硬删除（永久删除，谨慎使用）
const result2 = await deleteMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  hardDelete: true,  // ⚠️ 永久删除，无法恢复
  deleteReason: '测试数据'
});

console.log('删除结果:', result.data);
// {
//   success: true,
//   message: '摊位已删除',
//   merchantId: 'merchant789',
//   deleteType: 'soft',
//   deletedBy: 'userId',
//   deletedAt: '2026-01-14T10:30:00.000Z',
//   clearedRelations: {
//     merchantOwner: 1,
//     merchantAsists: 2
//   }
// }

// ============================================
// 软删除 vs 硬删除
// ============================================
// 
// 软删除（推荐）：
// ✅ 数据保留在数据库中
// ✅ 可以恢复（手动修改 deletedAt）
// ✅ 保留历史记录
// ✅ 相关交易记录不受影响
// ❌ 占用存储空间
// 
// 硬删除（谨慎）：
// ✅ 彻底删除，释放空间
// ❌ 无法恢复
// ❌ 可能影响数据完整性
// ⚠️ 仅用于测试数据或确定不需要的数据
// 
// 建议：
// - 生产环境：始终使用软删除
// - 测试环境：可以使用硬删除清理测试数据
*/