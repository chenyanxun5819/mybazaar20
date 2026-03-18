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
import ChartHistogramIcon from '../../assets/chart-histogram.svg?react';
import QrScanIcon from '../../assets/qr-scan.svg?react';
import PointsTransferIcon from '../../assets/points-transfer.svg?react';
import MemoCircleCheckIcon from '../../assets/memo-circle-check.svg?react';
import CustomerPayment from './CustomerPayment';
import CustomerTransfer from './CustomerTransfer';
import CustomerTransactions from './CustomerTransactions';

// ⭐ 添加通知横幅动画样式
const notificationStyles = `
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translate(-50%, -20px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

.customer-notification-banner:hover {
  transform: translateX(-50%) scale(1.02) !important;
  box-shadow: 0 12px 24px rgba(0,0,0,0.3) !important;
}

.customer-notification-banner:active {
  transform: translateX(-50%) scale(0.98) !important;
}
`;

const CustomerDashboard = () => {
  const navigate = useNavigate();
  const { userProfile } = useAuth(); // 🆕 获取 userProfile
  const { orgCode, eventCode, event, organizationId: eventOrgId, eventId: eventEventId } = useEvent(); // 🆕 获取 event 对象
  const [loading, setLoading] = useState(true);
  const [customerData, setCustomerData] = useState(null);
  const [showQRCode, setShowQRCode] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  // ⭐ 新增：交易通知状态
  const [notification, setNotification] = useState(null);
  const [organizationId, setOrganizationId] = useState(eventOrgId);
  const [eventId, setEventId] = useState(eventEventId);
  const processedTransactionStatusRef = useRef(new Set());
  const notificationTimeoutRef = useRef(null);
  const isInitialLoadRef = useRef(true);  // ⭐ 新增：标记初始加载

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

    let unsubscribe = () => {};
    let isUnmounted = false;

    const setupTransactionListener = async () => {
      try {
        const tokenResult = await auth.currentUser.getIdTokenResult();
        const targetUserId = tokenResult?.claims?.userId || auth.currentUser.uid;

        if (isUnmounted) return;

        console.log('🔔 [CustomerDashboard] Setting up transaction listener', {
          targetUserId,
          organizationId,
          eventId
        });

        const transactionsRef = collection(
          db,
          'organizations', organizationId,
          'events', eventId,
          'transactions'
        );

        const q = query(
          transactionsRef,
          where('customerId', '==', targetUserId),
          where('transactionType', '==', 'customer_to_merchant')
        );

        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            console.log('🔔 [CustomerDashboard] Snapshot received, isInitialLoad:', isInitialLoadRef.current, 'docs:', snapshot.docs.length);
            
            // ⭐ 初始加载：只标记现有交易，不触发通知
            if (isInitialLoadRef.current) {
              console.log('🔔 [CustomerDashboard] 初始加载 - 标记所有现有交易');
              snapshot.docs.forEach(doc => {
                const data = doc.data();
                if (data.status === 'completed' || data.status === 'cancelled') {
                  processedTransactionStatusRef.current.add(`${doc.id}:${data.status}`);
                }
                console.log('  • 已标记:', doc.id, '| 状态:', data.status, '| 金额:', data.amount);
              });
              isInitialLoadRef.current = false;
              console.log('🔔 [CustomerDashboard] 初始加载完成，已标记', processedTransactionStatusRef.current.size, '笔已完成/已取消交易');
              return;  // ⚠️ 关键：初始加载不继续处理
            }

            // ⭐ 后续更新：正常处理状态变化
            snapshot.docChanges().forEach((change) => {
              const docId = change.doc.id;
              const data = change.doc.data();

              console.log('🔔 [CustomerDashboard] 检测到交易变化', {
                changeType: change.type,
                transactionId: docId,
                status: data.status,
                amount: data.amount,
                merchantName: data.merchantName
              });

              // ⭐ 只处理状态变更（modified）
              if (change.type === 'modified') {
                
                // ⭐ 检查是否是关键状态变化
                if (data.status === 'completed' || data.status === 'cancelled') {
                  
                  // ⭐ 去重检查（按「交易ID + 状态」去重）
                  const processKey = `${docId}:${data.status}`;
                  if (processedTransactionStatusRef.current.has(processKey)) {
                    console.log('🔔 [CustomerDashboard] 交易已处理过，跳过:', docId);
                    return;
                  }

                  processedTransactionStatusRef.current.add(processKey);
                  console.log('✅ [CustomerDashboard] 关键状态变化 -', data.status, '| 交易:', docId);

                  // 处理取消交易的余额回滚
                  if (data.status === 'cancelled') {
                    const cancelledAmount = Number(data.amount) || 0;
                    
                    console.log('🔄 [CustomerDashboard] 回滚余额', {
                      transactionId: docId,
                      cancelledAmount,
                      currentAvailable: customerData?.customer?.pointsAccount?.availablePoints
                    });

                    if (cancelledAmount > 0) {
                      setCustomerData((prev) => {
                        if (!prev) return prev;

                        const available = prev.customer?.pointsAccount?.availablePoints || 0;
                        const totalSpent = prev.customer?.pointsAccount?.totalSpent || 0;
                        const txCount = prev.customer?.stats?.transactionCount || 0;
                        const paymentCount = prev.customer?.stats?.merchantPaymentCount || 0;

                        console.log('  • 当前余额:', {
                          availablePoints: available,
                          totalSpent
                        });

                        const newData = {
                          ...prev,
                          customer: {
                            ...prev.customer,
                            pointsAccount: {
                              ...prev.customer?.pointsAccount,
                              availablePoints: available + cancelledAmount,
                              totalSpent: Math.max(0, totalSpent - cancelledAmount)
                            },
                            stats: {
                              ...prev.customer?.stats,
                              transactionCount: Math.max(0, txCount - 1),
                              merchantPaymentCount: Math.max(0, paymentCount - 1),
                              lastActivityAt: new Date()
                            }
                          }
                        };

                        console.log('  • 更新后余额:', {
                          availablePoints: newData.customer.pointsAccount.availablePoints,
                          totalSpent: newData.customer.pointsAccount.totalSpent
                        });

                        return newData;
                      });

                      // 显示 Toast 提示
                      if (typeof window !== 'undefined' && typeof window.mybazaarShowToast === 'function') {
                        window.mybazaarShowToast(
                          `交易已取消，已退回 ${cancelledAmount} 点`,
                          'info'
                        );
                      }
                    }
                  }

                  // ⭐ 显示通知横幅
                  console.log('🔔 [CustomerDashboard] 准备显示通知');
                  showNotification({
                    id: docId,
                    status: data.status,
                    amount: data.amount,
                    merchantName: data.merchantName || '商家',
                    title: data.status === 'completed' ? '收款成功' : '交易已取消'
                  });
                }
              } 
              // ⭐ 新增交易（added）- 只标记
              else if (change.type === 'added') {
                if (data.status === 'completed' || data.status === 'cancelled') {
                  processedTransactionStatusRef.current.add(`${docId}:${data.status}`);
                }
                console.log('➕ [CustomerDashboard] 新增交易已标记:', docId, '| 状态:', data.status);
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
      } catch (error) {
        console.error('❌ [CustomerDashboard] Setup transaction listener failed:', error);
      }
    };

    setupTransactionListener();

    return () => {
      isUnmounted = true;
      console.log('🔔 [CustomerDashboard] Cleaning up transaction listener');
      unsubscribe();
      
      // ⭐ 清理时重置初始加载标记，以便下次重新初始化
      if (processedTransactionStatusRef.current.size > 0) {
        console.log('🔔 [CustomerDashboard] 保留已处理的交易状态记录:', processedTransactionStatusRef.current.size, '笔');
      }
      isInitialLoadRef.current = true;  // ⭐ 重置初始加载标记
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

  const handlePaymentExit = async () => {
    setActiveTab('overview');
    await loadCustomerData();
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
      {/* ⭐ 注入通知动画样式 */}
      <style>{notificationStyles}</style>
      
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

      {/* ⭐ 交易通知横幅 - 修复版 */}
      {notification && (
        <div
          className="customer-notification-banner"
          onClick={handleNotificationClick}
          style={{
            position: 'fixed',
            top: '80px',  // ⭐ 修复：避免被 Header 遮挡（Header 高度约 60-70px）
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: notification.status === 'completed' ? '#10b981' : '#ef4444',
            color: 'white',
            padding: '16px 24px',
            borderRadius: '12px',
            boxShadow: '0 8px 16px rgba(0,0,0,0.2)',  // ⭐ 增强阴影
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            zIndex: 9999,  // ⭐ 修复：提高到最顶层
            minWidth: '320px',
            maxWidth: '90%',
            animation: 'slideDown 0.3s ease-out',  // ⭐ 添加滑入动画
            border: '2px solid rgba(255,255,255,0.2)',  // ⭐ 添加边框突出显示
            transition: 'all 0.3s ease'
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

      {/* Tab 导航 */}
      <nav className="tab-navigation" style={styles.tabNavigation}>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'overview' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('overview')}
        >
          <ChartHistogramIcon style={{ width: '1.5rem', height: '1.5rem', color: activeTab === 'overview' ? '#2196F3' : '#757575' }} />
          <span style={styles.tabLabel}>总览</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'payment' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('payment')}
        >
          <QrScanIcon style={{ width: '1.5rem', height: '1.5rem', color: activeTab === 'payment' ? '#2196F3' : '#757575' }} />
          <span style={styles.tabLabel}>扫码付款</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'transfer' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('transfer')}
        >
          <PointsTransferIcon style={{ width: '1.5rem', height: '1.5rem', color: activeTab === 'transfer' ? '#2196F3' : '#757575' }} />
          <span style={styles.tabLabel}>点数转让</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'history' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('history')}
        >
          <MemoCircleCheckIcon style={{ width: '1.5rem', height: '1.5rem', color: activeTab === 'history' ? '#2196F3' : '#757575' }} />
          <span style={styles.tabLabel}>消费记录</span>
        </button>
      </nav>

      {/* 主内容区 */}
      <main className="dashboard-content" style={styles.dashboardContent}>
        {/* Overview Tab - 余额卡片 */}
        {activeTab === 'overview' && (
          <>
            <div style={styles.balanceCard}>
              <div style={styles.balanceHeader}>
                <span style={styles.balanceLabel}>💰 我的余额</span>
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
              <div style={{ textAlign: 'center', color: '#757575', fontSize: '0.9rem', marginBottom: '1rem' }}>
                可用于消费
              </div>

              {/* 统计信息 */}
              <div style={styles.balanceStats}>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>累计获得</span>
                  <span style={styles.statValue}>{pointsAccount.totalReceived || 0}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>累计消费</span>
                  <span style={styles.statValue}>{pointsAccount.totalSpent || 0}</span>
                </div>
                <div style={styles.statItem}>
                  <span style={styles.statLabel}>交易次数</span>
                  <span style={styles.statValue}>{stats.transactionCount || 0}</span>
                </div>
              </div>
            </div>


            {/* 活动统计卡片 */}
            <div style={styles.statsCard}>
              <h3 style={styles.statsTitle}>📊 我的活动</h3>
              <div style={styles.statsGrid}>
                <div style={styles.statsItem}>
                  <span style={styles.statLabel}>访问商家</span>
                  <span style={styles.statValue}>{stats.merchantsVisited?.length || 0}</span>
                </div>
                <div style={styles.statsItem}>
                  <span style={styles.statLabel}>转让次数</span>
                  <span style={styles.statValue}>{stats.transfersSent || 0}</span>
                </div>
                <div style={styles.statsItem}>
                  <span style={styles.statLabel}>接收转让</span>
                  <span style={styles.statValue}>{stats.transfersReceived || 0}</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Payment Tab */}
        {activeTab === 'payment' && (
          <CustomerPayment
            embedded={true}
            orgEventCode={orgEventCode}
            onBack={handlePaymentExit}
          />
        )}

        {/* Transfer Tab */}
        {activeTab === 'transfer' && (
          <CustomerTransfer />
        )}

        {/* History Tab */}
        {activeTab === 'history' && (
          <CustomerTransactions />
        )}
      </main>

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
  tabNavigation: {
    display: 'flex',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    overflowX: 'auto',
    overflowY: 'hidden'
  },
  tabButton: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '1rem 0.5rem',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    color: '#757575',
    transition: 'all 0.2s',
    borderBottom: '3px solid transparent'
  },
  tabButtonActive: {
    color: '#2196F3',
    borderBottomColor: '#2196F3'
  },
  tabLabel: {
    fontSize: '0.85rem',
    fontWeight: 500
  },
  dashboardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    padding: '1rem',
    margin: 0,
    width: '100%',
    maxWidth: 'none',
    minHeight: 'auto'
  },
  tabContent: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
    padding: '2rem 1rem',
    backgroundColor: '#f5f5f5'
  },
  largeActionButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem 2rem',
    backgroundColor: '#fff',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.3s',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.15)'
    }
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
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  balanceHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  balanceLabel: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333'
  },
  qrButton: {
    padding: '0.5rem 1rem',
    fontSize: '0.85rem',
    backgroundColor: '#f5f5f5',
    color: '#2196F3',
    border: '1px solid #e0e0e0',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  balanceAmount: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  balanceNumber: {
    fontSize: '3rem',
    fontWeight: '700',
    color: '#2196F3',
    marginRight: '0.5rem'
  },
  balanceUnit: {
    fontSize: '1.2rem',
    color: '#757575',
    marginLeft: '0.5rem'
  },
  balanceStats: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '1px solid #e0e0e0'
  },
  statItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem',
    backgroundColor: '#f9f9f9',
    borderRadius: '4px'
  },
  statValue: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333'
  },
  statLabel: {
    fontSize: '0.95rem',
    color: '#666'
  },
  statDivider: {
    display: 'none'
  },
  qrCodeSection: {
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
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
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: '8px',
    padding: '1.5rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  statsTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 1rem 0'
  },
  statsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  statsItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem',
    backgroundColor: '#f9f9fa',
    borderRadius: '4px'
  },
  statsIcon: {
    display: 'none'
  },
  statsInfo: {
    display: 'none'
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
  }
};

export default CustomerDashboard;