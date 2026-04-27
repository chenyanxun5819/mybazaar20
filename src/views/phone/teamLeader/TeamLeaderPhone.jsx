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
import CustomerListPhone from './components/SellerListPhone';
import SubmitCashPhone from './components/SubmitCashPhone';
import AllocatePointsPhone from './components/AllocatePointsPhone';
import ChartHistogramIcon from '../../../assets/chart-histogram.svg?react';
import WorkshopIcon from '../../../assets/workshop.svg?react';
import PersonalFinanceIcon from '../../../assets/personal-finance.svg?react';

const TeamLeaderPhone = () => {
  const navigate = useNavigate();
  const { orgEventCode } = useParams();
  const { eventCode: contextEventCode } = useEvent();
  const { userProfile, loading: authLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [eventData, setEventData] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
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

        if (!userProfile.roles?.includes('teamLeader')) {
          window.mybazaarShowToast?.('您没有 Team Leader 权限');
          navigate(`/login/${orgEventCode}`);
          return;
        }

        const managedDepts =
          userProfile.teamLeader?.managedDepartments ||
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

  const tabs = [
    { key: 'overview',  label: '总览',    Icon: ChartHistogramIcon },
    { key: 'sellers',   label: '学生清单', Icon: WorkshopIcon },
    { key: 'submit',    label: '上交现金', Icon: PersonalFinanceIcon },
  ];

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('teamLeaderInfo');
      navigate(`/login/${orgEventCode}`);
    } catch (err) {
      console.error('[SMPhone] 登出失败:', err);
      window.mybazaarShowToast?.('登出失败，请重试');
    }
  };

  const handleRefresh = () => window.location.reload();


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


  return (
    <div style={styles.page}>
      <DashboardHeader
        title="班导师管理"
        subtitle="Team Leader"
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
        currentRole="teamLeader"
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 导航 */}
      <nav style={styles.tabNav}>
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            style={{
              ...styles.tabButton,
              ...(activeTab === key ? styles.tabButtonActive : {})
            }}
            onClick={() => setActiveTab(key)}
          >
            <Icon style={{ width: '1.5rem', height: '1.5rem' }} />
            <span style={styles.tabLabel}>{label}</span>
          </button>
        ))}
      </nav>

      {/* Tab 内容 */}
      <main style={styles.content}>
        {activeTab === 'overview' && (
          <OverviewStatsPhone
            organizationId={safeCurrentUser.organizationId}
            eventId={eventId}
            teamLeaderId={safeCurrentUser.userId}
            managedDepartments={safeCurrentUser.managedDepartments || []}
            eventData={safeEventData}
          />
        )}

        {activeTab === 'sellers' && !selectedSeller && (
          <CustomerListPhone
            userInfo={safeCurrentUser}
            onAllocate={(seller) => setSelectedSeller(seller)}
          />
        )}

        {activeTab === 'sellers' && selectedSeller && (
          <AllocatePointsPhone
            userInfo={safeCurrentUser}
            selectedCustomer={selectedSeller}
            onSelectCustomer={setSelectedSeller}
            organizationId={safeCurrentUser.organizationId}
            eventId={eventId}
          />
        )}

        {activeTab === 'submit' && (
          <SubmitCashPhone
            userInfo={safeCurrentUser}
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
    backgroundColor: '#fff',
    borderBottom: '1px solid #e0e0e0',
    position: 'sticky',
    top: 0,
    zIndex: 10,
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    overflowX: 'auto',
    overflowY: 'hidden',
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
    borderBottom: '3px solid transparent',
    WebkitTapHighlightColor: 'transparent',
  },
  tabButtonActive: {
    color: '#2196F3',
    borderBottomColor: '#2196F3',
  },
  tabLabel: {
    fontSize: '0.85rem',
    fontWeight: 500,
  },
  content: {
    flex: 1,
    padding: '1rem',
    overflowY: 'auto'
  }
};

export default TeamLeaderPhone;
