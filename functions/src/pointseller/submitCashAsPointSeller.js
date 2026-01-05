/**
 * Submit Cash As PointSeller Cloud Function
 * PointSeller 上交现金给 Finance Manager
 * 
 * 功能：
 * 1. 验证交易密码
 * 2. 验证金额与记录总和匹配
 * 3. 创建 cashSubmissions 文档
 * 4. 状态设置为 pending，等待 Finance Manager 确认
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

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
  const storedHash = userData.basicInfo?.transactionPinHash;
  
  if (!storedHash) {
    throw new HttpsError('failed-precondition', '未设置交易密码');
  }
  
  // 使用 SHA-256 验证
  const inputHash = crypto.createHash('sha256').update(inputPin).digest('hex');
  
  if (inputHash !== storedHash) {
    throw new HttpsError('permission-denied', '交易密码错误');
  }
  
  return true;
}

exports.submitCashAsPointSeller = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data } = request;
  const context = request;
  
  // 1. 身份验证
  if (!context.auth) {
    throw new HttpsError('unauthenticated', '用户未登录');
  }
  
  const { orgId, eventId, amount, recordIds, records, transactionPin, note } = data;
  const pointSellerId = context.auth.uid;
  
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
    const calculatedTotal = records.reduce((sum, record) => {
      const recordAmount = record.type === 'point_card' 
        ? (record.issuer?.cashReceived || 0)
        : (record.amount || 0);
      return sum + recordAmount;
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
      // 6. 读取 PointSeller 数据
      const pointSellerDoc = await pointSellerRef.get();
      if (!pointSellerDoc.exists) {
        throw new HttpsError('not-found', 'PointSeller 不存在');
      }
      
      const pointSellerData = pointSellerDoc.data();
      
      // 验证角色
      if (!pointSellerData.roles || !pointSellerData.roles.includes('pointSeller')) {
        throw new HttpsError('permission-denied', '用户不是 PointSeller');
      }
      
      // 7. 创建 cashSubmissions 文档
      const submissionId = `CASH_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const cashSubmissionRef = db
        .collection('organizations').doc(orgId)
        .collection('events').doc(eventId)
        .collection('cashSubmissions').doc(submissionId);
      
      const cashSubmissionData = {
        submissionId,
        organizationId: orgId,
        eventId: eventId,
        
        // 提交人信息
        submittedBy: pointSellerId,
        submitterName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
        submitterRole: 'pointSeller',
        
        // 金额信息
        amount: amount,
        currency: 'MYR',
        
        // 记录信息
        recordIds: recordIds || [],
        records: records.map(record => ({
          id: record.id,
          type: record.type,
          amount: record.type === 'point_card' 
            ? (record.issuer?.cashReceived || 0)
            : (record.amount || 0),
          cardNumber: record.cardNumber || null,
          customerName: record.customerName || null,
          timestamp: record.metadata?.createdAt || record.timestamp || null
        })),
        
        // 状态信息
        status: 'pending',
        receivedBy: null,
        receiverName: null,
        confirmationNote: null,
        
        // 备注
        note: note || '',
        
        // 时间戳
        submittedAt: admin.firestore.FieldValue.serverTimestamp(),
        confirmedAt: null,
        
        // 元数据
        metadata: {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'submitCashAsPointSeller'
        }
      };
      
      await cashSubmissionRef.set(cashSubmissionData);
      
      return {
        success: true,
        data: {
          submissionId,
          amount,
          status: 'pending',
          submittedAt: new Date().toISOString()
        },
        message: '现金上交成功，等待 Finance Manager 确认'
      };
      
    } catch (error) {
      console.error('上交现金失败:', error);
      
      if (error.code) {
        throw error;
      }
      
      throw new HttpsError('internal', `上交失败: ${error.message}`);
    }
  });
