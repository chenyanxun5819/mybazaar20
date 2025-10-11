// src/services/authService.js
import { auth, db, functions } from '../config/firebase';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { query, where, collection, getDocs } from 'firebase/firestore';

/**
 * 验证手机号格式（马来西亚格式）
 * @param {string} phoneNumber - 手机号
 * @returns {string|null} - 规范化的手机号或 null
 */
function normalizePhone(phoneNumber) {
  const trimmed = phoneNumber.trim();
  // 马来西亚手机号：01开头，后接8-9位数字（总共10-11位）
  if (/^01\d{8,9}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * 验证密码强度
 * @param {string} password - 密码
 * @returns {boolean} - 是否符合要求
 */
function validatePassword(password) {
  if (password.length < 8) return false;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  return hasLetter && hasNumber;
}

/**
 * 使用 PIN 码登录
 * @param {string} phoneNumber - 手机号
 * @param {string} password - 密码
 * @returns {Promise<Object>} - 登录结果
 */
async function loginWithPin(phoneNumber, password) {
  try {
    // 验证手机号格式
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手机号格式不正确，请输入01开头的10-11位数字');
    }

    // 验证密码
    if (!validatePassword(password)) {
      throw new Error('密码至少需要8个字符，且必须包含英文字母和数字');
    }

    console.log('[authService] Calling loginWithPin function');
    
    // 调用 Cloud Function
    const loginWithPinFn = httpsCallable(functions, 'loginWithPin');
    const result = await loginWithPinFn({ 
      phoneNumber: normalized, 
      pin: password 
    });

    const data = result.data;
    const customToken = data?.customToken || data?.token || data?.custom_token;

    if (!customToken) {
      throw new Error(data?.message || '密码验证失败');
    }

    console.log('[authService] Got custom token, signing in...');
    
    // 使用 Custom Token 登录 Firebase Auth
    await signInWithCustomToken(auth, customToken);

    console.log('[authService] Login successful');
    
    return {
      success: true,
      user: data,
      message: '登录成功'
    };
  } catch (error) {
    console.error('[authService] Login error:', error);
    
    // 处理错误信息
    let errorMessage = '登录失败，请确认手机号与密码';
    
    if (error.code === 'not-found') {
      errorMessage = '查无此手机号码';
    } else if (error.code === 'permission-denied') {
      errorMessage = '密码错误';
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
 * 根据 authUid 获取用户资料（新架构）
 * @param {string} authUid - Firebase Auth UID
 * @param {string} orgId - 组织 ID（必填）
 * @param {string} eventId - 活动 ID（必填）
 * @returns {Promise<Object|null>} - 用户资料
 */
async function getUserProfile(authUid, orgId, eventId) {
  // 验证必填参数
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
 * 修改密码
 * @param {string} phoneNumber - 手机号
 * @param {string} currentPassword - 当前密码
 * @param {string} newPassword - 新密码
 * @returns {Promise<Object>} - 修改结果
 */
async function changePassword(phoneNumber, currentPassword, newPassword) {
  try {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手机号格式不正确');
    }

    if (!validatePassword(newPassword)) {
      throw new Error('新密码至少需要8个字符，且必须包含英文字母和数字');
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
    throw new Error(error.message || '修改密码失败');
  }
}

/**
 * 发送 OTP（用于注册等场景）
 * @param {string} phoneNumber - 手机号
 * @param {string} pinCode - PIN 码
 * @returns {Promise<Object>} - 包含 sessionId
 */
async function sendOtp(phoneNumber, pinCode) {
  try {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手机号格式不正确');
    }

    const sendOtpFn = httpsCallable(functions, 'sendOtpToPhone');
    const result = await sendOtpFn({
      phoneNumber: normalized,
      pinCode
    });

    return result.data;
  } catch (error) {
    console.error('[authService] Send OTP error:', error);
    throw new Error(error.message || '发送 OTP 失败');
  }
}

// 导出所有函数
export const authService = {
  loginWithPin,
  logout,
  getUserProfile,
  changePassword,
  sendOtp,
  normalizePhone,
  validatePassword
};