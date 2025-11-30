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
 * Event Manager 專用登錄端點
 * 
 * @description
 * 1. 驗證 orgCode + eventCode
 * 2. 查找 Event.eventManager 物件
 * 3. 驗證手機號和密碼
 * 4. 生成 Custom Token
 * 
 * @route POST /api/eventManagerLoginHttp
 * 
 * @param {Object} req.body
 * @param {string} req.body.orgCode - 組織代碼 (小寫)
 * @param {string} req.body.eventCode - 活動代碼
 * @param {string} req.body.phoneNumber - 手機號
 * @param {string} req.body.password - 密碼
 * 
 * @returns {Object} 登錄結果
 * @returns {boolean} success - 是否成功
 * @returns {string} customToken - Firebase Custom Token
 * @returns {string} organizationId - 組織 ID
 * @returns {string} eventId - 活動 ID
 */
exports.eventManagerLoginHttp = functions.https.onRequest(async (req, res) => {
  // 🔐 CORS 設置
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  // 確保所有成功/錯誤回應皆為 JSON
  res.set('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(204).send('');
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: { message: '僅支持 POST 請求' } });
  }

  const startTime = Date.now();
  const { orgCode, eventCode, phoneNumber, password } = req.body;

  try {
    console.log('[eventManagerLoginHttp] 開始 Event Manager 登錄', { 
      orgCode, 
      eventCode, 
      phoneNumber 
    });

    // ✅ 參數驗證
    if (!orgCode || !eventCode || !phoneNumber || !password) {
      console.warn('[eventManagerLoginHttp] 缺少必填參數');
      return res.status(400).json({
        error: { message: '請提供所有必填字段：組織代碼、活動代碼、手機號、密碼' }
      });
    }

    const db = admin.firestore();
    const orgCodeLower = orgCode.toLowerCase();

    // 📋 Step 1: 查找組織
    console.log('[eventManagerLoginHttp] Step 1: 查找組織', { orgCode: orgCodeLower });
    
    const orgSnapshot = await db.collection('organizations')
      .where('orgCode', '==', orgCodeLower)
      .limit(1)
      .get();

    if (orgSnapshot.empty) {
      console.warn('[eventManagerLoginHttp] 組織不存在', { orgCode: orgCodeLower });
      return res.status(404).json({
        error: { message: `找不到組織代碼: ${orgCode}` }
      });
    }

    const orgDoc = orgSnapshot.docs[0];
    const organizationId = orgDoc.id;
    const orgData = orgDoc.data();
    
    console.log('[eventManagerLoginHttp] 組織找到', { 
      organizationId, 
      orgName: orgData.orgName?.['zh-CN'] 
    });

    // 📋 Step 2: 查找活動
    console.log('[eventManagerLoginHttp] Step 2: 查找活動', { eventCode });
    
    const eventSnapshot = await db
      .collection('organizations').doc(organizationId)
      .collection('events')
      .where('eventCode', '==', eventCode)
      .limit(1)
      .get();

    if (eventSnapshot.empty) {
      console.warn('[eventManagerLoginHttp] 活動不存在', { eventCode });
      return res.status(404).json({
        error: { message: `找不到活動代碼: ${eventCode}` }
      });
    }

    const eventDoc = eventSnapshot.docs[0];
    const eventId = eventDoc.id;
    const eventData = eventDoc.data();
    
    console.log('[eventManagerLoginHttp] 活動找到', { 
      eventId, 
      eventName: eventData.eventName?.['zh-CN'] 
    });

    // 📋 Step 3: 驗證 Event Manager
    console.log('[eventManagerLoginHttp] Step 3: 驗證 Event Manager');

    const eventManager = eventData.eventManager;
    if (!eventManager) {
      console.warn('[eventManagerLoginHttp] 活動沒有指派 Event Manager');
      return res.status(403).json({
        error: { message: '此活動尚未指派活動主任' }
      });
    }

    // 驗證手機號 (多種格式)
    const norm = normalizePhoneNumber(phoneNumber);
    const normEventManagerPhone = normalizePhoneNumber(eventManager.phoneNumber);
    
    const variants = [
      norm,
      `0${norm}`,
      `60${norm}`,
      `+60${norm}`,
      String(phoneNumber)
    ];

    const phoneMatch = variants.some(v => normalizePhoneNumber(v) === normEventManagerPhone);
    
    if (!phoneMatch) {
      console.warn('[eventManagerLoginHttp] 手機號不匹配', { 
        provided: phoneNumber,
        stored: eventManager.phoneNumber 
      });
      return res.status(401).json({
        error: { message: '手機號或密碼不正確' }
      });
    }

    console.log('[eventManagerLoginHttp] 手機號驗證成功');

    // 驗證密碼
    const providedPasswordHash = sha256(password + eventManager.passwordSalt);
    if (providedPasswordHash !== eventManager.password) {
      console.warn('[eventManagerLoginHttp] 密碼不正確');
      return res.status(401).json({
        error: { message: '手機號或密碼不正確' }
      });
    }

    console.log('[eventManagerLoginHttp] 密碼驗證成功');

    // 📋 Step 4: 確保 Auth 用戶存在
    console.log('[eventManagerLoginHttp] Step 4: 確保 Auth 用戶存在');

    const authUid = eventManager.authUid || `eventManager_${phoneNumber}`;
    
    try {
      await admin.auth().getUser(authUid);
      console.log('[eventManagerLoginHttp] Auth 用戶已存在:', authUid);
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.log('[eventManagerLoginHttp] Auth 用戶不存在，正在建立:', authUid);
        await admin.auth().createUser({
          uid: authUid,
          displayName: eventManager.displayName || eventManager.englishName || '活動主任',
          disabled: false
        });
        console.log('[eventManagerLoginHttp] Auth 用戶建立成功:', authUid);
      } else {
        throw err;
      }
    }

    // 📋 Step 5: 生成 Custom Token
    console.log('[eventManagerLoginHttp] Step 5: 生成 Custom Token');

    const customToken = await admin.auth().createCustomToken(authUid, {
      role: 'eventManager',
      organizationId,
      eventId,
      eventCode,
      orgCode: orgCodeLower
    });

    console.log('[eventManagerLoginHttp] 登錄成功', { 
      authUid,
      organizationId, 
      eventId,
      耗時: Date.now() - startTime 
    });

    return res.status(200).json({
      success: true,
      customToken,
      organizationId,
      eventId,
      eventCode,
      orgCode: orgCodeLower
    });

  } catch (error) {
    console.error('[eventManagerLoginHttp] 錯誤:', error);
    return res.status(500).json({
      error: { 
        message: error?.message || '登錄失敗，請重試',
        code: 'LOGIN_ERROR'
      }
    });
  }
});
