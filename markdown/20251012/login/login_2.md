# functions\index.js
```
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const cors = require('cors')({ origin: true });

// 确保只初始化一次
if (!admin.apps.length) {
  admin.initializeApp();
}

const { checkAdminExists, createInitialAdmin, sendOtpToPhone, verifyOtpCode, setProjectInfo, getTotalCapital, getAssignedCapitalSum, createManager } = require('./admin');
exports.checkAdminExists = checkAdminExists;
exports.createInitialAdmin = createInitialAdmin;
exports.sendOtpToPhone = sendOtpToPhone;
exports.verifyOtpCode = verifyOtpCode;
exports.setProjectInfo = setProjectInfo;
exports.getTotalCapital = getTotalCapital;
exports.getAssignedCapitalSum = getAssignedCapitalSum;
exports.createManager = createManager;

exports.loginWithPin = functions.https.onCall(async (data, context) => {
    const { phoneNumber, pin, organizationId, eventId } = data.data || data;
    
    console.log('[loginWithPin] Received:', { 
      phoneNumber, 
      organizationId, 
      eventId, 
      hasPin: !!pin,
      hasContext: !!context
    });
    
    if (!phoneNumber || !pin) {
      throw new functions.https.HttpsError("invalid-argument", "请提供手机号码与PIN码");
    }
    if (!organizationId || !eventId) {
      throw new functions.https.HttpsError("invalid-argument", "请提供组织与活动信息");
    }
    
    // 使用正确的路径查询用户
    const collectionPath = `organizations/${organizationId}/events/${eventId}/users`;
    console.log('[loginWithPin] Querying path:', collectionPath);
    
    const usersSnap = await admin.firestore()
      .collection(collectionPath)
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
    
    console.log('[loginWithPin] Query result:', { empty: usersSnap.empty, size: usersSnap.size });
      
    if (usersSnap.empty) {
      throw new functions.https.HttpsError("not-found", "查无此手机号码");
    }
    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const passwordHash = crypto.createHash("sha256").update(pin + passwordSalt).digest("hex");
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    
    if (passwordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "密码错误");
    }
    // 马来西亚国码是 60
    const authUid = `phone_60${phoneNumber.replace(/^0/, "")}`;
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(authUid);
    } catch (error) {
      // 如果用戶不存在，創建新用戶（不設定 phoneNumber，避免衝突）
      userRecord = await admin.auth().createUser({
        uid: authUid,
        displayName: userData.basicInfo.chineseName || phoneNumber
      });
    }
    const customToken = await admin.auth().createCustomToken(authUid);
    // 確保 Firestore 的 authUid 正確更新
    console.log(`[loginWithPin] Current authUid in Firestore: ${userData.authUid}, New authUid: ${authUid}`);
    if (userData.authUid !== authUid) {
      console.log(`[loginWithPin] Updating authUid from ${userData.authUid} to ${authUid}`);
      await userDoc.ref.update({ authUid });
    }
    return {
      customToken,
      chineseName: userData.basicInfo.chineseName,
      roles: userData.roles,
      redirectUrl: getRedirectUrl(userData.roles)
    };
  });

exports.changePassword = functions.https.onCall(async (data, context) => {
  const { phoneNumber, currentPassword, newPassword } = data.data || data;
  
  if (!phoneNumber || !currentPassword || !newPassword) {
    throw new functions.https.HttpsError("invalid-argument", "請提供手機號碼、當前密碼和新密碼");
  }
  
  // 驗證新密碼長度
  if (newPassword.length < 8) {
    throw new functions.https.HttpsError("invalid-argument", "新密碼長度至少需要8個字符");
  }
  
  // 驗證新密碼強度（至少包含英文和數字）
  const hasLetter = /[a-zA-Z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  
  if (!hasLetter || !hasNumber) {
    throw new functions.https.HttpsError("invalid-argument", "新密碼必須包含英文字母和數字");
  }
  
  try {
    // 查詢用戶
    const usersSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
      
    if (usersSnap.empty) {
      throw new functions.https.HttpsError("not-found", "查無此手機號碼");
    }
    
    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    
    // 驗證當前密碼
    const passwordSalt = userData.basicInfo.passwordSalt || userData.basicInfo.pinSalt;
    const currentPasswordHash = crypto.createHash("sha256").update(currentPassword + passwordSalt).digest("hex");
    
    const storedHash = userData.basicInfo.passwordHash || userData.basicInfo.pinHash;
    if (currentPasswordHash !== storedHash) {
      throw new functions.https.HttpsError("permission-denied", "當前密碼錯誤");
    }
    
    // 生成新的密碼 hash（使用相同的 salt）
    const newPasswordHash = crypto.createHash("sha256").update(newPassword + passwordSalt).digest("hex");
    
    // 更新 Firestore（同時更新 passwordHash 和保留舊的 pinHash 以便向後兼容）
    await userDoc.ref.update({
      "basicInfo.passwordHash": newPasswordHash,
      "basicInfo.pinHash": newPasswordHash,  // 向後兼容
      "basicInfo.passwordSalt": passwordSalt,
      "basicInfo.pinSalt": passwordSalt       // 向後兼容
    });
    
    console.log(`[changePassword] Password changed for ${phoneNumber}`);
    return { success: true, message: "密碼修改成功" };
    
  } catch (error) {
    console.error("[changePassword] Error:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError("internal", `修改密碼失敗：${error.message}`);
  }
});

function getRedirectUrl(roles) {
  console.log(`[getRedirectUrl] Checking roles:`, JSON.stringify(roles));
  // super_admin 去 admin-dashboard.html（管理後台總覽）
  if (roles.includes("super_admin") || roles.includes("super admin")) return "../admin/admin-dashboard.html";
  // manager 去 admin-manage-users.html（用戶管理頁面）
  if (roles.includes("manager")) return "../manager/admin-manage-users.html";
  // merchant 去 merchant-dashboard.html（商家儀表板）
  if (roles.includes("merchant")) return "../merchant/merchant-dashboard.html";
  // seller 去 seller-dashboard.html（銷售員儀表板）
  if (roles.includes("seller")) return "../seller/seller-dashboard.html";
  if (roles.includes("customer")) return "../customer/consume.html";
  console.log(`[getRedirectUrl] No role matched, returning default`);
  return "../home/index.html";
}

exports.loginAndRedirect = functions.https.onCall(async (data, context) => {
  const userUid = context.auth ? context.auth.uid : null;
  console.log(`[loginAndRedirect] User UID from context: ${userUid}`);
  
  // 如果 context.auth 是 null（emulator 常見問題），嘗試從 data 取得 phoneNumber
  const { phoneNumber } = data.data || data;
  
  let userSnap;
  if (userUid) {
    // 優先用 authUid 查詢
    userSnap = await admin.firestore().collection("users").where("authUid", "==", userUid).limit(1).get();
  }
  
  // 如果 authUid 查不到，且有 phoneNumber，改用 phoneNumber 查詢
  if ((!userSnap || userSnap.empty) && phoneNumber) {
    console.log(`[loginAndRedirect] Fallback to phoneNumber query: ${phoneNumber}`);
    userSnap = await admin.firestore().collection("users")
      .where("basicInfo.phoneNumber", "==", phoneNumber)
      .limit(1)
      .get();
  }
  
  console.log(`[loginAndRedirect] Query result: ${userSnap && !userSnap.empty ? 'found' : 'empty'}`);
  if (!userSnap || userSnap.empty) throw new functions.https.HttpsError("not-found", "找不到使用者資料。");
  
  const userData = userSnap.docs[0].data();
  return {
    redirectUrl: getRedirectUrl(userData.roles),
    chineseName: userData.basicInfo && userData.basicInfo.chineseName ? userData.basicInfo.chineseName : "",
    roles: userData.roles,
    identityTag: userData.identityTag || "",
  };
});

exports.sendOtpToPhone = functions.https.onCall(async (data, context) => {
    const { phoneNumber, pinCode } = data.data || data;
    if (!phoneNumber || !pinCode) {
        throw new functions.https.HttpsError("invalid-argument", "請提供手機號和PIN");
    }
    // 產生 6 位數 OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // 產生 sessionId
    const sessionId = crypto.randomUUID();
    const expirationTime = Date.now() + 5 * 60 * 1000;
    await admin.firestore().collection("otp_sessions").doc(sessionId).set({
        phoneNumber,
        pinCode,
        otp,
        expirationTime,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (process.env.FUNCTIONS_EMULATOR === "true") {
        console.log(`[EMULATOR] OTP for ${phoneNumber}: ${otp} (sessionId: ${sessionId})`);
    }
    // Twilio 發送略（正式环境可补充）
    return { sessionId, success: true, message: "OTP已發送" };
});

exports.getManagers = functions.https.onCall(async (data, context) => {
  try {
    const managersSnap = await admin.firestore().collection("managers").get();
    const managers = [];

    managersSnap.forEach(doc => {
      managers.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return { managers };
  } catch (error) {
    console.error("Error fetching managers:", error);
    throw new functions.https.HttpsError("internal", "Unable to fetch managers.");
  }
});

```

