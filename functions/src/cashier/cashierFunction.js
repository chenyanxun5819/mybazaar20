/**
 * Cashier Cloud Functions (v2) - 修复版
 * 修复：使用 authUid 查询用户文档，而不是直接使用 doc(userId)
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// 🔧 确保 Admin SDK 已初始化（仅初始化一次）
if (!admin.apps.length) {
  admin.initializeApp();
}

const { FieldValue } = admin.firestore;

/**
 * 确认现金上交记录 (v2)
 */
exports.confirmCashSubmission = onCall(
  { 
    region: 'asia-southeast1',
    cors: true 
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[confirmCashSubmission] 🔐 Auth Debug:', {
      hasAuth: !!auth,
      uid: auth?.uid || null,
      token: auth?.token ? Object.keys(auth.token) : []
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      throw new Error('用户未登录');
    }

    const { orgId: rawOrgId, eventId: rawEventId, submissionId, confirmationNote } = data;

    // ===== 🛡️ 防御性处理：确保移除前缀 =====
    const orgId = rawOrgId?.replace('organization_', '') || rawOrgId || '';
    const eventId = rawEventId?.replace('event_', '') || rawEventId || '';

    console.log('[confirmCashSubmission] 📥 收到请求:', {
      rawOrgId,
      rawEventId,
      orgId,
      eventId,
      submissionId,
      userId: auth.uid,
      didRemovePrefix: rawOrgId !== orgId || rawEventId !== eventId
    });

    if (!orgId || !eventId || !submissionId) {
      throw new Error('缺少必需参数');
    }

    const db = admin.firestore();
    const authUid = auth.uid;

    try {
      // ===== 2. 权限验证 - 使用 authUid 查询 =====
      const usersRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      const userQuery = usersRef.where('authUid', '==', authUid);
      const userSnapshot = await userQuery.get();
      
      if (userSnapshot.empty) {
        console.warn('[confirmCashSubmission] ⚠️ 用户文档不存在:', authUid);
        throw new Error('用户不存在');
      }

      const userDoc = userSnapshot.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;
      
      console.log('[confirmCashSubmission] ✅ 找到用户:', {
        authUid,
        userId,
        roles: userData.roles
      });
      
      // 检查是否是 Team Leader
      if (!userData.roles || !userData.roles.includes('teamLeader')) {
        console.warn('[confirmCashSubmission] ⚠️ 权限不足:', {
          userId,
          roles: userData.roles
        });
        throw new Error('只有 Team Leader 可以确认收款');
      }

      // ===== 3. 获取上交记录 =====
      const submissionRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('cashSubmissions').doc(submissionId);

      const submissionDoc = await submissionRef.get();

      if (!submissionDoc.exists) {
        throw new Error('上交记录不存在');
      }

      const submissionData = submissionDoc.data();

      console.log('[confirmCashSubmission] ✅ 找到提交记录:', {
        submissionNumber: submissionData.submissionNumber,
        amount: submissionData.amount,
        status: submissionData.status,
        receivedBy: submissionData.receivedBy,
        submittedBy: submissionData.submittedBy,
        submitterRole: submissionData.submitterRole
      });

      // 验证 receivedBy 是当前 teamLeader
      if (submissionData.receivedBy !== userId) {
        console.error('[confirmCashSubmission] ❌ 不是接收人');
        throw new Error('您不是此笔现金的接收人');
      }

      // 验证状态
      if (submissionData.status !== 'pending') {
        console.error('[confirmCashSubmission] ❌ 状态不是pending:', submissionData.status);
        throw new Error(`此记录状态为${submissionData.status}，无法确认`);
      }

      console.log('[confirmCashSubmission] ✅ 验证通过，开始确认收款');

      // ===== 4. 使用事务确认收款 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        const amount = submissionData.amount || 0;
        
        // 4.1 更新上交记录状态
        transaction.update(submissionRef, {
          status: 'confirmed',
          confirmedAt: now,
          confirmationNote: confirmationNote || '',
          'metadata.updatedAt': now
        });

        // 4.2 更新 teamLeader.cashStats 统计（完全匹配JSON架构）
        const userDocRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('users').doc(userId);

        transaction.update(userDocRef, {
          // 减少待收款
          'teamLeader.cashStats.pendingFromSellers': FieldValue.increment(-amount),
          // 增加已确认收款
          'teamLeader.cashStats.confirmedFromSellers': FieldValue.increment(amount),
          // 增加持有现金
          'teamLeader.cashStats.cashOnHand': FieldValue.increment(amount),
          // 更新最后确认时间
          'teamLeader.cashStats.lastConfirmedAt': now
        });

        // 4.3 同步建立 cashCollections（將已確認的現金寫入 cashCollections，供 SubmitCash.jsx 讀取）
        try {
          const collectionRef = db
            .collection('organizations').doc(orgId)
            .collection('events').doc(eventId)
            .collection('cashCollections').doc();

          const collectionData = {
            sellerId: submissionData.submittedBy || null,
            sellerName: submissionData.submitterName || '未知',
            amount: submissionData.amount || 0,
            collectedAt: now,
            collectedBy: userId, // teamLeader who confirmed
            status: 'collected',
            submittedToFinance: false,
            notes: submissionData.note || '',
            submissionId: submissionId,
            metadata: {
              createdAt: now,
              updatedAt: now
            }
          };

          transaction.set(collectionRef, collectionData);
          console.log('[confirmCashSubmission] ✅ 已建立 cashCollections 文檔:', collectionRef.id);
        } catch (err) {
          console.error('[confirmCashSubmission] ⚠️ 建立 cashCollections 失敗，將繼續但請檢查:', err.message);
        }

        return {
          success: true,
          submissionId,
          submissionNumber: submissionData.submissionNumber,
          amount,
          sellerName: submissionData.submitterName
        };
      });

      console.log('[confirmCashSubmission] ✅ 确认成功:', result);

      // ===== 5. 返回结果 =====
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

