/**
 * verifyTransactionPin.js
 * 统一的交易密码验证函数
 * 
 * 适用于所有角色：customer, merchantOwner, merchantAsist, pointSeller, seller
 * 
 * ⭐ 重要：使用 basicInfo.transactionPinHash（不是security）
 * 
 * 创建日期：2025-01-20
 */

const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

/**
 * 验证用户的交易密码
 */
async function verifyTransactionPin(userId, inputPin, organizationId, eventId) {
  const db = admin.firestore();
  
  const userRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users').doc(userId);

  const userDoc = await userRef.get();
  
  if (!userDoc.exists) {
    throw new HttpsError('not-found', '用户不存在');
  }

  const userData = userDoc.data();
  
  // ⭐ 使用正确的字段路径：basicInfo
  const storedHash = userData.basicInfo?.transactionPinHash;
  const hashMethod = userData.basicInfo?.transactionPinHashMethod || 'bcrypt';

  if (!storedHash) {
    throw new HttpsError('failed-precondition', '未设置交易密码');
  }

  // 先检查账户锁定
  if (userData.basicInfo?.pinLockedUntil) {
    const lockedUntil = userData.basicInfo.pinLockedUntil.toDate();
    if (new Date() < lockedUntil) {
      const minutesLeft = Math.ceil((lockedUntil - new Date()) / 1000 / 60);
      throw new HttpsError('permission-denied', `账户已锁定，请${minutesLeft}分钟后再试`);
    }
  }

  // 验证密码
  let isValid = false;

  if (hashMethod === 'bcrypt') {
    isValid = await bcrypt.compare(inputPin, storedHash);
  } else if (hashMethod === 'sha256') {
    const inputHash = crypto.createHash('sha256').update(inputPin).digest('hex');
    isValid = (inputHash === storedHash);
  } else {
    throw new HttpsError('internal', '不支持的密码加密方式');
  }

  // 密码错误：记录失败次数
  if (!isValid) {
    const now = new Date();
    const failedAttempts = (userData.basicInfo?.pinFailedAttempts || 0) + 1;
    const lockUntil = failedAttempts >= 5 
      ? new Date(now.getTime() + 60 * 60 * 1000)
      : null;

    await userRef.update({
      'basicInfo.pinFailedAttempts': failedAttempts,
      'basicInfo.lastPinFailedAt': admin.firestore.FieldValue.serverTimestamp(),
      ...(lockUntil ? { 'basicInfo.pinLockedUntil': lockUntil } : {})
    });

    if (failedAttempts >= 5) {
      throw new HttpsError('permission-denied', '密码错误次数过多，账户已锁定1小时');
    }

    throw new HttpsError('permission-denied', `交易密码错误（剩余尝试次数：${5 - failedAttempts}）`);
  }

  // 密码正确：重置失败次数
  await userRef.update({
    'basicInfo.pinFailedAttempts': 0,
    'basicInfo.pinLockedUntil': admin.firestore.FieldValue.delete(),
    'basicInfo.lastPinVerifiedAt': admin.firestore.FieldValue.serverTimestamp()
  });

  return true;
}

module.exports = { verifyTransactionPin };
