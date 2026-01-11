/**
 * allocatePointsBySellerManagerHttp (方案A 更新版)
 * 
 * 功能：Seller Manager 分配点数给 Seller
 * 
 * ✅ 方案A 更新：
 * 1. 记录收到的现金（cashReceived = points，1:1 比例）
 * 2. 更新 sellerManager.cashStats.cashSources.fromPointPurchase
 * 3. 更新 sellerManager.cashStats.cashOnHand
 * 
 * @version 2.0
 * @date 2026-01-11
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

exports.allocatePointsBySellerManagerHttp = onCall({ region: 'asia-southeast1' }, async (request) => {
    const data = request.data;
    const context = { auth: request.auth };

    console.log('[allocatePointsBySellerManager] 开始处理', {
      data,
      authUid: context.auth?.uid
    });

    // ========== 第1步：验证用户身份 ==========
    if (!context.auth) {
      throw new HttpsError(
        'unauthenticated',
        '用户未认证'
      );
    }

    const callerUid = context.auth.uid;

    // ========== 第2步：验证参数 ==========
    const {
      organizationId,
      eventId,
      recipientId,
      points,
      notes
    } = data;

    if (!organizationId || !eventId || !recipientId) {
      throw new HttpsError(
        'invalid-argument',
        '缺少必填参数：organizationId, eventId, recipientId'
      );
    }

    if (!points || typeof points !== 'number' || points <= 0) {
      throw new HttpsError(
        'invalid-argument',
        '点数必须是正数'
      );
    }

    // ========== 第3步：验证 Seller Manager 身份 ==========
    const smRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${callerUid}`);
    const smDoc = await smRef.get();

    if (!smDoc.exists) {
      throw new HttpsError(
        'not-found',
        'Seller Manager 用户不存在'
      );
    }

    const smData = smDoc.data();
    const roles = smData.roles || [];

    if (!roles.includes('sellerManager')) {
      throw new HttpsError(
        'permission-denied',
        '只有 Seller Manager 可以分配点数'
      );
    }

    const managedDepartments = smData.sellerManager?.managedDepartments || [];
    if (managedDepartments.length === 0) {
      throw new HttpsError(
        'permission-denied',
        'Seller Manager 没有管理任何部门'
      );
    }

    console.log('[allocatePointsBySellerManager] Seller Manager 验证通过', {
      smId: callerUid,
      smName: smData.basicInfo?.chineseName,
      managedDepartments
    });

    // ========== 第4步：验证接收者 ==========
    const recipientRef = db.doc(`organizations/${organizationId}/events/${eventId}/users/${recipientId}`);
    const recipientDoc = await recipientRef.get();

    if (!recipientDoc.exists) {
      throw new HttpsError(
        'not-found',
        '接收者不存在'
      );
    }

    const recipientData = recipientDoc.data();
    const recipientRoles = recipientData.roles || [];

    if (!recipientRoles.includes('seller')) {
      throw new HttpsError(
        'invalid-argument',
        '接收者必须是 Seller'
      );
    }

    const recipientDepartment = recipientData.identityInfo?.department;
    if (!recipientDepartment || !managedDepartments.includes(recipientDepartment)) {
      throw new HttpsError(
        'permission-denied',
        `您只能分配点数给您管理的部门（${managedDepartments.join(', ')}）`
      );
    }

    console.log('[allocatePointsBySellerManager] 接收者验证通过', {
      recipientId,
      recipientName: recipientData.basicInfo?.chineseName,
      recipientDepartment
    });

    // ========== 第5步：验证分配限额 ==========
    const eventRef = db.doc(`organizations/${organizationId}/events/${eventId}`);
    const eventDoc = await eventRef.get();

    let maxPerAllocation = 100; // 默认值
    if (eventDoc.exists) {
      const eventData = eventDoc.data();
      maxPerAllocation = eventData.pointAllocationRules?.sellerManager?.maxPerAllocation || 100;
    }

    if (points > maxPerAllocation) {
      throw new HttpsError(
        'invalid-argument',
        `单次分配不能超过 ${maxPerAllocation} 点`
      );
    }

    console.log('[allocatePointsBySellerManager] 分配限额验证通过', {
      points,
      maxPerAllocation
    });

    // ========== 第6步：执行分配（使用事务） ==========
    try {
      const result = await db.runTransaction(async (transaction) => {
        // 6.1 重新读取最新数据（事务内）
        const smDocInTx = await transaction.get(smRef);
        const recipientDocInTx = await transaction.get(recipientRef);

        if (!smDocInTx.exists || !recipientDocInTx.exists) {
          throw new HttpsError(
            'aborted',
            '用户数据已被删除'
          );
        }

        // 6.2 获取当前余额
        const currentBalance = recipientDocInTx.data().seller?.availablePoints || 0;

        // 6.3 创建分配记录（✅ 方案A：添加现金记录）
        const allocationRef = smRef.collection('pointAllocations').doc();
        const allocationId = allocationRef.id;
        const now = FieldValue.serverTimestamp();

        const allocationData = {
          allocationId: allocationId,
          fromUserId: callerUid,
          toUserId: recipientId,
          toDepartment: recipientDepartment,
          points: points,
          reason: notes || '加额购买',
          allocatedAt: now,
          status: 'completed',
          
          // ✅ 方案A：新增现金记录
          cashReceived: points,              // 现金金额（1:1 比例）
          cashReceivedAt: now,               // 收款时间
          cashRecordedInSubmission: false,   // 未上交
          
          // 接收者快照
          recipientSnapshot: {
            recipientName: recipientDocInTx.data().basicInfo?.chineseName || 'N/A',
            recipientDepartment: recipientDepartment,
            beforeBalance: currentBalance,
            afterBalance: currentBalance + points
          }
        };

        transaction.set(allocationRef, allocationData);

        console.log('[allocatePointsBySellerManager] 创建分配记录', {
          allocationId,
          points,
          cashReceived: points  // ✅ 记录现金
        });

        // 6.4 更新接收者的可用点数
        transaction.update(recipientRef, {
          'seller.availablePoints': FieldValue.increment(points),
          'seller.totalReceived': FieldValue.increment(points),
          'pointsStats.totalReceived': FieldValue.increment(points),
          'pointsStats.currentBalance': FieldValue.increment(points),
          updatedAt: now
        });

        console.log('[allocatePointsBySellerManager] 更新接收者点数', {
          recipientId,
          pointsAdded: points,
          newBalance: currentBalance + points
        });

        // 6.5 更新 Seller Manager 统计（✅ 方案A：更新现金来源）
        const currentCashSources = smDocInTx.data().sellerManager?.cashStats?.cashSources || {};
        const currentFromPurchase = currentCashSources.fromPointPurchase || 0;

        transaction.update(smRef, {
          // 分配统计
          'sellerManager.totalAllocations': FieldValue.increment(1),
          'sellerManager.totalPointsAllocated': FieldValue.increment(points),
          'sellerManager.lastAllocationAt': now,
          
          // ✅ 方案A：更新现金统计
          'sellerManager.cashStats.cashOnHand': FieldValue.increment(points),
          'sellerManager.cashStats.cashSources.fromPointPurchase': FieldValue.increment(points),
          
          updatedAt: now
        });

        console.log('[allocatePointsBySellerManager] ✅ 更新 SM 现金统计', {
          cashReceived: points,
          newFromPointPurchase: currentFromPurchase + points
        });

        return {
          success: true,
          allocationId: allocationId,
          points: points,
          cashReceived: points,  // ✅ 返回现金金额
          recipientId: recipientId,
          recipientName: recipientDocInTx.data().basicInfo?.chineseName,
          newBalance: currentBalance + points
        };
      });

      console.log('[allocatePointsBySellerManager] ✅ 分配成功', result);

      return result;

    } catch (error) {
      console.error('[allocatePointsBySellerManager] ❌ 事务失败', error);
      
      if (error instanceof HttpsError) {
        throw error;
      }
      
      throw new HttpsError(
        'internal',
        '分配失败：' + (error?.message || String(error))
      );
    }
  });

// ========== 导出函数 ==========
// exports.allocatePointsBySellerManagerHttp = allocatePointsBySellerManagerHttp;
