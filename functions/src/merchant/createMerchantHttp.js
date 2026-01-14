/**
 * createMerchantHttp
 * 创建新摊位（merchants）
 * 
 * 功能：
 * 1. 验证权限（merchantManager 或 eventManager）
 * 2. 验证 merchantOwnerId 是否已被分配
 * 3. 验证 merchantAsists 数量（最多5人）
 * 4. 创建 merchant 文档
 * 5. 生成 QR Code 数据
 * 6. 更新 users.merchantOwner.merchantId
 * 7. 更新 users.merchantAsist.assignedMerchants
 * 8. 更新 events.roleStats.merchants
 * 9. 返回新摊位信息
 * 
 * @param {object} data
 * @param {string} data.organizationId - 组织 ID
 * @param {string} data.eventId - 活动 ID
 * @param {string} data.stallName - 摊位名称
 * @param {string} data.description - 摊位描述（可选）
 * @param {object} data.contactInfo - 联系方式
 * @param {string} data.contactInfo.phone - 联系电话
 * @param {string} data.contactInfo.email - 联系邮箱（可选）
 * @param {string} data.contactInfo.note - 备注（可选）
 * @param {string} data.merchantOwnerId - 摊主 ID（可选）
 * @param {string[]} data.merchantAsists - 助理 ID 数组（可选，最多5人）
 * @param {boolean} data.isActive - 是否营业中（默认 false）
 * 
 * @returns {object} 新创建的摊位信息
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.createMerchantHttp = functions.https.onCall(async (data, context) => {
  // ============================================
  // 1. 权限验证
  // ============================================
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      '用户未登录'
    );
  }

  const callerId = context.auth.uid;
  const { organizationId, eventId, stallName, description, contactInfo, merchantOwnerId, merchantAsists, isActive } = data;

  // 验证必填参数
  if (!organizationId || !eventId || !stallName || !contactInfo?.phone) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      '缺少必填参数：organizationId, eventId, stallName, contactInfo.phone'
    );
  }

  const db = admin.firestore();
  
  // 验证调用者权限
  const callerRef = db.collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users').doc(callerId);
  
  const callerDoc = await callerRef.get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError(
      'permission-denied',
      '用户不属于此活动'
    );
  }

  const callerData = callerDoc.data();
  const hasPermission = callerData.roles?.includes('merchantManager') || 
                       callerData.roles?.includes('eventManager');
  
  if (!hasPermission) {
    throw new functions.https.HttpsError(
      'permission-denied',
      '只有 merchantManager 或 eventManager 可以创建摊位'
    );
  }

  // ============================================
  // 2. 验证 merchantOwner（如果提供）
  // ============================================
  if (merchantOwnerId) {
    const ownerRef = db.collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(merchantOwnerId);
    
    const ownerDoc = await ownerRef.get();
    if (!ownerDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        `merchantOwner ${merchantOwnerId} 不存在`
      );
    }

    const ownerData = ownerDoc.data();
    
    // 验证是否有 merchantOwner 角色
    if (!ownerData.roles?.includes('merchantOwner')) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `用户 ${merchantOwnerId} 不是 merchantOwner`
      );
    }

    // 验证是否已被分配
    if (ownerData.merchantOwner?.merchantId) {
      throw new functions.https.HttpsError(
        'already-exists',
        `merchantOwner ${merchantOwnerId} 已被分配给摊位 ${ownerData.merchantOwner.merchantId}`
      );
    }
  }

  // ============================================
  // 3. 验证 merchantAsists（如果提供）
  // ============================================
  const validatedAsists = [];
  if (merchantAsists && merchantAsists.length > 0) {
    // 检查数量
    if (merchantAsists.length > 5) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `助理数量不能超过 5 人，当前：${merchantAsists.length}`
      );
    }

    // 验证每个助理
    for (const asistId of merchantAsists) {
      const asistRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(asistId);
      
      const asistDoc = await asistRef.get();
      if (!asistDoc.exists) {
        throw new functions.https.HttpsError(
          'not-found',
          `merchantAsist ${asistId} 不存在`
        );
      }

      const asistData = asistDoc.data();
      
      // 验证是否有 merchantAsist 角色
      if (!asistData.roles?.includes('merchantAsist')) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          `用户 ${asistId} 不是 merchantAsist`
        );
      }

      validatedAsists.push(asistId);
    }
  }

  // ============================================
  // 4. 创建 merchant 文档
  // ============================================
  const merchantsRef = db.collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('merchants');
  
  const newMerchantRef = merchantsRef.doc(); // 自动生成 ID
  const merchantId = newMerchantRef.id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  // 构建 merchant 数据
  const merchantData = {
    merchantId: merchantId,
    merchantOwnerId: merchantOwnerId || null,
    merchantAsists: validatedAsists,
    merchantAsistsCount: validatedAsists.length,
    stallName: stallName,
    description: description || '',
    contactInfo: {
      phone: contactInfo.phone,
      email: contactInfo.email || '',
      note: contactInfo.note || ''
    },
    // QR Code 数据
    qrCodeData: {
      type: 'MERCHANT_PAYMENT',
      version: '1.0',
      merchantId: merchantId,
      eventId: eventId,
      organizationId: organizationId,
      generatedAt: now
    },
    // 收入统计（初始化为0）
    revenueStats: {
      totalRevenue: 0,
      transactionCount: 0,
      lastTransactionAt: null,
      averageTransactionAmount: 0,
      ownerCollectedRevenue: 0,
      asistsCollectedRevenue: 0
    },
    // 每日收入（初始化为0）
    dailyRevenue: {
      today: 0,
      todayTransactionCount: 0,
      todayOwnerCollected: 0,
      todayAsistsCollected: 0,
      lastResetAt: now,
      resetSchedule: 'daily at 00:00 MYT'
    },
    // 营业状态
    operationStatus: {
      isActive: isActive || false,
      lastStatusChange: now,
      pauseReason: ''
    },
    // 元数据
    metadata: {
      createdAt: now,
      updatedAt: now,
      createdBy: callerId,
      lastUpdatedBy: callerId
    }
  };

  // ============================================
  // 5. 批量写入（使用 transaction）
  // ============================================
  try {
    await db.runTransaction(async (transaction) => {
      // 5.1 创建 merchant 文档
      transaction.set(newMerchantRef, merchantData);

      // 5.2 更新 merchantOwner 的 user 文档（如果有）
      if (merchantOwnerId) {
        const ownerRef = db.collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(merchantOwnerId);
        
        transaction.update(ownerRef, {
          'merchantOwner.merchantId': merchantId,
          'merchantOwner.stallName': stallName,
          'merchantOwner.assignedAt': now,
          'merchantOwner.assignedBy': callerId,
          'updatedAt': now
        });
      }

      // 5.3 更新 merchantAsists 的 user 文档
      for (const asistId of validatedAsists) {
        const asistRef = db.collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(asistId);
        
        transaction.update(asistRef, {
          'merchantAsist.assignedMerchants': admin.firestore.FieldValue.arrayUnion(merchantId),
          'updatedAt': now
        });
      }

      // 5.4 更新 events.roleStats.merchants（增量更新）
      const eventRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId);
      
      transaction.update(eventRef, {
        'roleStats.merchants.count': admin.firestore.FieldValue.increment(1),
        'roleStats.merchants.totalAsistsCount': admin.firestore.FieldValue.increment(validatedAsists.length),
        'roleStats.merchants.withAsistsCount': validatedAsists.length > 0 ? 
          admin.firestore.FieldValue.increment(1) : admin.firestore.FieldValue.increment(0),
        'roleStats.merchantManagers.totalMerchantsManaged': admin.firestore.FieldValue.increment(1),
        'roleStats.merchantManagers.lastAssignmentAt': now,
        'updatedAt': now
      });
    });

    // ============================================
    // 6. 返回成功结果
    // ============================================
    console.log(`✅ 摊位创建成功: ${merchantId} by ${callerId}`);
    
    return {
      success: true,
      merchantId: merchantId,
      message: '摊位创建成功',
      merchant: {
        ...merchantData,
        // 将 timestamp 转换为可序列化的格式
        qrCodeData: {
          ...merchantData.qrCodeData,
          generatedAt: new Date().toISOString()
        },
        metadata: {
          ...merchantData.metadata,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        operationStatus: {
          ...merchantData.operationStatus,
          lastStatusChange: new Date().toISOString()
        },
        dailyRevenue: {
          ...merchantData.dailyRevenue,
          lastResetAt: new Date().toISOString()
        }
      }
    };

  } catch (error) {
    console.error('❌ 创建摊位失败:', error);
    throw new functions.https.HttpsError(
      'internal',
      `创建摊位失败: ${error.message}`
    );
  }
});

// ============================================
// 使用示例
// ============================================
/*
// 前端调用示例
const functions = getFunctions();
const createMerchant = httpsCallable(functions, 'createMerchantHttp');

const result = await createMerchant({
  organizationId: 'org123',
  eventId: 'event456',
  stallName: '美食天地',
  description: '提供各种美食',
  contactInfo: {
    phone: '+60123456789',
    email: 'food@example.com',
    note: '营业时间：9:00-17:00'
  },
  merchantOwnerId: 'user789',  // 可选
  merchantAsists: ['user101', 'user102'],  // 可选，最多5人
  isActive: true
});

console.log('摊位创建成功:', result.data.merchantId);
*/
