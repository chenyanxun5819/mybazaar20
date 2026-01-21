import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QrCode, Receipt, Store, Bell, Scan } from 'lucide-react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext'; // 🆕 导入 EventContext
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import { useMerchantData } from '../../hooks/useMerchantData';
import { formatAmount } from '../../services/transactionService';
import MerchantQRCode from '../../components/merchant/MerchantQRCode';
import MerchantStats from '../../components/merchant/MerchantStats';
import MerchantTransactions from '../../components/merchant/MerchantTransactions';
import MerchantProfile from '../../components/merchant/MerchantProfile';
import MerchantScanner from '../../components/merchant/MerchantScanner'; // ⭐ 新增：扫码收款组件
import userBagIcon from '../../assets/user-bag.svg';
import './MerchantDashboard.css';

/**
 * MerchantDashboard - 商家摊位界面 (Mobile)
 * ⭐ 修复版本（2026-01-17）：
 * 1. 优化通知系统，避免 AbortError
 * 2. 过滤初始加载，只通知真正的新交易
 * 3. 使用 useRef 防止重复监听器
 */
const MerchantDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState('qrcode');
  const [organizationId, setOrganizationId] = useState(null);
  const [eventId, setEventId] = useState(null);

  // 🆕 从 EventContext 获取 event 对象
  const { event, eventCode } = useEvent();

  // ⭐ 通知系统状态
  const [notification, setNotification] = useState(null);

  // ⭐ 防止重复监听与重复通知
  const processedTransactionsRef = useRef(new Set());
  const unsubscribeRef = useRef(null);
  const notificationTimeoutRef = useRef(null);
  const isInitialLoadRef = useRef(true);  // ⭐ 新增：标记初始加载

  const { userProfile } = useAuth();

  // ⭐ 检测用户角色
  const isMerchantOwner = userProfile?.roles?.includes('merchantOwner');
  const isMerchantAsist = userProfile?.roles?.includes('merchantAsist');

  // 获取用户角色信息
  const userRole = isMerchantOwner ? 'merchantOwner' : isMerchantAsist ? 'merchantAsist' : null;
  // 设置组织和活动 ID
  useEffect(() => {
    if (userProfile?.organizationId && userProfile?.eventId) {
      setOrganizationId(userProfile.organizationId);
      setEventId(userProfile.eventId);
      return;
    }

    if (orgEventCode) {
      const [orgCode, eventCode] = orgEventCode.split('-');
      setOrganizationId(orgCode);
      setEventId(eventCode);
    }
  }, [userProfile?.organizationId, userProfile?.eventId, orgEventCode]);

  const currentUser = auth.currentUser;
  const {
    merchant,
    stats,
    loading,
    error,
    refreshStats,
    updateProfile,
    toggleStatus
  } = useMerchantData(
    currentUser?.uid,
    organizationId,
    eventId
  );

  // ============================================
  // ⭐ 全局通知系统（修复版）
  // ============================================
  useEffect(() => {
    // ⭐ 条件不满足：清理并返回
    if (!merchant?.id || !organizationId || !eventId) {
      if (unsubscribeRef.current) {
        console.log('🔔 [Dashboard] Cleaning up listener (conditions not met)');
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        processedTransactionsRef.current.clear();
        isInitialLoadRef.current = true;
      }
      return;
    }

    // ⭐ 已经有监听器：避免重复创建
    if (unsubscribeRef.current) {
      console.log('🔔 [Dashboard] Listener already exists, skipping setup');
      return;
    }

    console.log('🔔 [Dashboard] Setting up notification listener for merchant:', merchant.id);

    const transactionsRef = collection(
      db,
      'organizations', organizationId,
      'events', eventId,
      'transactions'
    );

    const q = query(
      transactionsRef,
      where('merchantId', '==', merchant.id),
      where('status', '==', 'pending'),
      orderBy('timestamp', 'desc')
    );

    unsubscribeRef.current = onSnapshot(
      q,
      (snapshot) => {
        console.log('🔔 [Dashboard] Snapshot received, isInitialLoad:', isInitialLoadRef.current);
        
        // ⭐ 初始加载：标记所有现有交易为已处理，但不显示通知
        if (isInitialLoadRef.current) {
          snapshot.docs.forEach(doc => {
            processedTransactionsRef.current.add(doc.id);
            console.log('🔔 [Dashboard] Initial load - marked as processed:', doc.id);
          });
          isInitialLoadRef.current = false;
          console.log('🔔 [Dashboard] Initial load completed, future changes will trigger notifications');
          return;
        }

        // ⭐ 后续更新：只处理真正的新交易
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const docId = change.doc.id;

            // ⭐ 去重：避免同一笔交易重复弹通知
            if (processedTransactionsRef.current.has(docId)) {
              console.log('🔔 [Dashboard] Already processed:', docId);
              return;
            }
            
            processedTransactionsRef.current.add(docId);

            const data = change.doc.data();

            // ⭐ 新的 pending 交易 - 显示通知
            console.log('🔔 [Dashboard] 🎉 New pending payment detected:', {
              id: docId,
              customerName: data.customerName,
              amount: data.amount
            });

            showNotification({
              id: docId,
              customerName: data.customerName || '顾客',
              amount: data.amount
            });
          }
        });
      },
      (error) => {
        // ⭐ 忽略 AbortError（这是正常的清理行为）
        if (error?.name === 'AbortError' || error?.code === 'cancelled') {
          console.log('🔔 [Dashboard] Listener aborted (expected during cleanup)');
          return;
        }
        console.error('❌ [Dashboard] Error listening to pending payments:', error);
      }
    );

    return () => {
      console.log('🔔 [Dashboard] Cleaning up notification listener');
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // ⭐ 不清空 processedTransactionsRef，保留已处理记录
    };
  }, [merchant?.id, organizationId, eventId]);

  // ⭐ 显示通知（5秒后自动消失）
  const showNotification = (data) => {
    console.log('🔔 [Dashboard] Showing notification:', data);
    setNotification(data);

    // 5秒后自动消失
    if (notificationTimeoutRef.current) {
      clearTimeout(notificationTimeoutRef.current);
    }
    notificationTimeoutRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimeoutRef.current = null;
    }, 5000);
  };

  // ⭐ 点击通知跳转到交易记录
  const handleNotificationClick = () => {
    setCurrentTab('transactions');
    setNotification(null);
  };

  const handleLogout = async () => {
    if (confirm('确定要登出吗？')) {
      try {
        await signOut(auth);
        navigate(`/login/${orgEventCode}`);
      } catch (error) {
        console.error('Logout error:', error);
        window.mybazaarShowToast('登出失败');
      }
    }
  };

  // Tab 配置（保留用於其他参考）
  const tabs = [
    { id: 'qrcode', label: 'QR Code', icon: QrCode },
    { id: 'scanner', label: '扫码收款', icon: Scan },
    { id: 'transactions', label: '交易记录', icon: Receipt },
    ...(isMerchantOwner ? [{ id: 'profile', label: '摊位资料', icon: Store }] : [])
  ];

  if (loading) {
    return (
      <div className="merchant-loading">
        <div className="merchant-loading-content">
          <div className="merchant-loading-spinner"></div>
          <p className="merchant-loading-text">加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="merchant-error">
        <div className="merchant-error-card">
          <div className="merchant-error-icon">
            <X />
          </div>
          <h2 className="merchant-error-title">加载失败</h2>
          <p className="merchant-error-message">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="merchant-error-btn"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!merchant) {
    return (
      <div className="merchant-not-assigned">
        <div className="merchant-not-assigned-card">
          <div className="merchant-not-assigned-icon">
            <Store />
          </div>
          <h2 className="merchant-not-assigned-title">尚未设置摊位资料</h2>
          <div className="merchant-not-assigned-content">
            <p className="merchant-not-assigned-message">
              您已拥有{isMerchantOwner ? '摊主' : '助理'}角色，但还没有被分配到摊位。
            </p>
            <div className="merchant-not-assigned-steps">
              <h3>请按照以下步骤操作：</h3>
              <ol>
                <li>联络活动的 <strong>Merchant Manager</strong> 或 <strong>Event Manager</strong></li>
                <li>
                  {isMerchantOwner && '请他们为您创建摊位并分配给您'}
                  {isMerchantAsist && '请他们将您分配到摊位'}
                </li>
                <li>分配完成后，刷新此页面即可查看摊位资料</li>
              </ol>
            </div>
            <div className="merchant-not-assigned-info">
              <p><strong>您的角色：</strong>{isMerchantOwner ? '摊主 (Merchant Owner)' : '助理 (Merchant Assistant)'}</p>
              <p><strong>用户 ID：</strong>{currentUser?.uid?.substring(0, 12)}...</p>
            </div>
          </div>
          <div className="merchant-not-assigned-actions">
            <button
              onClick={() => window.location.reload()}
              className="merchant-refresh-btn"
            >
              刷新页面
            </button>
            <button
              onClick={() => navigate(`/customer/${orgEventCode}/dashboard`)}
              className="merchant-to-customer-btn"
              title="返回消費者頁面"
            >
              <img 
                src={userBagIcon}
                alt="返回消費者頁面" 
                className="merchant-to-customer-icon"
              />
              <span>返回消費者頁面</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="merchant-dashboard">
      {/* 🆕 共用 Header 组件（临时，如需自定义，稍后可修改参数） */}
      <DashboardHeader
        title={merchant.stallName || '商家管理'}
        subtitle="Merchant Dashboard"
        logoUrl={event?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || currentUser?.displayName || '商家'}
        userPhone={userProfile?.basicInfo?.phoneNumber || currentUser?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={refreshStats}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userRole || userProfile?.roles?.[0]}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 導航（模仿 SellerDashboard 樣式） */}
      <nav className="tab-navigation">
        <button
          className={`tab-button ${currentTab === 'qrcode' ? 'active' : ''}`}
          onClick={() => setCurrentTab('qrcode')}
        >
          <QrCode className="tab-icon-img" />
          <span className="tab-label">QR Code</span>
        </button>

        <button
          className={`tab-button ${currentTab === 'scanner' ? 'active' : ''}`}
          onClick={() => setCurrentTab('scanner')}
        >
          <Scan className="tab-icon-img" />
          <span className="tab-label">扫码收款</span>
        </button>

        <button
          className={`tab-button ${currentTab === 'transactions' ? 'active' : ''}`}
          onClick={() => setCurrentTab('transactions')}
        >
          <Receipt className="tab-icon-img" />
          <span className="tab-label">交易记录</span>
        </button>

        {isMerchantOwner && (
          <button
            className={`tab-button ${currentTab === 'profile' ? 'active' : ''}`}
            onClick={() => setCurrentTab('profile')}
          >
            <Store className="tab-icon-img" />
            <span className="tab-label">摊位资料</span>
          </button>
        )}
      </nav>

      {/* ⭐ 全局通知横幅 */}
      {notification && (
        <div
          className="merchant-notification-banner"
          onClick={handleNotificationClick}
        >
          <Bell className="notification-icon" />
          <div className="notification-content">
            <p className="notification-title">新的付款请求</p>
            <p className="notification-text">
              {notification.customerName} 请求付款 {formatAmount(notification.amount)} 点
            </p>
          </div>
          <div className="notification-close" onClick={(e) => {
            e.stopPropagation();
            setNotification(null);
          }}>
            <X />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="merchant-main">
        <div className="merchant-stats-section">
          <MerchantStats stats={stats} userRole={userRole} />
        </div>

        <div>
          {currentTab === 'qrcode' && (
            <MerchantQRCode
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole={userRole}
            />
          )}
          {currentTab === 'scanner' && (
            <MerchantScanner
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole={userRole}
              currentUserId={currentUser?.uid}
            />
          )}


          {currentTab === 'transactions' && (
            <MerchantTransactions
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole={userRole}
              currentUserId={currentUser?.uid}
            />
          )}

          {currentTab === 'profile' && isMerchantOwner && (
            <MerchantProfile
              merchant={merchant}
              onUpdate={updateProfile}
              onToggleStatus={toggleStatus}
            />
          )}
        </div>
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

export default MerchantDashboard;