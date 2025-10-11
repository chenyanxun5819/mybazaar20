import { useState, useEffect } from 'react';

// 設備檢測 Hook
export const useDeviceDetect = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkDevice = () => {
      const userAgent = navigator.userAgent || navigator.vendor || window.opera;
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      const isMobileUA = mobileRegex.test(userAgent);
      const isSmallScreen = window.innerWidth <= 768;
      
      setIsMobile(isMobileUA || isSmallScreen);
    };

    checkDevice();
    window.addEventListener('resize', checkDevice);
    
    return () => window.removeEventListener('resize', checkDevice);
  }, []);

  return isMobile;
};

// 設備警告組件
const DeviceWarning = ({ requiredDevice }) => {
  const isMobileRequired = requiredDevice === 'mobile';
  
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.icon}>⚠️</div>
        <h1 style={styles.title}>設備不符</h1>
        <p style={styles.message}>
          {isMobileRequired 
            ? '此頁面僅供行動裝置瀏覽\n請使用手機或平板訪問'
            : '此頁面僅供桌面電腦瀏覽\n請使用電腦訪問此頁面'
          }
        </p>
        <div style={styles.info}>
          <p style={styles.infoText}>
            {isMobileRequired 
              ? '📱 請使用手機掃描 QR Code 或直接在手機瀏覽器中打開此連結'
              : '🖥️ 請在桌面電腦上打開此連結以訪問管理介面'
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