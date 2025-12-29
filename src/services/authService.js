// src/services/authService.js
import { auth, db, functions } from '../config/firebase';
import { safeFetch } from './safeFetch';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { query, where, collection, getDocs } from 'firebase/firestore';

/**
 * 🔥 修復：標準化手機號碼格式
 */
function normalizePhone(phoneNumber) {
  if (!phoneNumber) return null;
  
  // 移除所有空格和特殊字符
  let cleaned = phoneNumber.trim().replace(/[\s\-()]/g, '');
  
  // 如果以 +60 或 60 開頭，移除它
  if (cleaned.startsWith('+60')) {
    cleaned = cleaned.substring(3);
  } else if (cleaned.startsWith('60')) {
    cleaned = cleaned.substring(2);
  }
  
  // 如果以 0 開頭，移除它
  if (cleaned.startsWith('0')) {
    cleaned = cleaned.substring(1);
  }
  
  // 驗證格式：應該是 1 開頭，後接 8-9 位數字（馬來西亞手機號）
  if (!/^1\d{8,9}$/.test(cleaned)) {
    return null;
  }
  
  // 返回標準格式：0 + 數字（例如：0123456789）
  return '0' + cleaned;
}

/**
 * 驗證密碼強度
 */
function validatePassword(password) {
  if (!password || password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  return hasLetter && hasNumber;
}

/**
 * 🔥 修复：使用 PIN 码登入
 */
async function loginWithPin(phoneNumber, password, organizationId, eventId) {
  try {
    console.log('[authService] Login attempt:', { 
      phoneNumber, 
      organizationId, 
      eventId 
    });
    
    // 验证参数
    if (!phoneNumber || !password || !organizationId || !eventId) {
      throw new Error('请提供完整的登入信息');
    }
    
    // 标准化手机号码
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手机号格式不正确，请输入 01 开头的 10-11 位数字');
    }
    
    console.log('[authService] Normalized phone:', normalized);
    
    // 验证密码
    if (!validatePassword(password)) {
      throw new Error('密码至少需要 8 个字符，且必须包含英文字母和数字');
    }
    
    // 🔥 调用 Cloud Function - 使用 fetch 直接请求
    console.log('[authService] Calling Cloud Function...');
    
    const functionUrl = 'https://us-central1-mybazaar-c4881.cloudfunctions.net/loginWithPin';
    
    const response = await safeFetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: normalized,
        pin: password,
        organizationId,
        eventId
      })
    });
    
    console.log('[authService] Response status:', response.status);
    
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        const errorText = await response.text();
        console.error('[authService] Error response text:', errorText);
        throw new Error(`服务器错误 (${response.status}): ${errorText}`);
      }
      
      console.error('[authService] Error response:', errorData);
      throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
    }
    
    const result = await response.json();
    
    console.log('[authService] Cloud Function response received');
    console.log('[authService] Response data:', {
      hasCustomToken: !!result?.customToken,
      hasUserProfile: !!result?.userProfile,
      success: result?.success
    });
    
    if (!result?.customToken) {
      console.error('[authService] No custom token in response:', result);
      throw new Error(result?.error?.message || '登入失败：未收到认证令牌');
    }
    
    // 🔥 使用自定义令牌登入 Firebase Auth
    console.log('[authService] Signing in with custom token...');
    try {
      const userCredential = await signInWithCustomToken(auth, result.customToken);
      console.log('[authService] Firebase Auth sign-in successful:', userCredential.user.uid);
    } catch (authError) {
      console.error('[authService] Firebase Auth error:', {
        code: authError.code,
        message: authError.message,
        stack: authError.stack
      });
      
      // 提供更详细的错误信息
      if (authError.code === 'auth/invalid-custom-token') {
        throw new Error('认证令牌无效，请重试');
      } else if (authError.code === 'auth/custom-token-mismatch') {
        throw new Error('认证配置错误，请联系管理员');
      } else {
        throw new Error(`认证失败: ${authError.message}`);
      }
    }
    
    return {
      success: true,
      user: result,
      userProfile: result.userProfile,
      message: '登入成功'
    };
    
  } catch (error) {
    console.error('[authService] Login error:', {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    
    // 🔥 统一错误处理
    let errorMessage = '登入失败';
    
    if (error.code === 'not-found') {
      errorMessage = '查无此手机号码，请确认后重试';
    } else if (error.code === 'permission-denied') {
      errorMessage = '密码错误，请重新输入';
    } else if (error.code === 'invalid-argument') {
      errorMessage = error.message || '输入资料格式不正确';
    } else if (error.code === 'internal') {
      errorMessage = '服务器内部错误，请稍后重试';
    } else if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
      errorMessage = '网络连接失败，请检查网络后重试';
    } else if (error.message.includes('Failed to fetch')) {
      errorMessage = '无法连接到服务器，请检查网络连接';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    throw new Error(errorMessage);
  }
}

/**
 * 登出
 */
async function logout() {
  try {
    await signOut(auth);
    console.log('[authService] Logout successful');
  } catch (error) {
    console.error('[authService] Logout error:', error);
    throw error;
  }
}

/**
 * 🔥 修復：根據 authUid 獲取用戶資料
 */
async function getUserProfile(authUid, orgId, eventId) {
  if (!authUid || !orgId || !eventId) {
    throw new Error('getUserProfile requires authUid, orgId, and eventId');
  }

  try {
    const userCollectionPath = `organizations/${orgId}/events/${eventId}/users`;
    console.log('[authService] Querying user from:', userCollectionPath);
    
    const q = query(
      collection(db, userCollectionPath),
      where('authUid', '==', authUid)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      // 🔥 嘗試查詢其他可能的 authUid 字段
      const alternativeFields = ['accountStatus.authUid', 'authId', 'authMid'];
      
      for (const field of alternativeFields) {
        const altQ = query(
          collection(db, userCollectionPath),
          where(field, '==', authUid)
        );
        
        const altSnapshot = await getDocs(altQ);
        if (!altSnapshot.empty) {
          console.log(`[authService] Found user with ${field}`);
          const userDoc = altSnapshot.docs[0];
          return {
            id: userDoc.id,
            orgId,
            eventId,
            ...userDoc.data()
          };
        }
      }
      
      console.warn('[authService] No user profile found for authUid:', authUid);
      return null;
    }
    
    const userDoc = querySnapshot.docs[0];
    return {
      id: userDoc.id,
      orgId,
      eventId,
      ...userDoc.data()
    };
  } catch (error) {
    console.error('[authService] Error getting user profile:', error);
    throw error;
  }
}

/**
 * 修改密碼
 */
async function changePassword(phoneNumber, currentPassword, newPassword) {
  try {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手機號格式不正確');
    }

    if (!validatePassword(newPassword)) {
      throw new Error('新密碼至少需要 8 個字符，且必須包含英文字母和數字');
    }

    const changePasswordFn = httpsCallable(functions, 'changePassword');
    const result = await changePasswordFn({
      phoneNumber: normalized,
      currentPassword,
      newPassword
    });

    return result.data;
  } catch (error) {
    console.error('[authService] Change password error:', error);
    throw new Error(error.message || '修改密碼失敗');
  }
}

/**
 * 發送 OTP
 */
async function sendOtp(phoneNumber, pinCode) {
  try {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手機號格式不正確');
    }

    const sendOtpFn = httpsCallable(functions, 'sendOtpToPhone');
    const result = await sendOtpFn({
      phoneNumber: normalized,
      pinCode
    });

    return result.data;
  } catch (error) {
    console.error('[authService] Send OTP error:', error);
    throw new Error(error.message || '發送 OTP 失敗');
  }
}

// 導出所有函數
export const authService = {
  loginWithPin,
  logout,
  getUserProfile,
  changePassword,
  sendOtp,
  normalizePhone,
  validatePassword
};