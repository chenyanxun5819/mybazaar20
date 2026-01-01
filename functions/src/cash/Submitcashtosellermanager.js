/**
 * submitCashToSellerManager.js
 * 学生Seller上交现金给SellerManager
 * 
 * 流程：
 * 1. 验证Seller身份
 * 2. 验证SellerManager存在
 * 3. 创建上交记录
 * 4. 更新Seller统计（减少手上现金）
 * 5. 更新SellerManager统计（增加待收款）
 * 
 * @version 1.0
 * @date 2025-01-01
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = admin.firestore;

exports.submitCashToSellerManager = onCall(
  {
    region: 'asia-southeast1',
    cors: true
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[submitCashToSellerManager] 🔐 收到请求:', {
      hasAuth: !!auth,
      uid: auth?.uid,
      data: {
        orgId: data.orgId,
        eventId: data.eventId,
        amount: data.amount,
        sellerManagerId: data.sellerManagerId
      }
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      throw new Error('用户未登录');
    }

    const { orgId, eventId, amount, note, sellerManagerId } = data;

    if (!orgId || !eventId || !amount || !sellerManagerId) {
      throw new Error('缺少必需参数');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('金额必须为正数');
    }

    const db = admin.firestore();
    const authUid = auth.uid;

    try {
      // ===== 2. 查询Seller文档 =====
      const usersRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      const sellerQuery = usersRef.where('authUid', '==', authUid);
      const sellerSnapshot = await sellerQuery.get();

      if (sellerSnapshot.empty) {
        throw new Error('Seller不存在');
      }

      const sellerDoc = sellerSnapshot.docs[0];
      const sellerData = sellerDoc.data();
      const sellerId = sellerDoc.id;

      console.log('[submitCashToSellerManager] ✅ 找到Seller:', {
        sellerId,
        roles: sellerData.roles
      });

      // 验证是Seller角色
      if (!sellerData.roles || !sellerData.roles.includes('seller')) {
        throw new Error('只有Seller可以上交现金给SellerManager');
      }

      // 验证手上现金是否足够
      const cashOnHand = sellerData.seller?.pendingCollection || 0;
      if (amount > cashOnHand) {
        throw new Error(`手上现金不足（仅有 RM ${cashOnHand}）`);
      }

      // ===== 3. 查询SellerManager文档 =====
      const smDoc = await usersRef.doc(sellerManagerId).get();

      if (!smDoc.exists) {
        throw new Error('SellerManager不存在');
      }

      const smData = smDoc.data();

      // 验证是SellerManager角色
      if (!smData.roles || !smData.roles.includes('sellerManager')) {
        throw new Error('接收人不是SellerManager');
      }

      // 验证管理关系
      const managedBy = sellerData.managedBy || [];
      if (!managedBy.includes(sellerManagerId)) {
        throw new Error('该SellerManager不是您的管理者');
      }

      console.log('[submitCashToSellerManager] ✅ 验证通过，开始创建上交记录');

      // ===== 4. 使用事务创建上交记录 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        const submissionNumber = `SM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // 4.1 创建上交记录
        const submissionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions').doc();

        const submissionData = {
          submissionNumber,
          submittedBy: sellerId,
          submitterRole: 'seller',
          submitterName: sellerData.basicInfo?.chineseName || sellerData.basicInfo?.englishName || '未知',
          submitterDepartment: sellerData.identityInfo?.department || null,
          
          amount,
          note: note || '',
          
          // 🔴 上交给SellerManager（不是待认领池子）
          receivedBy: sellerManagerId,
          receiverName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName || 'SellerManager',
          receiverRole: 'sellerManager',
          
          status: 'pending', // 等待SellerManager确认
          submittedAt: now,
          confirmedAt: null,
          confirmationNote: '',
          
          metadata: {
            createdAt: now,
            updatedAt: now,
            submissionType: 'sellerToManager' // 标记为Seller→SM的上交
          }
        };

        transaction.set(submissionRef, submissionData);

        // 4.2 更新Seller统计
        const sellerDocRef = usersRef.doc(sellerId);
        transaction.update(sellerDocRef, {
          'seller.pendingCollection': FieldValue.increment(-amount), // 减少手上现金
          'seller.totalSubmittedToManager': FieldValue.increment(amount),
          'seller.lastSubmittedAt': now
        });

        // 4.3 更新SellerManager统计（待收款）
        const smDocRef = usersRef.doc(sellerManagerId);
        transaction.update(smDocRef, {
          'sellerManager.cashStats.pendingFromSellers': FieldValue.increment(amount),
          'sellerManager.cashStats.totalReceivedFromSellers': FieldValue.increment(amount)
        });

        return {
          success: true,
          submissionId: submissionRef.id,
          submissionNumber,
          amount,
          receiverName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName
        };
      });

      console.log('[submitCashToSellerManager] ✅ 上交成功:', result);

      return {
        success: true,
        message: `现金已提交给 ${result.receiverName}`,
        data: result
      };

    } catch (error) {
      console.error('[submitCashToSellerManager] ❌ 上交失败:', error);
      throw new Error('上交失败: ' + error.message);
    }
  }
);