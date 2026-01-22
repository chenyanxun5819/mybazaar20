import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { safeFetch } from '../../services/safeFetch';
import { signInWithCustomToken } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, getDocs } from 'firebase/firestore';
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
  const { login, getNavigationPath, isAuthenticated, userProfile } = useAuth();
  const { orgEventCode } = useParams();

  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];

  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: ''
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
      if (!(isAuthenticated && userProfile && userProfile.roles && userProfile.roles.length > 0)) return;

      // ⭐ 新增：如果检测到需要设置密码，跳过自动跳转到 Dashboard
      // 优先检查 userData (来自当前登录会话)，其次检查 userProfile (来自 AuthContext/Firestore)
      // 🔧 修复：只检查 hasDefaultPassword 和 isFirstLogin，不要特殊处理 eventManager
      const needsSetup = userData?.needsPasswordSetup || 
                         userProfile?.basicInfo?.hasDefaultPassword || 
                         userProfile?.basicInfo?.isFirstLogin;

      if (needsSetup) {
        console.log('[UniversalLogin] 🔐 检测到需要设置密码，跳过自动跳转');
        return;
      }

      const params = new URLSearchParams(window.location.search);
      if (params.has('stay') || params.has('noRedirect')) {
        console.log('[UniversalLogin] 🧷 stay/noRedirect 已启用，跳过自动跳转');
        return;
      }

      // ✅ 修复：使用本地逻辑根据设备类型决定跳转路径
      const availableRoles = filterRolesByDevice(userProfile.roles);
      
      // 🚨 手机端限制检查：如果用户在手机上，但没有移动端角色（只有经理角色）
      if (isMobile && availableRoles.length === 0) {
        console.warn('[UniversalLogin] 📱 手机端检测到仅有经理角色，阻止跳转');
        setError('管理后台仅支持桌面电脑访问，请使用电脑登录。');
        return;
      }

      const selectedRole = getPriorityRole(availableRoles);
      
      let navPath = '';
      
      // 尝试构建目标 orgEventCode
      let targetCode = orgEventCode;
      if (!targetCode && userProfile.organizationCode && userProfile.eventCode) {
         targetCode = `${userProfile.organizationCode}-${userProfile.eventCode}`;
      }
      if (!targetCode && userProfile.orgEventCode) {
         targetCode = userProfile.orgEventCode;
      }

      if (selectedRole && targetCode) {
         // 临时构造一个 path
         if (selectedRole === 'eventManager') navPath = `/event-manager/${targetCode}/dashboard`;
         else if (selectedRole === 'sellerManager') navPath = `/seller-manager/${targetCode}/dashboard`;
         else if (selectedRole === 'cashier') navPath = `/cashier/${targetCode}/dashboard`;
         else if (selectedRole === 'merchantManager') navPath = `/merchant-manager/${targetCode}/dashboard`;
         else if (selectedRole === 'customerManager') navPath = `/customer-manager/${targetCode}/dashboard`;
         
         // Mobile Roles
         else if (selectedRole === 'seller') navPath = `/seller/${targetCode}/dashboard`;
         else if (selectedRole === 'merchant') navPath = `/merchant/${targetCode}/dashboard`;
        // pointSeller 目前沿用 Seller Dashboard
        else if (selectedRole === 'pointSeller') navPath = `/seller/${targetCode}/dashboard`;
         else if (selectedRole === 'customer') navPath = `/customer/${targetCode}/dashboard`;
         
         else navPath = getNavigationPath(userProfile);
      } else {
         navPath = getNavigationPath(userProfile);
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
      if (userProfile) {
        // 忽略设备限制，直接检查角色
        const roles = userProfile.roles || [];
        const userInfoToSave = {
          ...userProfile,
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
  }, [isAuthenticated, userProfile, getNavigationPath, navigate, isMobile, orgEventCode]);
  // 验证 orgEventCode 格式
  const isValidOrgEventCode = orgCode && eventCode;

  /**
   * 根据角色和设备类型获取 Dashboard 路径
   */
  const getRoleDashboardPath = (role, isMobile) => {
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
    }
    // Mobile 角色路由
    else if (role === 'seller') {
      return `/seller/${orgEventCode}/dashboard`;
    } else if (role === 'merchant') {
      return `/merchant/${orgEventCode}/dashboard`;
    } else if (role === 'pointSeller') {
      // pointSeller 目前沿用 Seller Dashboard
      return `/seller/${orgEventCode}/dashboard`;
    } else if (role === 'customer') {
      return `/customer/${orgEventCode}/dashboard`;
    } else {
      console.error('[UniversalLogin] 未知角色:', role);
      return '/';
    }
  };

  /**
   * 处理密码登录提交 - 第一步
   */
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!isValidOrgEventCode) {
      setError('无效的活动链接，请检查网址是否正确');
      return;
    }

    setLoading(true);

    try {
      console.log('[UniversalLogin] 密码验证请求:', {
        orgCode,
        eventCode,
        phoneNumber: formData.phoneNumber
      });

      const url = '/api/loginUniversalHttp';

      const payload = {
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode,
        phoneNumber: formData.phoneNumber,
        password: formData.password
      };

      const startTime = Date.now();
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
        console.warn('[UniversalLogin] 非 JSON 响应, status:', resp.status);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${text?.substring(0, 200) || '非 JSON 响应'}`);
        }
      }

      if (!resp.ok || !data?.success) {
        const serverMsg = data?.error?.message;
        throw new Error(serverMsg || `请求失败 (HTTP ${resp.status})`);
      }

      console.log('[UniversalLogin] 密码验证成功:', data, '耗时:', Date.now() - startTime, 'ms');

      // 密码验证通过，保存临时信息并发送 OTP
      const tempUserData = {
        userId: data.userId,
        organizationId: data.organizationId,
        eventId: data.eventId,
        orgCode: orgCode,
        eventCode: eventCode,
        orgEventCode: orgEventCode,
        englishName: data.englishName,
        chineseName: data.chineseName,
        roles: Array.isArray(data.roles) ? data.roles : [],
        managedDepartments: data.managedDepartments || [],
        phoneNumber: formData.phoneNumber,
        customToken: data.customToken,
        roleSpecificData: data.roleSpecificData || {},
        // ⭐ 新增：保存密码状态字段
        needsPasswordSetup: data.needsPasswordSetup,
        hasDefaultPassword: data.hasDefaultPassword,
        isFirstLogin: data.isFirstLogin,
        hasTransactionPin: data.hasTransactionPin
      };

      // ⭐ 添加调试日志
      console.log('[UniversalLogin] 密码状态字段:', {
        needsPasswordSetup: data.needsPasswordSetup,
        hasDefaultPassword: data.hasDefaultPassword,
        isFirstLogin: data.isFirstLogin,
        hasTransactionPin: data.hasTransactionPin
      });

      setUserData(tempUserData);

      // 发送 OTP
      await sendOtp(formData.phoneNumber);

      // 切换到 OTP 输入界面
      setOtpStep(true);
      setOtp('');

    } catch (error) {
      console.error('[UniversalLogin] 错误:', error);
      const msg = error?.message || '登录失败，请重试';

      if (/组织|活动|not[- ]?found/i.test(msg)) {
        setError('找不到该组织或活动');
      } else if (/密码|permission[- ]?denied/i.test(msg)) {
        setError('手机号或密码错误');
      } else if (/必填|invalid[- ]?argument/i.test(msg)) {
        setError('请填写所有必填字段');
      } else if (/角色/i.test(msg)) {
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * 发送 OTP 到手机
   */
  const sendOtp = async (phoneNumber) => {
    try {
      console.log('[UniversalLogin] 发送 OTP 到:', phoneNumber);

      // ✅ 統一走 HTTP（safeFetch）以配合後端 onRequest + rewrites
      const resp = await safeFetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber,
          orgCode: orgCode.toLowerCase(),
          eventCode: eventCode,
          // ✅ 明確標記為 universalLogin（避免後端誤判為 login scenario 去查 users）
          scenario: 'universalLogin'
        })
      });

      const data = await resp.json();
      console.log('[UniversalLogin] sendOTP结果:', data);

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || '发送 OTP 失败');
      }

      console.log('[UniversalLogin] OTP 已发送');

      // 保存 sessionId（後續用新方式驗證）
      if (data?.sessionId) {
        setOtpSessionId(String(data.sessionId));
      }

      setOtpTimer(data.expiresIn || 300);
      startOtpTimer();

      // 🔧 開發模式：若後端回傳 testOtp，直接預填並顯示提示
      if (data?.devMode && data?.testOtp) {
        console.log('[UniversalLogin] DEV 模式：自動填入測試 OTP', data.testOtp);
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
  const filterRolesByDevice = (roles) => {
    console.log('[UniversalLogin] filterRolesByDevice - 输入角色:', roles);
    console.log('[UniversalLogin] filterRolesByDevice - 设备类型:', isMobile ? 'Mobile' : 'Desktop');

    if (isMobile) {
      // Mobile: 只支持手机角色（manager 一律不允许）
      const phoneRoles = ['seller', 'pointSeller', 'customer'];
      const filtered = (roles || []).filter(role => phoneRoles.includes(role));
      console.log('[UniversalLogin] filterRolesByDevice - Mobile 过滤结果:', filtered);
      return filtered;
    } else {
      // Desktop: 支持所有管理员角色 + 通用角色
      const desktopRoles = [
        'eventManager',
        'sellerManager',
        'merchantManager',
        'customerManager',
        'cashier',
        'seller',
        'merchant',
        'pointSeller',
        'customer'
      ];
      const filtered = (roles || []).filter(role => desktopRoles.includes(role));
      console.log('[UniversalLogin] filterRolesByDevice - Desktop 过滤结果:', filtered);
      return filtered;
    }
  };

  /**
   * 获取优先级最高的角色
   */
  const getPriorityRole = (roles) => {
    console.log('[UniversalLogin] getPriorityRole - 输入角色:', roles);

    if (isMobile) {
      // 手机端优先级：seller > merchant > pointSeller > customer
      const priority = ['seller', 'merchant', 'pointSeller', 'customer'];
      for (const role of priority) {
        if (roles.includes(role)) {
          console.log('[UniversalLogin] getPriorityRole - Mobile 选中角色:', role);
          return role;
        }
      }
    } else {
      const priority = ['eventManager', 'cashier', 'sellerManager', 'merchantManager', 'customerManager', 'seller', 'merchant', 'customer'];
      for (const role of priority) {
        if (roles.includes(role)) {
          console.log('[UniversalLogin] getPriorityRole - Desktop 选中角色:', role);
          return role;
        }
      }
    }

    console.warn('[UniversalLogin] getPriorityRole - 未找到匹配的角色');
    return null;
  };

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

      console.log('[UniversalLogin] ✅ OTP 验证成功');

      // ========== 簡化：移除客戶端 Firestore 讀取（避免權限問題）========== 
      // 首次登錄檢測應由後端在 verifyOtpHttp 回傳
      // 目前先簡化邏輯，直接使用 verifyOtpHttp 回傳的信息

      // 使用 verifyOtp 回傳的 customToken（優先）；向後相容使用第1步的 token
      const customTokenFromVerify = data?.customToken;
      const tokenToUse = customTokenFromVerify || userData?.customToken;

      // 🔍 調試信息：記錄 token 來源和長度
      console.log('[UniversalLogin] 🔐 Custom Token 詳情:', {
        hasTokenFromVerify: !!customTokenFromVerify,
        hasTokenFromUserData: !!userData?.customToken,
        tokenLength: tokenToUse?.length || 0,
        tokenPreview: tokenToUse ? `${tokenToUse.substring(0, 30)}...` : 'null',
        currentDomain: window.location.hostname,
        userAgent: navigator.userAgent.substring(0, 100)
      });

      if (!tokenToUse) {
        throw new Error('登录票据缺失：未取得 Custom Token');
      }

      // 🔍 嘗試登入並捕獲詳細錯誤
      try {
        await signInWithCustomToken(auth, tokenToUse);
        console.log('[UniversalLogin] ✅ Firebase Auth 登录成功');

        // ⭐ 新增：检查是否需要设置密码
        // data 来自 verifyOtp 的返回，userData 来自第一步密码验证
        const needsPasswordSetup = data?.needsPasswordSetup || userData?.needsPasswordSetup || false;

        console.log('[UniversalLogin] 密码设置状态检查:', {
          needsPasswordSetup,
          hasDefaultPassword: data?.hasDefaultPassword || userData?.hasDefaultPassword,
          isFirstLogin: data?.isFirstLogin || userData?.isFirstLogin,
          hasTransactionPin: data?.hasTransactionPin || userData?.hasTransactionPin
        });

        if (needsPasswordSetup) {
          // 构建用户信息（用于密码设置页面）
          const tempUserInfo = {
            userId: data?.userId || userData.userId,
            organizationId: data?.organizationId || userData.organizationId,
            eventId: data?.eventId || userData.eventId,
            orgCode,
            eventCode,
            orgEventCode,
            englishName: data?.englishName || userData.englishName,
            chineseName: data?.chineseName || userData.chineseName,
            roles: Array.isArray(data?.roles) ? data.roles : (userData.roles || []),
            phoneNumber: formData.phoneNumber,
            // 保存原始密码（用于 changeLoginPassword 的旧密码验证）
            oldPassword: formData.password
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

      // 根據 verifyOtp 結果覆蓋/對齊使用者資料（若提供）
      // 综合后端返回与第一步临时数据，优先使用 verifyOtp 返回的数据
      const roleSpecificFromVerify = data?.roleSpecificData || {};
      const roleSpecificFromTemp = userData?.roleSpecificData || {};

      const verifiedUser = {
        userId: data?.userId || userData.userId,
        organizationId: data?.organizationId || userData.organizationId,
        eventId: data?.eventId || userData.eventId,
        englishName: data?.englishName || userData.englishName,
        chineseName: data?.chineseName || userData.chineseName,
        roles: Array.isArray(data?.roles) ? data.roles : (userData.roles || []),
        // managedDepartments 可能直接在 data 中，或放在 roleSpecificData.sellerManager
        managedDepartments:
          data?.managedDepartments 
            || (roleSpecificFromVerify?.sellerManager && roleSpecificFromVerify.sellerManager.managedDepartments) 
            || userData?.managedDepartments 
            || (roleSpecificFromTemp?.sellerManager && roleSpecificFromTemp.sellerManager.managedDepartments)
            || [],
        // 保留 roleSpecificData 以便后续 Dashboard 使用（避免被误判为空）
        roleSpecificData: roleSpecificFromVerify || roleSpecificFromTemp || {},
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
  const handleRoleNavigation = (role, orgEventCode) => {
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
    } else if (role === 'merchant') {
      navigate(`/merchant/${orgEventCode}/dashboard`);
    } else if (role === 'customer') {
      navigate(`/customer/${orgEventCode}/dashboard`);
    } else {
      console.error('[UniversalLogin] 未知角色:', role);
      setError('未知角色类型');
    }
  };

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
        <form onSubmit={handlePasswordSubmit} style={styles.form}>
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
            <small style={styles.hint}>请您注册的马来西亚手机号</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>密码 *</label>
            <input
              type="password"
              style={styles.input}
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              placeholder="••••••••"
              required
              disabled={!isValidOrgEventCode}
            />
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
            {loading ? '登录中...' : '登录'}
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
            忘记密码？请联系活动管理员
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

