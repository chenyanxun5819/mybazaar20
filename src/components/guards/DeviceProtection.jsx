import { useState, useEffect } from 'react';

// 設備檢測 Hook
export const useDeviceDetect = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      // 主要：基于 User Agent 判断
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      const isMobileUA = mobileRegex.test(userAgent);
      
      // 次要：如果 UA 不是手机，但屏幕太小，才判定为手机
      // （这样可以避免桌机上缩小窗口被误判）
      let isMobileScreen = false;
      if (!isMobileUA && window.innerWidth <= 600) {
        // 严格的屏幕宽度检查：只有非常小的窗口才被认为是移动设备
        // （避免在桌机上打开小窗口就被判定为手机）
        isMobileScreen = true;
      }
      
      const finalIsMobile = isMobileUA || isMobileScreen;
      
      // 🔍 詳細的診斷日誌
      console.log('[useDeviceDetect] 設備檢測結果:', {
        userAgent: userAgent.slice(0, 100) + '...',
        isMobileUA,
        windowWidth: window.innerWidth,
        isMobileScreen,
        finalIsMobile
      });
      
      setIsMobile(finalIsMobile);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return isMobile;
};

// 设备警告组件
const DeviceWarning = ({ requiredDevice }) => {
  const isMobileRequired = requiredDevice === 'mobile';
  
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icon}>⚠️</div>
        <h1 style={styles.title}>设备不符</h1>
        <p style={styles.message}>
          {isMobileRequired 
            ? '此页面仅供移动设备浏览\n请使用手机或平板访问'
            : '此页面仅供桌面电脑浏览\n请使用电脑访问此页面'
          }
        </p>
        <div style={styles.info}>
          <p style={styles.infoText}>
            {isMobileRequired 
              ? '📱 请使用手机扫描 QR Code 或直接在手机浏览器中打开此链接'
              : '🖥️ 请在桌面电脑上打开此链接以访问管理界面'
            }
          </p>
        </div>
      </div>
    </div>
  );
};

// Mobile 路由守衛
export const MobileGuard = ({ children }) => {
  const isMobile = useDeviceDetect();
  
  return isMobile ? children : <DeviceWarning requiredDevice="mobile" />;
};

// Desktop 路由守衛
export const DesktopGuard = ({ children }) => {
  const isMobile = useDeviceDetect();
  
  return !isMobile ? children : <DeviceWarning requiredDevice="desktop" />;
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '20px',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
  },
  card: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '16px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    maxWidth: '500px',
    width: '100%',
    textAlign: 'center'
  },
  icon: {
    fontSize: '64px',
    marginBottom: '20px'
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '16px'
  },
  message: {
    fontSize: '16px',
    color: '#6b7280',
    lineHeight: '1.6',
    marginBottom: '24px',
    whiteSpace: 'pre-line'
  },
  info: {
    backgroundColor: '#f3f4f6',
    padding: '16px',
    borderRadius: '12px',
    borderLeft: '4px solid #667eea'
  },
  infoText: {
    fontSize: '14px',
    color: '#374151',
    margin: 0,
    lineHeight: '1.5'
  }
};

export default DeviceWarning;

