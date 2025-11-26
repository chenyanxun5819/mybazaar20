// auth-helpers.js
// 可复用的权限验证辅助函数

const admin = require('firebase-admin');

/**
 * 验证用户是否是指定活动的 Event Manager
 * @param {string} idToken - Firebase ID Token
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @returns {Promise<{success: boolean, uid?: string, error?: string}>}
 */
async function verifyEventManagerAuth(idToken, organizationId, eventId) {
  try {
    // 1️⃣ 验证 ID Token
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch (error) {
      console.error('[Auth] Token 验证失败:', error);
      return { success: false, error: 'Token 验证失败' };
    }

    const uid = decodedToken.uid;
    console.log('[Auth] 用户 UID:', uid);

    // 2️⃣ 获取活动文档
    const eventRef = admin.firestore()
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId);
    
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
      return { success: false, error: '活动不存在' };
    }

    // 3️⃣ 检查用户是否在 admins 列表中
    const eventData = eventDoc.data();
    const admins = eventData.admins || [];
    
    const isEventManager = admins.some(admin => {
      // admins 数组中存储的是 phone（如 "60123456789"）
      // 而 UID 是 "phone_60123456789"
      return admin.phone && `phone_${admin.phone}` === uid;
    });

    if (!isEventManager) {
      console.log('[Auth] ❌ 权限不足，用户不是 Event Manager');
      return { success: false, error: '需要 Event Manager 权限' };
    }

    console.log('[Auth] ✅ Event Manager 权限验证通过');
    return { success: true, uid };

  } catch (error) {
    console.error('[Auth] 验证过程出错:', error);
    return { success: false, error: '验证过程出错: ' + error.message };
  }
}

/**
 * 从 HTTP 请求中提取并验证 Event Manager 权限
 * @param {object} request - HTTP 请求对象
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @returns {Promise<{success: boolean, uid?: string, error?: string}>}
 */
async function verifyEventManagerFromRequest(request, organizationId, eventId) {
  // 从 Authorization header 获取 token
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: '缺少 Authorization header' };
  }

  const idToken = authHeader.split('Bearer ')[1];
  return await verifyEventManagerAuth(idToken, organizationId, eventId);
}

/**
 * 验证用户是否是指定活动的 Seller Manager
 * @param {string} uid - 用户 UID
 * @param {string} organizationId - 组织 ID
 * @param {string} eventId - 活动 ID
 * @returns {Promise<{success: boolean, managedDepartments?: string[], error?: string}>}
 */
async function verifySellerManagerAuth(uid, organizationId, eventId) {
  try {
    // 获取活动文档
    const eventRef = admin.firestore()
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId);
    
    const eventDoc = await eventRef.get();
    if (!eventDoc.exists) {
      return { success: false, error: '活动不存在' };
    }

    // 检查用户是否在 sellerManagers 列表中
    const eventData = eventDoc.data();
    const sellerManagers = eventData.sellerManagers || [];
    
    const manager = sellerManagers.find(sm => sm.userId === uid);
    
    if (!manager) {
      console.log('[Auth] ❌ 权限不足，用户不是 Seller Manager');
      return { success: false, error: '需要 Seller Manager 权限' };
    }

    console.log('[Auth] ✅ Seller Manager 权限验证通过');
    console.log('[Auth] 管理部门:', manager.managedDepartments);
    
    return { 
      success: true, 
      managedDepartments: manager.managedDepartments || [] 
    };

  } catch (error) {
    console.error('[Auth] 验证过程出错:', error);
    return { success: false, error: '验证过程出错: ' + error.message };
  }
}

/**
 * 验证用户是否是 Platform Admin
 * @param {string} uid - 用户 UID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function verifyPlatformAdminAuth(uid) {
  try {
    // 检查用户是否在 platformAdmins 集合中
    const adminRef = admin.firestore().collection('platformAdmins').doc(uid);
    const adminDoc = await adminRef.get();
    
    if (!adminDoc.exists) {
      console.log('[Auth] ❌ 权限不足，用户不是 Platform Admin');
      return { success: false, error: '需要 Platform Admin 权限' };
    }

    console.log('[Auth] ✅ Platform Admin 权限验证通过');
    return { success: true };

  } catch (error) {
    console.error('[Auth] 验证过程出错:', error);
    return { success: false, error: '验证过程出错: ' + error.message };
  }
}

module.exports = {
  verifyEventManagerAuth,
  verifyEventManagerFromRequest,
  verifySellerManagerAuth,
  verifyPlatformAdminAuth
};