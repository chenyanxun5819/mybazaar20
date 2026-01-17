/**
 * toggleMerchantStatusHttp
 * 切换摊位营业状态
 * 
 * 功能：
 * 1. 验证权限（merchantManager, eventManager, merchantOwner）
 * 2. 切换营业状态（营业中 ↔ 已暂停）
 * 3. 记录状态变更历史（可选）
 * 4. 返回更新结果
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织 ID
 * @param {string} data.eventId - 活动 ID
 * @param {string} data.merchantId - 摊位 ID
 * @param {boolean} data.isActive - 营业状态（true=营业中，false=已暂停）
 * @param {string} data.pauseReason - 暂停原因（可选，仅当 isActive=false 时）
 * 
 * @returns {object} 更新结果
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.toggleMerchantStatusHttp = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;
  
  // ============================================
  // 1. 权限验证
  // ============================================
  if (!auth) {
    throw new HttpsError('unauthenticated', '用户未认证');
  }
  
  const callerId = auth.uid;
  const { organizationId, eventId, merchantId, isActive, pauseReason } = data;

  // 验证必填参数
  if (!organizationId || !eventId || !merchantId || isActive === undefined) {
    throw new HttpsError(
      'invalid-argument',
      '缺少必填参数：organizationId, eventId, merchantId, isActive'
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
  
  // 权限检查
  const isMerchantManager = callerData.roles?.includes('merchantManager');
  const isEventManager = callerData.roles?.includes('eventManager');
  const isMerchantOwner = merchantData.merchantOwnerId === callerId;
  
  if (!isMerchantManager && !isEventManager && !isMerchantOwner) {
    throw new HttpsError(
      'permission-denied',
      '没有权限修改此摊位状态'
    );
  }

  // ============================================
  // 2. 更新营业状态
  // ============================================
  const now = admin.firestore.FieldValue.serverTimestamp();
  const oldStatus = merchantData.operationStatus.isActive;

  // 如果状态没有变化，返回提示
  if (oldStatus === isActive) {
    return {
      success: true,
      message: `摊位已经是${isActive ? '营业中' : '已暂停'}状态`,
      statusChanged: false,
      isActive: isActive
    };
  }

  try {
    // 更新摊位状态
    const updates = {
      'operationStatus.isActive': isActive,
      'operationStatus.lastStatusChange': now,
      'operationStatus.pauseReason': isActive ? '' : (pauseReason || ''),
      'metadata.updatedAt': now,
      'metadata.lastUpdatedBy': callerId
    };

    await merchantRef.update(updates);

    // ============================================
    // 3. 返回成功结果
    // ============================================
    console.log(`✅ 摊位状态切换成功: ${merchantId} ${oldStatus ? '营业中' : '已暂停'} → ${isActive ? '营业中' : '已暂停'} by ${callerId}`);
    
    return {
      success: true,
      message: `摊位已${isActive ? '开始营业' : '暂停营业'}`,
      statusChanged: true,
      oldStatus: oldStatus,
      newStatus: isActive,
      pauseReason: isActive ? null : (pauseReason || ''),
      changedBy: callerId,
      changedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error('❌ 切换摊位状态失败:', error);
    throw new HttpsError(
      'internal',
      `切换摊位状态失败: ${error.message}`
    );
  }
});

// ============================================
// 使用示例
// ============================================
/*
// 前端调用示例

// 示例 1: 暂停营业
const toggleStatus = httpsCallable(functions, 'toggleMerchantStatusHttp');

const result1 = await toggleStatus({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  isActive: false,
  pauseReason: '临时休息'
});

// 示例 2: 恢复营业
const result2 = await toggleStatus({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  isActive: true
});

console.log('状态切换结果:', result.data);
// {
//   success: true,
//   message: '摊位已开始营业',
//   statusChanged: true,
//   oldStatus: false,
//   newStatus: true,
//   changedBy: 'userId',
//   changedAt: '2026-01-14T10:30:00.000Z'
// }
*/
