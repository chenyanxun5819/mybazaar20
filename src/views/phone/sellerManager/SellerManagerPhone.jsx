import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useEvent } from '../../../contexts/EventContext';
import DashboardHeader from '../../../components/common/DashboardHeader';
import DashboardFooter from '../../../components/common/DashboardFooter';
import OverviewStatsPhone from './components/OverviewStatsPhone';
import SellerListPhone from './components/SellerListPhone';
import AllocatePointsPhone from './components/AllocatePointsPhone';
import CollectCashPhone from './components/CollectCashPhone';

const SellerManagerPhone = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  const { eventCode: contextEventCode } = useEvent();
  const { userProfile, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // 分配点数：选中的 seller
  const [selectedSeller, setSelectedSeller] = useState(null);

  useEffect(() => {
    if (authLoading) return;

    const init = async () => {
      try {
        setLoading(true);

        if (!userProfile) {
          navigate(`/login/${orgEventCode}`);
          return;
        }

        if (!userProfile.roles?.includes('sellerManager')) {
          window.mybazaarShowToast?.('您没有 Seller Manager 权限');
          navigate(`/login/${orgEventCode}`);
          return;
        }

        const managedDepts =
          userProfile.sellerManager?.managedDepartments ||
          userProfile.managedDepartments ||
          [];

        setCurrentUser({ ...userProfile, managedDepartments: managedDepts });
        setEventId(userProfile.eventId);

        const eventDoc = await getDoc(
          doc(db, 'organizations', userProfile.organizationId, 'events', userProfile.eventId)
        );
        if (eventDoc.exists()) {
          setEventData(eventDoc.data() || {});
        }
      } catch (err) {
        console.error('[SMPhone] 初始化失败:', err);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [userProfile, authLoading, orgEventCode, navigate]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('sellerManagerInfo');
      navigate(`/login/${orgEventCode}`);
    } catch (err) {
      console.error('[SMPhone] 登出失败:', err);
      window.mybazaarShowToast?.('登出失败，请重试');
    }
  };

  const handleRefresh = () => window.location.reload();

  // 从卖家列表跳到分配 tab，并带入选中 seller
  const handleSelectSellerForAllocate = (seller) => {
    setSelectedSeller(seller);
    setActiveTab('allocate');
  };

  if (loading) {
    return (
      <div style={styles.loadingWrapper}>
        <div style={styles.spinner} />
        <p style={{ color: '#6b7280', marginTop: '1rem' }}>加载中...</p>
      </div>
    );
  }

  const safeCurrentUser = currentUser || {};
  const safeEventData = eventData || {};
  const eventCodeForFooter =
    contextEventCode ||
    safeEventData?.eventCode ||
    userProfile?.eventCode ||
    orgEventCode?.split('-')?.[1] ||
    '';

  const maxPerAllocation =
    safeEventData?.pointAllocationRules?.sellerManager?.maxPerAllocation ?? 100;

  const tabs = [
    { key: 'overview', label: '总览' },
    { key: 'sellers', label: '卖家' },
    { key: 'allocate', label: '分配' },
    { key: 'collect', label: '收款' }
  ];

  return (
    <div style={styles.page}>
      <DashboardHeader
        title="班导师管理"
        subtitle="Seller Manager"
        logoUrl={safeEventData?.logoUrl}
        userName={
          userProfile?.basicInfo?.chineseName ||
          userProfile?.basicInfo?.englishName
        }
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole="sellerManager"
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 导航 */}
      <nav style={styles.tabNav}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            style={{
              ...styles.tabButton,
              ...(activeTab === tab.key ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab(tab.key)}
          >
            <span style={styles.tabLabel}>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* Tab 内容 */}
      <main style={styles.content}>
        {activeTab === 'overview' && (
          <OverviewStatsPhone
            organizationId={safeCurrentUser.organizationId}
            eventId={eventId}
            sellerManagerId={safeCurrentUser.userId}
            managedDepartments={safeCurrentUser.managedDepartments || []}
            eventData={safeEventData}
          />
        )}

        {activeTab === 'sellers' && (
          <SellerListPhone
            userInfo={safeCurrentUser}
            onAllocate={handleSelectSellerForAllocate}
          />
        )}

        {activeTab === 'allocate' && (
          <AllocatePointsPhone
            userInfo={safeCurrentUser}
            selectedSeller={selectedSeller}
            onSelectSeller={setSelectedSeller}
            organizationId={safeCurrentUser.organizationId}
            eventId={eventId}
            maxPerAllocation={maxPerAllocation}
          />
        )}

        {activeTab === 'collect' && (
          <CollectCashPhone
            userInfo={safeCurrentUser}
            eventData={safeEventData}
          />
        )}
      </main>

      <DashboardFooter eventCode={eventCodeForFooter} />
    </div>
  );
};

const styles = {
  page: {
    minHeight: '100vh',
    background: '#f9fafb',
    display: 'flex',
    flexDirection: 'column'
  },
  loadingWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh'
  },
  spinner: {
    width: '3rem',
    height: '3rem',
    border: '4px solid #e5e7eb',
    borderTopColor: '#f59e0b',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  tabNav: {
    display: 'flex',
    background: 'white',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky',
    top: 0,
    zIndex: 100
  },
  tabButton: {
    flex: 1,
    padding: '0.875rem 0.25rem',
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.25rem'
  },
  tabButtonActive: {
    borderBottomColor: '#f59e0b',
    background: '#fffbeb'
  },
  tabLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  content: {
    flex: 1,
    padding: '1rem',
    overflowY: 'auto'
  }
};

export default SellerManagerPhone;
