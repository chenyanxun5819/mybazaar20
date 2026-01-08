const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const cors = require('cors')({ origin: true });

/**
 * 获取 Customer Dashboard 数据 (HTTP版)
 * 
 * @description
 * 替代客户端直接读取 Firestore，解决 "Customer文档不存在" 或连接问题。
 * 
 * @route POST /api/getCustomerDashboardDataHttp
 */
exports.getCustomerDashboardDataHttp = onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      // 1. 验证 Auth Token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: { message: '未授权' } });
      }
      const idToken = authHeader.split('Bearer ')[1];
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const { uid, organizationId, eventId, userId } = decodedToken;

      if (!organizationId || !eventId) {
        return res.status(400).json({ error: { message: 'Token 缺少组织或活动信息' } });
      }

      // 2. 确定目标 User ID
      // 优先使用 claims 中的 userId (通常是文档 ID)，回退到 uid
      const targetUserId = userId || uid;

      console.log('[getCustomerDashboardDataHttp] Fetching data for:', {
        organizationId,
        eventId,
        targetUserId,
        authUid: uid
      });

      const db = admin.firestore();
      const userRef = db.collection('organizations').doc(organizationId)
        .collection('events').doc(eventId)
        .collection('users').doc(targetUserId);

      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        console.warn('[getCustomerDashboardDataHttp] User doc not found at path:', userRef.path);
        
        // 尝试通过 authUid 查找 (如果 targetUserId 不对)
        if (targetUserId !== uid) {
             console.log('[getCustomerDashboardDataHttp] Trying fallback with authUid:', uid);
             const fallbackRef = db.collection('organizations').doc(organizationId)
                .collection('events').doc(eventId)
                .collection('users').doc(uid);
             const fallbackSnap = await fallbackRef.get();
             if (fallbackSnap.exists) {
                 console.log('[getCustomerDashboardDataHttp] Found with authUid!');
                 return res.status(200).json({
                    success: true,
                    data: { ...fallbackSnap.data(), id: fallbackSnap.id }
                 });
             }
        }

        return res.status(404).json({ 
            error: { 
                message: '找不到用户数据',
                details: 'Customer文档不存在',
                path: userRef.path
            } 
        });
      }

      const userData = userSnap.data();
      
      // 返回数据
      return res.status(200).json({
        success: true,
        data: { ...userData, id: userSnap.id }
      });

    } catch (error) {
      console.error('[getCustomerDashboardDataHttp] Error:', error);
      return res.status(500).json({
        error: { message: error.message || '服务器内部错误' }
      });
    }
  });
});
