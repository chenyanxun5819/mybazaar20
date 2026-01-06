/**
 * Submit Cash As PointSeller Cloud Function - 修复版 v3.0
 * PointSeller 上交现金给 Finance Manager
 * 
 * 修复：
 * 1. 添加 submissionNumber（流水号）
 * 2. 添加 submitterPhone
 * 3. 添加 receiverRole
 * 4. 添加 receiptNumber
 * 5. 使用 pointCardInfo 结构
 * 6. 添加 metadata.submissionType
 * 7. 更新 PointSeller 的 cashManagement
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

// 生成提交流水号
function generateSubmissionNumber(orgId, eventId) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const timeStr = now.getTime().toString().slice(-4); // 后4位时间戳
  return `CS-${dateStr}-${timeStr}`;
}

exports.submitCashAsPointSeller = onCall({ region: 'asia-southeast1' }, async (request) => {
    // 1. 身份验证
    if (!request.auth) {
      throw new HttpsError('unauthenticated', '用户未登录');
    }
    
    const { orgId, eventId, amount, recordIds, records, transactionPin, note } = request.data;
    const pointSellerId = request.auth.uid;
    
    // 2. 参数验证
    if (!orgId || !eventId || !amount || !records || !Array.isArray(records)) {
      throw new HttpsError('invalid-argument', '缺少必要参数');
    }
    
    if (typeof amount !== 'number' || amount <= 0) {
      throw new HttpsError('invalid-argument', '金额必须大于 0');
    }
    
    if (records.length === 0) {
      throw new HttpsError('invalid-argument', '至少需要选择一条记录');
    }
    
    // 3. 验证交易密码
    try {
      await verifyTransactionPin(pointSellerId, orgId, eventId, transactionPin);
    } catch (error) {
      throw error;
    }
    
    // 4. 验证金额匹配
    // ✅ 修正：统一使用前端传递的 amount 字段
    const calculatedTotal = records.reduce((sum, record) => {
      return sum + (record.amount || 0);
    }, 0);
    
    if (Math.abs(calculatedTotal - amount) > 0.01) {
      throw new HttpsError(
        'invalid-argument',
        `金额不匹配：提交金额 ${amount}，记录总和 ${calculatedTotal}`
      );
    }
    
    const db = admin.firestore();
    
    // 5. 获取 PointSeller 引用
    const pointSellerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(pointSellerId);
    
    try {
      // 6. 使用事务创建提交记录并更新统计
      const result = await db.runTransaction(async (transaction) => {
        // 6.1 读取 PointSeller 数据
        const pointSellerDoc = await transaction.get(pointSellerRef);
        if (!pointSellerDoc.exists) {
          throw new HttpsError('not-found', 'PointSeller 不存在');
        }
        
        const pointSellerData = pointSellerDoc.data();
        
        // 验证角色
        if (!pointSellerData.roles || !pointSellerData.roles.includes('pointSeller')) {
          throw new HttpsError('permission-denied', '用户不是 PointSeller');
        }
        
        // 6.2 生成编号
        const submissionId = `CASH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const submissionNumber = generateSubmissionNumber(orgId, eventId);
        
        // 6.3 处理点数卡信息
        const pointCards = records.filter(r => r.type === 'point_card');
        const directSales = records.filter(r => r.type === 'direct_sale');
        
        const pointCardInfo = {
          cardsIssued: pointCards.length,
          pointsIssued: pointCards.reduce((sum, card) => sum + (card.balance?.initial || 0), 0),
          cardIds: pointCards.map(card => card.cardId || card.id)
        };
        
        // 6.4 创建 cashSubmissions 文档（✅ 按 Firestore 架构）
        const cashSubmissionRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('cashSubmissions').doc(submissionId);
        
        const now = admin.firestore.FieldValue.serverTimestamp();
        
        const cashSubmissionData = {
          // 基本信息
          submissionId,
          submissionNumber,  // ✅ 新增流水号
          
          // 提交方信息
          submittedBy: pointSellerId,
          submitterName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
          submitterRole: 'pointSeller',
          submitterDepartment: null,
          submitterPhone: pointSellerData.basicInfo?.phoneNumber || '',  // ✅ 新增
          
          // 接收方信息（null = 待认领池子）
          receivedBy: null,
          receiverName: null,
          receiverRole: null,  // ✅ 新增
          receiverPhone: null,
          
          // 金额信息
          amount: amount,
          breakdown: {
            cash: amount,
            transfer: 0,
            check: 0
          },
          currency: 'MYR',
          
          // 状态信息
          status: 'pending',
          submittedAt: now,
          confirmedAt: null,
          disputedAt: null,
          rejectedAt: null,
          
          // 备注信息
          note: note || '',
          receiptNumber: null,  // ✅ 新增（Finance Manager 确认时填写）
          confirmationNote: null,
          disputeReason: null,
          
          // 包含的销售记录
          includedSales: directSales.map(sale => ({
            sellerId: sale.sellerId,
            sellerName: sale.sellerName || sale.customerName,
            amount: sale.amount || 0,
            salesDate: new Date().toISOString().split('T')[0],
            transactionIds: [sale.transactionId || sale.id]
          })),
          salesCount: directSales.length,
          
          // 点数卡信息（✅ 使用规范结构）
          pointCardInfo: pointCardInfo,
          
          // 元数据
          metadata: {
            createdAt: now,
            updatedAt: now,
            eventId: eventId,
            organizationId: orgId,
            submissionSource: 'manual',
            submissionType: 'pointSellerToFinance'  // ✅ 新增
          }
        };
        
        transaction.set(cashSubmissionRef, cashSubmissionData);
        
        // 6.5 更新 PointSeller 的 cashManagement（✅ 修正逻辑）
        // 提交现金后：
        // 1. cashOnHand 减少（现金已交出）
        // 2. 不更新 totalSubmitted（等确认后才算"已上交"）
        transaction.update(pointSellerRef, {
          'pointSeller.cashManagement.cashOnHand': admin.firestore.FieldValue.increment(-amount),
          'pointSeller.cashManagement.lastSubmissionAt': now,
          'pointSeller.cashManagement.submissionCount': admin.firestore.FieldValue.increment(1),
          'updatedAt': now
        });
        
        return {
          submissionId,
          submissionNumber,
          amount,
          status: 'pending'
        };
      });
      
      return {
        success: true,
        data: {
          ...result,
          submittedAt: new Date().toISOString()
        },
        message: '现金上交成功，等待 Finance Manager 确认'
      };
      
    } catch (error) {
      console.error('[submitCashAsPointSeller] 上交现金失败:', error);
      
      if (error.code) {
        throw error;
      }
      
      throw new HttpsError('internal', `上交失败: ${error.message}`);
    }
  });