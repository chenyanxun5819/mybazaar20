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
import RoleSwitcher from '../../components/common/RoleSwitcher'; // 🆕 导入角色切换器
import ChartHistogramIcon from '../../assets/chart-histogram.svg?react';
import SellIcon from '../../assets/sell.svg?react';
import MemoCircleCheckIcon from '../../assets/memo-circle-check.svg?react';
import PersonalFinanceIcon from '../../assets/personal-finance.svg?react';
import LeaveIcon from '../../assets/leave.svg?react';
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
    },
    roleSwitcherButton: {
      background: 'transparent',
      border: 'none',
      padding: '0.5rem',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: 0,
      transition: 'transform 0.2s',
      borderRadius: '4px',
      color: '#222c6e'
    }
  };

  const [logoutHover, setLogoutHover] = React.useState(false);

  const handleLogout = async () => {
    try {
      await logout();
      // 🔧 修复：使用 EventContext 中的 orgCode 和 eventCode
      const orgEventCode = `${orgCode}-${eventCode}`;
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('登出失败:', error);
      alert('登出失败，请重试');
    }
  };

  return (
    <div className="seller-dashboard">
      {/* 顶部栏 */}
      <header className="dashboard-header">
        <div className="header-content">
          <div className="dashboard-brand">
            {event?.logoUrl ? (
              <>
                <img src={event.logoUrl} alt={event?.eventName?.['zh-CN'] || event?.eventName?.['en-US'] || 'logo'} className="dashboard-logo" />
                <div className="brand-text">
                  <div className="dashboard-eventName">
                    {event?.eventName?.['zh-CN'] || event?.eventName?.['en-US'] || eventCode}
                  </div>
                  <div className="dashboard-subtitle">点数销售介面</div>
                        <div className="dashboard-userSmall">
                          {userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName || ''}
                          {userProfile?.basicInfo?.phoneNumber ? ` · ${userProfile.basicInfo.phoneNumber}` : ''}
                        </div>
                </div>
              </>
            ) : (
              <div className="brand-text">
                <h1 className="dashboard-title">{event?.eventName?.['zh-CN'] || event?.eventName?.['en-US'] || '卖家中心'}</h1>
                <div className="dashboard-subtitle">点数销售介面</div>
                <div className="dashboard-userSmall">
                  {currentUser?.basicInfo?.chineseName || currentUser?.basicInfo?.englishName || ''}
                  {currentUser?.basicInfo?.phoneNumber ? ` · ${currentUser.basicInfo.phoneNumber}` : ''}
                </div>
              </div>
            )}
          </div>
          <div className="user-info">
            <span className="user-name">
              {userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName || '用户'}
            </span>
                        {/* 🆕 角色切换器 */}
            <RoleSwitcher 
              currentRole="seller" 
              orgEventCode={`${orgCode}-${eventCode}`}
              availableRoles={userProfile?.roles || []}
              userInfo={userProfile}
            />
            <button 
              onClick={handleLogout} 
              style={{
                ...styles.logoutButton,
                ...(logoutHover ? styles.logoutButtonHover : {})
              }}
              onMouseEnter={() => setLogoutHover(true)}
              onMouseLeave={() => setLogoutHover(false)}
              title="登出"
            >
              <LeaveIcon style={{ width: '20px', height: '20px' }} />
            </button>

          </div>
        </div>
      </header>

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
          <span style={styles.tabLabel}>历史</span>
        </button>
        {/* 🆕 新增Tab */}
        <button
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
              RM {cashOnHand.toLocaleString()}
            </span>
          )}
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="dashboard-content">
        {activeTab === 'overview' && <PointsOverview />}
        {activeTab === 'sale' && <MakeSale />}
        {activeTab === 'history' && <TransactionHistory />}
        {/* 🔧 修复：不再传递userInfo，组件自己用useSellerStats获取数据 */}
        {activeTab === 'submit' && <SellerSubmitCash />}
      </main>
    </div>
  );
}

export default SellerDashboard;