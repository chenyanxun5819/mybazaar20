import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '../../config/firebase';
import safeFetch from '../../services/safeFetch';
import OTPInput from '../../components/OTPInput';
import { syncErudaVisibility } from '../../utils/eruda';

/**
 * Customer注册页面（纯OTP版本）
 * 
 * 流程：
 * 步骤1：输入手机号和昵称
 * 步骤2：OTP验证
 * 步骤3：设置交易密码
 * 
 * 路由参数：
 * - orgEventCode: 组织-活动代码 (格式: orgCode-eventCode, 例如: fch-2025)
 */
const CustomerRegister = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();

  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || ['', ''];
  const [resolvedIds, setResolvedIds] = useState({
    loading: true,
    error: '',
    organizationId: null,
    eventId: null
  });
  const [eventMeta, setEventMeta] = useState(null);

  useEffect(() => {
    const run = async () => {
      if (!orgCode || !eventCode) {
        setResolvedIds({
          loading: false,
          error: '无效的活动链接（缺少 orgCode-eventCode）',
          organizationId: null,
          eventId: null
        });
        return;
      }

      try {
        setResolvedIds(prev => ({ ...prev, loading: true, error: '' }));

        const resp = await safeFetch('/api/resolveOrgEventHttp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgCode, eventCode })
        });

        const text = await resp.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch (_) {
          data = null;
        }

        if (!resp.ok || !data?.success) {
          const msg = data?.error?.message || '无法解析组织/活动信息，请稍后重试';
          setResolvedIds({
            loading: false,
            error: msg,
            organizationId: null,
            eventId: null
          });
          return;
        }

        setResolvedIds({
          loading: false,
          error: '',
          organizationId: data.organizationId,
          eventId: data.eventId
        });
        setEventMeta(data.event || null);
      } catch (e) {
        setResolvedIds({
          loading: false,
          error: e?.message || '网络错误，请检查连接后重试',
          organizationId: null,
          eventId: null
        });
      }
    };

    run();
  }, [orgCode, eventCode]);

  useEffect(() => {
    syncErudaVisibility(Boolean(eventMeta?.erudaSettings?.enabled));

    return () => {
      syncErudaVisibility(false);
    };
  }, [eventMeta?.erudaSettings?.enabled]);

  // 表单数据
  const [formData, setFormData] = useState({
    phoneNumber: '',
    englishName: '',
    chineseName: '',
    email: '',
    transactionPin: '',
    confirmPin: ''
  });

  // 步骤控制
  const [currentStep, setCurrentStep] = useState(1); // 1=基本信息, 2=OTP验证, 3=设置交易密码

  // OTP相关状态
  const [otp, setOtp] = useState('');
  const [otpSessionId, setOtpSessionId] = useState('');
  const [otpTimer, setOtpTimer] = useState(0);
  const [otpLoading, setOtpLoading] = useState(false);

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // 验证手机号
  const validatePhone = (phone) => {
    const phoneRegex = /^(\+?60|0)?1\d{8,9}$/;
    return phoneRegex.test(phone.replace(/[\s-]/g, ''));
  };

  // 格式化手机号为+60格式
  const formatPhoneNumber = (phone) => {
    let cleaned = phone.replace(/[\s-()]/g, '');

    if (cleaned.startsWith('+60')) {
      return cleaned;
    } else if (cleaned.startsWith('60')) {
      return '+' + cleaned;
    } else if (cleaned.startsWith('0')) {
      return '+60' + cleaned.substring(1);
    } else if (cleaned.startsWith('1')) {
      return '+60' + cleaned;
    }

    return '+60' + cleaned;
  };

  // 处理输入变化
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));

    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
  };

  // 验证步骤1（基本信息）
  const validateStep1 = () => {
    const newErrors = {};

    if (!formData.phoneNumber) {
      newErrors.phoneNumber = '请输入手机号';
    } else if (!validatePhone(formData.phoneNumber)) {
      newErrors.phoneNumber = '手机号格式不正确';
    }

    if (!formData.englishName) {
      newErrors.englishName = '请输入英文名称';
    } else if (!/^[a-zA-Z0-9 ]+$/.test(formData.englishName)) {
      newErrors.englishName = '只允许输入英文字母和数字';
    } else if (formData.englishName.trim().length < 2) {
      newErrors.englishName = '英文名称至少2个字符';
    } else if (formData.englishName.length > 30) {
      newErrors.englishName = '英文名称不能超过30个字符';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = '邮箱格式不正确';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 验证步骤3（交易密码）
  const validateStep3 = () => {
    const newErrors = {};

    if (!formData.transactionPin) {
      newErrors.transactionPin = '请输入交易密码';
    } else if (!/^\d{6}$/.test(formData.transactionPin)) {
      newErrors.transactionPin = '交易密码必须是6位数字';
    } else {
      const weakPins = ['000000', '111111', '222222', '333333', '444444',
        '555555', '666666', '777777', '888888', '999999',
        '123456', '654321', '123123'];
      
      if (weakPins.includes(formData.transactionPin)) {
        newErrors.transactionPin = '请使用更安全的密码组合';
      } else {
        const digits = formData.transactionPin.split('').map(Number);
        let isAscending = true;
        let isDescending = true;
        for (let i = 1; i < digits.length; i++) {
          if (digits[i] !== digits[i - 1] + 1) isAscending = false;
          if (digits[i] !== digits[i - 1] - 1) isDescending = false;
        }
        if (isAscending || isDescending) {
          newErrors.transactionPin = '请不要使用连续数字';
        }
      }
    }

    if (!formData.confirmPin) {
      newErrors.confirmPin = '请确认交易密码';
    } else if (formData.transactionPin !== formData.confirmPin) {
      newErrors.confirmPin = '两次输入的交易密码不一致';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 发送OTP
  const sendOtp = async () => {
    try {
      console.log('[CustomerRegister] 发送 OTP 到:', formData.phoneNumber);

      const sendPayload = {
        phoneNumber: formData.phoneNumber,
        orgCode: orgCode.toLowerCase(),
        eventCode: eventCode,
        scenario: 'customerRegister'
      };

      console.log('[CustomerRegister] sendOtp 请求体:', sendPayload);

      const resp = await safeFetch('/api/sendOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sendPayload)
      });

      console.log('[CustomerRegister] sendOtp 响应状态:', {
        status: resp.status,
        ok: resp.ok,
        aborted: resp.aborted
      });

      if (resp.status === 0 || resp.aborted) {
        throw new Error('网络请求被中断，请检查网络连接后重试');
      }

      let data = null;
      try {
        const responseText = await resp.text();
        console.log('[CustomerRegister] sendOtp 原始响应:', responseText.slice(0, 500));
        
        if (responseText) {
          data = JSON.parse(responseText);
        }
      } catch (parseError) {
        console.error('[CustomerRegister] sendOtp 响应解析失败:', parseError);
        throw new Error('服务器返回无效的响应格式');
      }

      console.log('[CustomerRegister] sendOtp 解析后的数据:', {
        success: data?.success,
        hasSessionId: !!data?.sessionId,
        hasError: !!data?.error
      });

      if (!resp.ok || !data?.success) {
        throw new Error(data?.error?.message || '发送 OTP 失败');
      }

      console.log('[CustomerRegister] ✅ OTP 已发送');

      if (data?.sessionId) {
        setOtpSessionId(String(data.sessionId));
        console.log('[CustomerRegister] ✓ sessionId 已保存:', data.sessionId.slice(0, 20) + '...');
      } else {
        console.warn('[CustomerRegister] ⚠️ 响应中缺少 sessionId');
      }

      setOtpTimer(data.expiresIn || 300);
      startOtpTimer();

      if (data?.devMode && data?.testOtp) {
        console.log('[CustomerRegister] DEV 模式：自动填入测试 OTP', data.testOtp);
        setOtp(String(data.testOtp));
      }

    } catch (error) {
      console.error('[CustomerRegister] 发送 OTP 错误:', {
        message: error.message,
        stack: error.stack
      });
      throw new Error(error.message || '发送验证码失败，请重试');
    }
  };

  // OTP 倒计时
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

  // 验证OTP
  const verifyOtp = async () => {
    try {
      if (!otp || otp.length !== 6) {
        throw new Error('请输入6位验证码');
      }

      console.log('[CustomerRegister] 开始验证 OTP', {
        otpLength: otp.length,
        sessionId: otpSessionId ? '✓ 已设置' : '✗ 未设置',
        phoneNumber: formData.phoneNumber ? '✓ 已设置' : '✗ 未设置'
      });

      // 构建验证请求
      const verifyPayload = {
        otp: otp
      };

      // 优先使用 sessionId，备用方案是 phoneNumber
      if (otpSessionId) {
        console.log('[CustomerRegister] 使用 sessionId 验证');
        verifyPayload.sessionId = otpSessionId;
      } else if (formData.phoneNumber && orgCode && eventCode) {
        console.log('[CustomerRegister] sessionId 不存在，使用备用方案 (phoneNumber)');
        verifyPayload.phoneNumber = formData.phoneNumber;
        verifyPayload.orgCode = orgCode;
        verifyPayload.eventCode = eventCode;
      } else {
        throw new Error('验证条件不足：缺少 sessionId 和必要的备用信息');
      }

      console.log('[CustomerRegister] 发送验证请求到 /api/verifyOtpHttp');

      const resp = await safeFetch('/api/verifyOtpHttp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyPayload)
      });

      console.log('[CustomerRegister] 收到响应', {
        status: resp.status,
        ok: resp.ok,
        contentType: resp.headers?.get?.('content-type') || 'unknown'
      });

      // 处理可能的网络中断
      if (resp.status === 0 || resp.aborted) {
        throw new Error('网络请求被中断或超时，请检查网络连接后重试');
      }

      let data = null;
      try {
        const responseText = await resp.text();
        console.log('[CustomerRegister] 原始响应:', responseText.slice(0, 500));
        
        if (responseText) {
          data = JSON.parse(responseText);
        }
      } catch (parseError) {
        console.error('[CustomerRegister] 响应解析失败:', parseError);
        throw new Error(`服务器返回无效的响应格式`);
      }

      console.log('[CustomerRegister] 解析后的数据:', {
        success: data?.success,
        verified: data?.verified,
        hasError: !!data?.error,
        errorCode: data?.error?.code,
        errorMessage: data?.error?.message
      });

      if (!resp.ok) {
        const errorMsg = data?.error?.message || `HTTP ${resp.status}: OTP 验证失败`;
        throw new Error(errorMsg);
      }

      if (!data?.success && !data?.verified) {
        throw new Error(data?.error?.message || 'OTP 验证失败');
      }

      console.log('[CustomerRegister] ✅ OTP 验证成功');
      return true;

    } catch (error) {
      console.error('[CustomerRegister] OTP 验证错误:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      throw error;
    }
  };

  // 步骤1：提交基本信息并发送OTP
  const handleStep1Submit = async (e) => {
    e.preventDefault();

    if (!resolvedIds.organizationId || !resolvedIds.eventId) {
      window.mybazaarShowToast(resolvedIds.error || '缺少必要的活动信息');
      return;
    }

    if (!validateStep1()) {
      return;
    }

    setLoading(true);

    try {
      await sendOtp();
      setCurrentStep(2);
      setOtp('');
    } catch (error) {
      window.mybazaarShowToast(error.message || '发送验证码失败');
    } finally {
      setLoading(false);
    }
  };

  // 步骤2：验证OTP
  const handleStep2Submit = async (e) => {
    e.preventDefault();

    console.log('[handleStep2Submit] 表单提交事件触发', {
      otpValue: otp,
      otpLength: otp?.length || 0,
      otpLoading,
      buttonDisabledCondition: `otpLoading=${otpLoading} OR otp.length !== 6 (${otp?.length} !== 6)`
    });

    if (!otp || otp.length !== 6) {
      const msg = `❌ OTP长度不足：${otp?.length || 0}/6`;
      console.warn('[handleStep2Submit] 验证失败:', msg);
      window.mybazaarShowToast?.(msg);
      return;
    }

    setOtpLoading(true);

    try {
      console.log('[handleStep2Submit] 开始验证 OTP');
      await verifyOtp();
      console.log('[handleStep2Submit] ✅ OTP 验证成功，跳转到步骤3');
      setCurrentStep(3);
    } catch (error) {
      const errorMsg = error?.message || 'OTP验证失败，请重试';
      console.error('[handleStep2Submit] 捕获到错误:', errorMsg);
      window.mybazaarShowToast?.(errorMsg);
    } finally {
      setOtpLoading(false);
    }
  };

  // 步骤3：设置交易密码并完成注册
  const handleStep3Submit = async (e) => {
    e.preventDefault();

    if (!validateStep3()) {
      return;
    }

    setLoading(true);

    try {
      const createCustomer = httpsCallable(functions, 'createCustomer');
      const normalizedPhoneNumber = formatPhoneNumber(formData.phoneNumber);

      const result = await createCustomer({
        organizationId: resolvedIds.organizationId,
        eventId: resolvedIds.eventId,
        phoneNumber: normalizedPhoneNumber,
        englishName: formData.englishName.trim(),
        chineseName: formData.chineseName.trim() || null,
        transactionPin: formData.transactionPin,
        email: formData.email.trim() || null
      });

      console.log('[CustomerRegister] 注册成功:', result.data);

      const resultData = result?.data || {};

      try {
        if (!resultData.customToken) {
          throw new Error('未收到自动登录凭证');
        }

        await signInWithCustomToken(auth, resultData.customToken);
        await auth.currentUser?.getIdToken(true);

        const customerSession = {
          userId: resultData.userId,
          organizationId: resolvedIds.organizationId,
          eventId: resolvedIds.eventId,
          roles: ['customer'],
          selectedRole: 'customer',
          englishName: formData.englishName.trim(),
          chineseName: formData.chineseName.trim() || '',
          phoneNumber: normalizedPhoneNumber,
          identityTag: 'external',
          orgCode,
          eventCode,
          orgEventCode,
          lastLogin: new Date().toISOString()
        };

        localStorage.setItem('currentUser', JSON.stringify(customerSession));
        localStorage.setItem('customerInfo', JSON.stringify(customerSession));

        window.mybazaarShowToast('✅ 注册成功！正在进入顾客主页');

        setTimeout(() => {
          navigate(`/customer/${orgEventCode}/dashboard`, { replace: true });
        }, 800);
      } catch (autoLoginError) {
        console.error('[CustomerRegister] 自动登录失败:', autoLoginError);
        window.mybazaarShowToast('✅ 注册成功，但自动登录失败，请重新登录');

        setTimeout(() => {
          navigate(`/login/${orgEventCode}`, { replace: true });
        }, 1500);
      }

    } catch (error) {
      console.error('[CustomerRegister] 注册失败:', error);

      let errorMessage = '注册失败，请重试';

      if (error.code === 'already-exists') {
        errorMessage = '该手机号已注册，请直接登录';
      } else if (error.message) {
        errorMessage = error.message;
      }

      window.mybazaarShowToast(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 重新发送OTP
  const handleResendOtp = async () => {
    try {
      console.log('[handleResendOtp] 用户请求重新发送 OTP');
      setOtpLoading(true);
      await sendOtp();
      setOtp('');
      window.mybazaarShowToast?.('✅ 验证码已重新发送');
    } catch (error) {
      const errorMsg = error?.message || '发送失败，请重试';
      console.error('[handleResendOtp] 错误:', errorMsg);
      window.mybazaarShowToast?.(errorMsg);
    } finally {
      setOtpLoading(false);
    }
  };

  // 返回上一步
  const handleBackStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setErrors({});
    }
  };

  // 跳转到登录页面
  const handleGoToLogin = () => {
    navigate(`/login/${orgEventCode}`);
  };

  // ========== UI渲染 ==========

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Logo和标题 */}
        <div style={styles.header}>
          <div style={styles.logo}>🎪</div>
          <h1 style={styles.title}>MyBazaar</h1>
          <h2 style={styles.subtitle}>Customer会员注册</h2>
          
          {/* 步骤指示器 */}
          <div style={styles.stepIndicator}>
            <div style={{
              ...styles.step,
              ...(currentStep >= 1 ? styles.stepActive : {})
            }}>
              <span>1</span>
              <small>基本信息</small>
            </div>
            <div style={styles.stepLine}></div>
            <div style={{
              ...styles.step,
              ...(currentStep >= 2 ? styles.stepActive : {})
            }}>
              <span>2</span>
              <small>验证手机</small>
            </div>
            <div style={styles.stepLine}></div>
            <div style={{
              ...styles.step,
              ...(currentStep >= 3 ? styles.stepActive : {})
            }}>
              <span>3</span>
              <small>设置密码</small>
            </div>
          </div>
        </div>

        {/* 活动信息加载中 */}
        {resolvedIds.loading && (
          <div style={styles.loadingBox}>
            正在载入活动信息...
          </div>
        )}

        {/* 活动信息错误 */}
        {!!resolvedIds.error && !resolvedIds.loading && (
          <div style={styles.errorBox}>
            ⚠️ {resolvedIds.error}
          </div>
        )}

        {/* 步骤1：基本信息 */}
        {currentStep === 1 && !resolvedIds.loading && !resolvedIds.error && (
          <form onSubmit={handleStep1Submit} style={styles.form}>
            <div style={styles.formGroup}>
              <label style={styles.label}>
                手机号 <span style={styles.required}>*</span>
              </label>
              <input
                type="tel"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="60123456789"
                style={{
                  ...styles.input,
                  ...(errors.phoneNumber ? styles.inputError : {})
                }}
                disabled={loading}
              />
              {errors.phoneNumber && (
                <p style={styles.errorText}>{errors.phoneNumber}</p>
              )}
              <p style={styles.hint}>马来西亚手机号</p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                英文名称 <span style={styles.required}>*</span>
              </label>
              <input
                type="text"
                name="englishName"
                value={formData.englishName}
                onChange={(e) => {
                  const filtered = e.target.value.replace(/[^a-zA-Z0-9 ]/g, '');
                  setFormData(prev => ({ ...prev, englishName: filtered }));
                  if (errors.englishName) setErrors(prev => ({ ...prev, englishName: '' }));
                }}
                placeholder="John Doe"
                style={{
                  ...styles.input,
                  ...(errors.englishName ? styles.inputError : {})
                }}
                disabled={loading}
                maxLength={30}
              />
              {errors.englishName && (
                <p style={styles.errorText}>{errors.englishName}</p>
              )}
              <p style={styles.hint}>只允许输入英文字母和数字</p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>中文名称</label>
              <input
                type="text"
                name="chineseName"
                value={formData.chineseName}
                onChange={handleChange}
                placeholder="张三（可选）"
                style={styles.input}
                disabled={loading}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>邮箱（可选）</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="example@email.com"
                style={{
                  ...styles.input,
                  ...(errors.email ? styles.inputError : {})
                }}
                disabled={loading}
              />
              {errors.email && (
                <p style={styles.errorText}>{errors.email}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '发送中...' : '下一步：获取验证码'}
            </button>

            <div style={styles.footer}>
              <p style={styles.footerText}>
                已有账号？
                <button onClick={handleGoToLogin} style={styles.linkButton}>
                  立即登录
                </button>
              </p>
            </div>
          </form>
        )}

        {/* 步骤2：OTP验证 */}
        {currentStep === 2 && (
          <form onSubmit={handleStep2Submit} style={styles.form}>
            <div style={styles.otpInfo}>
              <p style={styles.otpTitle}>📱 验证码已发送</p>
              <p style={styles.otpSubtitle}>
                已发送至 {formData.phoneNumber}
              </p>
            </div>

            <div style={styles.otpContainer}>
              <OTPInput
                value={otp}
                onChange={(otpCode) => {
                  console.log('[CustomerRegister] OTPInput onChange:', otpCode);
                  setOtp(otpCode);
                }}
                onComplete={(otpCode) => {
                  console.log('[CustomerRegister] OTPInput onComplete 回调:', otpCode);
                  setOtp(otpCode);
                }}
                onResend={handleResendOtp}
                expiresIn={otpTimer}
                loading={otpLoading}
              />
            </div>

            {otpTimer > 0 && (
              <p style={styles.timerText}>
                {Math.floor(otpTimer / 60)}:{String(otpTimer % 60).padStart(2, '0')} 后可重新发送
              </p>
            )}

            {otpTimer === 0 && (
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={otpLoading}
                style={styles.resendButton}
              >
                重新发送验证码
              </button>
            )}

            <button
              type="submit"
              disabled={otpLoading || otp.length !== 6}
              style={{
                ...styles.submitButton,
                ...(otpLoading || otp.length !== 6 ? styles.buttonDisabled : {})
              }}
            >
              {otpLoading ? '验证中...' : '下一步'}
            </button>

            <button
              type="button"
              onClick={handleBackStep}
              style={styles.backButton}
            >
              ← 返回上一步
            </button>
          </form>
        )}

        {/* 步骤3：设置交易密码 */}
        {currentStep === 3 && (
          <form onSubmit={handleStep3Submit} style={styles.form}>
            <div style={styles.successInfo}>
              <p>✅ 手机号验证成功！</p>
              <p>现在设置您的交易密码</p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                交易密码 <span style={styles.required}>*</span>
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                name="transactionPin"
                value={formData.transactionPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setFormData(prev => ({ ...prev, transactionPin: value }));
                  if (errors.transactionPin) {
                    setErrors(prev => ({ ...prev, transactionPin: '' }));
                  }
                }}
                placeholder="请输入6位数字"
                maxLength="6"
                style={{
                  ...styles.input,
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  textAlign: 'center',
                  ...(errors.transactionPin ? styles.inputError : {})
                }}
                disabled={loading}
              />
              {errors.transactionPin && (
                <p style={styles.errorText}>{errors.transactionPin}</p>
              )}
              <p style={styles.hint}>用于点数转账和支付验证</p>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                确认交易密码 <span style={styles.required}>*</span>
              </label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                name="confirmPin"
                value={formData.confirmPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 6);
                  setFormData(prev => ({ ...prev, confirmPin: value }));
                  if (errors.confirmPin) {
                    setErrors(prev => ({ ...prev, confirmPin: '' }));
                  }
                }}
                placeholder="请再次输入6位数字"
                maxLength="6"
                style={{
                  ...styles.input,
                  fontSize: '1.5rem',
                  letterSpacing: '0.5rem',
                  textAlign: 'center',
                  ...(errors.confirmPin ? styles.inputError : {})
                }}
                disabled={loading}
              />
              {errors.confirmPin && (
                <p style={styles.errorText}>{errors.confirmPin}</p>
              )}
            </div>

            <div style={styles.pinHint}>
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: '600' }}>
                💡 交易密码用途
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.5rem', fontSize: '0.85rem' }}>
                <li>购买点数时验证</li>
                <li>支付给商家时验证</li>
                <li>转让点数给他人时验证</li>
                <li>请勿使用简单密码（如 123456）</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                ...styles.submitButton,
                ...(loading ? styles.buttonDisabled : {})
              }}
            >
              {loading ? '注册中...' : '完成注册'}
            </button>

            <button
              type="button"
              onClick={handleBackStep}
              style={styles.backButton}
            >
              ← 返回上一步
            </button>
          </form>
        )}

        {/* 使用条款 */}
        {!resolvedIds.loading && !resolvedIds.error && (
          <div style={styles.terms}>
            <p style={styles.termsText}>
              注册即表示您同意MyBazaar的
              <a href="/terms" style={styles.link}>使用条款</a>
              和
              <a href="/privacy" style={styles.link}>隐私政策</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

// ========== 样式 ==========

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '2rem 1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  card: {
    width: '100%',
    maxWidth: '500px',
    backgroundColor: '#fff',
    borderRadius: '12px',
    padding: '2rem',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  logo: {
    fontSize: '3rem',
    marginBottom: '0.5rem'
  },
  title: {
    fontSize: '1.8rem',
    fontWeight: '700',
    color: '#2196F3',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '1.1rem',
    fontWeight: '500',
    color: '#666',
    margin: '0 0 1.5rem 0'
  },
  stepIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '1.5rem'
  },
  step: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem'
  },
  stepActive: {
    color: '#2196F3',
    fontWeight: '600'
  },
  stepLine: {
    width: '40px',
    height: '2px',
    backgroundColor: '#ddd'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#333'
  },
  required: {
    color: '#f44336'
  },
  input: {
    padding: '0.75rem 1rem',
    fontSize: '1rem',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    transition: 'all 0.2s'
  },
  inputError: {
    borderColor: '#f44336'
  },
  errorText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#f44336'
  },
  hint: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#999'
  },
  loadingBox: {
    padding: '0.75rem 1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px',
    fontSize: '0.9rem',
    color: '#666',
    textAlign: 'center'
  },
  errorBox: {
    padding: '0.75rem 1rem',
    backgroundColor: '#fee',
    borderRadius: '8px',
    fontSize: '0.9rem',
    color: '#c33',
    textAlign: 'center'
  },
  otpInfo: {
    textAlign: 'center',
    padding: '1rem',
    backgroundColor: '#f0f9ff',
    borderRadius: '8px',
    marginBottom: '0.5rem'
  },
  otpContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    transform: 'scale(0.75)',
    transformOrigin: 'center top'
  },
  otpTitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1976d2'
  },
  otpSubtitle: {
    margin: 0,
    fontSize: '0.9rem',
    color: '#666'
  },
  timerText: {
    textAlign: 'center',
    fontSize: '0.85rem',
    color: '#666',
    margin: '0.5rem 0'
  },
  resendButton: {
    padding: '0.5rem',
    fontSize: '0.9rem',
    color: '#2196F3',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  successInfo: {
    textAlign: 'center',
    padding: '1rem',
    backgroundColor: '#e8f5e9',
    borderRadius: '8px',
    color: '#2e7d32',
    marginBottom: '0.5rem'
  },
  pinHint: {
    padding: '1rem',
    backgroundColor: '#e3f2fd',
    borderRadius: '8px',
    borderLeft: '4px solid #2196F3',
    color: '#666'
  },
  submitButton: {
    marginTop: '0.5rem',
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: '600',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  backButton: {
    padding: '0.75rem',
    fontSize: '0.9rem',
    color: '#666',
    backgroundColor: '#f5f5f5',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  footer: {
    marginTop: '1rem',
    textAlign: 'center'
  },
  footerText: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  linkButton: {
    marginLeft: '0.5rem',
    padding: '0',
    fontSize: '0.9rem',
    fontWeight: '600',
    color: '#2196F3',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    textDecoration: 'underline'
  },
  terms: {
    marginTop: '1.5rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  termsText: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#666',
    textAlign: 'center'
  },
  link: {
    color: '#2196F3',
    textDecoration: 'none'
  }
};

export default CustomerRegister;