# src\views\desktop\auth\Login.jsx
```
// src/views/phone/auth/Login.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../../contexts/AuthContext';
import { useEvent } from '../../../contexts/EventContext';

const PhoneLogin = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { orgCode, eventCode } = useEvent();

  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // 清除错误信息
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // 基本验证
    if (!formData.phoneNumber || !formData.password) {
      setError('请填写完整的手机号和密码');
      return;
    }

    // 验证手机号格式
    if (!/^01\d{8,9}$/.test(formData.phoneNumber)) {
      setError('手机号格式不正确，请输入01开头的10-11位数字');
      return;
    }

    // 验证密码长度
    if (formData.password.length < 8) {
      setError('密码至少需要8个字符');
      return;
    }

    try {
      setLoading(true);
      setError('');

      await login(formData.phoneNumber, formData.password);

      // 登录成功，跳转到手机版首页
      navigate(`/${orgCode}-${eventCode}/phone`);
    } catch (err) {
      console.error('[PhoneLogin] Login failed:', err);
      setError(err.message || '登录失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h1 style={styles.title}>用户登录</h1>
          <p style={styles.subtitle}>请输入您的手机号和密码</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>手机号</label>
            <input
              type="tel"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              placeholder="01xxxxxxxx"
              style={styles.input}
              disabled={loading}
              inputMode="numeric"
              pattern="^01\d{8,9}$"
              maxLength="11"
            />
            <small style={styles.hint}>马来西亚手机号，01开头</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>密码</label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="至少8位，包含英文和数字"
              style={styles.input}
              disabled={loading}
              minLength="8"
            />
          </div>

          {error && (
            <div style={styles.errorMessage}>
              ⚠️ {error}
            </div>
          )}

          <button
            type="submit"
            style={{
              ...styles.submitButton,
              ...(loading ? styles.submitButtonDisabled : {})
            }}
            disabled={loading}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div style={styles.footer}>
          <p style={styles.footerText}>
            还没有账号？请联系管理员注册
          </p>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1rem'
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.2)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  input: {
    padding: '0.75rem',
    fontSize: '1rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
    boxSizing: 'border-box'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  errorMessage: {
    padding: '0.75rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  submitButton: {
    padding: '0.875rem',
    fontSize: '1rem',
    fontWeight: '600',
    color: 'white',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'transform 0.2s, opacity 0.2s',
    marginTop: '0.5rem'
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  footer: {
    marginTop: '1.5rem',
    paddingTop: '1.5rem',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'center'
  },
  footerText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  }
};

export default PhoneLogin;
```
# src\services\authService.js
```
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
async function loginWithPin(phoneNumber, password, organizationId, eventId) {
  try {
    const normalized = normalizePhone(phoneNumber);
    if (!normalized) {
      throw new Error('手机号格式不正确，请输入01开头的10-11位数字');
    }

    if (!validatePassword(password)) {
      throw new Error('密码至少需要8个字符，且必须包含英文字母和数字');
    }

    if (!organizationId || !eventId) {
      throw new Error('缺少组织或活动资讯');
    }

    console.log('[authService] Calling loginWithPin function with:', {
      phoneNumber: normalized,
      organizationId,
      eventId
    });
    
    const loginWithPinFn = httpsCallable(functions, 'loginWithPin');
    
    const result = await loginWithPinFn({ 
      phoneNumber: normalized, 
      pin: password,
      organizationId,
      eventId
    });

    console.log('[authService] Function call result:', result);

    const data = result.data;
    const customToken = data?.customToken || data?.token || data?.custom_token;

    if (!customToken) {
      console.error('[authService] No custom token in response:', data);
      throw new Error(data?.message || '密码验证失败');
    }

    console.log('[authService] Got custom token, signing in...');
    
    await signInWithCustomToken(auth, customToken);

    console.log('[authService] Login successful');
    
    return {
      success: true,
      user: data,
      message: '登录成功'
    };
  } catch (error) {
    console.error('[authService] Login error details:', {
      code: error.code,
      message: error.message,
      details: error.details,
      stack: error.stack
    });
    
    let errorMessage = '登录失败，请确认手机号与密码';
    
    if (error.code === 'not-found') {
      errorMessage = '查无此手机号码';
    } else if (error.code === 'permission-denied') {
      errorMessage = '密码错误';
    } else if (error.code === 'internal') {
      errorMessage = '服务器错误，请稍后重试';
    } else if (error.code === 'unavailable') {
      errorMessage = '网络连接失败，请检查网络';
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
```


