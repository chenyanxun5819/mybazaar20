/**
 * submitCashToFinance.js
 * 上交现金到Finance Manager待认领池子
 * 
 * 支持的角色：
 * 1. SellerManager - 上交从学生收集的现金
 * 2. Seller (职员/老师) - 直接上交自己的销售现金
 * 3. PointSeller - 上交点数卡销售现金
 * 
 * 🔴 待认领池子模式：receivedBy = null
 * 
 * @version 1.0
 * @date 2025-01-01
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = admin.firestore;

exports.submitCashToFinance = onCall(
  {
    region: 'asia-southeast1',
    cors: true
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[submitCashToFinance] 🔐 收到请求:', {
      hasAuth: !!auth,
      uid: auth?.uid,
      data: {
        orgId: data.orgId,
        eventId: data.eventId,
        amount: data.amount
      }
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      throw new Error('用户未登录');
    }

    const { orgId, eventId, amount, note, includedCollections, includedSales } = data;

    if (!orgId || !eventId || !amount) {
      throw new Error('缺少必需参数');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('金额必须为正数');
    }

    const db = admin.firestore();
    const authUid = auth.uid;

    try {
      // ===== 2. 查询用户文档 =====
      const usersRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('users');

      const userQuery = usersRef.where('authUid', '==', authUid);
      const userSnapshot = await userQuery.get();

      if (userSnapshot.empty) {
        throw new Error('用户不存在');
      }

      const userDoc = userSnapshot.docs[0];
      const userData = userDoc.data();
      const userId = userDoc.id;

      console.log('[submitCashToFinance] ✅ 找到用户:', {
        userId,
        roles: userData.roles
      });

      // ===== 3. 验证角色权限 =====
      const roles = userData.roles || [];
      let submitterRole = null;

      if (roles.includes('sellerManager')) {
        submitterRole = 'sellerManager';
      } else if (roles.includes('seller')) {
        submitterRole = 'seller';
      } else if (roles.includes('pointSeller')) {
        submitterRole = 'pointSeller';
      } else {
        throw new Error('您没有权限上交现金');
      }

      console.log('[submitCashToFinance] 📝 提交者角色:', submitterRole);

      // ===== 4. 使用事务创建上交记录 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        const submissionNumber = `CS-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        // 4.1 创建上交记录（待认领池子）
        const submissionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions').doc();

        const submissionData = {
          submissionNumber,
          submittedBy: userId,
          submitterRole,
          submitterName: userData.basicInfo?.chineseName || userData.basicInfo?.englishName || '未知',
          submitterDepartment: userData.identityInfo?.department || null,
          
          amount,
          note: note || '',
          
          // 🔴 待认领池子：receivedBy = null
          receivedBy: null,
          receiverName: null,
          
          status: 'pending',
          submittedAt: now,
          confirmedAt: null,
          confirmationNote: '',
          
          // 包含的收款记录（仅SellerManager）
          includedCollections: includedCollections || [],
          includedSales: includedSales || [],
          
          metadata: {
            createdAt: now,
            updatedAt: now
          }
        };

        transaction.set(submissionRef, submissionData);

        // 4.2 更新用户统计
        const userDocRef = usersRef.doc(userId);

        if (submitterRole === 'sellerManager') {
          // SellerManager 统计
          transaction.update(userDocRef, {
            'sellerManager.cashStats.totalSubmitted': FieldValue.increment(amount),
            'sellerManager.cashStats.pendingSubmission': FieldValue.increment(amount),
            'sellerManager.cashStats.lastSubmittedAt': now
          });

          // 4.3 更新收款记录状态（标记为已上交）
          if (includedCollections && includedCollections.length > 0) {
            for (const collectionId of includedCollections) {
              const collectionRef = db
                .collection('organizations').doc(orgId)
                .collection('events').doc(eventId)
                .collection('cashCollections').doc(collectionId);

              transaction.update(collectionRef, {
                submittedToFinance: true,
                submittedAt: now,
                submissionId: submissionRef.id
              });
            }
          }

        } else if (submitterRole === 'seller') {
          // Seller 统计
          transaction.update(userDocRef, {
            'seller.totalSubmitted': FieldValue.increment(amount),
            'seller.pendingCollection': FieldValue.increment(-amount), // 减少手上现金
            'seller.lastSubmittedAt': now
          });

        } else if (submitterRole === 'pointSeller') {
          // PointSeller 统计
          transaction.update(userDocRef, {
            'pointSeller.cashStats.totalSubmitted': FieldValue.increment(amount),
            'pointSeller.cashStats.pendingSubmission': FieldValue.increment(amount),
            'pointSeller.cashStats.lastSubmittedAt': now
          });
        }

        // 4.4 更新Event统计（可选）
        const eventRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId);

        transaction.update(eventRef, {
          [`financeSummary.cash.pendingFromRole.${submitterRole}`]: FieldValue.increment(amount),
          'metadata.updatedAt': now
        });

        return {
          success: true,
          submissionId: submissionRef.id,
          submissionNumber,
          amount
        };
      });

      console.log('[submitCashToFinance] ✅ 上交成功:', result);

      return {
        success: true,
        message: '现金已提交到待认领池子',
        data: result
      };

    } catch (error) {
      console.error('[submitCashToFinance] ❌ 上交失败:', error);
      throw new Error('上交失败: ' + error.message);
    }
  }
);