/**
 * 获取收银员统计数据 (v2) - ⭐ 修复版
 */
exports.getCashierStats = onCall(
  { 
    region: 'asia-southeast1',
    cors: true 
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[getFinanceStats] 🔐 Auth Debug:', {
      hasAuth: !!auth,
      uid: auth?.uid || null,
      token: auth?.token ? Object.keys(auth.token) : []
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      throw new Error('用户未登录');
    }

    const { orgId, eventId } = data;

    console.log('[getFinanceStats] 📥 收到请求:', {
      orgId,
      eventId,
      authUid: auth.uid
    });

    if (!orgId || !eventId) {
      throw new Error('缺少必需参数');
    }

    const db = admin.firestore();
    const authUid = auth.uid;

    try {
      // ===== 2. 权限验证 - ⭐⭐⭐ 修复：使用 authUid 查询 ⭐⭐⭐ =====
      const usersRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      // ⭐ 关键修复：使用 where 查询而不是 doc(userId)
      const userQuery = usersRef.where('authUid', '==', authUid);
      const userSnapshot = await userQuery.get();
      
      if (userSnapshot.empty) {
        console.warn('[getFinanceStats] ⚠️ 用户文档不存在:', authUid);
        console.log('[getFinanceStats] 💡 提示：请检查用户文档是否有 authUid 字段');
        throw new Error('用户不存在');
      }

      const userDoc = userSnapshot.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;
      
      console.log('[getCashierStats] ✅ 找到用户:', {
        authUid,
        userId,
        roles: userData.roles,
        hasCashier: !!userData.cashier
      });
      
      if (!userData.roles || !userData.roles.includes('cashier')) {
        console.warn('[getCashierStats] ⚠️ 权限不足:', {
          userId,
          roles: userData.roles
        });
        throw new Error('只有收银员可以查看财务统计');
      }

      // ===== 3. 获取统计数据 =====
      const financeData = userData.cashier || {};
      
      // 获取待确认列表
      const pendingSnapshot = await db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('cashSubmissions')
        .where('status', '==', 'pending')
        .orderBy('submittedAt', 'desc')
        .limit(10)
        .get();

      const pendingSubmissions = pendingSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('[getFinanceStats] ✅ 数据获取成功:', {
        cashStatsExists: !!financeData.cashStats,
        pendingCount: pendingSubmissions.length
      });

      // ===== 4. 返回统计数据 =====
      return {
        success: true,
        data: {
          cashStats: financeData.cashStats || {},
          pendingStats: financeData.pendingStats || {},
          pendingSubmissions,
          basicInfo: userData.basicInfo || {}
        }
      };

    } catch (error) {
      console.error('[getFinanceStats] ❌ 获取财务统计失败:', error);
      throw new Error('获取财务统计失败: ' + error.message);
    }
  }
);