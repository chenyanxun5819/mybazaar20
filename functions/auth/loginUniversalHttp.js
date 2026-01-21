const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return '';
  let cleaned = String(phoneNumber).replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+60')) cleaned = cleaned.slice(3);
  else if (cleaned.startsWith('60')) cleaned = cleaned.slice(2);
  if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
  return cleaned;
}

/**
 * 通用登录端点 - 支持所有角色（包括 Event Manager）
 * 
 * @description
 * 1. 验证 orgCode + eventCode + phoneNumber + password
 * 2. 查找用户并验证密码
 * 3. 返回用户的所有角色信息（包括 eventManager）
 * 4. 生成 Custom Token 用于 Firebase Auth（包含 Custom Claims）
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
 * @returns {Array<string>} roles - 用户角色列表（包括 eventManager）
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

    // 📋 Step 2: 查找活动 (支持多个同名活动)
    console.log('[loginUniversalHttp] Step 2: 查找活动', { eventCode });

    const eventSnapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('events')
      .where('eventCode', '==', eventCode)
      .get();

    if (eventSnapshot.empty) {
      console.warn('[loginUniversalHttp] 活动不存在', { eventCode });
      return res.status(404).json({
        error: { message: `找不到活动代码: ${eventCode}` }
      });
    }

    // 遍历所有匹配的活动，查找用户
    let foundEventId = null;
    let foundEventData = null;
    let foundUserDoc = null;
    let foundEventManagerData = null;
    let isEventManagerLogin = false;

    const norm = normalizePhoneNumber(phoneNumber);
    const variants = [
      norm,
      `0${norm}`,
      `60${norm}`,
      `+60${norm}`,
      String(phoneNumber)
    ];

    for (const eventDoc of eventSnapshot.docs) {
      const currentEventId = eventDoc.id;
      const currentEventData = eventDoc.data();

      // 📋 Step 3A: 检查是否为 Event Manager 登录
      if (currentEventData && currentEventData.eventManager && currentEventData.eventManager.phoneNumber) {
        const emPhone = String(currentEventData.eventManager.phoneNumber);
        const emNorm = normalizePhoneNumber(emPhone);
        const emVariants = [emNorm, `0${emNorm}`, `60${emNorm}`, `+60${emNorm}`, emPhone];
        const phoneMatched = variants.some(v => emVariants.includes(String(v)));
        
        if (phoneMatched) {
          // 验证 Event Manager 密码
          const emSalt = currentEventData.eventManager.passwordSalt;
          const emHash = currentEventData.eventManager.password;
          if (emSalt && emHash) {
            const computed = sha256(String(password) + String(emSalt));
            if (computed === emHash) {
              isEventManagerLogin = true;
              foundEventManagerData = currentEventData.eventManager;
              foundEventId = currentEventId;
              foundEventData = currentEventData;
              console.log('[loginUniversalHttp] Event Manager 手机匹配且密码正确, EventId:', currentEventId);
              break; // 找到即停止
            }
          }
        }
      }

      // 📋 Step 3B: 普通用户登录（从 users 集合）
      for (const variant of variants) {
        const snap = await db
          .collection('organizations').doc(organizationId)
          .collection('events').doc(currentEventId)
          .collection('users')
          .where('basicInfo.phoneNumber', '==', variant)
          .limit(1)
          .get();
        
        if (!snap.empty) {
          const userDoc = snap.docs[0];
          const userData = userDoc.data();
          
          // 验证密码
          const passwordSalt = userData.basicInfo?.passwordSalt || userData.basicInfo?.pinSalt;
          const hashStored = userData.basicInfo?.passwordHash || userData.basicInfo?.pinHash;
          const plainStored = userData.accountStatus?.password;

          let passOk = false;
          if (hashStored && passwordSalt) {
            const computed = sha256(String(password) + String(passwordSalt));
            passOk = computed === hashStored;
          } else if (plainStored) {
            passOk = String(plainStored) === String(password);
          }

          if (passOk) {
            foundUserDoc = userDoc;
            foundEventId = currentEventId;
            foundEventData = currentEventData;
            console.log('[loginUniversalHttp] 普通用户找到且密码正确, EventId:', currentEventId);
            break; // 找到用户且密码正确，停止内层循环
          }
        }
      }
      
      if (foundUserDoc || isEventManagerLogin) break; // 找到用户或 Event Manager，停止外层循环
    }

    if (!foundUserDoc && !isEventManagerLogin) {
       console.warn('[loginUniversalHttp] 用户不存在或密码错误');
       return res.status(401).json({ error: { message: '手机号或密码错误' } });
    }

    const eventId = foundEventId;
    const _eventData = foundEventData; // prefixed to avoid unused-var lint

    if (isEventManagerLogin) {
      // 生成 Custom Token（使用 eventManager.authUid，确保后端权限检查通过）
      // ✅ 修正：优先使用 authUid，否则使用 phone_60... 格式，避免使用 'eventManager'
      const eventManagerData = foundEventManagerData;
      const realUserId = eventManagerData.authUid || `phone_60${norm}`;
      const authUidForToken = realUserId;

      const customClaims = {
        organizationId,
        eventId,
        userId: realUserId, // ✅ 修正：使用真实的 userId
        roles: ['eventManager'],
        managedDepartments: [],
        department: '',
        identityTag: ''
      };
      console.log('[loginUniversalHttp] Event Manager Custom Claims:', customClaims);

      const customToken = await admin.auth().createCustomToken(authUidForToken, customClaims);

      // 返回成功结果（使用 eventManagerData 信息）
      const elapsedMs = Date.now() - startTime;
      console.log('[loginUniversalHttp] ✅ 登录成功 (Event Manager)', { elapsedMs, userId: realUserId });
      // ⭐ 新增：检查 Event Manager 密码状态
      // 🔧 修复：只检查 hasDefaultPassword 和 isFirstLogin，不要检查 transactionPinHash
      // 因为 transactionPinHash 在首次设置后就不会改变
      const needsPasswordSetup =
        eventManagerData.hasDefaultPassword === true ||
        eventManagerData.isFirstLogin === true;

      console.log('[loginUniversalHttp] Event Manager 密码状态:', {
        hasDefaultPassword: eventManagerData.hasDefaultPassword,
        isFirstLogin: eventManagerData.isFirstLogin,
        hasTransactionPin: !!eventManagerData.transactionPinHash,
        needsPasswordSetup
      });

      return res.status(200).json({
        success: true,
        customToken,
        userId: realUserId, // ✅ 修正：返回真实的 userId
        organizationId,
        eventId,
        englishName: eventManagerData.englishName || eventManagerData.displayName || '',
        chineseName: eventManagerData.chineseName || '',
        roles: ['eventManager'],
        managedDepartments: [],
        department: '',
        identityTag: '',
        roleSpecificData: {},

        // ⭐ 新增：密码状态字段
        needsPasswordSetup: needsPasswordSetup,
        hasDefaultPassword: eventManagerData.hasDefaultPassword || false,
        isFirstLogin: eventManagerData.isFirstLogin || false,
        hasTransactionPin: !!eventManagerData.transactionPinHash
      });
    }

    // 📋 Step 3B: 普通用户登录（从 users 集合）
    // (Already handled in loop)
    const userDoc = foundUserDoc;
    const userId = userDoc.id;
    const userData = userDoc.data();

    console.log('[loginUniversalHttp] 用户找到', {
      userId,
      englishName: userData.basicInfo?.englishName,
      roles: userData.roles
    });

    // 🔐 Step 4: 验证密码
    // (Already verified in loop)
    console.log('[loginUniversalHttp] Step 4: 验证密码 (已在循环中验证)');

    // ✅ Step 5: 检查用户角色
    console.log('[loginUniversalHttp] Step 5: 检查角色');

    const roles = userData.roles || [];
    if (roles.length === 0) {
      console.warn('[loginUniversalHttp] 用户没有角色', { userId });
      return res.status(403).json({
        error: { message: '您的账户尚未分配角色，请联系管理员' }
      });
    }

    // 🎫 Step 6: 生成 Custom Token（包含 Custom Claims）
    console.log('[loginUniversalHttp] Step 6: 生成 Custom Token with Custom Claims');

    const authUidForToken = userData.authUid || `phone_60${norm}`;

    // ✨ 提取 managedDepartments（支持两种数据结构）
    const managedDepartments = userData.sellerManager?.managedDepartments ||
      userData.roleSpecificData?.sellerManager?.managedDepartments ||
      [];

    // ✨ 构建 Custom Claims
    const customClaims = {
      organizationId,
      eventId,
      userId,
      roles,  // 用户的所有角色（包括 eventManager）
      managedDepartments,  // Seller Manager 管理的部门
      department: userData.identityInfo?.department || '',
      identityTag: userData.identityTag || userData.identityInfo?.identityTag || ''
    };

    console.log('[loginUniversalHttp] Custom Claims:', customClaims);

    const customToken = await admin.auth().createCustomToken(authUidForToken, customClaims);

    // 📝 Step 7: 更新最后登录时间
    await userDoc.ref.update({
      'accountStatus.lastLogin': admin.firestore.FieldValue.serverTimestamp()
    });

    const elapsedMs = Date.now() - startTime;
    console.log('[loginUniversalHttp] ✅ 登录成功', {
      userId,
      roles,
      managedDepartments,
      elapsedMs
    });


    // ⭐ 新增：Step 8 - 检查密码状态
    console.log('[loginUniversalHttp] Step 8: 检查密码状态');

    // 🔧 修复：只检查 hasDefaultPassword 和 isFirstLogin，不要检查 transactionPinHash
    // 因为 transactionPinHash 在首次设置后就不会改变
    const needsPasswordSetup =
      userData.basicInfo?.hasDefaultPassword === true ||  // 仍是默认密码
      userData.basicInfo?.isFirstLogin === true;          // 首次登录

    console.log('[loginUniversalHttp] 密码状态:', {
      hasDefaultPassword: userData.basicInfo?.hasDefaultPassword,
      isFirstLogin: userData.basicInfo?.isFirstLogin,
      hasTransactionPin: !!userData.basicInfo?.transactionPinHash,
      needsPasswordSetup
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
      roles: roles, // 返回所有角色（包括 eventManager）
      managedDepartments: managedDepartments,
      department: userData.identityInfo?.department || '',
      identityTag: userData.identityTag || userData.identityInfo?.identityTag || '',
      roleSpecificData: userData.roleSpecificData || {}, // 返回角色特定数据（可选）
      needsPasswordSetup: needsPasswordSetup,
      hasDefaultPassword: userData.basicInfo?.hasDefaultPassword || false,
      isFirstLogin: userData.basicInfo?.isFirstLogin || false,
      hasTransactionPin: !!userData.basicInfo?.transactionPinHash
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