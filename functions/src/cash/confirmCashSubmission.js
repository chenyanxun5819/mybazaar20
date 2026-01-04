/**
 * confirmCashSubmission.js
 * SellerManager确认收到学生Seller的现金
 * 
 * 架构对应：
 * - sellerManager.cashStats.pendingFromSellers (待确认)
 * - sellerManager.cashStats.confirmedFromSellers (已确认)
 * - sellerManager.cashStats.cashOnHand (持有现金)
 * - cashSubmissions.status: pending → confirmed
 * 
 * @version 1.0
 * @date 2025-01-03
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = admin.firestore;

exports.confirmCashSubmission = onCall(
  {
    region: 'asia-southeast1',
    cors: true
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[confirmCashSubmission] 🔐 收到请求:', {
      hasAuth: !!auth,
      uid: auth?.uid,
      data: {
        orgId: data.orgId,
        eventId: data.eventId,
        submissionId: data.submissionId
      }
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      console.error('[confirmCashSubmission] ❌ 用户未登录');
      throw new Error('用户未登录');
    }

    const { orgId, eventId, submissionId, note } = data;

    if (!orgId || !eventId || !submissionId) {
      console.error('[confirmCashSubmission] ❌ 缺少必需参数:', { orgId, eventId, submissionId });
      throw new Error('缺少必需参数');
    }

    const db = admin.firestore();
    const authUid = auth.uid;

    try {
      // ===== 2. 查询SellerManager文档 =====
      const usersRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      console.log('[confirmCashSubmission] 📊 查询SellerManager，authUid:', authUid);

      const smQuery = usersRef.where('authUid', '==', authUid);
      const smSnapshot = await smQuery.get();

      if (smSnapshot.empty) {
        console.error('[confirmCashSubmission] ❌ SellerManager不存在');
        throw new Error('SellerManager不存在');
      }

      const smDoc = smSnapshot.docs[0];
      const smData = smDoc.data();
      const smId = smDoc.id;

      console.log('[confirmCashSubmission] ✅ 找到SellerManager:', {
        smId,
        roles: smData.roles
      });

      // 验证是SellerManager角色
      if (!smData.roles || !smData.roles.includes('sellerManager')) {
        console.error('[confirmCashSubmission] ❌ 不是SellerManager角色');
        throw new Error('只有SellerManager可以确认收款');
      }

      // ===== 3. 查询submission记录 =====
      const submissionRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('cashSubmissions').doc(submissionId);

      const submissionDoc = await submissionRef.get();

      if (!submissionDoc.exists) {
        console.error('[confirmCashSubmission] ❌ 提交记录不存在');
        throw new Error('提交记录不存在');
      }

      const submissionData = submissionDoc.data();

      console.log('[confirmCashSubmission] ✅ 找到提交记录:', {
        submissionNumber: submissionData.submissionNumber,
        amount: submissionData.amount,
        status: submissionData.status,
        receivedBy: submissionData.receivedBy,
        submittedBy: submissionData.submittedBy
      });

      // ===== 4. 验证权限和状态 =====

      // 验证receivedBy是当前SM
      if (submissionData.receivedBy !== smId) {
        console.error('[confirmCashSubmission] ❌ 不是接收人');
        throw new Error('您不是此笔现金的接收人');
      }

      // 验证状态
      if (submissionData.status !== 'pending') {
        console.error('[confirmCashSubmission] ❌ 状态不是pending:', submissionData.status);
        throw new Error(`此记录状态为${submissionData.status}，无法确认`);
      }

      // 验证是Seller提交的
      if (submissionData.submitterRole !== 'seller') {
        console.error('[confirmCashSubmission] ❌ 提交者不是Seller');
        throw new Error('只能确认Seller提交的现金');
      }

      console.log('[confirmCashSubmission] ✅ 验证通过，开始确认收款');

      // ===== 5. 使用事务更新数据 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        const amount = submissionData.amount;

        // 5.1 更新submission状态
        transaction.update(submissionRef, {
          status: 'confirmed',
          confirmedAt: now,
          confirmationNote: note || '',
          'metadata.updatedAt': now
        });

        console.log('[confirmCashSubmission] ✅ 已更新submission状态');

        // 5.2 更新SellerManager.cashStats统计（完全匹配JSON架构）
        const smDocRef = usersRef.doc(smId);

        transaction.update(smDocRef, {
          // 减少待收款
          'sellerManager.cashStats.pendingFromSellers': FieldValue.increment(-amount),
          // 增加已确认收款
          'sellerManager.cashStats.confirmedFromSellers': FieldValue.increment(amount),
          // 增加持有现金
          'sellerManager.cashStats.cashOnHand': FieldValue.increment(amount),
          // 更新最后确认时间
          'sellerManager.cashStats.lastConfirmedAt': now
        });

        console.log('[confirmCashSubmission] ✅ 已更新SellerManager.cashStats');

        return {
          success: true,
          submissionId,
          submissionNumber: submissionData.submissionNumber,
          amount,
          sellerName: submissionData.submitterName
        };
      });

      console.log('[confirmCashSubmission] ✅ 确认成功:', result);

      return {
        success: true,
        message: `已确认收到 ${result.sellerName} 的 RM ${result.amount}`,
        data: result
      };

    } catch (error) {
      console.error('[confirmCashSubmission] ❌ 确认失败:', {
        errorMessage: error.message,
        errorStack: error.stack
      });
      
      throw new Error('确认失败: ' + error.message);
    }
  }
);
