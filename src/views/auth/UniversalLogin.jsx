import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { safeFetch } from '../../services/safeFetch';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { syncErudaVisibility, persistErudaState } from '../../utils/eruda';
// 移除 httpsCallable，統一使用 HTTP 重寫 + safeFetch

/**
 * 统一登录页面 - 支持所有角色（包括 Event Manager）+ SMS OTP 验证
 * 
 * @route /login/:orgEventCode
 * @example /login/fch-2025
 * 
 * @description
 * 1. 从 URL 获取 orgEventCode (格式: orgCode-eventCode)
 * 2. 用户输入手机号和密码，进行初始验证
 * 3. 验证通过后，系统发送 OTP 验证码到手机
 * 4. 用户输入 OTP，验证成功后根据设备类型和角色优先级自动跳转
 * 5. 不显示角色选择界面，直接进入最高优先级角色的Dashboard
 * 6. 支持 Event Manager 角色（Desktop优先级最高）
 * 
 * 🔥 方案 A：不使用 AuthContext，登录成功后保存到 localStorage
 *    跳转后由 AuthContext 自动从 localStorage + Claims 恢复
 */
const UniversalLogin = () => {
  const navigate = useNavigate();
  const { login, getNavigationPath, isAuthenticated, userProfile, loading: authLoading } = useAuth();
  const { orgEventCode } = useParams();

  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];

  const [formData, setFormData] = useState({
    phoneNumber: ''
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [userData, setUserData] = useState(null);
  const detectIsMobile = () => {
    try {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      const isMobileUA = mobileRegex.test(userAgent);
      const isSmallScreen = window.innerWidth <= 768;
      return isMobileUA || isSmallScreen;
    } catch {
      return window.innerWidth <= 768;
    }
  };
  const [isMobile, setIsMobile] = useState(detectIsMobile);

  // SMS OTP 相关状态
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(0);
  const [otpSessionId, setOtpSessionId] = useState('');
  const [eventMeta, setEventMeta] = useState(null);
  const [manualStay, setManualStay] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  function getCachedSessionProfile() {
    try {
      const keys = [
        'currentUser',
        'eventManagerInfo',
        'sellerManagerInfo',
        'cashierInfo',
        'merchantOwnerInfo',
        'merchantAsistInfo',
        'sellerInfo',
        'customerInfo'
      ];

      for (const key of keys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const roles = Array.isArray(parsed?.roles) && parsed.roles.length > 0
          ? parsed.roles
          : (parsed?.selectedRole ? [parsed.selectedRole] : []);

        if (roles.length > 0) {
          return {
            ...parsed,
            roles,
            organizationCode: parsed?.organizationCode || parsed?.orgCode,
            eventCode: parsed?.eventCode,
            orgEventCode: parsed?.orgEventCode || parsed?.combinedCode
          };
        }
      }
    } catch (e) {
      console.warn('[UniversalLogin] 读取本地会话缓存失败:', e?.message || e);
    }

    return null;
  }

  function isSessionForCurrentOrgEvent(profile) {
    if (!profile) return false;
    if (!orgEventCode) return true;

    const currentCode = String(orgEventCode).trim().toLowerCase();
    const candidateCodes = [
      profile?.orgEventCode,
      (profile?.organizationCode && profile?.eventCode) ? `${profile.organizationCode}-${profile.eventCode}` : null,
      (profile?.orgCode && profile?.eventCode) ? `${profile.orgCode}-${profile.eventCode}` : null
    ]
      .filter(Boolean)
      .map(code => String(code).trim().toLowerCase());

    return candidateCodes.includes(currentCode);
  }


  // 检测设备类型
  useEffect(() => {
    const checkDeviceType = () => {
      const width = window.innerWidth;
      const nextIsMobile = detectIsMobile();
      setIsMobile(nextIsMobile);
      console.log('[UniversalLogin] 🖥️ 设备检测 - 窗口宽度:', width, 'px, 设备类型:', nextIsMobile ? 'Mobile 📱' : 'Desktop 💻');
    };

    checkDeviceType();
    window.addEventListener('resize', checkDeviceType);

    return () => window.removeEventListener('resize', checkDeviceType);
  }, []);

  // 加载活动元数据（logo, eventName）用于登录页显示
  useEffect(() => {
    let cancelled = false;
    const loadEventMeta = async () => {
      if (!orgCode || !eventCode) return;
      try {
        // 先根据 orgCode 找到 organization 文档 id
        const orgQ = query(collection(db, 'organizations'), where('orgCode', '==', orgCode));
        const orgSnap = await getDocs(orgQ);
        if (orgSnap.empty) return;
        const orgDoc = orgSnap.docs[0];
        const orgId = orgDoc.id;

        // 在子集合 events 中根据 eventCode 查找
        const eventsRef = collection(db, 'organizations', orgId, 'events');
        const evQ = query(eventsRef, where('eventCode', '==', eventCode));
        const evSnap = await getDocs(evQ);
        if (evSnap.empty) return;
        const ev = evSnap.docs[0].data();
        if (cancelled) return;
        setEventMeta(ev);

        // ✅ 根据活动的 erudaSettings 决定是否显示 Eruda
        const erudaEnabled = ev?.erudaSettings?.enabled === true;
        persistErudaState(erudaEnabled);
        syncErudaVisibility(erudaEnabled);
      } catch (e) {
        console.warn('[UniversalLogin] 加载 eventMeta 失败:', e);
      }
    };

    loadEventMeta();
    return () => { cancelled = true; };
  }, [orgCode, eventCode]);

  // ⭐ 自动跳转已登录用户（带路径检查）
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (authLoading) return;

      const cachedProfile = getCachedSessionProfile();
      const matchedCachedProfile = isSessionForCurrentOrgEvent(cachedProfile) ? cachedProfile : null;
      if (cachedProfile && !matchedCachedProfile) {
        console.warn('[UniversalLogin] 偵測到其他活動的舊會話快取，已忽略', {
          currentOrgEventCode: orgEventCode,
          cachedOrgEventCode: cachedProfile?.orgEventCode
        });
      }

      const effectiveProfile = (userProfile && userProfile.roles && userProfile.roles.length > 0)
        ? userProfile
        : matchedCachedProfile;

      if (!(isAuthenticated && effectiveProfile && effectiveProfile.roles && effectiveProfile.roles.length > 0)) return;

      // ⭐ 新增：如果检测到需要设置密码，跳过自动跳转到 Dashboard
      // 优先检查 userData (来自当前登录会话)，其次检查 userProfile (来自 AuthContext/Firestore)
      // 🔧 修复：只检查 hasDefaultPassword 和 isFirstLogin，不要特殊处理 eventManager
      const needsSetup =
        userData?.needsPasswordSetup === true ||
        userData?.isFirstLogin === true ||
        userData?.hasTransactionPin === false ||
        userProfile?.basicInfo?.isFirstLogin === true ||
        userProfile?.basicInfo?.hasTransactionPin === false;

      if (needsSetup) {
        console.log('[UniversalLogin] 🔐 检测到需要设置密码，跳过自动跳转');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      if (manualStay || params.has('stay') || params.has('noRedirect')) {
        console.log('[UniversalLogin] 🧷 stay/noRedirect 已启用，跳过自动跳转');
        return;
      }

      // ✅ 按设备与角色决定跳转
      const availableRoles = filterRolesByDevice(effectiveProfile.roles);

      // 电脑端：若无可用桌面角色，则提示改用手机登录
      if (!isMobile && availableRoles.length === 0) {
        console.warn('[UniversalLogin] 💻 桌面端未匹配到可用角色，提示改用手机登录');
        setError('请使用手机登录页面');
        return;
      }

      const selectedRole = getPriorityRole(availableRoles);

      let navPath = '';

      // 尝试构建目标 orgEventCode
      let targetCode = orgEventCode;
      if (!targetCode && effectiveProfile.organizationCode && effectiveProfile.eventCode) {
        targetCode = `${effectiveProfile.organizationCode}-${effectiveProfile.eventCode}`;
      }
      if (!targetCode && effectiveProfile.orgEventCode) {
        targetCode = effectiveProfile.orgEventCode;
      }

      if (selectedRole && targetCode) {
        // 临时构造一个 path
        if (selectedRole === 'eventManager') navPath = `/event-manager/${targetCode}/dashboard`;
        else if (selectedRole === 'sellerManager') navPath = `/seller-manager/${targetCode}/dashboard`;
        else if (selectedRole === 'cashier') navPath = `/cashier/${targetCode}/dashboard`;
        else if (selectedRole === 'merchantManager') navPath = `/merchant-manager/${targetCode}/dashboard`;
        else if (selectedRole === 'customerManager') navPath = `/customer-manager/${targetCode}/dashboard`;
        else if (selectedRole === 'auditor') navPath = `/auditor/${targetCode}/dashboard`; // 🆕

        // Mobile Roles
        else if (selectedRole === 'seller') navPath = `/seller/${targetCode}/dashboard`;
        else if (selectedRole === 'merchant' || selectedRole === 'merchantOwner' || selectedRole === 'merchantAsist') navPath = `/merchant/${targetCode}/dashboard`;
        else if (selectedRole === 'customer') navPath = `/customer/${targetCode}/dashboard`;
        else if (selectedRole === 'pointSeller') navPath = `/pointseller/${targetCode}/dashboard`;

        else navPath = getNavigationPath(effectiveProfile);
      } else {
        navPath = getNavigationPath(effectiveProfile);
      }

      const currentPath = window.location.pathname;

      // 避免重定向到当前路径
      if (currentPath === navPath) {
        console.log('[UniversalLogin] ✅ 已在目标路径，跳过重定向');
        return;
      }

      // 只在登录页面才执行跳转
      if (!currentPath.startsWith('/login/')) return;

      // 确保 Token 已可用，避免跳转后 callable 出现 unauthenticated
      try {
        await auth.currentUser?.getIdToken(true);
      } catch (e) {
        console.warn('[UniversalLogin] 获取 Token 失败，保留在登录页:', e?.message || e);
        return;
      }

      if (cancelled) return;
      console.log('[UniversalLogin] 🔍 检测到已登录用户，准备自动跳转');
      console.log('[UniversalLogin] 从:', currentPath);
      console.log('[UniversalLogin] 到:', navPath);
      console.log('[UniversalLogin] 设备:', isMobile ? 'Mobile' : 'Desktop', '选中角色:', selectedRole);

      // ✅ 修复：确保 Legacy LocalStorage Keys 存在 (防止 EventManagerDashboard 报错)
      // 这里的 userProfile 来自 AuthContext，已经包含了 claims 信息
      if (effectiveProfile) {
        // 忽略设备限制，直接检查角色
        const roles = effectiveProfile.roles || [];
        const userInfoToSave = {
          ...effectiveProfile,
          selectedRole: selectedRole || roles[0], // 使用选中的角色
          lastLogin: new Date().toISOString()
        };

        if (roles.includes('eventManager')) {
          console.log('[UniversalLogin] 💾 恢复 Event Manager Legacy Storage (Force)');
          localStorage.setItem('eventManagerInfo', JSON.stringify(userInfoToSave));
          localStorage.setItem('eventManagerLogin', JSON.stringify(userInfoToSave));
        }

        if (roles.includes('sellerManager')) {
          console.log('[UniversalLogin] 💾 恢复 Seller Manager Legacy Storage (Force)');
          localStorage.setItem('sellerManagerInfo', JSON.stringify(userInfoToSave));
        }

        if (roles.includes('cashier')) {
          console.log('[UniversalLogin] 💾 恢复 Cashier Legacy Storage (Force)');
          localStorage.setItem('cashierInfo', JSON.stringify(userInfoToSave));
        }
      }

      navigate(navPath, { replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, userProfile, authLoading, getNavigationPath, navigate, isMobile, orgEventCode, manualStay]);
  // 验证 orgEventCode 格式
  const isValidOrgEventCode = orgCode && eventCode;

  // ⭐ 新增：已登录用户的渲染拦截 - 显示"重定向中..."而不是登录表单
  const cachedSessionProfileRaw = getCachedSessionProfile();
  const cachedSessionProfile = isSessionForCurrentOrgEvent(cachedSessionProfileRaw)
    ? cachedSessionProfileRaw
    : null;
  const effectiveProfileForRender = (userProfile && userProfile.roles && userProfile.roles.length > 0)
    ? userProfile
    : cachedSessionProfile;
  const isLoggedIn = isAuthenticated && effectiveProfileForRender && effectiveProfileForRender.roles && effectiveProfileForRender.roles.length > 0;
  const needsPasswordSetup =
    userData?.needsPasswordSetup === true ||
    userData?.isFirstLogin === true ||
    userData?.hasTransactionPin === false ||
    userProfile?.basicInfo?.isFirstLogin === true ||
    userProfile?.basicInfo?.hasTransactionPin === false;

  // 检查URL参数是否要求停留在登录页
  const params = new URLSearchParams(window.location.search);
  const shouldStay = manualStay || params.has('stay') || params.has('noRedirect');

  const handleManualLogout = async () => {
    try {
      setLoggingOut(true);
      setManualStay(true);

      await signOut(auth);

      const keysToClear = [
        'currentUser',
        'eventManagerInfo',
        'eventManagerLogin',
        'sellerManagerInfo',
        'cashierInfo',
        'merchantOwnerInfo',
        'merchantAsistInfo',
        'sellerInfo',
        'customerInfo'
      ];
      keysToClear.forEach((key) => localStorage.removeItem(key));

      navigate(`/login/${orgEventCode}?stay=1`, { replace: true });
      window.mybazaarShowToast('已登出');
    } catch (logoutError) {
      console.error('[UniversalLogin] 手动登出失败:', logoutError);
      setError('登出失败，请重试');
    } finally {
      setLoggingOut(false);
    }
  };

  // 如果已登录且不需要设置密码且没有stay参数，显示重定向提示
  if (isLoggedIn && !needsPasswordSetup && !shouldStay) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          <div style={styles.header}>
            {eventMeta?.logo && (
              <img
                src={eventMeta.logo}
                alt="Logo"
                style={styles.logo}
              />
            )}
            <h2 style={styles.title}>
              {eventMeta?.eventName?.['zh-CN'] || eventMeta?.eventName?.['en-US'] || '加载中...'}
            </h2>
            <p style={styles.subtitle}>义卖会管理系统</p>
          </div>

          <div style={{
            textAlign: 'center',
            padding: '2rem',
            color: '#667eea'
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '1rem'
            }}>
              ⏳
            </div>
            <h3 style={{
              fontSize: '1.25rem',
              fontWeight: '600',
              marginBottom: '0.5rem',
              color: '#374151'
            }}>
              您已登录
            </h3>
            <p style={{
              fontSize: '0.875rem',
              color: '#6b7280',
              marginBottom: '1rem'
            }}>
              正在跳转到您的工作台...
            </p>
            <div style={{
              display: 'inline-block',
              padding: '0.5rem 1rem',
              background: '#f0f9ff',
              borderRadius: '8px',
              fontSize: '0.875rem',
              color: '#0369a1'
            }}>
              角色: {effectiveProfileForRender?.selectedRole || effectiveProfileForRender?.roles?.[0]}
            </div>

            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                onClick={handleManualLogout}
                disabled={loggingOut}
                style={{
                  ...styles.backToLoginButton,
                  marginTop: 0,
                  opacity: loggingOut ? 0.6 : 1,
                  cursor: loggingOut ? 'not-allowed' : 'pointer'
                }}
              >
                {loggingOut ? '登出中...' : '登出并返回登录页'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /**
   * 根据角色和设备类型获取 Dashboard 路径
   */
  function getRoleDashboardPath(role, isMobile) {
    // Desktop 角色路由
    if (role === 'eventManager') {
      return `/event-manager/${orgEventCode}/dashboard`;
    } else if (role === 'sellerManager') {
      return `/seller-manager/${orgEventCode}/dashboard`;
    } else if (role === 'merchantManager') {
      return `/merchant-manager/${orgEventCode}/dashboard`;
    } else if (role === 'customerManager') {
      return `/customer-manager/${orgEventCode}/dashboard`;
    } else if (role === 'cashier') {
      return `/cashier/${orgEventCode}/dashboard`;
    } else if (role === 'auditor') {
      return `/auditor/${orgEventCode}/dashboard`; // 🆕 稽核人员 - 仅桌面端
    }
    // Mobile 角色路由
    else if (role === 'seller') {
      return `/seller/${orgEventCode}/dashboard`;
    } else if (role === 'merchant' || role === 'merchantOwner' || role === 'merchantAsist') {
      return `/merchant/${orgEventCode}/dashboard`;
    } else if (role === 'pointSeller') {
      return `/pointseller/${orgEventCode}/dashboard`;
    } else if (role === 'customer') {
      return `/customer/${orgEventCode}/dashboard`;
    } else {
      console.error('[UniversalLogin] 未知角色:', role);
      return '/';
    }
  }

  /**
   * 处理手机号提交 - 直接发送OTP（无需密码）
   */
  const handlePhoneSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isValidOrgEventCode) {
      setError('无效的活动链接，请检查网址是否正确');
      return;
    }

    // 验证手机号格式
    if (!formData.phoneNumber || formData.phoneNumber.length < 9) {
      setError('请输入有效的手机号码');
      return;
    }

    setLoading(true);

    try {
      console.log('[UniversalLogin] ✨ 纯OTP登录流程开始:', {
        orgCode,
        eventCode,
        phoneNumber: formData.phoneNumber
      });

      // ✅ 直接发送 OTP，无需先验证密码
      await sendOtp(formData.phoneNumber);

      // 切换到 OTP 输入界面
      setOtpStep(true);
      setOtp('');

      console.log('[UniversalLogin] ✅ OTP已发送，等待用户输入验证码');

    } catch (error) {
      console.error('[UniversalLogin] 错误:', error);
      const msg = error?.message || '发送验证码失败，请重试';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 发送 OTP 到手机（纯OTP登录流程）
   */
  const sendOtp = async (phoneNumber) => {
    try {
      console.log('[UniversalLogin] 发送 OTP 到:', phoneNumber);

      // ✅ 使用 'login' scenario，让 verifyOtpHttp 执行完整的用户验证和登录流程
      const resp = await safeFetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber,
          orgCode: orgCode.toLowerCase(),
          eventCode: eventCode,
          // ✅ 使用 'login' scenario，让验证时进行用户查找和Custom Token生成
          scenario: 'login'
        })
      });

      const data = await resp.json();
      console.log('[UniversalLogin] sendOTP结果:', data);

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || '发送 OTP 失败');
      }

      console.log('[UniversalLogin] OTP 已发送');

      // 保存 sessionId
      if (data?.sessionId) {
        setOtpSessionId(String(data.sessionId));
      }

      setOtpTimer(data.expiresIn || 300);
      startOtpTimer();

      // 🔧 开发模式：若后端返回 testOtp，直接预填
      if (data?.devMode && data?.testOtp) {
        console.log('[UniversalLogin] DEV 模式：自动填入测试 OTP', data.testOtp);
        setOtpStep(true);
        setOtp(String(data.testOtp));
      }

    } catch (error) {
      console.error('[UniversalLogin] 发送 OTP 错误:', error);
      throw new Error('发送验证码失败，请重试');
    }
  };

  /**
   * OTP 倒计时
   */
  const startOtpTimer = () => {
    const interval = setInterval(() => {
      setOtpTimer(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  /**
   * 根据设备类型过滤角色
   * Desktop: 所有管理员角色 + 通用角色 (seller, customer, merchant)
   * Mobile: 只有通用角色 (seller, customer, merchant)
   */
  function filterRolesByDevice(roles) {
    console.log('[UniversalLogin] filterRolesByDevice - 输入角色:', roles);
    console.log('[UniversalLogin] filterRolesByDevice - 设备类型:', isMobile ? 'Mobile' : 'Desktop');

    if (isMobile) {
      // 手机端：pointSeller 可直接进 pointSellerDashboard；其余角色统一先进 customerDashboard
      const hasPointSeller = (roles || []).includes('pointSeller');
      const filtered = hasPointSeller ? ['pointSeller'] : ['customer'];
      console.log('[UniversalLogin] filterRolesByDevice - Mobile 过滤结果:', filtered);
      return filtered;
    }

    // 电脑端：仅允许桌面角色（含 pointSeller）
    const desktopRoles = [
      'eventManager',
      'sellerManager',
      'merchantManager',
      'customerManager',
      'cashier',
      'auditor',      // 🆕 稽核人员 - 仅桌面端
      'pointSeller'
    ];
    const filtered = (roles || []).filter(role => desktopRoles.includes(role));
    console.log('[UniversalLogin] filterRolesByDevice - Desktop 过滤结果:', filtered);
    return filtered;
  }

  /**
   * 获取优先级最高的角色
   */
  function getPriorityRole(roles) {
    console.log('[UniversalLogin] getPriorityRole - 输入角色:', roles);

    if (isMobile) {
      const role = roles.includes('pointSeller') ? 'pointSeller' : 'customer';
      console.log('[UniversalLogin] getPriorityRole - Mobile 选中角色:', role);
      return role;
    }

    const priority = ['eventManager', 'sellerManager', 'merchantManager', 'customerManager', 'cashier', 'auditor', 'pointSeller'];
    for (const role of priority) {
      if (roles.includes(role)) {
        console.log('[UniversalLogin] getPriorityRole - Desktop 选中角色:', role);
        return role;
      }
    }

    console.warn('[UniversalLogin] getPriorityRole - 未找到匹配的角色');
    return null;
  }

  /**
   * 验证 OTP - 第二步
   * 
   * ✅ 已修正：使用 userData 对象中的正确变量
   */
  const handleOtpVerify = async (e) => {
    e.preventDefault();
    setError('');

    if (!otp || otp.length !== 6) {
      setError('请输入6位验证码');
      return;
    }

    setOtpLoading(true);

    try {
      console.log('[UniversalLogin] 验证 OTP:', { sessionId: otpSessionId, otp });

      if (!otpSessionId) {
        throw new Error('验证码会话丢失，请重新发送验证码');
      }

      const url = '/api/verifyOtpHttp';
      const payload = {
        sessionId: otpSessionId,
        otp: otp
      };

      const resp = await safeFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const text = await resp.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch (_) {
        console.warn('[UniversalLogin] 验证 OTP 响应非 JSON');
      }

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || `验证失败 (HTTP ${resp.status})`);
      }

      console.log('[UniversalLogin] ✅ OTP 验证成功，收到用户数据:', data);

      // ========== ✨ 纯OTP登录：直接使用 verifyOtpHttp 返回的完整数据 ==========
      // verifyOtpHttp (scenario='login') 会返回完整的用户信息和 customToken

      // 验证返回数据的完整性
      if (!data?.customToken) {
        throw new Error('登录票据缺失：未取得 Custom Token');
      }

      if (!data?.userId || !data?.roles || data.roles.length === 0) {
        throw new Error('用户数据不完整，请联系管理员');
      }

      console.log('[UniversalLogin] 🔐 Custom Token 详情:', {
        tokenLength: data.customToken.length,
        tokenPreview: `${data.customToken.substring(0, 30)}...`,
        userId: data.userId,
        roles: data.roles
      });

      // 使用 customToken 登录 Firebase Auth
      try {
        await signInWithCustomToken(auth, data.customToken);
        console.log('[UniversalLogin] ✅ Firebase Auth 登录成功');

        // ⭐ 检查是否需要设置密码
        const needsPasswordSetup =
          data?.needsPasswordSetup === true ||
          data?.isFirstLogin === true ||
          data?.hasTransactionPin === false;

        setUserData({
          needsPasswordSetup,
          hasDefaultPassword: data?.hasDefaultPassword === true,
          isFirstLogin: data?.isFirstLogin === true,
          hasTransactionPin: data?.hasTransactionPin === true
        });

        console.log('[UniversalLogin] 密码设置状态检查:', {
          needsPasswordSetup,
          hasDefaultPassword: data?.hasDefaultPassword,
          isFirstLogin: data?.isFirstLogin,
          hasTransactionPin: data?.hasTransactionPin
        });

        if (needsPasswordSetup) {
          // 构建用户信息（用于密码设置页面）
          const tempUserInfo = {
            userId: data.userId,
            organizationId: data.organizationId,
            eventId: data.eventId,
            orgCode,
            eventCode,
            orgEventCode,
            englishName: data.englishName,
            chineseName: data.chineseName,
            roles: data.roles,
            phoneNumber: formData.phoneNumber
          };

          // 保存到 sessionStorage（防止刷新丢失）
          sessionStorage.setItem('passwordSetupPending', JSON.stringify(tempUserInfo));

          console.log('[UniversalLogin] 🔐 检测到需要设置密码，跳转到设置页面');

          // 跳转到密码设置页面
          navigate(`/setup-passwords/${orgEventCode}`, {
            replace: true,
            state: { userInfo: tempUserInfo }
          });

          setOtpLoading(false);
          return;
        }

        // 正常的登录流程继续...
        console.log('[UniversalLogin] ✅ 密码状态正常，继续登录流程');

      } catch (authError) {
        console.error('[UniversalLogin] ❌ Firebase Auth 登录失败:', {
          code: authError?.code,
          message: authError?.message,
          name: authError?.name,
          stack: authError?.stack,
          customData: authError?.customData,
          fullError: JSON.stringify(authError, Object.getOwnPropertyNames(authError))
        });

        // 根據錯誤碼提供更友好的提示
        if (authError?.code === 'auth/network-request-failed') {
          throw new Error('網路連線失敗。請檢查：1) 網路連線是否正常 2) 是否使用了 VPN 或代理 3) 防火牆設定');
        } else if (authError?.code === 'auth/invalid-custom-token') {
          throw new Error('登入憑證無效，請重新登入');
        } else if (authError?.code === 'auth/app-not-authorized') {
          throw new Error('應用程式未授權此域名，請聯繫管理員');
        }
        throw authError;
      }

      // 根據 verifyOtp 結果构建用户数据
      const verifiedUser = {
        userId: data.userId,
        organizationId: data.organizationId,
        eventId: data.eventId,
        englishName: data.englishName,
        chineseName: data.chineseName,
        roles: data.roles,
        managedDepartments: data.managedDepartments || [],
        roleSpecificData: data.roleSpecificData || {},
        department: data.department || '',
        identityTag: data.identityTag || '',
        orgCode,
        eventCode,
        orgEventCode
      };

      // 根据设备类型过滤角色
      const availableRoles = filterRolesByDevice(verifiedUser.roles);
      console.log('[UniversalLogin] 可用角色:', availableRoles);

      if (availableRoles.length === 0) {
        setError(`您的账户在此设备上没有可用角色。${isMobile ? '请使用桌面设备登录' : '请使用手机设备登录'}`);
        setOtpLoading(false);
        return;
      }

      // 获取优先级最高的角色
      const selectedRole = getPriorityRole(availableRoles);
      console.log('[UniversalLogin] 选中角色:', selectedRole);

      if (!selectedRole) {
        setError('无法确定您的角色，请联系管理员');
        setOtpLoading(false);
        return;
      }

      // 保存用户信息到 localStorage (供 AuthContext 读取)
      const userInfoToSave = {
        ...verifiedUser,
        selectedRole,
        lastLogin: new Date().toISOString()
      };
      localStorage.setItem('currentUser', JSON.stringify(userInfoToSave));

      // ✅ 向後相容：Desktop Manager Dashboards 仍在讀取舊 key
      // 注意：selectedRole 可能是手机端角色（例如 seller），但用户仍可能拥有 manager 身份
      // 为避免桌面端后续访问报错，这里按“是否拥有该角色”写入 legacy keys
      const allRoles = verifiedUser.roles || [];
      if (allRoles.includes('sellerManager')) {
        // 确保 legacy key 包含 managedDepartments & roleSpecificData，避免 Dashboard 误判
        const sellerLegacy = {
          ...userInfoToSave,
          managedDepartments: verifiedUser.managedDepartments || [],
          roleSpecificData: verifiedUser.roleSpecificData || {}
        };
        localStorage.setItem('sellerManagerInfo', JSON.stringify(sellerLegacy));
      }
      if (allRoles.includes('eventManager')) {
        localStorage.setItem('eventManagerInfo', JSON.stringify(userInfoToSave));
        localStorage.setItem('eventManagerLogin', JSON.stringify(userInfoToSave));
      }
      if (allRoles.includes('cashier')) {
        localStorage.setItem('cashierInfo', JSON.stringify(userInfoToSave));
      }

      console.log('[UniversalLogin] ✅ 用户信息已保存到 localStorage');

      // 根据角色和设备类型跳转
      // ✅ 关键修复：不要用 getNavigationPath（它不区分设备，会优先导向 manager）
      // 这里必须使用 selectedRole 的结果，确保手机一定进入手机角色页面
      const dashboardPath = getRoleDashboardPath(selectedRole, isMobile);
      console.log('[UniversalLogin] 🚀 跳转到:', dashboardPath);
      navigate(dashboardPath, { replace: true });

    } catch (error) {
      console.error('[UniversalLogin] OTP 验证错误:', error);
      const msg = error?.message || 'OTP 验证失败，请重试';

      if (/验证码|otp|invalid/i.test(msg)) {
        setError('验证码错误或已过期');
      } else if (/过期|expired/i.test(msg)) {
        setError('验证码已过期，请重新获取');
      } else {
        setError(msg);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  /**
   * 根据角色跳转到对应的 Dashboard
   */
  function handleRoleNavigation(role, orgEventCode) {
    console.log('[UniversalLogin] 准备跳转:', { role, orgEventCode });

    // Desktop 角色路由
    if (role === 'eventManager') {
      navigate(`/event-manager/${orgEventCode}/dashboard`);
    } else if (role === 'sellerManager') {
      navigate(`/seller-manager/${orgEventCode}/dashboard`);
    } else if (role === 'merchantManager') {
      navigate(`/merchant-manager/${orgEventCode}/dashboard`);
    } else if (role === 'customerManager') {
      navigate(`/customer-manager/${orgEventCode}/dashboard`);
    } else if (role === 'cashier') {
      navigate(`/cashier/${orgEventCode}/dashboard`);
    }
    // Mobile 角色路由
    else if (role === 'seller') {
      navigate(`/seller/${orgEventCode}/dashboard`);
    } else if (role === 'merchant' || role === 'merchantOwner' || role === 'merchantAsist') {
      navigate(`/merchant/${orgEventCode}/dashboard`);
    } else if (role === 'customer') {
      navigate(`/customer/${orgEventCode}/dashboard`);
    } else if (role === 'pointSeller') {
      navigate(`/pointseller/${orgEventCode}/dashboard`);
    } else {
      console.error('[UniversalLogin] 未知角色:', role);
      setError('未知角色类型');
    }
  }

  /**
   * 返回密码登录界面
   */
  const handleBackToPassword = () => {
    setOtpStep(false);
    setOtp('');
    setError('');
    setOtpTimer(0);
  };

  // OTP 验证界面
  if (otpStep) {
    return (
      <div style={styles.container}>
        <div style={styles.loginCard}>
          {/* Logo 和标题 */}
          <div style={styles.header}>
            {eventMeta?.logoUrl ? (
              <img src={eventMeta.logoUrl} alt="Event Logo" style={styles.logo} />
            ) : (
              <div style={styles.logo}>🔐</div>
            )}
            <h1 style={styles.title}>验证码验证</h1>
            <p style={styles.subtitle}>
              验证码已发送至 {formData.phoneNumber}
            </p>
          </div>

          <form onSubmit={handleOtpVerify} style={styles.form}>
            <div style={{ ...styles.formGroup, alignItems: 'center' }}>
              <label style={styles.label}>请输入6位验证码</label>
              <input
                type="tel"
                inputMode="numeric"
                pattern="[0-9]*"
                style={styles.otpInput}
                value={otp}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  if (value.length <= 6) {
                    setOtp(value);
                    setError('');
                  }
                }}
                placeholder="000000"
                maxLength="6"
                disabled={otpLoading}
                autoFocus
                autoComplete="one-time-code"
              />
            </div>

            {/* 错误提示 */}
            {error && (
              <div style={styles.errorBox}>
                ⚠️ {error}
              </div>
            )}

            {/* 验证按钮 */}
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                opacity: otpLoading || otp.length !== 6 ? 0.6 : 1,
                cursor: otpLoading || otp.length !== 6 ? 'not-allowed' : 'pointer'
              }}
              disabled={otpLoading || otp.length !== 6}
            >
              {otpLoading ? '验证中...' : '验证并登录'}
            </button>

            {/* 重新发送验证码 */}
            {otpTimer === 0 ? (
              <button
                type="button"
                style={styles.resendButton}
                onClick={async () => {
                  try {
                    setError('');
                    await sendOtp(formData.phoneNumber);
                  } catch (err) {
                    setError(err.message);
                  }
                }}
              >
                重新发送验证码
              </button>
            ) : (
              <div style={styles.timerInfo}>
                重新发送倒计时: {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')}
              </div>
            )}
          </form>

          {/* 返回登录按钮 */}
          <button
            style={styles.backToLoginButton}
            onClick={handleBackToPassword}
          >
            ← 返回登录
          </button>
        </div>
      </div>
    );
  }

  // 正常登录界面
  return (
    <div style={styles.container}>
      <div style={styles.loginCard}>
        {/* Logo 和标题 */}
        <div style={styles.header}>
          {eventMeta?.logoUrl ? (
            <img src={eventMeta.logoUrl} alt="Event Logo" style={styles.logo} />
          ) : (
            <div style={styles.logo}>🎪</div>
          )}
          <h1 style={styles.title}>{eventMeta?.eventName?.['zh-CN'] || eventMeta?.eventName?.['en-US'] || 'MyBazaar 登录'}</h1>
          <p style={styles.subtitle}>义卖会管理系统</p>
          {isValidOrgEventCode && (
            <div style={styles.eventBadge}>
              <span style={styles.eventBadgeIcon}>🏷️</span>
              <span>{orgCode.toUpperCase()}-{eventCode}</span>
            </div>
          )}
          {/* 显示设备类型提示 */}
          <div style={{
            ...styles.eventBadge,
            background: isMobile ? '#dbeafe' : '#fef3c7',
            color: isMobile ? '#1e40af' : '#92400e',
            marginTop: '0.5rem'
          }}>
            <span>{isMobile ? '📱' : '💻'}</span>
            <span>{isMobile ? '手机模式' : '桌面模式'}</span>
          </div>
        </div>

        {/* 无效链接提示 */}
        {!isValidOrgEventCode && (
          <div style={styles.errorBox}>
            ⚠️ 无效的活动链接
            <div style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              正确格式: /login/组织代码-活动代码 (例如: /login/fch-2025)
            </div>
          </div>
        )}

        {/* 登录表单 */}
        <form onSubmit={handlePhoneSubmit} style={styles.form}>
          <div style={styles.formGroup}>
            <label style={styles.label}>手机号 *</label>
            <input
              type="tel"
              style={styles.input}
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              placeholder="60123456789"
              required
              disabled={!isValidOrgEventCode}
            />
            <small style={styles.hint}>请输入您注册的马来西亚手机号</small>
          </div>

          {/* ========== ✨ OTP登录说明 ========== */}
          <div style={{
            padding: '1rem',
            background: '#f0f9ff',
            borderRadius: '8px',
            fontSize: '0.875rem',
            color: '#0369a1',
            border: '1px solid #bae6fd'
          }}>
            <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>🔐 验证码登录</p>
            <p style={{ margin: 0 }}>
              点击"获取验证码"后，我们将向您的手机发送6位验证码。请输入验证码完成登录。
            </p>
          </div>

          {/* 错误提示 */}
          {error && (
            <div style={styles.errorBox}>
              ⚠️ {error}
            </div>
          )}

          {/* 登录按钮 */}
          <button
            type="submit"
            style={{
              ...styles.submitButton,
              opacity: loading || !isValidOrgEventCode ? 0.6 : 1,
              cursor: loading || !isValidOrgEventCode ? 'not-allowed' : 'pointer'
            }}
            disabled={loading || !isValidOrgEventCode}
          >
            {loading ? '发送中...' : '获取验证码'}
          </button>

          {/* ========== ✨ 新增：注册链接 ========== */}
          <div style={{ marginTop: '1rem', textAlign: 'center' }}>
            <p style={{ fontSize: '0.9rem', color: '#666', margin: 0 }}>
              还没有账号？
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  if (isValidOrgEventCode) {
                    navigate(`/customer/${orgEventCode}/register`);
                  }
                }}
                disabled={!isValidOrgEventCode}
                style={{
                  marginLeft: '0.5rem',
                  padding: '0',
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: isValidOrgEventCode ? '#667eea' : '#ccc',
                  background: 'none',
                  border: 'none',
                  cursor: isValidOrgEventCode ? 'pointer' : 'not-allowed',
                  textDecoration: 'underline'
                }}
              >
                立即注册
              </button>
            </p>
          </div>
        </form>

        {/* 帮助信息 */}
        <div style={styles.footer}>
          <p style={styles.helpText}>
            需要帮助？请联系活动管理员
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: '2rem'
  },
  loginCard: {
    background: 'white',
    borderRadius: '16px',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
    padding: '3rem',
    maxWidth: '500px',
    width: '100%'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    width: '120px',
    height: '120px',
    marginBottom: '0.5rem'
  },
  title: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '0.8rem',
    color: '#6b7280',
    margin: '0 0 0.5rem 0'
  },
  eventBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    background: '#f3f4f6',
    padding: '0.5rem 1rem',
    borderRadius: '20px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginTop: '1rem'
  },
  eventBadgeIcon: {
    fontSize: '1.25rem'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  input: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  otpInput: {
    padding: '0.75rem 1rem',
    width: '260px',
    maxWidth: '100%',
    boxSizing: 'border-box',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1.25rem',
    textAlign: 'center',
    letterSpacing: '0.35rem',
    fontFamily: 'monospace',
    outline: 'none',
    display: 'block',
    margin: '0.25rem auto',
    transition: 'border-color 0.2s'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  errorBox: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca'
  },
  submitButton: {
    padding: '1rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '1rem',
    transition: 'all 0.2s'
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center'
  },
  helpText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0.5rem 0'
  },
  backToLoginButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    marginTop: '1rem'
  },
  resendButton: {
    width: '100%',
    padding: '0.75rem',
    marginTop: '1rem',
    background: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  timerInfo: {
    width: '100%',
    textAlign: 'center',
    marginTop: '1rem',
    padding: '0.75rem',
    background: '#f0f4ff',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#667eea'
  }
};

export default UniversalLogin;