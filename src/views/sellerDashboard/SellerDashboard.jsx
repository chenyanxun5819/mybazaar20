import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import PointsOverview from './components/PointsOverview';
import MakeSale from './components/MakeSale';
import { TransactionHistory } from './components/TransactionHistory';
import './SellerDashboard.css';

function SellerDashboard() {
  const { currentUser, logout } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  const handleLogout = async () => {
    try {
      await logout();
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
          <h1 className="dashboard-title">卖家中心</h1>
          <div className="user-info">
            <span className="user-name">
              {currentUser?.basicInfo?.chineseName || currentUser?.basicInfo?.englishName || '用户'}
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
          <span className="tab-icon">📊</span>
          <span className="tab-label">总览</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'sale' ? 'active' : ''}`}
          onClick={() => setActiveTab('sale')}
        >
          <span className="tab-icon">🛒</span>
          <span className="tab-label">销售</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span className="tab-icon">📋</span>
          <span className="tab-label">历史</span>
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="dashboard-content">
        {activeTab === 'overview' && <PointsOverview />}
        {activeTab === 'sale' && <MakeSale />}
        {activeTab === 'history' && <TransactionHistory />}
      </main>
    </div>
  );
}

export default SellerDashboard;