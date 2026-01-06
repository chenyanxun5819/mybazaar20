/**
 * Point Seller Direct Sale Cloud Function - 修复版 v3.0
 * PointSeller 直接销售点数给 Customer
 * 
 * 修复：
 * 1. 添加 directSalesCount 和 directSalesPoints 统计
 * 2. 添加 cashManagement 更新
 * 3. 修正统计字段名称
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// 验证交易密码的辅助函数
async function verifyTransactionPin(userId, orgId, eventId, inputPin) {
  const userRef = admin.firestore()
    .collection('organizations').doc(orgId)
    .collection('events').doc(eventId)
    .collection('users').doc(userId);
  
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new HttpsError('not-found', '用户不存在');
  }
  
  const userData = userDoc.data();
  const basicInfo = userData.basicInfo || {};
  const storedHash = basicInfo.transactionPinHash;
  
  if (!storedHash) {
    throw new HttpsError('failed-precondition', '未设置交易密码');
  }
  
  // 检查是否被锁定
  const pinLockedUntil = basicInfo.pinLockedUntil;
  const now = admin.firestore.Timestamp.now();
  
  if (pinLockedUntil && pinLockedUntil.toMillis() > now.toMillis()) {
    const remainingMinutes = Math.ceil((pinLockedUntil.toMillis() - now.toMillis()) / 60000);
    throw new HttpsError(
      'failed-precondition',
      `交易密码已被锁定，请在 ${remainingMinutes} 分钟后重试`
    );
  }
  
  // 使用 bcrypt 验证密码
  const bcrypt = require('bcryptjs');
  const isPinCorrect = await bcrypt.compare(inputPin, storedHash);
  
  const pinFailedAttempts = basicInfo.pinFailedAttempts || 0;
  const MAX_FAILED_ATTEMPTS = 5;
  const LOCK_DURATION_MS = 60 * 60 * 1000; // 1小时
  
  if (isPinCorrect) {
    // 验证成功：重置错误次数
    await userRef.update({
      'basicInfo.pinFailedAttempts': 0,
      'basicInfo.pinLockedUntil': null
    });
    return true;
  } else {
    // 验证失败：增加错误次数
    const newFailedAttempts = pinFailedAttempts + 1;
    const updateData = {
      'basicInfo.pinFailedAttempts': newFailedAttempts
    };
    
    // 如果达到最大错误次数，锁定账户
    if (newFailedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
      updateData['basicInfo.pinLockedUntil'] = admin.firestore.Timestamp.fromDate(lockUntil);
      await userRef.update(updateData);
      
      throw new HttpsError(
        'failed-precondition',
        '交易密码错误次数过多，账户已被锁定1小时'
      );
    }
    
    await userRef.update(updateData);
    const remainingAttempts = MAX_FAILED_ATTEMPTS - newFailedAttempts;
    
    throw new HttpsError(
      'permission-denied',
      `交易密码错误，剩余尝试次数：${remainingAttempts}`
    );
  }
}

exports.pointSellerDirectSale = onCall({ region: 'asia-southeast1' }, async (request) => {
    // 1. 身份验证
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '用户未登录');
    }
    
    const { orgId, eventId, customerId, amount, transactionPin, note } = request.data;
    const pointSellerId = request.auth.uid;
    
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
    try {
      await verifyTransactionPin(pointSellerId, orgId, eventId, transactionPin);
    } catch (error) {
      throw error;
    }
    
    const db = admin.firestore();
    
    // 6. 获取 PointSeller 和 Customer 引用
    const pointSellerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(pointSellerId);
    
    const customerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(customerId);
    
    // 7. 使用事务执行销售
    try {
      const result = await db.runTransaction(async (transaction) => {
        // 7.1 读取 PointSeller 数据
        const pointSellerDoc = await transaction.get(pointSellerRef);
        if (!pointSellerDoc.exists) {
          throw new HttpsError('not-found', 'PointSeller 不存在');
        }
        
        const pointSellerData = pointSellerDoc.data();
        
        // 验证角色
        if (!pointSellerData.roles || !pointSellerData.roles.includes('pointSeller')) {
          throw new HttpsError('permission-denied', '用户不是 PointSeller');
        }
        
        // 7.2 读取 Customer 数据
        const customerDoc = await transaction.get(customerRef);
        if (!customerDoc.exists) {
          throw new HttpsError('not-found', '客户不存在');
        }
        
        const customerData = customerDoc.data();
        
        // 验证客户角色
        if (!customerData.roles || !customerData.roles.includes('customer')) {
          throw new HttpsError('permission-denied', '目标用户不是客户');
        }
        
        // 7.3 创建交易记录
        const transactionId = `PS2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const transactionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('transactions').doc(transactionId);
        
        const now = admin.firestore.FieldValue.serverTimestamp();
        
        const transactionData = {
          transactionId,
          type: 'pointseller_to_customer',
          organizationId: orgId,
          eventId: eventId,
          
          // PointSeller 信息
          sellerId: pointSellerId,
          sellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
          sellerRole: 'pointSeller',
          
          // Customer 信息
          customerId: customerId,
          customerName: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || 'Customer',
          
          // 交易信息
          amount: amount,
          points: amount,
          note: note || '',
          
          // 余额快照
          sellerBalanceBefore: 0, // PointSeller 没有库存概念
          sellerBalanceAfter: 0,
          customerBalanceBefore: customerData.customer?.pointsAccount?.availablePoints || 0,
          customerBalanceAfter: (customerData.customer?.pointsAccount?.availablePoints || 0) + amount,
          
          // 时间戳
          timestamp: now,
          status: 'completed',
          
          metadata: {
            createdAt: now,
            source: 'pointSellerDirectSale'
          }
        };
        
        transaction.set(transactionRef, transactionData);
        
        // 7.4 更新 Customer 点数
        transaction.update(customerRef, {
          'customer.pointsAccount.availablePoints': admin.firestore.FieldValue.increment(amount),
          'customer.pointsAccount.totalReceived': admin.firestore.FieldValue.increment(amount),
          'customer.pointsAccount.lastTransactionAt': now,
          'updatedAt': now
        });
        
        // 7.5 更新 PointSeller 统计数据（✅ 修正：添加 directSales 统计）
        const updateData = {
          // 今日统计
          'pointSeller.todayStats.directSalesCount': admin.firestore.FieldValue.increment(1),  // ✅ 新增
          'pointSeller.todayStats.directSalesPoints': admin.firestore.FieldValue.increment(amount),  // ✅ 新增
          'pointSeller.todayStats.totalCashReceived': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.lastSaleAt': now,
          
          // 累计统计
          'pointSeller.totalStats.totalDirectSales': admin.firestore.FieldValue.increment(1),
          'pointSeller.totalStats.totalPointsSold': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCashReceived': admin.firestore.FieldValue.increment(amount),
          
          // 现金管理（✅ 新增）
          'pointSeller.cashManagement.cashOnHand': admin.firestore.FieldValue.increment(amount),
          'pointSeller.cashManagement.pendingSubmission': admin.firestore.FieldValue.increment(amount),
          
          'updatedAt': now
        };

        // 如果是首次销售，设置 firstIssueAt
        if (!pointSellerData.pointSeller?.todayStats?.firstIssueAt) {
          updateData['pointSeller.todayStats.firstIssueAt'] = now;
        }
        
        transaction.update(pointSellerRef, updateData);
        
        return {
          transactionId,
          amount,
          sellerBalanceAfter: 0,
          customerBalanceAfter: (customerData.customer?.pointsAccount?.availablePoints || 0) + amount
        };
      });
      
      return {
        success: true,
        data: result,
        message: '销售成功'
      };
      
    } catch (error) {
      console.error('[pointSellerDirectSale] 销售失败:', error);
      
      if (error.code) {
        throw error;
      }
      
      throw new HttpsError('internal', `销售失败: ${error.message}`);
    }
  });