# src\contexts\AuthContext.jsx
```
// src/contexts/AuthContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { auth } from '../config/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { authService } from '../services/authService';
import { useEvent } from './EventContext';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // 获取 EventContext（必须存在）
  const { organizationId, eventId } = useEvent();

  // 监听 Firebase Auth 状态变化
  useEffect(() => {
    // 如果没有 orgId/eventId，不执行查询
    if (!organizationId || !eventId) {
      console.warn('[AuthContext] No organizationId or eventId, skipping user profile load');
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[AuthContext] Auth state changed:', user ? user.uid : 'no user');
      
      if (user && !user.isAnonymous) {
        setCurrentUser(user);
        
        // 载入用户资料
        try {
          const profile = await authService.getUserProfile(
            user.uid, 
            organizationId, 
            eventId
          );
          setUserProfile(profile);
          console.log('[AuthContext] User profile loaded:', profile);
        } catch (err) {
          console.error('[AuthContext] Failed to load user profile:', err);
          setUserProfile(null);
        }
      } else {
        setCurrentUser(null);
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return () => unsubscribe();
  }, [organizationId, eventId]);

  // 登入函数
  const login = async (phoneNumber, password) => {
    try {
      setError(null);
      setLoading(true);
      
      console.log('[AuthContext] Login called with:', {
        phoneNumber,
        organizationId,
        eventId
      });
      
      if (!organizationId || !eventId) {
        throw new Error('无法获取组织或活动信息，请重新加载页面');
      }
      
      const result = await authService.loginWithPin(phoneNumber, password, organizationId, eventId);
      
      // onAuthStateChanged 会自动处理后续
      return result;
    } catch (err) {
      console.error('[AuthContext] Login error:', err);
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  // 登出函数
  const logout = async () => {
    try {
      await authService.logout();
      setCurrentUser(null);
      setUserProfile(null);
    } catch (err) {
      console.error('[AuthContext] Logout error:', err);
      throw err;
    }
  };

  // 检查用户是否有特定角色
  const hasRole = (role) => {
    if (!userProfile || !userProfile.roles) return false;
    return userProfile.roles.includes(role);
  };

  // 获取用户主要角色（优先级最高的角色）
  const getPrimaryRole = () => {
    if (!userProfile || !userProfile.roles) return null;
    
    const rolePriority = [
      'platform_admin',
      'org_admin', 
      'event_manager',
      'manager',
      'merchant',
      'seller',
      'customer'
    ];
    
    for (const role of rolePriority) {
      if (userProfile.roles.includes(role)) {
        return role;
      }
    }
    
    return null;
  };

  const value = {
    currentUser,
    userProfile,
    loading,
    error,
    login,
    logout,
    hasRole,
    getPrimaryRole,
    isAuthenticated: !!currentUser && !currentUser.isAnonymous
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
```
