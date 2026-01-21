/**
 * queryPointCardBalance.js
 * 查询点数卡余额 - Merchant扫描点数卡后查询余额和状态
 * 
 * 功能：
 * 1. 查询点数卡基本信息
 * 2. 返回卡号、余额、状态
 * 3. 验证卡片是否有效
 * 
 * 调用时机：Merchant扫描点数卡QR Code后
 * 
 * 创建日期：2025-01-20
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

exports.queryPointCardBalance = onCall({ region: 'asia-southeast1' }, async (request) => {
  const { data, auth } = request;

  try {
    // ========== 1. 验证用户认证 ==========
    if (!auth) {
      throw new HttpsError('unauthenticated', '用户未认证');
    }

    // ========== 2. 提取参数 ==========
    const { cardId, organizationId, eventId } = data;

    console.log('[queryPointCardBalance] 收到查询请求:', {
      cardId,
      organizationId,
      eventId,
      callerUid: auth.uid
    });

    // ========== 3. 验证必填参数 ==========
    if (!cardId) {
      throw new HttpsError('invalid-argument', '缺少点数卡ID');
    }

    if (!organizationId || !eventId) {
      throw new HttpsError('invalid-argument', '缺少组织或活动ID');
    }

    const db = admin.firestore();

    // ========== 4. 查询点数卡文档 ==========
    const cardRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('pointCards').doc(cardId);

    const cardDoc = await cardRef.get();

    if (!cardDoc.exists) {
      throw new HttpsError('not-found', '找不到该点数卡，请确认QR Code是否正确');
    }

    const cardData = cardDoc.data();

    console.log('[queryPointCardBalance] 点数卡数据:', {
      cardNumber: cardData.cardNumber,
      balance: cardData.balance,
      status: cardData.status
    });

    // ========== 5. 返回点数卡信息 ==========
    return {
      success: true,
      cardId: cardId,
      cardNumber: cardData.cardNumber,
      balance: {
        initial: cardData.balance?.initial || 0,
        current: cardData.balance?.current || 0,
        spent: cardData.balance?.spent || 0,
        reserved: cardData.balance?.reserved || 0
      },
      status: {
        isActive: cardData.status?.isActive || false,
        isExpired: cardData.status?.isExpired || false,
        isDestroyed: cardData.status?.isDestroyed || false,
        isEmpty: cardData.status?.isEmpty || false,
        expiresAt: cardData.status?.expiresAt || null,
        lastUsedAt: cardData.status?.lastUsedAt || null
      },
      issuer: {
        pointSellerName: cardData.issuer?.pointSellerName || '未知',
        issuedAt: cardData.issuer?.issuedAt || null
      }
    };

  } catch (error) {
    console.error('[queryPointCardBalance] 错误:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || '查询点数卡失败，请重试');
  }
});
