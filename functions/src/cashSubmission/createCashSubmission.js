/**
 * createCashSubmission.js
 * 创建现金上交记录
 * 
 * 适用角色：
 * - PointSeller: 上交到 Cashier 池子 (receivedBy = null)
 * - Seller (教师/职员): 上交到 Cashier 池子 (receivedBy = null)
 * - Seller (学生): 上交到 SellerManager (receivedBy = sellerManagerId)
 * - SellerManager: 上交到 Cashier 池子 (receivedBy = null)
 * 
 * 创建日期：2025-01-20
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// 导入共用的交易密码验证函数
const { verifyTransactionPin } = require('../utils/verifyTransactionPin');

exports.createCashSubmission = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const {
      organizationId,
      eventId,
      submittedBy,
      submitterName,
      submitterRole,      // 'pointSeller' | 'seller' | 'sellerManager'
      amount,
      note,
      receivedBy,         // null = 待认领池子, sellerManagerId = 指定SellerManager
      receiverName,
      receiverRole,       // null | 'sellerManager'
      transactionPin
    } = data;

    console.log('[createCashSubmission] 收到请求:', {
      submittedBy,
      submitterRole,
      amount,
      receivedBy: receivedBy || 'null (待认领池子)',
      organizationId,
      eventId
    });

    // ========== 3. 验证必填参数 ==========
    if (!organizationId || !eventId) {
      throw new HttpsError('invalid-argument', '缺少组织或活动ID');
    }

    if (!submittedBy || !submitterName || !submitterRole) {
      throw new HttpsError('invalid-argument', '缺少提交者信息');
    }

    if (!amount || amount <= 0) {
      throw new HttpsError('invalid-argument', '上交金额必须大于0');
    }

    if (!transactionPin) {
      throw new HttpsError('invalid-argument', '缺少交易密码');
    }

    // 验证角色
    const validRoles = ['pointSeller', 'seller', 'sellerManager'];
    if (!validRoles.includes(submitterRole)) {
      throw new HttpsError('invalid-argument', '无效的提交者角色');
    }

    // ========== 4. 验证提交者是当前用户 ==========
    if (auth.uid !== submittedBy) {
      throw new HttpsError('permission-denied', '只能提交自己的上交记录');
    }

    const db = admin.firestore();

    // ========== 5. 验证用户存在并获取用户信息 ==========
    const userRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users').doc(submittedBy);

    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new HttpsError('not-found', '用户不存在');
    }

    const userData = userDoc.data();
    const userRoles = userData.roles || [];

    // 验证用户拥有对应角色
    if (!userRoles.includes(submitterRole)) {
      throw new HttpsError('permission-denied', `用户不是 ${submitterRole}`);
    }

    // ========== 6. 验证交易密码 ==========
    console.log('[createCashSubmission] 验证交易密码...');
    await verifyTransactionPin(submittedBy, transactionPin, organizationId, eventId);

    // ========== 7. 如果指定了接收者，验证接收者存在 ==========
    if (receivedBy) {
      const receiverRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(receivedBy);

      const receiverDoc = await receiverRef.get();

      if (!receiverDoc.exists) {
        throw new HttpsError('not-found', '指定的接收者不存在');
      }

      const receiverData = receiverDoc.data();
      const receiverRoles = receiverData.roles || [];

      // 验证接收者角色
      if (receiverRole === 'sellerManager' && !receiverRoles.includes('sellerManager')) {
        throw new HttpsError('invalid-argument', '接收者不是 SellerManager');
      }
    }

    // ========== 8. 使用事务创建上交记录 ==========
    const result = await db.runTransaction(async (transaction) => {
      const now = admin.firestore.FieldValue.serverTimestamp();
      
      // 8.1 生成流水号
      const timestamp = Date.now();
      const submissionNumber = `CS-${timestamp}`;

      // 8.2 创建 cashSubmission 文档
      const submissionRef = db
        .collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('cashSubmissions').doc();

      const submissionData = {
        submissionId: submissionRef.id,
        submissionNumber,
        
        // 提交者信息
        submittedBy,
        submitterName,
        submitterRole,
        
        // 接收者信息
        receivedBy: receivedBy || null,
        receiverName: receiverName || null,
        receiverRole: receiverRole || null,
        
        // 金额信息
        amount,
        currency: 'MYR',
        
        // 状态
        status: 'pending',
        submittedAt: now,
        
        // 备注
        note: note || '',
        
        // 元数据
        metadata: {
          createdAt: now,
          updatedAt: now,
          eventId,
          organizationId,
          submissionSource: 'manual',
          submissionType: receivedBy ? 'sellerToManager' : 'toFinancePool'
        }
      };

      transaction.set(submissionRef, submissionData);

      // 8.3 更新提交者统计
      if (submitterRole === 'pointSeller') {
        transaction.update(userRef, {
          'pointSeller.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'pointSeller.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'pointSeller.statistics.lastSubmissionAt': now,
          'activityData.updatedAt': now
        });

      } else if (submitterRole === 'seller') {
        transaction.update(userRef, {
          'seller.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'seller.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'seller.statistics.lastSubmissionAt': now,
          'activityData.updatedAt': now
        });

      } else if (submitterRole === 'sellerManager') {
        transaction.update(userRef, {
          'sellerManager.statistics.totalSubmitted': admin.firestore.FieldValue.increment(amount),
          'sellerManager.statistics.submissionCount': admin.firestore.FieldValue.increment(1),
          'sellerManager.statistics.lastSubmissionAt': now,
          'activityData.updatedAt': now
        });
      }

      // 8.4 如果有接收者，更新接收者的待处理统计
      if (receivedBy && receiverRole === 'sellerManager') {
        const receiverRef = db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(eventId)
          .collection('users').doc(receivedBy);

        transaction.update(receiverRef, {
          'sellerManager.cashStats.pendingFromSellers': admin.firestore.FieldValue.increment(amount),
          'sellerManager.cashStats.pendingSubmissionsCount': admin.firestore.FieldValue.increment(1),
          'activityData.updatedAt': now
        });
      }

      console.log('[createCashSubmission] 创建成功:', {
        submissionId: submissionRef.id,
        submissionNumber,
        amount,
        receivedBy: receivedBy || '待认领池子'
      });

      return {
        submissionId: submissionRef.id,
        submissionNumber,
        amount,
        submittedAt: new Date()
      };
    });

    // ========== 9. 返回成功 ==========
    return {
      success: true,
      message: receivedBy 
        ? `已提交 RM ${amount} 给 ${receiverName}`
        : `已提交 RM ${amount} 到收银台待认领池子`,
      submissionId: result.submissionId,
      submissionNumber: result.submissionNumber,
      amount: result.amount,
      submittedAt: result.submittedAt
    };

  } catch (error) {
    console.error('[createCashSubmission] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '创建上交记录失败，请重试');
  }
});
