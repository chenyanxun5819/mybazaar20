import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { QrCode, Receipt, Store, LogOut, Menu, X } from 'lucide-react';
import { auth } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext';
import { useMerchantData } from '../../hooks/useMerchantData';
import MerchantQRCode from '../../components/merchant/MerchantQRCode';
import MerchantStats from '../../components/merchant/MerchantStats';
import MerchantTransactions from '../../components/merchant/MerchantTransactions';
import MerchantProfile from '../../components/merchant/MerchantProfile';
import './MerchantDashboard.css';

/**
 * MerchantDashboard - 商家摊位界面 (Mobile)
 * ⭐ 同时支持 merchantOwner 和 merchantAsist 角色
 * merchantOwner: 可查看所有交易、退款、编辑资料
 * merchantAsist: 只能查看自己的交易、不能退款、不能编辑资料
 */
const MerchantDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const [currentTab, setCurrentTab] = useState('qrcode');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [organizationId, setOrganizationId] = useState(null);
  const [eventId, setEventId] = useState(null);
  const { userProfile } = useAuth();

  // ⭐ 检测用户角色
  const isMerchantOwner = userProfile?.roles?.includes('merchantOwner');
  const isMerchantAsist = userProfile?.roles?.includes('merchantAsist');
  
  // 获取用户角色信息（用于传递给子组件）
  const userRole = isMerchantOwner ? 'merchantOwner' : isMerchantAsist ? 'merchantAsist' : null;

  // 使用 AuthContext 的 userProfile 组织/活动 ID，避免路径不一致
  useEffect(() => {
    if (userProfile?.organizationId && userProfile?.eventId) {
      setOrganizationId(userProfile.organizationId);
      setEventId(userProfile.eventId);
      return;
    }

    // 后备方案：解析 orgEventCode（仅在缺少 userProfile 时使用）
    if (orgEventCode) {
      const [orgCode, eventCode] = orgEventCode.split('-');
      setOrganizationId(orgCode);
      setEventId(eventCode);
    }
  }, [userProfile?.organizationId, userProfile?.eventId, orgEventCode]);

  // 取得当前用户与应用内 userId（Custom Claims / userProfile）
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
    currentUser?.uid,  // ✅ 统一格式后直接使用 user.uid
    organizationId,
    eventId
  );

  const handleLogout = async () => {
    if (confirm('确定要登出吗？')) {
      try {
        await signOut(auth);
        navigate(`/login/${orgEventCode}`);
      } catch (error) {
        console.error('Logout error:', error);
        alert('登出失败');
      }
    }
  };

  // Tab 配置（根据角色调整）
  // ⭐ merchantAsist 不能编辑摊位资料，所以不显示 profile tab
  const tabs = [
    { id: 'qrcode', label: 'QR Code', icon: QrCode },
    { id: 'transactions', label: '交易记录', icon: Receipt },
    // ⭐ 只有 merchantOwner 可以查看和编辑摊位资料
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
      <div className="merchant-not-found">
        <div className="merchant-not-found-card">
          <Store className="merchant-not-found-icon" />
          <h2 className="merchant-not-found-title">找不到商家资料</h2>
          <p className="merchant-not-found-message">请联络活动管理员</p>
          <button
            onClick={handleLogout}
            className="merchant-not-found-btn"
          >
            返回登入
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="merchant-dashboard">
      {/* Header */}
      <header className="merchant-header">
        <div className="merchant-header-container">
          <div className="merchant-header-content">
            {/* Logo & Title */}
            <div className="merchant-logo-section">
              <div className="merchant-logo">
                <Store />
              </div>
              <div className="merchant-title-section">
                <h1>{merchant.stallName || '商家管理'}</h1>
                <p>
                  {isMerchantOwner && '摊主 (Owner)'}
                  {isMerchantAsist && '助理 (Assistant)'}
                  {!isMerchantOwner && !isMerchantAsist && 'Merchant Dashboard'}
                </p>
              </div>
            </div>

            {/* Desktop Actions */}
            <div className="merchant-desktop-actions">
              <button
                onClick={refreshStats}
                className="merchant-refresh-btn"
              >
                刷新
              </button>
              <button
                onClick={handleLogout}
                className="merchant-logout-btn"
              >
                <LogOut />
                登出
              </button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setShowMobileMenu(!showMobileMenu)}
              className="merchant-mobile-menu-btn"
            >
              {showMobileMenu ? <X /> : <Menu />}
            </button>
          </div>

          {/* Mobile Menu */}
          {showMobileMenu && (
            <div className="merchant-mobile-menu">
              <button
                onClick={refreshStats}
                className="refresh-item"
              >
                刷新资料
              </button>
              <button
                onClick={handleLogout}
                className="logout-item"
              >
                登出
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="merchant-main">
        {/* Stats Cards */}
        <div className="merchant-stats-section">
          <MerchantStats stats={stats} />
        </div>

        {/* Tabs Navigation */}
        <div className="merchant-tabs-container">
          <div className="merchant-tabs-nav">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setCurrentTab(tab.id)}
                  className={`merchant-tab-btn ${currentTab === tab.id ? 'active' : 'inactive'}`}
                >
                  <Icon />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div>
          {currentTab === 'qrcode' && (
            <MerchantQRCode
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole={userRole}  // ⭐ 传递用户角色
            />
          )}

          {currentTab === 'transactions' && (
            <MerchantTransactions
              merchant={merchant}
              organizationId={organizationId}
              eventId={eventId}
              userRole={userRole}  // ⭐ 传递用户角色
              currentUserId={currentUser?.uid}  // ⭐ 传递当前用户 ID（用于筛选 merchantAsist 的交易）
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
    </div>
  );
};

export default MerchantDashboard;