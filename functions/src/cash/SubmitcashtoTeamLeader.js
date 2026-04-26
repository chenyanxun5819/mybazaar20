/**
 * submitCashToTeamLeader.js (架构对齐版 v3.0)
 * 学生Seller上交现金给teamLeader
 * 
 * 🔧 架构对齐修改：
 * 1. seller.totalSubmittedToManager → seller.totalSubmitted (匹配JSON第429行)
 * 2. seller.lastSubmittedAt → 移除（不需要冗余字段）
 * 3. teamLeader.cashStats字段名完全匹配JSON架构
 * 
 * 架构对应：
 * - seller.pendingCollection (手上现金)
 * - seller.totalSubmitted (累计提交现金)
 * - teamLeader.cashStats.pendingFromSellers (待确认)
 * - teamLeader.cashStats.totalReceivedFromSellers (累计收款)
 * - cashSubmissions (提交记录)
 * 
 * @version 3.0
 * @date 2025-01-03
 */

const { onCall } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = admin.firestore;

exports.submitCashToTeamLeader = onCall(
  {
    region: 'asia-southeast1',
    cors: true
  },
  async (request) => {
    const { data, auth } = request;

    console.log('[submitCashToTeamLeader] 🔐 收到请求:', {
      hasAuth: !!auth,
      uid: auth?.uid,
      data: {
        orgId: data.orgId,
        eventId: data.eventId,
        amount: data.amount,
        teamLeaderId: data.teamLeaderId
      }
    });

    // ===== 1. 身份验证 =====
    if (!auth) {
      console.error('[submitCashToTeamLeader] ❌ 用户未登录');
      throw new Error('用户未登录');
    }

    const { orgId, eventId, amount, note, teamLeaderId } = data;

    if (!orgId || !eventId || !amount || !teamLeaderId) {
      console.error('[submitCashToTeamLeader] ❌ 缺少必需参数:', { orgId, eventId, amount, teamLeaderId });
      throw new Error('缺少必需参数');
    }

    if (typeof amount !== 'number' || amount <= 0) {
      console.error('[submitCashToTeamLeader] ❌ 金额无效:', amount);
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

      console.log('[submitCashToTeamLeader] 📊 查询Seller，authUid:', authUid);

      const sellerQuery = usersRef.where('authUid', '==', authUid);
      const sellerSnapshot = await sellerQuery.get();

      if (sellerSnapshot.empty) {
        console.error('[submitCashToTeamLeader] ❌ Seller不存在');
        throw new Error('Seller不存在');
      }

      const sellerDoc = sellerSnapshot.docs[0];
      const sellerData = sellerDoc.data();
      const sellerId = sellerDoc.id;

      console.log('[submitCashToTeamLeader] ✅ 找到Seller:', {
        sellerId,
        roles: sellerData.roles,
        department: sellerData.identityInfo?.department,
        pendingCollection: sellerData.seller?.pendingCollection
      });

      // 验证是Customer角色
      if (!sellerData.roles || !sellerData.roles.includes('customer')) {
        console.error('[submitCashToTeamLeader] ❌ 不是Customer角色');
        throw new Error('只有Customer可以上交现金给teamLeader');
      }

      // 验证手上现金是否足够
      const cashOnHand = sellerData.pointsStats?.pendingCollection || 0;
      console.log('[submitCashToTeamLeader] 💰 手上现金:', cashOnHand, '上交金额:', amount);

      if (amount > cashOnHand) {
        console.error('[submitCashToTeamLeader] ❌ 现金不足');
        throw new Error(`手上现金不足（仅有 RM ${cashOnHand}）`);
      }

      // ===== 3. 查询teamLeader文档 =====
      console.log('[submitCashToTeamLeader] 📊 查询teamLeader:', teamLeaderId);

      const smDoc = await usersRef.doc(teamLeaderId).get();

      if (!smDoc.exists) {
        console.error('[submitCashToTeamLeader] ❌ teamLeader不存在');
        throw new Error('teamLeader不存在');
      }

      const smData = smDoc.data();

      console.log('[submitCashToTeamLeader] ✅ 找到teamLeader:', {
        id: teamLeaderId,
        name: smData.basicInfo?.chineseName,
        roles: smData.roles,
        managedDepartments: smData.teamLeader?.managedDepartments
      });

      // 验证是teamLeader角色
      if (!smData.roles || !smData.roles.includes('teamLeader')) {
        console.error('[submitCashToTeamLeader] ❌ 不是teamLeader角色');
        throw new Error('接收人不是teamLeader');
      }

      // 验证管理关系（使用department匹配）
      const sellerDepartment = sellerData.identityInfo?.department;
      const managedDepartments = smData.teamLeader?.managedDepartments || [];

      console.log('[submitCashToTeamLeader] 🔍 验证管理关系:', {
        sellerDepartment,
        managedDepartments,
        isManaged: managedDepartments.includes(sellerDepartment)
      });

      if (!sellerDepartment) {
        console.error('[submitCashToTeamLeader] ❌ Seller没有department信息');
        throw new Error('您的账号缺少班级信息，请联系管理员');
      }

      if (!managedDepartments.includes(sellerDepartment)) {
        console.error('[submitCashToTeamLeader] ❌ teamLeader不管理此班级');
        throw new Error(`该teamLeader不管理您的班级（${sellerDepartment}）`);
      }

      console.log('[submitCashToTeamLeader] ✅ 验证通过，开始创建上交记录');

      // ===== 4. 使用事务创建上交记录 =====
      const result = await db.runTransaction(async (transaction) => {
        const now = FieldValue.serverTimestamp();
        const submissionNumber = `SM-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        console.log('[submitCashToTeamLeader] 📝 创建上交记录:', submissionNumber);

        // 4.1 创建上交记录（匹配JSON架构）
        const submissionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions').doc();

        const submissionData = {
          submissionNumber,
          submittedBy: sellerId,
          submitterRole: 'customer',
          submitterName: sellerData.basicInfo?.chineseName || sellerData.basicInfo?.englishName || '未知',
          submitterDepartment: sellerData.identityInfo?.department || null,
          
          amount,
          note: note || '',
          
          // 接收方信息（匹配JSON第1010-1013行）
          receivedBy: teamLeaderId,
          receiverName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName || 'teamLeader',
          receiverRole: 'teamLeader', // ✅ JSON第1012行
          
          status: 'pending',
          submittedAt: now,
          confirmedAt: null,
          confirmationNote: '',
          
          metadata: {
            createdAt: now,
            updatedAt: now,
            submissionType: 'customerToteamLeader'
          }
        };

        transaction.set(submissionRef, submissionData);
        console.log('[submitCashToTeamLeader] ✅ 上交记录已创建');

        // 4.2 更新Seller统计（匹配JSON第422-435行）
        const sellerDocRef = usersRef.doc(sellerId);
        
        console.log('[submitCashToTeamLeader] 📊 更新Seller统计');

        transaction.update(sellerDocRef, {
          'pointsStats.pendingCollection': FieldValue.increment(-amount),
          'activityData.updatedAt': now
        });

        // 4.3 更新teamLeader.cashStats统计
        const smDocRef = usersRef.doc(teamLeaderId);

        console.log('[submitCashToTeamLeader] 📊 更新teamLeader.cashStats');

        transaction.update(smDocRef, {
          'teamLeader.cashStats.pendingFromCustomers': FieldValue.increment(amount),
          // totalReceivedFromCustomers
          'teamLeader.cashStats.totalReceivedFromCustomers': FieldValue.increment(amount)
        });

        console.log('[submitCashToTeamLeader] ✅ 事务提交成功');

        return {
          success: true,
          submissionId: submissionRef.id,
          submissionNumber,
          amount,
          receiverName: smData.basicInfo?.chineseName || smData.basicInfo?.englishName
        };
      });

      console.log('[submitCashToTeamLeader] ✅ 上交成功:', result);

      return {
        success: true,
        message: `现金已提交给 ${result.receiverName}`,
        data: result
      };

    } catch (error) {
      console.error('[submitCashToTeamLeader] ❌ 上交失败:', {
        errorMessage: error.message,
        errorStack: error.stack,
        errorCode: error.code
      });
      
      throw new Error('上交失败: ' + error.message);
    }
  }
);