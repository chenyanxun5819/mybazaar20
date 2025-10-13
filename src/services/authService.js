// src/services/authService.js
import { auth, db, functions } from '../config/firebase';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { query, where, collection, getDocs } from 'firebase/firestore';

/**
 * 🔥 修復：標準化手機號碼格式
 */
function normalizePhone(phoneNumber) {
  if (!phoneNumber) return null;
  
  // 移除所有空格和特殊字符
  let cleaned = phoneNumber.trim().replace(/[\s\-\(\)]/g, '');
  
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
 * 🔥 修復：使用 PIN 碼登入
 */
async function loginWithPin(phoneNumber, password, organizationId, eventId) {
  try {
    console.log('[authService] Login attempt:', { 
      phoneNumber, 
      organizationId, 
      eventId 
    });
    
    // 驗證參數
    if (!phoneNumber || !password || !organizationId || !eventId) {
      throw new Error('請提供完整的登入信息');
    }
    
    // 標準化手機號碼
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手機號格式不正確，請輸入 01 開頭的 10-11 位數字');
    }
    
    console.log('[authService] Normalized phone:', normalized);
    
    // 驗證密碼
    if (!validatePassword(password)) {
      throw new Error('密碼至少需要 8 個字符，且必須包含英文字母和數字');
    }
    
    // 🔥 調用 Cloud Function - 使用 httpsCallable (v2 onCall 自動處理 CORS)
    console.log('[authService] Calling Cloud Function...');
    
    const loginWithPinFn = httpsCallable(functions, 'loginWithPin');
    const result = await loginWithPinFn({
      phoneNumber: normalized,
      pin: password,
      organizationId,
      eventId
    });
    
    console.log('[authService] Cloud Function response received');
    const data = result.data;
    console.log('[authService] Response data:', {
      hasCustomToken: !!data?.customToken,
      hasUserProfile: !!data?.userProfile
    });
    
    if (!data?.customToken) {
      console.error('[authService] No custom token in response');
      throw new Error(data?.message || '登入失敗：未收到認證令牌');
    }
    
    // 🔥 使用自定義令牌登入 Firebase Auth
    console.log('[authService] Signing in with custom token...');
    try {
      await signInWithCustomToken(auth, data.customToken);
      console.log('[authService] Firebase Auth sign-in successful');
    } catch (authError) {
      console.error('[authService] Firebase Auth error:', authError);
      throw new Error('認證失敗，請重試');
    }
    
    return {
      success: true,
      user: data,
      userProfile: data.userProfile,
      message: '登入成功'
    };
    
  } catch (error) {
    console.error('[authService] Login error:', {
      name: error.name,
      code: error.code,
      message: error.message,
      stack: error.stack
    });
    
    // 🔥 統一錯誤處理
    let errorMessage = '登入失敗';
    
    if (error.code === 'not-found') {
      errorMessage = '查無此手機號碼，請確認後重試';
    } else if (error.code === 'permission-denied') {
      errorMessage = '密碼錯誤，請重新輸入';
    } else if (error.code === 'invalid-argument') {
      errorMessage = error.message || '輸入資料格式不正確';
    } else if (error.code === 'internal') {
      errorMessage = '服務器內部錯誤，請稍後重試';
    } else if (error.code === 'unavailable' || error.code === 'deadline-exceeded') {
      errorMessage = '網絡連接失敗，請檢查網絡後重試';
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