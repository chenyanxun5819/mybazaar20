/**
 * SellerDashboard.jsx (更新版 v2.1)
 * ✅ 修复：SellerSubmitCash不再需要传递userInfo
 * 
 * @version 2.1
 * @date 2025-01-01
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext'; // 🆕 导入 EventContext
import PointsOverview from './components/PointsOverview';
import MakeSale from './components/MakeSale';
import { TransactionHistory } from './components/TransactionHistory';
import SellerSubmitCash from './components/SellerSubmitCash'; // 🆕 新增
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import ChartHistogramIcon from '../../assets/chart-histogram.svg?react';
import SellIcon from '../../assets/sell.svg?react';
import MemoCircleCheckIcon from '../../assets/memo-circle-check.svg?react';
import PersonalFinanceIcon from '../../assets/personal-finance.svg?react';
import TogetherPeopleIcon from '../../assets/together-people.svg?react';
import './SellerDashboard.css';

function SellerDashboard() {
  const navigate = useNavigate();
  const { currentUser, logout, userProfile } = useAuth();
  const { orgCode, eventCode, event } = useEvent(); // 🆕 从 EventContext 获取完整 event
  const [activeTab, setActiveTab] = useState('overview');

  // 🔧 从seller对象获取手上现金（用于显示徽章）
  // 注意：这里可能需要使用useSellerStats来获取实时数据
  const cashOnHand = userProfile?.seller?.pendingCollection || 0;

  // 🆕 inline styles（参考 EventManagerDashboard）
  const styles = {
    tabButton: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0.25rem',
      padding: '1rem 0.5rem',
      minHeight: '74px',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      cursor: 'pointer',
      color: '#757575',
      transition: 'all 0.2s',
      borderBottom: '3px solid transparent',
      position: 'relative',
      overflow: 'visible'
    },
    tabButtonActive: {
      color: '#2196F3',
      borderBottomColor: '#2196F3'
    },
    tabLabel: {
      fontSize: '0.85rem',
      fontWeight: 500
    },
    logoutButton: {
      background: 'transparent',
      border: 'none',
      padding: '0.5rem',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '0.9rem',
      transition: 'background-color 0.2s, transform 0.12s',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 0,
      color: '#222c6e'
    },
    logoutButtonHover: {
      backgroundColor: 'rgba(0,0,0,0.06)',
      transform: 'translateY(-1px)'
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      // 🔧 修复：使用 EventContext 中的 orgCode 和 eventCode
      const orgEventCode = `${orgCode}-${eventCode}`;
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('登出失败:', error);
      window.mybazaarShowToast('登出失败，请重试');
    }
  };

  const handleRefresh = () => {
    // 刷新页面或重新加载数据
    window.location.reload();
  };

  return (
    <div className="seller-dashboard">
      {/* 🆕 共用 Header 组件（包含角色切换器和登出按钮） */}
      <DashboardHeader
        title="点数销售"
        subtitle="Points Sales"
        logoUrl={event?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || currentUser?.basicInfo?.chineseName}
        userPhone={userProfile?.basicInfo?.phoneNumber || currentUser?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.includes('seller') ? 'seller' : userProfile?.roles?.[0]}
        orgEventCode={`${orgCode}-${eventCode}`}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 导航 */}
      <nav className="tab-navigation">
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'overview' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('overview')}
        >
          <ChartHistogramIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>总览</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'sale' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('sale')}
        >
          <SellIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>销售</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'history' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('history')}
        >
          <MemoCircleCheckIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>交易历史</span>
        </button>
        {/* 🆕 新增Tab */}
        <button
          className="seller-submit-tab"
          style={{
            ...styles.tabButton,
            ...(activeTab === 'submit' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('submit')}
        >
          <PersonalFinanceIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>上交现金</span>
          {/* 🆕 显示待上交金额徽章 */}
          {cashOnHand > 0 && (
            <span className="badge">
              {cashOnHand >= 1000
                ? new Intl.NumberFormat('en-MY', {
                    notation: 'compact',
                    maximumFractionDigits: 1
                  }).format(cashOnHand)
                : cashOnHand.toLocaleString('en-MY')}
            </span>
          )}
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="dashboard-content">
        {activeTab === 'overview' && <PointsOverview />}
        {activeTab === 'sale' && <MakeSale />}
        {activeTab === 'history' && <TransactionHistory />}
        {activeTab === 'submit' && <SellerSubmitCash />}
      </main>
      
      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter 
        event={event}
        eventCode={eventCode}
        showEventInfo={true}
      />
    </div>
  );
}

export default SellerDashboard;
