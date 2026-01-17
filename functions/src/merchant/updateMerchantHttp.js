/**
 * updateMerchantHttp
 * 更新摊位信息
 * 
 * 功能：
 * 1. 验证权限（merchantManager, eventManager, merchantOwner）
 * 2. 更新基本信息（stallName, description, contactInfo）
 * 3. 更换 merchantOwner（可选）
 * 4. 管理 merchantAsists（添加/移除）
 * 5. 更新营业状态（可选）
 * 6. 同步更新 users 集合
 * 7. 更新 events.roleStats
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织 ID
 * @param {string} data.eventId - 活动 ID
 * @param {string} data.merchantId - 摊位 ID
 * @param {object} data.updates - 更新数据
 * @param {string} data.updates.stallName - 摊位名称（可选）
 * @param {string} data.updates.description - 摊位描述（可选）
 * @param {object} data.updates.contactInfo - 联系方式（可选）
 * @param {string} data.updates.newMerchantOwnerId - 新摊主 ID（可选，null 表示移除摊主）
 * @param {object} data.updates.merchantAsists - 助理管理（可选）
 * @param {string[]} data.updates.merchantAsists.add - 要添加的助理 ID 数组
 * @param {string[]} data.updates.merchantAsists.remove - 要移除的助理 ID 数组
 * @param {boolean} data.updates.isActive - 营业状态（可选）
 * @param {string} data.updates.pauseReason - 暂停原因（可选）
 * 
 * @returns {object} 更新结果
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.updateMerchantHttp = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;
  
  // ============================================
  // 1. 权限验证
  // ============================================
  if (!auth) {
    throw new HttpsError('unauthenticated', '用户未认证');
  }
  
  const callerId = auth.uid;

  const { organizationId, eventId, merchantId, updates } = data;

  // 验证必填参数
  if (!organizationId || !eventId || !merchantId || !updates) {
    throw new HttpsError(
      'invalid-argument',
      '缺少必填参数：organizationId, eventId, merchantId, updates'
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
      '没有权限修改此摊位'
    );
  }

  // merchantOwner 只能修改部分字段
  const ownerAllowedFields = ['stallName', 'description', 'contactInfo', 'isActive', 'pauseReason'];
  if (isMerchantOwner && !isMerchantManager && !isEventManager) {
    const updatingFields = Object.keys(updates);
    const hasUnauthorizedField = updatingFields.some(field => !ownerAllowedFields.includes(field));
    
    if (hasUnauthorizedField) {
      throw new HttpsError(
        'permission-denied',
        'merchantOwner 只能修改 stallName, description, contactInfo, isActive'
      );
    }
  }

  // ============================================
  // 2. 验证更新数据
  // ============================================
  const now = admin.firestore.FieldValue.serverTimestamp();
  const merchantUpdates = {};
  let needsTransaction = false;

  // 2.1 基本信息更新
  if (updates.stallName !== undefined) {
    merchantUpdates.stallName = updates.stallName;
  }

  if (updates.description !== undefined) {
    merchantUpdates.description = updates.description;
  }

  if (updates.contactInfo !== undefined) {
    merchantUpdates['contactInfo.phone'] = updates.contactInfo.phone || merchantData.contactInfo.phone;
    merchantUpdates['contactInfo.email'] = updates.contactInfo.email || '';
    merchantUpdates['contactInfo.note'] = updates.contactInfo.note || '';
  }

  // 2.2 营业状态更新
  if (updates.isActive !== undefined) {
    merchantUpdates['operationStatus.isActive'] = updates.isActive;
    merchantUpdates['operationStatus.lastStatusChange'] = now;
    if (updates.pauseReason !== undefined) {
      merchantUpdates['operationStatus.pauseReason'] = updates.pauseReason;
    }
  }

  // 2.3 更换 merchantOwner（需要 transaction）
  let oldOwnerId = null;
  let newOwnerId = null;
  
  if (updates.newMerchantOwnerId !== undefined) {
    needsTransaction = true;
    oldOwnerId = merchantData.merchantOwnerId;
    newOwnerId = updates.newMerchantOwnerId;

    // 验证新 owner（如果不是 null）
    if (newOwnerId) {
      const newOwnerRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(newOwnerId);
      
      const newOwnerDoc = await newOwnerRef.get();
      if (!newOwnerDoc.exists) {
        throw new HttpsError(
          'not-found',
          `merchantOwner ${newOwnerId} 不存在`
        );
      }

      const newOwnerData = newOwnerDoc.data();
      
      if (!newOwnerData.roles?.includes('merchantOwner')) {
        throw new HttpsError(
          'invalid-argument',
          `用户 ${newOwnerId} 不是 merchantOwner`
        );
      }

      // 验证新 owner 是否已被分配
      if (newOwnerData.merchantOwner?.merchantId && newOwnerData.merchantOwner.merchantId !== merchantId) {
        throw new HttpsError(
          'already-exists',
          `merchantOwner ${newOwnerId} 已被分配给摊位 ${newOwnerData.merchantOwner.merchantId}`
        );
      }
    }

    merchantUpdates.merchantOwnerId = newOwnerId;
  }

  // 2.4 管理 merchantAsists（需要 transaction）
  let asistsToAdd = [];
  let asistsToRemove = [];
  
  if (updates.merchantAsists) {
    needsTransaction = true;
    
    if (updates.merchantAsists.add && updates.merchantAsists.add.length > 0) {
      asistsToAdd = updates.merchantAsists.add;
      
      // 验证添加后的总数不超过 5
      const currentAsistsCount = merchantData.merchantAsistsCount || 0;
      const newTotalCount = currentAsistsCount + asistsToAdd.length - (updates.merchantAsists.remove?.length || 0);
      
      if (newTotalCount > 5) {
        throw new HttpsError(
          'invalid-argument',
          `助理总数不能超过 5 人，当前：${currentAsistsCount}，尝试添加：${asistsToAdd.length}`
        );
      }

      // 验证每个助理
      for (const asistId of asistsToAdd) {
        const asistRef = db.collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(asistId);
        
        const asistDoc = await asistRef.get();
        if (!asistDoc.exists) {
          throw new HttpsError(
            'not-found',
            `merchantAsist ${asistId} 不存在`
          );
        }

        const asistData = asistDoc.data();
        
        if (!asistData.roles?.includes('merchantAsist')) {
          throw new HttpsError(
            'invalid-argument',
            `用户 ${asistId} 不是 merchantAsist`
          );
        }
      }
    }

    if (updates.merchantAsists.remove && updates.merchantAsists.remove.length > 0) {
      asistsToRemove = updates.merchantAsists.remove;
    }
  }

  // ============================================
  // 3. 执行更新
  // ============================================
  try {
    if (needsTransaction) {
      // 使用 transaction 处理复杂更新
      await db.runTransaction(async (transaction) => {
        // 3.1 更新 merchant 文档
        const finalUpdates = {
          ...merchantUpdates,
          'metadata.updatedAt': now,
          'metadata.lastUpdatedBy': callerId
        };

        // 处理助理数组
        if (asistsToAdd.length > 0) {
          finalUpdates.merchantAsists = admin.firestore.FieldValue.arrayUnion(...asistsToAdd);
          finalUpdates.merchantAsistsCount = admin.firestore.FieldValue.increment(asistsToAdd.length);
        }
        if (asistsToRemove.length > 0) {
          finalUpdates.merchantAsists = admin.firestore.FieldValue.arrayRemove(...asistsToRemove);
          finalUpdates.merchantAsistsCount = admin.firestore.FieldValue.increment(-asistsToRemove.length);
        }

        transaction.update(merchantRef, finalUpdates);

        // 3.2 更新旧 owner（如果有）
        if (oldOwnerId && newOwnerId !== oldOwnerId) {
          const oldOwnerRef = db.collection('organizations').doc(organizationId)
            .collection('events').doc(eventId)
            .collection('users').doc(oldOwnerId);
          
          transaction.update(oldOwnerRef, {
            'merchantOwner.merchantId': null,
            'merchantOwner.stallName': null,
            'merchantOwner.assignedAt': null,
            'merchantOwner.assignedBy': null,
            'updatedAt': now
          });
        }

        // 3.3 更新新 owner（如果有）
        if (newOwnerId) {
          const newOwnerRef = db.collection('organizations').doc(organizationId)
            .collection('events').doc(eventId)
            .collection('users').doc(newOwnerId);
          
          transaction.update(newOwnerRef, {
            'merchantOwner.merchantId': merchantId,
            'merchantOwner.stallName': updates.stallName || merchantData.stallName,
            'merchantOwner.assignedAt': now,
            'merchantOwner.assignedBy': callerId,
            'updatedAt': now
          });
        }

        // 3.4 添加助理
        for (const asistId of asistsToAdd) {
          const asistRef = db.collection('organizations').doc(organizationId)
            .collection('events').doc(eventId)
            .collection('users').doc(asistId);
          
          transaction.update(asistRef, {
            'merchantAsist.assignedMerchants': admin.firestore.FieldValue.arrayUnion(merchantId),
            'updatedAt': now
          });
        }

        // 3.5 移除助理
        for (const asistId of asistsToRemove) {
          const asistRef = db.collection('organizations').doc(organizationId)
            .collection('events').doc(eventId)
            .collection('users').doc(asistId);
          
          transaction.update(asistRef, {
            'merchantAsist.assignedMerchants': admin.firestore.FieldValue.arrayRemove(merchantId),
            'updatedAt': now
          });
        }

        // 3.6 更新 events.roleStats（如果有助理变化）
        if (asistsToAdd.length > 0 || asistsToRemove.length > 0) {
          const eventRef = db.collection('organizations').doc(organizationId)
            .collection('events').doc(eventId);
          
          const asistsDiff = asistsToAdd.length - asistsToRemove.length;
          
          const eventUpdates = {
            'roleStats.merchants.totalAsistsCount': admin.firestore.FieldValue.increment(asistsDiff),
            'updatedAt': now
          };

          // 如果摊位之前没有助理，现在有了，增加 withAsistsCount
          const currentAsistsCount = merchantData.merchantAsistsCount || 0;
          const newAsistsCount = currentAsistsCount + asistsDiff;
          if (currentAsistsCount === 0 && newAsistsCount > 0) {
            eventUpdates['roleStats.merchants.withAsistsCount'] = admin.firestore.FieldValue.increment(1);
          }
          // 如果摊位之前有助理，现在没有了，减少 withAsistsCount
          else if (currentAsistsCount > 0 && newAsistsCount === 0) {
            eventUpdates['roleStats.merchants.withAsistsCount'] = admin.firestore.FieldValue.increment(-1);
          }

          transaction.update(eventRef, eventUpdates);
        }
      });

    } else {
      // 简单更新，不需要 transaction
      await merchantRef.update({
        ...merchantUpdates,
        'metadata.updatedAt': now,
        'metadata.lastUpdatedBy': callerId
      });
    }

    // ============================================
    // 4. 返回成功结果
    // ============================================
    console.log(`✅ 摊位更新成功: ${merchantId} by ${callerId}`);
    
    // 获取更新后的数据
    const updatedMerchant = await merchantRef.get();
    const updatedData = updatedMerchant.data();

    return {
      success: true,
      merchantId: merchantId,
      message: '摊位更新成功',
      updates: {
        basicInfo: updates.stallName || updates.description || updates.contactInfo ? true : false,
        ownerChanged: oldOwnerId !== newOwnerId,
        asistsAdded: asistsToAdd.length,
        asistsRemoved: asistsToRemove.length,
        statusChanged: updates.isActive !== undefined
      },
      merchant: {
        stallName: updatedData.stallName,
        merchantOwnerId: updatedData.merchantOwnerId,
        merchantAsistsCount: updatedData.merchantAsistsCount,
        isActive: updatedData.operationStatus.isActive
      }
    };

  } catch (error) {
    console.error('❌ 更新摊位失败:', error);
    throw new HttpsError(
      'internal',
      `更新摊位失败: ${error.message}`
    );
  }
});

// ============================================
// 使用示例
// ============================================
/*
// 前端调用示例

// 示例 1: 更新基本信息
const updateMerchant = httpsCallable(functions, 'updateMerchantHttp');

const result1 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    stallName: '美食天地（新）',
    description: '提供各种美食',
    contactInfo: {
      phone: '+60123456789',
      email: 'food@example.com'
    }
  }
});

// 示例 2: 更换摊主
const result2 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    newMerchantOwnerId: 'newOwnerUserId'  // 新摊主
  }
});

// 示例 3: 移除摊主
const result3 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    newMerchantOwnerId: null  // 移除摊主
  }
});

// 示例 4: 管理助理
const result4 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    merchantAsists: {
      add: ['asist1', 'asist2'],      // 添加 2 个助理
      remove: ['oldAsist1']           // 移除 1 个助理
    }
  }
});

// 示例 5: 切换营业状态
const result5 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    isActive: false,
    pauseReason: '临时休息'
  }
});

// 示例 6: 综合更新
const result6 = await updateMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  merchantId: 'merchant789',
  updates: {
    stallName: '新名称',
    newMerchantOwnerId: 'newOwner',
    merchantAsists: {
      add: ['asist1'],
      remove: ['oldAsist']
    },
    isActive: true
  }
});

console.log('更新成功:', result.data);
*/
