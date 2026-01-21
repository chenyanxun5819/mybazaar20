/**
 * Seller Manager Direct Sale Cloud Function
 * Seller Manager 直接销售点数给 Customer (所管理的 Seller)
 * 
 * 业务逻辑：
 * 1. Seller Manager 只能销售给他管理的 Seller
 * 2. 购买点数的 Seller 身份是 Customer
 * 3. 点数流向 customer.pointsAccount.availablePoints
 * 4. 记录 transaction (type: 'sellerManager_to_customer')
 * 5. 更新 sellerManager.cashStats.cashOnHand
 * 6. 更新 sellerManager.cashStats.cashSources.fromPointPurchase
 * 
 * @version 1.0
 * @date 2026-01-12
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { verifyTransactionPin } = require('../../utils/verifyTransactionPin');

exports.sellerManagerDirectSale = onCall({ region: 'asia-southeast1' }, async (request) => {
  // 1. 身份验证
  if (!request.auth) {
    throw new HttpsError('unauthenticated', '用户未登录');
  }
  
  const { orgId, eventId, customerId, amount, transactionPin, note } = request.data;
  const sellerManagerId = request.auth.uid;
  
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
  await verifyTransactionPin(sellerManagerId, transactionPin, orgId, eventId);
  
  const db = admin.firestore();
  
  // 5. 获取 Seller Manager 和 Customer 引用
  const sellerManagerRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(sellerManagerId);
  
  const customerRef = db
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(customerId);
  
  // 6. 使用事务执行销售
  try {
    const result = await db.runTransaction(async (transaction) => {
      // 6.1 读取 Seller Manager 数据
      const sellerManagerDoc = await transaction.get(sellerManagerRef);
      if (!sellerManagerDoc.exists) {
        throw new HttpsError('not-found', 'Seller Manager 不存在');
      }
      
      const sellerManagerData = sellerManagerDoc.data();
      
      // 验证角色
      if (!sellerManagerData.roles || !sellerManagerData.roles.includes('sellerManager')) {
        throw new HttpsError('permission-denied', '用户不是 Seller Manager');
      }
      
      // 获取管理的部门
      const managedDepartments = sellerManagerData.sellerManager?.managedDepartments || 
                                 sellerManagerData.managedDepartments || [];
      
      if (managedDepartments.length === 0) {
        throw new HttpsError('permission-denied', 'Seller Manager 没有管理任何部门');
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
        type: 'sellerManager_to_customer',
        organizationId: orgId,
        eventId: eventId,
        
        // Seller Manager 信息
        sellerId: sellerManagerId,
        sellerName: sellerManagerData.basicInfo?.chineseName || 
                   sellerManagerData.basicInfo?.englishName || 'Seller Manager',
        sellerRole: 'sellerManager',
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
        sellerBalanceBefore: 0, // Seller Manager 没有库存概念
        sellerBalanceAfter: 0,
        customerBalanceBefore: customerData.customer?.pointsAccount?.availablePoints || 0,
        customerBalanceAfter: (customerData.customer?.pointsAccount?.availablePoints || 0) + amount,
        
        // 时间戳
        timestamp: now,
        status: 'completed',
        
        metadata: {
          createdAt: now,
          source: 'sellerManagerDirectSale'
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
      
      // 6.5 更新 Seller Manager 现金统计
      const currentCashSources = sellerManagerData.sellerManager?.cashStats?.cashSources;
      
      const smUpdates = {
        // 更新现金持有
        'sellerManager.cashStats.cashOnHand': admin.firestore.FieldValue.increment(amount),
        
        // 更新购点收入
        'sellerManager.cashStats.cashSources.fromPointPurchase': admin.firestore.FieldValue.increment(amount),
        
        // 更新销售统计
        'sellerManager.totalAllocations': admin.firestore.FieldValue.increment(1),
        'sellerManager.totalPointsAllocated': admin.firestore.FieldValue.increment(amount),
        'sellerManager.lastAllocationAt': now,
        
        'updatedAt': now
      };
      
      // 初始化 fromPointSales（如果需要）
      if (!currentCashSources || currentCashSources.fromPointSales === undefined) {
        const currentCashOnHand = sellerManagerData.sellerManager?.cashStats?.cashOnHand || 0;
        smUpdates['sellerManager.cashStats.cashSources.fromPointSales'] = currentCashOnHand;
      }
      
      transaction.update(sellerManagerRef, smUpdates);
      
      return {
        transactionId,
        amount,
        sellerManagerId,
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
    console.error('[sellerManagerDirectSale] 销售失败:', error);
    
    if (error.code) {
      throw error;
    }
    
    throw new HttpsError('internal', `销售失败: ${error.message}`);
  }
});
