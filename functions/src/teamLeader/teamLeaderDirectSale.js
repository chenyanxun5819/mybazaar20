/**
 * Team Leader Direct Sale Cloud Function
 * Team Leader 直接销售点数给 Customer (所管理的 Seller)
 * 
 * 业务逻辑：
 * 1. Team Leader 只能销售给他管理的 Seller
 * 2. 购买点数的 Seller 身份是 Customer
 * 3. 点数流向 customer.pointsAccount.availablePoints
 * 4. 记录 transaction (transactionType: 'teamLeader_to_customer')
 * 5. 更新 teamLeader.cashStats.cashOnHand
 * 6. 更新 teamLeader.cashStats.cashSources.fromPointPurchase
 * 
 * @version 1.0
 * @date 2026-01-12
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.teamLeaderDirectSale = onCall({ region: 'asia-southeast1' }, async (request) => {
  // 1. 身份验证
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '用户未登录');
  }
  
  const { orgId, eventId, customerId, amount, transactionPin, note } = request.data;
  const teamLeaderId = request.auth.uid;
  
  // 2. 参数验证
  if (!orgId || !eventId || !customerId || !amount) {
    throw new HttpsError('invalid-argument', '缺少必要参数');
  }
  
  if (typeof amount !== 'number' || amount <= 0) {
    throw new HttpsError('invalid-argument', '金额必须大于 0');
  }
  
  // 3. 单笔限额验证
  const MAX_PER_TRANSACTION = 100;
  if (amount > MAX_PER_TRANSACTION) {
    throw new HttpsError(
      'invalid-argument',
      `单笔销售不能超过 ${MAX_PER_TRANSACTION} 点`
    );
  }
  
  // 4. 验证交易密码
  await verifyTransactionPin(teamLeaderId, transactionPin, orgId, eventId);
  
  const db = admin.firestore();
  
  // 5. 获取 Team Leader 和 Customer 引用
  const teamLeaderRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(teamLeaderId);
  
  const customerRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(customerId);
  
  // 6. 使用事务执行销售
  try {
    const result = await db.runTransaction(async (transaction) => {
      // 6.1 读取 Team Leader 数据
      const teamLeaderDoc = await transaction.get(teamLeaderRef);
      if (!teamLeaderDoc.exists) {
        throw new HttpsError('not-found', 'Team Leader 不存在');
      }
      
      const teamLeaderData = teamLeaderDoc.data();
      
      // 验证角色
      if (!teamLeaderData.roles || !teamLeaderData.roles.includes('teamLeader')) {
        throw new HttpsError('permission-denied', '用户不是 Team Leader');
      }
      
      // 获取管理的部门
      const managedDepartments = teamLeaderData.teamLeader?.managedDepartments || 
                                 teamLeaderData.managedDepartments || [];
      
      if (managedDepartments.length === 0) {
        throw new HttpsError('permission-denied', 'Team Leader 没有管理任何部门');
      }
      
      // 6.2 读取 Customer 数据
      const customerDoc = await transaction.get(customerRef);
      if (!customerDoc.exists) {
        throw new HttpsError('not-found', '客户不存在');
      }
      
      const customerData = customerDoc.data();
      
      // 验证客户角色
      if (!customerData.roles || !customerData.roles.includes('customer')) {
        throw new HttpsError('permission-denied', '目标用户不是客户');
      }
      
      // 验证客户是否在管理范围内
      const customerDept = customerData.identityInfo?.department || 
                          customerData.department ||
                          customerData.basicInfo?.department;
      
      if (!customerDept || !managedDepartments.includes(customerDept)) {
        throw new HttpsError(
          'permission-denied',
          '该客户不在您的管理范围内'
        );
      }
      
      // 6.3 创建交易记录
      const transactionId = `SM2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const transactionRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('transactions').doc(transactionId);
      
      const now = admin.firestore.FieldValue.serverTimestamp();
      
      const transactionData = {
        transactionId,
        transactionType: 'teamLeader_to_customer',
        organizationId: orgId,
        eventId: eventId,
        
        // Team Leader 信息
        sellerId: teamLeaderId,
        sellerName: teamLeaderData.basicInfo?.chineseName || 
                   teamLeaderData.basicInfo?.englishName || 'Team Leader',
        sellerRole: 'teamLeader',
        sellerDepartment: customerDept,
        
        // Customer 信息
        customerId: customerId,
        customerName: customerData.basicInfo?.chineseName || 
                     customerData.basicInfo?.englishName || 'Customer',
        customerDepartment: customerDept,
        
        // 交易信息
        amount: amount,
        points: amount,
        note: note || '',
        
        // 余额快照
        sellerBalanceBefore: 0, // Team Leader 没有库存概念
        sellerBalanceAfter: 0,
        customerBalanceBefore: customerData.customer?.pointsAccount?.availablePoints || 0,
        customerBalanceAfter: (customerData.customer?.pointsAccount?.availablePoints || 0) + amount,
        
        // 时间戳
        timestamp: now,
        status: 'completed',
        
        metadata: {
          createdAt: now,
          source: 'teamLeaderDirectSale'
        }
      };
      
      transaction.set(transactionRef, transactionData);
      
      // 6.4 更新 Customer 点数
      transaction.update(customerRef, {
        'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(amount),
        'customer.pointsAccount.lastTransactionAt': now,
        'updatedAt': now
      });
      
      // 6.5 更新 Team Leader 现金统计
      const currentCashSources = teamLeaderData.teamLeader?.cashStats?.cashSources;
      
      const smUpdates = {
        // 更新现金持有
        'teamLeader.cashStats.cashOnHand': admin.firestore.FieldValue.increment(amount),
        
        // 更新购点收入
        'teamLeader.cashStats.cashSources.fromPointPurchase': admin.firestore.FieldValue.increment(amount),
        
        // 更新销售统计
        'teamLeader.totalAllocations': admin.firestore.FieldValue.increment(1),
        'teamLeader.totalPointsAllocated': admin.firestore.FieldValue.increment(amount),
        'teamLeader.lastAllocationAt': now,
        
        'updatedAt': now
      };
      
      // 初始化 fromPointSales（如果需要）
      if (!currentCashSources || currentCashSources.fromPointSales === undefined) {
        const currentCashOnHand = teamLeaderData.teamLeader?.cashStats?.cashOnHand || 0;
        smUpdates['teamLeader.cashStats.cashSources.fromPointSales'] = currentCashOnHand;
      }
      
      transaction.update(teamLeaderRef, smUpdates);
      
      return {
        transactionId,
        amount,
        teamLeaderId,
        customerId,
        customerBalanceAfter: (customerData.customer?.pointsAccount?.availablePoints || 0) + amount
      };
    });
    
    return {
      success: true,
      data: result,
      message: '销售成功'
    };
    
  } catch (error) {
    console.error('[teamLeaderDirectSale] 销售失败:', error);
    
    if (error.code) {
      throw error;
    }
    
    throw new HttpsError('internal', `销售失败: ${error.message}`);
  }
});
