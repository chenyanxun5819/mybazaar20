const functions = require('firebase-functions');
const admin = require('firebase-admin');

/**
 * 通用登录端点 - 支持所有角色
 * 
 * @description
 * 1. 验证 orgCode + eventCode + phoneNumber + password
 * 2. 查找用户并验证密码
 * 3. 返回用户的所有角色信息
 * 4. 生成 Custom Token 用于 Firebase Auth
 * 
 * @route POST /api/loginUniversalHttp
 * 
 * @param {Object} req.body
 * @param {string} req.body.orgCode - 组织代码 (小写)
 * @param {string} req.body.eventCode - 活动代码
 * @param {string} req.body.phoneNumber - 手机号
 * @param {string} req.body.password - 密码
 * 
 * @returns {Object} 登录结果
 * @returns {boolean} success - 是否成功
 * @returns {string} customToken - Firebase Custom Token
 * @returns {string} userId - 用户 ID
 * @returns {string} organizationId - 组织 ID
 * @returns {string} eventId - 活动 ID
 * @returns {string} englishName - 英文名
 * @returns {string} chineseName - 中文名
 * @returns {Array<string>} roles - 用户角色列表
 */
exports.loginUniversalHttp = functions.https.onRequest(async (req, res) => {
  // 🔐 CORS 设置
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: '仅支持 POST 请求' } });
  }

  const startTime = Date.now();
  const { orgCode, eventCode, phoneNumber, password } = req.body;

  try {
    console.log('[loginUniversalHttp] 开始登录', { 
      orgCode, 
      eventCode, 
      phoneNumber 
    });

    // ✅ 参数验证
    if (!orgCode || !eventCode || !phoneNumber || !password) {
      console.warn('[loginUniversalHttp] 缺少必填参数');
      return res.status(400).json({
        error: { message: '请提供所有必填字段：组织代码、活动代码、手机号、密码' }
      });
    }

    const db = admin.firestore();
    const orgCodeLower = orgCode.toLowerCase();

    // 📋 Step 1: 查找组织
    console.log('[loginUniversalHttp] Step 1: 查找组织', { orgCode: orgCodeLower });
    
    const orgSnapshot = await db.collection('organizations')
      .where('orgCode', '==', orgCodeLower)
      .limit(1)
      .get();

    if (orgSnapshot.empty) {
      console.warn('[loginUniversalHttp] 组织不存在', { orgCode: orgCodeLower });
      return res.status(404).json({
        error: { message: `找不到组织代码: ${orgCode}` }
      });
    }

    const orgDoc = orgSnapshot.docs[0];
    const organizationId = orgDoc.id;
    const orgData = orgDoc.data();
    
    console.log('[loginUniversalHttp] 组织找到', { 
      organizationId, 
      orgName: orgData.orgName?.['zh-CN'] 
    });

    // 📋 Step 2: 查找活动
    console.log('[loginUniversalHttp] Step 2: 查找活动', { eventCode });
    
    const eventSnapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('events')
      .where('eventCode', '==', eventCode)
      .limit(1)
      .get();

    if (eventSnapshot.empty) {
      console.warn('[loginUniversalHttp] 活动不存在', { eventCode });
      return res.status(404).json({
        error: { message: `找不到活动代码: ${eventCode}` }
      });
    }

    const eventDoc = eventSnapshot.docs[0];
    const eventId = eventDoc.id;
    const eventData = eventDoc.data();
    
    console.log('[loginUniversalHttp] 活动找到', { 
      eventId, 
      eventName: eventData.eventName?.['zh-CN'] 
    });

    // 📋 Step 3: 查找用户（通过手机号）
    console.log('[loginUniversalHttp] Step 3: 查找用户', { phoneNumber });
    
    // 构建 authUid (格式: phone_手机号)
    const authUid = `phone_${phoneNumber}`;
    
    const usersSnapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('users')
      .where('authUid', '==', authUid)
      .limit(1)
      .get();

    if (usersSnapshot.empty) {
      console.warn('[loginUniversalHttp] 用户不存在', { phoneNumber, authUid });
      return res.status(401).json({
        error: { message: '手机号或密码错误' }
      });
    }

    const userDoc = usersSnapshot.docs[0];
    const userId = userDoc.id;
    const userData = userDoc.data();
    
    console.log('[loginUniversalHttp] 用户找到', { 
      userId, 
      englishName: userData.basicInfo?.englishName,
      roles: userData.roles 
    });

    // 🔐 Step 4: 验证密码
    console.log('[loginUniversalHttp] Step 4: 验证密码');
    
    const storedPassword = userData.accountStatus?.password;
    if (!storedPassword || storedPassword !== password) {
      console.warn('[loginUniversalHttp] 密码错误');
      return res.status(401).json({
        error: { message: '手机号或密码错误' }
      });
    }

    // ✅ Step 5: 检查用户角色
    console.log('[loginUniversalHttp] Step 5: 检查角色');
    
    const roles = userData.roles || [];
    if (roles.length === 0) {
      console.warn('[loginUniversalHttp] 用户没有角色', { userId });
      return res.status(403).json({
        error: { message: '您的账户尚未分配角色，请联系管理员' }
      });
    }

    // 🎫 Step 6: 生成 Custom Token
    console.log('[loginUniversalHttp] Step 6: 生成 Custom Token');
    
    const customToken = await admin.auth().createCustomToken(authUid, {
      organizationId,
      eventId,
      userId,
      roles
    });

    // 📝 Step 7: 更新最后登录时间
    await userDoc.ref.update({
      'accountStatus.lastLogin': admin.firestore.FieldValue.serverTimestamp()
    });

    const elapsedMs = Date.now() - startTime;
    console.log('[loginUniversalHttp] ✅ 登录成功', { 
      userId, 
      roles,
      elapsedMs 
    });

    // 🎉 返回成功结果
    return res.status(200).json({
      success: true,
      customToken,
      userId,
      organizationId,
      eventId,
      englishName: userData.basicInfo?.englishName || '',
      chineseName: userData.basicInfo?.chineseName || '',
      roles: roles, // 返回所有角色
      roleSpecificData: userData.roleSpecificData || {} // 返回角色特定数据（可选）
    });

  } catch (error) {
    console.error('[loginUniversalHttp] ❌ 登录失败', error);
    return res.status(500).json({
      error: {
        message: '服务器错误，请稍后重试',
        details: error.message
      }
    });
  }
});
