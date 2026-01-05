import { useState, useRef, useEffect } from 'react';

/**
 * OTP输入组件
 * 
 * 功能：
 * - 6位数字输入
 * - 自动聚焦下一个输入框
 * - 粘贴支持
 * - 倒计时显示
 * 
 * @param {Object} props
 * @param {Function} props.onComplete - OTP输入完成回调
 * @param {Function} props.onResend - 重新发送OTP回调
 * @param {number} props.expiresIn - 过期时间（秒）
 * @param {boolean} props.loading - 加载状态
 */
const OTPInput = ({ onComplete, onResend, expiresIn = 300, loading = false }) => {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timeLeft, setTimeLeft] = useState(expiresIn);
  const inputRefs = useRef([]);

  // 倒计时
  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // 格式化时间显示
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // 处理输入
  const handleChange = (index, value) => {
    // 只允许数字
    if (value && !/^\d$/.test(value)) return;

    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);

    // 自动聚焦下一个输入框
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // 如果全部输入完成
    if (newOtp.every((digit) => digit !== '')) {
      const otpCode = newOtp.join('');
      onComplete(otpCode);
    }
  };

  // 处理键盘事件
  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace') {
      if (!otp[index] && index > 0) {
        // 如果当前框为空，删除前一个
        const newOtp = [...otp];
        newOtp[index - 1] = '';
        setOtp(newOtp);
        inputRefs.current[index - 1]?.focus();
      } else {
        // 删除当前
        const newOtp = [...otp];
        newOtp[index] = '';
        setOtp(newOtp);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  // 处理粘贴
  const handlePaste = (e) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain').trim();
    
    // 只允许6位数字
    if (!/^\d{6}$/.test(pastedData)) return;

    const newOtp = pastedData.split('');
    setOtp(newOtp);
    
    // 聚焦最后一个输入框
    inputRefs.current[5]?.focus();
    
    // 自动提交
    onComplete(pastedData);
  };

  // 重置
  const handleReset = () => {
    setOtp(['', '', '', '', '', '']);
    setTimeLeft(expiresIn);
    inputRefs.current[0]?.focus();
  };

  // 重新发送
  const handleResend = async () => {
    handleReset();
    if (onResend) {
      await onResend();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>输入验证码</h3>
        <p style={styles.subtitle}>
          {timeLeft > 0 ? (
            <>验证码有效期：<span style={styles.timer}>{formatTime(timeLeft)}</span></>
          ) : (
            <span style={styles.expired}>验证码已过期</span>
          )}
        </p>
      </div>

      <div style={styles.inputContainer} onPaste={handlePaste}>
        {otp.map((digit, index) => (
          <input
            key={index}
            ref={(el) => (inputRefs.current[index] = el)}
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            disabled={loading || timeLeft === 0}
            style={{
              ...styles.input,
              ...(digit ? styles.inputFilled : {}),
              ...(loading ? styles.inputDisabled : {})
            }}
            autoFocus={index === 0}
          />
        ))}
      </div>

      <div style={styles.actions}>
        {timeLeft === 0 ? (
          <button
            onClick={handleResend}
            disabled={loading}
            style={{
              ...styles.resendButton,
              ...(loading ? styles.buttonDisabled : {})
            }}
          >
            {loading ? '发送中...' : '重新发送验证码'}
          </button>
        ) : (
          <button
            onClick={handleResend}
            disabled={loading || timeLeft > 240}
            style={{
              ...styles.resendButton,
              ...((loading || timeLeft > 240) ? styles.buttonDisabled : {})
            }}
          >
            {loading ? '发送中...' : 
             timeLeft > 240 ? `${Math.ceil((timeLeft - 240) / 60)}分钟后可重发` : 
             '重新发送'}
          </button>
        )}
      </div>

      <div style={styles.tips}>
        <p style={styles.tipText}>💡 提示：</p>
        <ul style={styles.tipList}>
          <li>验证码已发送到您的手机</li>
          <li>支持直接粘贴6位验证码</li>
          <li>未收到？请检查手机信号或稍后重试</li>
        </ul>
      </div>

      {loading && (
        <div style={styles.loadingOverlay}>
          <div style={styles.spinner}></div>
          <p style={styles.loadingText}>验证中...</p>
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    padding: '2rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    maxWidth: '500px',
    margin: '0 auto',
    position: 'relative'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '0.5rem'
  },
  subtitle: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  timer: {
    fontWeight: '600',
    color: '#4CAF50'
  },
  expired: {
    color: '#f44336',
    fontWeight: '600'
  },
  inputContainer: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.75rem',
    marginBottom: '1.5rem'
  },
  input: {
    width: '50px',
    height: '60px',
    fontSize: '1.5rem',
    textAlign: 'center',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    transition: 'all 0.2s',
    fontWeight: '600',
    backgroundColor: '#fff'
  },
  inputFilled: {
    borderColor: '#4CAF50',
    backgroundColor: '#f1f8f4'
  },
  inputDisabled: {
    backgroundColor: '#f5f5f5',
    cursor: 'not-allowed',
    opacity: 0.6
  },
  actions: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  resendButton: {
    padding: '0.75rem 1.5rem',
    fontSize: '0.9rem',
    backgroundColor: '#fff',
    color: '#2196F3',
    border: '1px solid #2196F3',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontWeight: '500'
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
    borderColor: '#ccc',
    color: '#999'
  },
  tips: {
    backgroundColor: '#f8f9fa',
    padding: '1rem',
    borderRadius: '8px',
    fontSize: '0.85rem'
  },
  tipText: {
    margin: '0 0 0.5rem 0',
    fontWeight: '600',
    color: '#666'
  },
  tipList: {
    margin: 0,
    paddingLeft: '1.5rem',
    color: '#666'
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #2196F3',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    marginTop: '1rem',
    color: '#666',
    fontSize: '0.9rem'
  }
};

// 添加旋转动画
const styleSheet = document.styleSheets[0];
const keyframes = `
@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;
styleSheet.insertRule(keyframes, styleSheet.cssRules.length);

export default OTPInput;
