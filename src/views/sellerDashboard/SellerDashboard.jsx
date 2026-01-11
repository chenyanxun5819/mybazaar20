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
import chartIcon from '../../assets/chart-svgrepo-com.svg';
import cartLargeIcon from '../../assets/cart-large-2-svgrepo-com.svg';
import clipboardIcon from '../../assets/clipboard-list-svgrepo-com.svg';
import forwardIcon from '../../assets/multiple-forward-right-svgrepo-com.svg';
import './SellerDashboard.css';

function SellerDashboard() {
  const navigate = useNavigate();
  const { currentUser, logout, userProfile } = useAuth();
  const { orgCode, eventCode, event } = useEvent(); // 🆕 从 EventContext 获取完整 event
  const [activeTab, setActiveTab] = useState('overview');

  // 🔧 从seller对象获取手上现金（用于显示徽章）
  // 注意：这里可能需要使用useSellerStats来获取实时数据
  const cashOnHand = userProfile?.seller?.pendingCollection || 0;

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
            <button onClick={handleLogout} className="logout-button">
              登出
            </button>
          </div>
        </div>
      </header>

      {/* Tab 导航 */}
      <nav className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <img src={chartIcon} alt="总览" className="tab-icon-img" />
          <span className="tab-label">总览</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'sale' ? 'active' : ''}`}
          onClick={() => setActiveTab('sale')}
        >
          <img src={cartLargeIcon} alt="销售" className="tab-icon-img" />
          <span className="tab-label">销售</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <img src={clipboardIcon} alt="历史" className="tab-icon-img" />
          <span className="tab-label">历史</span>
        </button>
        {/* 🆕 新增Tab */}
        <button
          className={`tab-button ${activeTab === 'submit' ? 'active' : ''}`}
          onClick={() => setActiveTab('submit')}
        >
          <img src={forwardIcon} alt="上交现金" className="tab-icon-img" />
          <span className="tab-label">上交现金</span>
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