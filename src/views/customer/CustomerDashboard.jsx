import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import { doc, getDoc, collection, query, where, onSnapshot } from 'firebase/firestore';
import { useEvent } from '../../contexts/EventContext';
import { useAuth } from '../../contexts/AuthContext'; // 🆕 导入 useAuth
import QRCodeDisplay from '../../components/QRCodeDisplay';
import { generateCustomerReceivePointsQR } from '../../utils/qrCodeGenerator';
import { safeFetch } from '../../services/safeFetch';
import { Bell, CheckCircle, XCircle } from 'lucide-react';
/**
 * Customer Dashboard 主页
 * 
 * 功能：
 * - 显示余额和统计
 * - 显示个人收款QR Code
 * - 功能导航（付款、转账、充值、记录）
 */
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer


const CustomerDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth(); // 🆕 获取 userProfile
  const { orgCode, eventCode, event, organizationId: eventOrgId, eventId: eventEventId } = useEvent(); // 🆕 获取 event 对象
  const [loading, setLoading] = useState(true);
  const [customerData, setCustomerData] = useState(null);
  const [showQRCode, setShowQRCode] = useState(false);
  // ⭐ 新增：交易通知状态
  const [notification, setNotification] = useState(null);
  const [organizationId, setOrganizationId] = useState(eventOrgId);
  const [eventId, setEventId] = useState(eventEventId);
  const processedTransactionsRef = useRef(new Set());
  const notificationTimeoutRef = useRef(null);

  // EventContext 初始化完成后，同步 organizationId/eventId
  useEffect(() => {
    if (eventOrgId && eventOrgId !== organizationId) setOrganizationId(eventOrgId);
    if (eventEventId && eventEventId !== eventId) setEventId(eventEventId);
  }, [eventOrgId, eventEventId]);

  useEffect(() => {
    loadCustomerData();
  }, [organizationId, eventId]);

  // 加载Customer数据
  const loadCustomerData = async () => {
    try {
      setLoading(true);

      // ✅ 使用 EventContext 提供的 organizationId 和 eventId
      if (!organizationId || !eventId) {
        console.warn('[CustomerDashboard] 等待 EventContext 加载完成...');
        return;
      }

      const user = auth.currentUser;
      if (!user) {
        console.error('[CustomerDashboard] 用户未登录');
        navigate('/universal-login');
        return;
      }

      // 从custom claims获取userId（fallback）
      const tokenResult = await user.getIdTokenResult();
      const { userId } = tokenResult.claims;

      // ✅ 优先使用 claims 中的 userId，回退到 user.uid
      const targetUserId = userId || user.uid;
      console.log('[CustomerDashboard] Loading user data:', {
        organizationId,
        eventId,
        targetUserId,
        authUid: user.uid
      });

      // 尝试直接读取 Firestore
      try {
        const customerRef = doc(
          db,
          'organizations', organizationId,
          'events', eventId,
          'users', targetUserId
        );
        const customerSnap = await getDoc(customerRef);

        if (customerSnap.exists()) {
          const data = customerSnap.data();
          console.log('[CustomerDashboard] Customer数据加载成功 (Firestore):', data);
          setCustomerData({ ...data, organizationId, eventId });
          return;
        } else {
          console.warn('[CustomerDashboard] Firestore 读取失败: 文档不存在，尝试 HTTP 回退...');
        }
      } catch (fsError) {
        console.warn('[CustomerDashboard] Firestore 读取出错，尝试 HTTP 回退:', fsError);
      }

      // 🚀 HTTP 回退机制 (解决 "Customer文档不存在" 或连接问题)
      console.log('[CustomerDashboard] 使用 HTTP 获取数据...');
      const resp = await safeFetch('/api/getCustomerDashboardDataHttp', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${tokenResult.token}`
        }
      });

      if (!resp.ok) {
        const errData = await resp.json();
        throw new Error(errData?.error?.message || '无法获取用户数据');
      }

      const httpData = await resp.json();
      if (httpData.success && httpData.data) {
        console.log('[CustomerDashboard] Customer数据加载成功 (HTTP):', httpData.data);
        setCustomerData({ ...httpData.data, organizationId, eventId });
      } else {
        throw new Error('数据格式错误');
      }

    } catch (error) {
      console.error('[CustomerDashboard] 加载失败:', error);
      window.mybazaarShowToast('加载失败：' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // ⭐ 监听交易状态变化，显示通知
  // ============================================
  useEffect(() => {
    if (!auth.currentUser || !organizationId || !eventId) return;

    const userId = auth.currentUser.uid;

    console.log('🔔 [CustomerDashboard] Setting up transaction listener');

    const transactionsRef = collection(
      db,
      'organizations', organizationId,
      'events', eventId,
      'transactions'
    );

    const q = query(
      transactionsRef,
      where('customerId', '==', userId),
      where('transactionType', '==', 'customer_to_merchant')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          const docId = change.doc.id;
          const data = change.doc.data();

          // 跳过已处理的交易
          if (processedTransactionsRef.current.has(docId)) {
            return;
          }

          // 只处理状态变更为 completed 或 cancelled 的交易
          if (change.type === 'modified') {
            if (data.status === 'completed' || data.status === 'cancelled') {
              processedTransactionsRef.current.add(docId);

              console.log('🔔 [CustomerDashboard] Transaction status changed:', {
                id: docId,
                status: data.status,
                amount: data.amount,
                merchantName: data.merchantName
              });

              showNotification({
                id: docId,
                status: data.status,
                amount: data.amount,
                merchantName: data.merchantName || '商家',
                title: data.merchantName || '商家'
              });
            }
          } else if (change.type === 'added') {
            // 标记已存在的交易，避免初始加载时弹通知
            processedTransactionsRef.current.add(docId);
          }
        });
      },
      (error) => {
        if (error?.name === 'AbortError' || error?.code === 'cancelled') {
          console.log('🔔 [CustomerDashboard] Listener aborted (expected)');
          return;
        }
        console.error('❌ [CustomerDashboard] Error listening to transactions:', error);
      }
    );

    return () => {
      console.log('🔔 [CustomerDashboard] Cleaning up transaction listener');
      unsubscribe();
    };
  }, [organizationId, eventId]);

  // ⭐ 显示通知函数
  const showNotification = (data) => {
    setNotification(data);

    // 5秒后自动消失
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
    }, 5000);
  };

  // ⭐ 点击通知跳转到交易记录
  const handleNotificationClick = () => {
    setNotification(null);
    const fallbackOrg =
      customerData?.organizationCode || customerData?.organizationId?.replace('organization_', '') || '';
    const fallbackEvt = customerData?.eventCode || customerData?.eventId?.replace('event_', '') || '';
    const combined = orgCode && eventCode ? `${orgCode}-${eventCode}` : `${fallbackOrg}-${fallbackEvt}`;
    navigate(`/customer/${combined}/transactions`);
  };


  // 登出
  const handleLogout = async () => {
    if (!confirm('确定要退出登录吗？')) return;

    try {
      await signOut(auth);
      const fallbackOrg =
        customerData?.organizationCode || customerData?.organizationId?.replace('organization_', '') || '';
      const fallbackEvt = customerData?.eventCode || customerData?.eventId?.replace('event_', '') || '';
      const combined = orgCode && eventCode ? `${orgCode}-${eventCode}` : `${fallbackOrg}-${fallbackEvt}`;
      navigate(`/login/${combined}`);
    } catch (error) {
      console.error('[CustomerDashboard] 登出失败:', error);
      window.mybazaarShowToast('登出失败：' + error.message);
    }
  };

  // 刷新数据
  const handleRefresh = () => {
    loadCustomerData();
  };

  // 讓 iOS 在「點擊扫码付款」當下就跳出系統相機授權（避免進入付款頁後再按一次）
  const handleScanPayClick = async () => {
    // 先準備目標路由
    const fallbackOrg =
      customerData?.organizationCode || customerData?.organizationId?.replace('organization_', '') || '';
    const fallbackEvt = customerData?.eventCode || customerData?.eventId?.replace('event_', '') || '';
    const combined = orgCode && eventCode ? `${orgCode}-${eventCode}` : `${fallbackOrg}-${fallbackEvt}`;
    const target = `/customer/${combined}/payment`;

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        // iOS/Chrome(iOS) 需要「使用者手勢」才能觸發相機授權提示。
        // 這裡只用來觸發授權，成功後立刻關閉 stream。
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' }
        });
        stream.getTracks().forEach((t) => t.stop());
      }
    } catch (e) {
      // 若使用者拒絕，仍可導頁，但付款頁將顯示無法開相機並提示開啟權限
      console.warn('[CustomerDashboard] 相机权限预请求失败:', e?.name, e?.message);
    } finally {
      navigate(target);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (!customerData) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <p>❌ 加载失败</p>
          <button onClick={loadCustomerData} style={styles.retryButton}>
            重试
          </button>
        </div>
      </div>
    );
  }

  const pointsAccount = customerData.customer?.pointsAccount || {};
  const stats = customerData.customer?.stats || {};
  // ✅ 修复：从basicInfo读取用户信息
  const displayName = customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName || '未命名';
  const phoneNumber = customerData.basicInfo?.phoneNumber || '';
  // 获取orgEventCode用于导航
  const fallbackOrg = customerData.organizationCode || customerData.organizationId?.replace('organization_', '') || '';
  const fallbackEvt = customerData.eventCode || customerData.eventId?.replace('event_', '') || '';
  const orgEventCode = orgCode && eventCode ? `${orgCode}-${eventCode}` : `${fallbackOrg}-${fallbackEvt}`;

  return (
    
    <div style={styles.container}>
      {/* 🆕 共用 Header 组件（包含角色切换器和登出按钮） */}
      <DashboardHeader
        title="消费者"
        subtitle="Customer Dashboard"
        logoUrl={event?.logoUrl}
        userName={displayName}
        userPhone={phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.[0] || 'customer'}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* ⭐ 交易通知横幅 */}
      {notification && (
        <div
          className="customer-notification-banner"
          onClick={handleNotificationClick}
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: notification.status === 'completed' ? '#10b981' : '#ef4444',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            zIndex: 1000,
            minWidth: '320px',
            maxWidth: '90%'
          }}
        >
          {notification.status === 'completed' ? (
            <CheckCircle size={24} />
          ) : (
            <XCircle size={24} />
          )}
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '16px' }}>
              {notification.title || (notification.status === 'completed' ? '收款成功' : '交易已取消')}
            </p>
            <p style={{ margin: '4px 0 0 0', fontSize: '14px', opacity: 0.9 }}>
              {notification.merchantName} • {notification.amount} 点
            </p>
          </div>
          <Bell size={20} style={{ opacity: 0.7 }} />
        </div>
      )}



      {/* 用户信息卡片 */}
      <div style={styles.userCard}>
        <div style={styles.userInfo}>
          <div style={styles.avatar}>
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 style={styles.userName}>{displayName}</h2>
            <p style={styles.userPhone}>{phoneNumber}</p>
          </div>
        </div>
      </div>

      {/* 余额卡片 */}
      <div style={styles.balanceCard}>
        <div style={styles.balanceHeader}>
          <span style={styles.balanceLabel}>可用点数</span>
          <button
            onClick={() => setShowQRCode(!showQRCode)}
            style={styles.qrButton}
          >
            {showQRCode ? '隐藏QR码' : '显示收点数QR码'}
          </button>
        </div>
        <div style={styles.balanceAmount}>
          <span style={styles.balanceNumber}>{pointsAccount.availablePoints || 0}</span>
          <span style={styles.balanceUnit}>点</span>
        </div>

        {/* 统计信息 */}
        <div style={styles.balanceStats}>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{pointsAccount.totalReceived || 0}</span>
            <span style={styles.statLabel}>累计获得</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{pointsAccount.totalSpent || 0}</span>
            <span style={styles.statLabel}>累计消费</span>
          </div>
          <div style={styles.statDivider}></div>
          <div style={styles.statItem}>
            <span style={styles.statValue}>{stats.transactionCount || 0}</span>
            <span style={styles.statLabel}>交易次数</span>
          </div>
        </div>
      </div>

      {/* 收点数QR Code */}
      {showQRCode && (
        <div style={styles.qrCodeSection}>
          <QRCodeDisplay
            qrData={{
              type: 'CUSTOMER_RECEIVE_POINTS',  // ✅ 改为大写
              v: '1.0',                          // ✅ 添加版本号
              orgId: orgId,                      // ✅ 使用无前缀的orgId
              eventId: evtId,                    // ✅ 使用无前缀的eventId
              customerId: auth.currentUser?.uid, // ✅ 改用customerId
              displayName: displayName,
              phoneNumber: phoneNumber,
              ts: Date.now()                     // ✅ 添加时间戳
            }}
            userName={displayName}
            subtitle="Customer收点数QR Code"
            size="medium"
          />
        </div>
      )}

      {/* 功能菜单 */}
      <div style={styles.menuGrid}>
        {/* 扫码付款 */}
        <button
          onClick={handleScanPayClick}
          style={styles.menuButton}
        >
          <div style={styles.menuIcon}>💳</div>
          <div style={styles.menuText}>
            <div style={styles.menuTitle}>扫码付款</div>
            <div style={styles.menuSubtitle}>扫描商家QR码</div>
          </div>
        </button>

        {/* 点数转让 */}
        <button
          onClick={() => navigate(`/customer/${orgEventCode}/transfer`)}
          style={styles.menuButton}
        >
          <div style={styles.menuIcon}>💸</div>
          <div style={styles.menuText}>
            <div style={styles.menuTitle}>点数转让</div>
            <div style={styles.menuSubtitle}>转给其他会员</div>
          </div>
        </button>

        {/* 点数卡充值 */}
        <button
          onClick={() => navigate(`/customer/${orgEventCode}/topup`)}
          style={styles.menuButton}
        >
          <div style={styles.menuIcon}>🎫</div>
          <div style={styles.menuText}>
            <div style={styles.menuTitle}>点数卡充值</div>
            <div style={styles.menuSubtitle}>扫描点数卡</div>
          </div>
        </button>

        {/* 消费记录 */}
        <button
          onClick={() => navigate(`/customer/${orgEventCode}/transactions`)}
          style={styles.menuButton}
        >
          <div style={styles.menuIcon}>📋</div>
          <div style={styles.menuText}>
            <div style={styles.menuTitle}>消费记录</div>
            <div style={styles.menuSubtitle}>查看交易历史</div>
          </div>
        </button>
      </div>

      {/* 活动统计卡片 */}
      <div style={styles.statsCard}>
        <h3 style={styles.statsTitle}>我的活动</h3>
        <div style={styles.statsGrid}>
          <div style={styles.statsItem}>
            <div style={styles.statsIcon}>🏪</div>
            <div style={styles.statsInfo}>
              <div style={styles.statsValue}>{stats.merchantsVisited?.length || 0}</div>
              <div style={styles.statsLabel}>访问商家</div>
            </div>
          </div>
          <div style={styles.statsItem}>
            <div style={styles.statsIcon}>🎫</div>
            <div style={styles.statsInfo}>
              <div style={styles.statsValue}>{stats.pointCardsRedeemed || 0}</div>
              <div style={styles.statsLabel}>兑换点数卡</div>
            </div>
          </div>
          <div style={styles.statsItem}>
            <div style={styles.statsIcon}>🔄</div>
            <div style={styles.statsInfo}>
              <div style={styles.statsValue}>{stats.transfersSent || 0}</div>
              <div style={styles.statsLabel}>转让次数</div>
            </div>
          </div>
          <div style={styles.statsItem}>
            <div style={styles.statsIcon}>📥</div>
            <div style={styles.statsInfo}>
              <div style={styles.statsValue}>{stats.transfersReceived || 0}</div>
              <div style={styles.statsLabel}>接收转让</div>
            </div>
          </div>
        </div>
      </div>

      {/* 底部提示 */}
      <div style={styles.footer}>
        <p style={styles.footerText}>
          💡 提示：使用"显示收点数QR码"让其他会员扫描向您转账
        </p>
      </div>

      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter 
        event={event}
        eventCode={eventCode}
        showEventInfo={true}
      />
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f5f5f5',
    paddingBottom: '2rem'
  },
  loadingCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f3f3',
    borderTop: '4px solid #2196F3',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  errorCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '1rem'
  },
  retryButton: {
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    backgroundColor: '#2196F3',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    backgroundColor: '#fff',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  logo: {
    fontSize: '2rem'
  },
  appName: {
    fontSize: '1.2rem',
    fontWeight: '700',
    color: '#2196F3',
    margin: 0
  },
  role: {
    fontSize: '0.8rem',
    color: '#666',
    margin: 0
  },
  headerRight: {
    display: 'flex',
    gap: '0.5rem'
  },
  iconButton: {
    width: '40px',
    height: '40px',
    fontSize: '1.2rem',
    backgroundColor: '#f5f5f5',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  userCard: {
    margin: '1rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  avatar: {
    width: '60px',
    height: '60px',
    borderRadius: '50%',
    backgroundColor: '#2196F3',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.8rem',
    fontWeight: '600'
  },
  userName: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.25rem 0'
  },
  userPhone: {
    fontSize: '0.9rem',
    color: '#666',
    margin: 0
  },
  balanceCard: {
    margin: '0 1rem 1rem',
    padding: '1.5rem',
    backgroundColor: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(33,150,243,0.3)',
    color: '#fff'
  },
  balanceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  balanceLabel: {
    fontSize: '0.9rem',
    opacity: 0.9
  },
  qrButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.8rem',
    backgroundColor: 'rgba(255,255,255,0.2)',
    color: '#fff',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '6px',
    cursor: 'pointer'
  },
  balanceAmount: {
    marginBottom: '1.5rem'
  },
  balanceNumber: {
    fontSize: '2.5rem',
    fontWeight: '700',
    marginRight: '0.5rem'
  },
  balanceUnit: {
    fontSize: '1.2rem',
    opacity: 0.9
  },
  balanceStats: {
    display: 'flex',
    justifyContent: 'space-around',
    paddingTop: '1rem',
    borderTop: '1px solid rgba(255,255,255,0.2)'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center'
  },
  statValue: {
    fontSize: '1.2rem',
    fontWeight: '600'
  },
  statLabel: {
    fontSize: '0.8rem',
    opacity: 0.8,
    marginTop: '0.25rem'
  },
  statDivider: {
    width: '1px',
    backgroundColor: 'rgba(255,255,255,0.2)'
  },
  qrCodeSection: {
    margin: '0 1rem 1rem',
    padding: '1rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  menuGrid: {
    margin: '0 1rem 1rem',
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem'
  },
  menuButton: {
    padding: '1.5rem',
    backgroundColor: '#fff',
    border: 'none',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    textAlign: 'left',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  menuIcon: {
    fontSize: '2rem'
  },
  menuText: {
    flex: 1
  },
  menuTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '0.25rem'
  },
  menuSubtitle: {
    fontSize: '0.8rem',
    color: '#999'
  },
  statsCard: {
    margin: '0 1rem 1rem',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  statsTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333',
    marginBottom: '1rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem'
  },
  statsItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  statsIcon: {
    fontSize: '1.5rem'
  },
  statsInfo: {
    flex: 1
  },
  statsValue: {
    display: 'block',
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333'
  },
  statsLabel: {
    display: 'block',
    fontSize: '0.8rem',
    color: '#666',
    marginTop: '0.25rem'
  },
  footer: {
    margin: '0 1rem',
    padding: '1rem',
    backgroundColor: '#fff3cd',
    borderRadius: '8px',
    border: '1px solid #ffc107'
  },
  footerText: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#856404',
    textAlign: 'center'
  }
};

export default CustomerDashboard;

