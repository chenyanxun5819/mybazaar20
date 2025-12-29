/**
 * Finance Manager Cloud Functions (v2)
 * 使用 Firebase Functions v2 API，独立于全局 region 设置
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
    region: 'asia-southeast1',  // ✅ v2 的 region 设置
    cors: true 
  },
  async (request) => {
    const { data, auth } = request;

    // 🔍 详细的认证日志
    console.log('[confirmCashSubmission] 🔐 Auth Debug:', {
      hasAuth: !!auth,
      uid: auth?.uid || null,
      token: auth?.token ? Object.keys(auth.token) : []
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      throw new Error('用户未登录');
    }

    const { orgId, eventId, submissionId, confirmationNote } = data;

    console.log('[confirmCashSubmission] 📥 收到请求:', {
      orgId,
      eventId,
      submissionId,
      userId: auth.uid
    });

    // 验证必需参数
    if (!orgId || !eventId || !submissionId) {
      throw new Error('缺少必需参数');
    }

    const db = admin.firestore();
    const userId = auth.uid;

    try {
      // ===== 2. 权限验证 =====
      const userRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users').doc(userId);

      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.warn('[confirmCashSubmission] ⚠️ 用户文档不存在:', userId);
        throw new Error('用户不存在');
      }

      const userData = userDoc.data();
      
      // 检查是否是 Finance Manager
      if (!userData.roles || !userData.roles.includes('financeManager')) {
        console.warn('[confirmCashSubmission] ⚠️ 权限不足:', {
          userId,
          roles: userData.roles
        });
        throw new Error('只有财务经理可以确认收款');
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

      // 检查状态
      if (submissionData.status !== 'pending') {
        throw new Error(`无法确认：当前状态为 ${submissionData.status}`);
      }

      // ===== 4. 使用事务确认收款 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        
        // 4.1 更新上交记录状态
        transaction.update(submissionRef, {
          status: 'confirmed',
          confirmedAt: now,
          receivedBy: userId,
          receiverName: userData.basicInfo?.name || '财务经理',
          confirmationNote: confirmationNote || '',
          'metadata.updatedAt': now
        });

        // 4.2 更新 Finance Manager 统计
        const amount = submissionData.amount || 0;
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // 获取当前统计数据
        const currentFinanceData = (await transaction.get(userRef)).data();
        const currentCashStats = currentFinanceData.financeManager?.cashStats || {};
        
        // 计算今日收款
        const lastCollection = currentCashStats.lastCollectionAt;
        const isToday = lastCollection && lastCollection.toDate() >= todayStart;
        
        transaction.update(userRef, {
          'financeManager.cashStats.totalCollected': FieldValue.increment(amount),
          'financeManager.cashStats.todayCollected': isToday 
            ? FieldValue.increment(amount) 
            : amount,
          'financeManager.cashStats.totalCollections': FieldValue.increment(1),
          'financeManager.cashStats.todayCollections': isToday 
            ? FieldValue.increment(1) 
            : 1,
          'financeManager.cashStats.lastCollectionAt': now,
          
          // 更新待确认统计（减少）
          'financeManager.pendingStats.pendingAmount': FieldValue.increment(-amount),
          'financeManager.pendingStats.pendingCount': FieldValue.increment(-1)
        });

        // 4.3 更新提交者的收款状态（如果是 SellerManager）
        if (submissionData.submitterRole === 'sellerManager') {
          const submitterRef = db
            .collection('organizations').doc(orgId)
            .collection('events').doc(eventId)
            .collection('users').doc(submissionData.submittedBy);

          transaction.update(submitterRef, {
            'sellerManager.cashStats.totalSubmitted': FieldValue.increment(amount),
            'sellerManager.cashStats.totalConfirmed': FieldValue.increment(amount),
            'sellerManager.cashStats.pendingSubmission': FieldValue.increment(-amount),
            'sellerManager.cashStats.lastSubmittedAt': now
          });
        }

        return {
          success: true,
          submissionId,
          amount,
          confirmedAt: now
        };
      });

      console.log('[confirmCashSubmission] ✅ 确认成功:', result);

      // ===== 5. 返回结果 =====
      return {
        success: true,
        message: '收款确认成功',
        data: result
      };

    } catch (error) {
      console.error('[confirmCashSubmission] ❌ 确认收款失败:', error);
      throw new Error('确认收款失败: ' + error.message);
    }
  }
);

/**
 * 获取财务统计数据 (v2)
 */
exports.getFinanceStats = onCall(
  { 
    region: 'asia-southeast1',  // ✅ v2 的 region 设置
    cors: true 
  },
  async (request) => {
    const { data, auth } = request;

    // 🔍 详细的认证日志
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
      userId: auth.uid
    });

    if (!orgId || !eventId) {
      throw new Error('缺少必需参数');
    }

    const db = admin.firestore();
    const userId = auth.uid;

    try {
      // ===== 2. 权限验证 =====
      const userRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users').doc(userId);

      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        console.warn('[getFinanceStats] ⚠️ 用户文档不存在:', userId);
        throw new Error('用户不存在');
      }

      const userData = userDoc.data();
      
      if (!userData.roles || !userData.roles.includes('financeManager')) {
        console.warn('[getFinanceStats] ⚠️ 权限不足:', {
          userId,
          roles: userData.roles
        });
        throw new Error('只有财务经理可以查看财务统计');
      }

      // ===== 3. 获取统计数据 =====
      const financeData = userData.financeManager || {};
      
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