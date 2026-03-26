/**
 * createMerchantHttp
 * 创建新摊位（merchants）
 *
 * 功能：
 * 1. 验证权限（merchantManager 或 eventManager）
 * 2. 验证 merchantOwnerId 是否已被分配
 * 3. 验证 merchantAsists 数量（最多5人）
 * 4. 在 transaction 内原子性地读取 lastMerchantSeq，生成 merchantCode（M001~M999）
 * 5. 创建 merchant 文档（含 merchantCode 和软删除初始字段）
 * 6. 生成 QR Code 数据
 * 7. 更新 users.merchantOwner.merchantId
 * 8. 更新 users.merchantAsist.merchantId
 * 9. 更新 events.roleStats.merchants（count +1、lastMerchantSeq +1）
 * 10. 返回新摊位信息
 *
 * 软删除说明：
 * - 禁止物理删除 merchant 文档
 * - 停用请调用 deactivateMerchantHttp（将 metadata.isDeleted = true，roleStats.merchants.count -1）
 * - lastMerchantSeq 只增不减，保证 merchantCode 永不重复
 * - count 才是计费依据（当前有效摊位数）
 *
 * @param {object} data
 * @param {string} data.organizationId       - 组织 ID
 * @param {string} data.eventId              - 活动 ID
 * @param {string} data.stallName            - 摊位名称
 * @param {string} [data.description]        - 摊位描述（可选）
 * @param {object} data.contactInfo          - 联系方式
 * @param {string} data.contactInfo.phone    - 联系电话
 * @param {string} [data.contactInfo.email]  - 联系邮箱（可选）
 * @param {string} [data.contactInfo.note]   - 备注（可选）
 * @param {string} [data.merchantOwnerId]    - 摊主 ID（可选）
 * @param {string[]} [data.merchantAsists]   - 助理 ID 数组（可选，最多5人）
 * @param {boolean} [data.isActive]          - 是否营业中（默认 false）
 *
 * @returns {object} 新创建的摊位信息，含 merchantId 和 merchantCode
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.createMerchantHttp = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  // ============================================
  // 1. 权限验证
  // ============================================
  if (!auth) {
    throw new HttpsError('unauthenticated', '用户未认证');
  }

  const callerId = auth.uid;
  const {
    organizationId,
    eventId,
    stallName,
    description,
    contactInfo,
    merchantOwnerId,
    merchantAsists,
    isActive
  } = data;

  // 验证必填参数
  if (!organizationId || !eventId || !stallName || !contactInfo?.phone) {
    throw new HttpsError(
      'invalid-argument',
      '缺少必填参数：organizationId, eventId, stallName, contactInfo.phone'
    );
  }

  const db = admin.firestore();

  // 验证调用者权限
  const callerRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users').doc(callerId);

  const callerDoc = await callerRef.get();
  if (!callerDoc.exists) {
    throw new HttpsError('permission-denied', '用户不属于此活动');
  }

  const callerData = callerDoc.data();
  const hasPermission =
    callerData.roles?.includes('merchantManager') ||
    callerData.roles?.includes('eventManager');

  if (!hasPermission) {
    throw new HttpsError(
      'permission-denied',
      '只有 merchantManager 或 eventManager 可以创建摊位'
    );
  }

  // ============================================
  // 2. 验证 merchantOwner（如果提供）
  // ============================================
  if (merchantOwnerId) {
    const ownerRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(merchantOwnerId);

    const ownerDoc = await ownerRef.get();
    if (!ownerDoc.exists) {
      throw new HttpsError('not-found', `merchantOwner ${merchantOwnerId} 不存在`);
    }

    const ownerData = ownerDoc.data();

    if (!ownerData.roles?.includes('merchantOwner')) {
      throw new HttpsError(
        'invalid-argument',
        `用户 ${merchantOwnerId} 不是 merchantOwner`
      );
    }

    if (ownerData.merchantOwner?.merchantId) {
      throw new HttpsError(
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
    if (merchantAsists.length > 5) {
      throw new HttpsError(
        'invalid-argument',
        `助理数量不能超过 5 人，当前：${merchantAsists.length}`
      );
    }

    for (const asistId of merchantAsists) {
      const asistRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(asistId);

      const asistDoc = await asistRef.get();
      if (!asistDoc.exists) {
        throw new HttpsError('not-found', `merchantAsist ${asistId} 不存在`);
      }

      const asistData = asistDoc.data();

      if (!asistData.roles?.includes('merchantAsist')) {
        throw new HttpsError(
          'invalid-argument',
          `用户 ${asistId} 不是 merchantAsist`
        );
      }

      if (asistData.merchantAsist?.merchantId) {
        throw new HttpsError(
          'already-exists',
          `merchantAsist ${asistId} 已被分配给摊位 ${asistData.merchantAsist.merchantId}`
        );
      }

      validatedAsists.push(asistId);
    }
  }

  // ============================================
  // 4. 准备 Firestore 引用（merchantId 将在 transaction 内与 merchantCode 同步生成）
  // ============================================
  const eventRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId);

  const merchantsRef = eventRef.collection('merchants');

  // now 在 transaction 外声明，避免 serverTimestamp 用于 arrayUnion 的问题
  const now = new Date();
  const serverNow = admin.firestore.FieldValue.serverTimestamp();

  // ============================================
  // 5. Transaction：读取序号 → 生成 merchantCode → 批量写入
  // ============================================
  let merchantCode;
  let merchantId;

  try {
    await db.runTransaction(async (transaction) => {

      // --- 5.1 读取 event 文档（所有读操作必须在写操作前）---
      const eventDoc = await transaction.get(eventRef);
      if (!eventDoc.exists) {
        throw new HttpsError('not-found', '活动文档不存在');
      }

      // 读取 merchantOwner（若有）
      let ownerRef_tx = null;
      if (merchantOwnerId) {
        ownerRef_tx = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(merchantOwnerId);
        await transaction.get(ownerRef_tx); // 预读，确保读在写之前
      }

      // 读取每个 asist（若有）
      const asistRefs_tx = [];
      for (const asistId of validatedAsists) {
        const ref = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(asistId);
        await transaction.get(ref); // 预读
        asistRefs_tx.push({ ref, asistId });
      }

      // --- 5.2 生成 merchantCode（读完再计算）---
      const lastSeq = eventDoc.data()?.roleStats?.merchants?.lastMerchantSeq ?? 0;
      const newSeq = lastSeq + 1;

      if (newSeq > 999) {
        throw new HttpsError(
          'resource-exhausted',
          '此活动的摊位编号已达上限（最多 999 个）'
        );
      }

      merchantCode = `M${String(newSeq).padStart(3, '0')}`; // M001 ~ M999
      merchantId = merchantCode; // merchantId 与 merchantCode 相同，均为人类可读编号
      const newMerchantRef = merchantsRef.doc(merchantId);

      // --- 5.3 构建 merchant 文档数据 ---
      const merchantData = {
        merchantId: merchantId,
        merchantCode: merchantCode,
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
        qrCodeData: {
          type: 'MERCHANT_PAYMENT',
          version: '1.0',
          merchantId: merchantId,
          merchantCode: merchantCode,
          eventId: eventId,
          organizationId: organizationId,
          generatedAt: serverNow
        },
        revenueStats: {
          totalRevenue: 0,
          transactionCount: 0,
          lastTransactionAt: null,
          averageTransactionAmount: 0,
          ownerCollectedRevenue: 0,
          asistsCollectedRevenue: 0
        },
        dailyRevenue: {
          today: 0,
          todayTransactionCount: 0,
          todayOwnerCollected: 0,
          todayAsistsCollected: 0,
          lastResetAt: serverNow,
          resetSchedule: 'daily at 00:00 MYT'
        },
        operationStatus: {
          isActive: isActive || false,
          lastStatusChange: serverNow,
          pauseReason: ''
        },
        metadata: {
          createdAt: serverNow,
          updatedAt: serverNow,
          createdBy: callerId,
          lastUpdatedBy: callerId,
          // 软删除字段（初始为未删除状态）
          isDeleted: false,
          deletedAt: null,
          deletedBy: null,
          deleteReason: null
        }
      };

      // --- 5.4 写入 merchant 文档 ---
      transaction.set(newMerchantRef, merchantData);

      // --- 5.5 更新 merchantOwner 的 user 文档（如果有）---
      if (merchantOwnerId && ownerRef_tx) {
        transaction.update(ownerRef_tx, {
          'merchantOwner.merchantId': merchantId,
          'merchantOwner.merchantCode': merchantCode,
          'merchantOwner.stallName': stallName,
          'merchantOwner.assignedAt': serverNow,
          'merchantOwner.assignedBy': callerId,
          'updatedAt': serverNow
        });
      }

      // --- 5.6 更新 merchantAsists 的 user 文档 ---
      for (const { ref, asistId } of asistRefs_tx) {
        transaction.update(ref, {
          'merchantAsist.merchantId': merchantId,
          'merchantAsist.merchantCode': merchantCode,
          'merchantAsist.stallName': stallName,
          'merchantAsist.assignedAt': serverNow,
          'merchantAsist.assignedBy': callerId,
          'updatedAt': serverNow
        });
      }

      // --- 5.7 更新 events.roleStats.merchants ---
      // count      = 当前有效摊位数（计费依据），创建时 +1
      // lastMerchantSeq = 只增不减的流水序号（编号依据），创建时 +1
      transaction.update(eventRef, {
        'roleStats.merchants.count': admin.firestore.FieldValue.increment(1),
        'roleStats.merchants.lastMerchantSeq': admin.firestore.FieldValue.increment(1),
        'roleStats.merchants.totalAsistsCount': admin.firestore.FieldValue.increment(validatedAsists.length),
        'roleStats.merchants.withAsistsCount': validatedAsists.length > 0
          ? admin.firestore.FieldValue.increment(1)
          : admin.firestore.FieldValue.increment(0),
        'roleStats.merchantManagers.totalMerchantsManaged': admin.firestore.FieldValue.increment(1),
        'roleStats.merchantManagers.lastAssignmentAt': serverNow,
        'updatedAt': serverNow
      });
    });

  } catch (error) {
    // 如果是我们自己抛出的 HttpsError，直接重新抛出
    if (error instanceof HttpsError) throw error;

    console.error('❌ 创建摊位失败:', error);
    throw new HttpsError('internal', `创建摊位失败: ${error.message}`);
  }

  // ============================================
  // 6. 返回成功结果
  // ============================================
  console.log(`✅ 摊位创建成功: ${merchantId} (${merchantCode}) by ${callerId}`);

  return {
    success: true,
    merchantId: merchantId,
    merchantCode: merchantCode,
    message: `摊位创建成功，编号：${merchantCode}`,
    merchant: {
      merchantId,
      merchantCode,
      merchantOwnerId: merchantOwnerId || null,
      merchantAsists: validatedAsists,
      merchantAsistsCount: validatedAsists.length,
      stallName,
      description: description || '',
      contactInfo: {
        phone: contactInfo.phone,
        email: contactInfo.email || '',
        note: contactInfo.note || ''
      },
      qrCodeData: {
        type: 'MERCHANT_PAYMENT',
        version: '1.0',
        merchantId,
        merchantCode,
        eventId,
        organizationId,
        generatedAt: now.toISOString()
      },
      revenueStats: {
        totalRevenue: 0,
        transactionCount: 0,
        lastTransactionAt: null,
        averageTransactionAmount: 0,
        ownerCollectedRevenue: 0,
        asistsCollectedRevenue: 0
      },
      operationStatus: {
        isActive: isActive || false,
        lastStatusChange: now.toISOString(),
        pauseReason: ''
      },
      metadata: {
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: callerId,
        lastUpdatedBy: callerId,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deleteReason: null
      }
    }
  };
});


// ============================================
// 使用示例
// ============================================
/*
// 前端调用示例
import { getFunctions, httpsCallable } from 'firebase/functions';

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
  merchantOwnerId: 'phone_60123456789',  // 可选
  merchantAsists: ['phone_60111111111', 'phone_60222222222'],  // 可选，最多5人
  isActive: true
});

console.log('摊位创建成功:', result.data.merchantId);  // Firestore 路径用
console.log('摊位编号:', result.data.merchantCode);    // 显示/计费用 → 'M001'
*/