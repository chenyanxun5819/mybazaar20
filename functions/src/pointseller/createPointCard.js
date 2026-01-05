/**
 * Create Point Card Cloud Function
 * 创建点数卡
 * 
 * 功能：
 * 1. 验证交易密码
 * 2. 验证时间限制（6:00-18:00）- 测试阶段已禁用
 * 3. 验证单笔限额（100点）
 * 4. 生成唯一卡号
 * 5. 创建 pointCards 文档
 * 6. 更新 PointSeller 统计数据
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

// 生成卡号：CARD-YYYYMMDD-XXXXX
function generateCardNumber() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
  const randomStr = Math.random().toString(36).substr(2, 5).toUpperCase(); // 5位随机字符
  return `CARD-${dateStr}-${randomStr}`;
}

exports.createPointCard = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data } = request;
  const context = request;
  
  // 1. 身份验证
  if (!context.auth) {
    throw new HttpsError('unauthenticated', '用户未登录');
  }
  
  const { orgId, eventId, amount, cashReceived, transactionPin, note } = data;
  const pointSellerId = context.auth.uid;
  
  // 2. 参数验证
  if (!orgId || !eventId || !amount || cashReceived === undefined) {
    throw new HttpsError('invalid-argument', '缺少必要参数');
  }
  
  if (typeof amount !== 'number' || amount <= 0) {
    throw new HttpsError('invalid-argument', '金额必须大于 0');
  }
  
  if (typeof cashReceived !== 'number' || cashReceived < 0) {
    throw new HttpsError('invalid-argument', '现金金额无效');
  }
  
  // 3. 单笔限额验证
  const MAX_PER_TRANSACTION = 100;
  if (amount > MAX_PER_TRANSACTION) {
    throw new HttpsError(
      'invalid-argument',
      `单笔发行不能超过 ${MAX_PER_TRANSACTION} 点`
    );
  }
  
  // 4. 验证交易密码
  try {
    await verifyTransactionPin(pointSellerId, orgId, eventId, transactionPin);
  } catch (error) {
    throw error;
  }
  
  // 5. 时间限制验证（测试阶段已禁用）
  // const now = new Date();
  // const hour = now.getHours();
  // if (hour < 6 || hour >= 18) {
  //   throw new HttpsError(
  //     'failed-precondition',
    //     '当前不在营业时间内（6:00 AM - 6:00 PM）'
    //   );
    // }
    
    const db = admin.firestore();
    
    // 6. 获取 PointSeller 引用
    const pointSellerRef = db
      .collection('organizations').doc(orgId)
      .collection('events').doc(eventId)
      .collection('users').doc(pointSellerId);
    
    // 7. 使用事务创建点数卡
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
        
        // 7.2 生成卡号和卡ID
        const cardNumber = generateCardNumber();
        const cardId = `CARD_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // 7.3 创建点数卡文档
        const pointCardRef = db
          .collection('organizations').doc(orgId)
          .collection('events').doc(eventId)
          .collection('pointCards').doc(cardId);
        
        const pointCardData = {
          cardId,
          cardNumber,
          organizationId: orgId,
          eventId: eventId,
          
          // 发行人信息
          issuer: {
            pointSellerId: pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            issuedAt: admin.firestore.FieldValue.serverTimestamp(),
            cashReceived: cashReceived,
            note: note || ''
          },
          
          // 余额信息
          balance: {
            initial: amount,
            current: amount,
            used: 0
          },
          
          // 状态信息
          status: {
            isActive: true,
            isLocked: false,
            activatedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUsedAt: null
          },
          
          // 交易记录（空数组，使用时添加）
          transactions: [],
          
          // 元数据
          metadata: {
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            version: '1.0',
            source: 'createPointCard'
          }
        };
        
        transaction.set(pointCardRef, pointCardData);
        
        // 7.4 更新 PointSeller 统计数据
        transaction.update(pointSellerRef, {
          // 今日统计
          'pointSeller.todayStats.cardsIssued': admin.firestore.FieldValue.increment(1),
          'pointSeller.todayStats.totalPointsIssued': admin.firestore.FieldValue.increment(amount),
          'pointSeller.todayStats.totalCashReceived': admin.firestore.FieldValue.increment(cashReceived),
          'pointSeller.todayStats.lastIssueAt': admin.firestore.FieldValue.serverTimestamp(),
          
          // 累计统计
          'pointSeller.totalStats.totalCardsIssued': admin.firestore.FieldValue.increment(1),
          'pointSeller.totalStats.totalPointsIssued': admin.firestore.FieldValue.increment(amount),
          'pointSeller.totalStats.totalCashReceived': admin.firestore.FieldValue.increment(cashReceived),
          
          'updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
        
        return {
          cardId,
          cardNumber,
          balance: {
            initial: amount,
            current: amount
          },
          issuer: {
            pointSellerId: pointSellerId,
            pointSellerName: pointSellerData.basicInfo?.chineseName || pointSellerData.basicInfo?.englishName || 'PointSeller',
            cashReceived: cashReceived
          }
        };
      });
      
      return {
        success: true,
        data: result,
        message: '点数卡创建成功'
      };
      
    } catch (error) {
      console.error('创建点数卡失败:', error);
      
      if (error.code) {
        throw error;
      }
      
      throw new HttpsError('internal', `创建失败: ${error.message}`);
    }
  });
