/**
 * SellerDashboard.jsx (更新版 v2.1)
 * ✅ 修复：SellerSubmitCash不再需要传递userInfo
 * 
 * @version 2.1
 * @date 2025-01-01
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext'; // 🆕 导入 EventContext
import PointsOverview from './components/PointsOverview';
import MakeSale from './components/MakeSale';
import { TransactionHistory } from './components/TransactionHistory';
import SellerSubmitCash from './components/SellerSubmitCash'; // 🆕 新增
import './SellerDashboard.css';

function SellerDashboard() {
  const navigate = useNavigate();
  const { currentUser, logout, userProfile } = useAuth();
  const { orgCode, eventCode } = useEvent(); // 🆕 从 EventContext 获取
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobileDevice, setIsMobileDevice] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // 🔧 检测设备类型：检查是否为移动设备
  useEffect(() => {
    const checkDeviceType = () => {
      const userAgent = navigator.userAgent.toLowerCase();
      const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
      const screenWidth = window.innerWidth;
      
      // 移动设备判断：User Agent 包含移动特征 或 屏幕宽度 <= 768px
      const mobile = isMobile || screenWidth <= 768;
      setIsMobileDevice(mobile);
      setIsDesktop(!mobile);
    };

    checkDeviceType();
    window.addEventListener('resize', checkDeviceType);
    return () => window.removeEventListener('resize', checkDeviceType);
  }, []);

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
      {/* 🔧 桌面版提示：仅支持移动设备 */}
      {isDesktop && (
        <div className="desktop-warning">
          <div className="warning-content">
            <span className="warning-icon">⚠️</span>
            <p className="warning-text">卖家中心仅支持移动设备使用</p>
            <p className="warning-hint">请使用手机或平板电脑访问此页面</p>
          </div>
        </div>
      )}

      {/* 🔧 仅在移动设备上显示内容 */}
      {isMobileDevice ? (
        <>
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
        {/* 🆕 新增Tab */}
        <button
          className={`tab-button ${activeTab === 'submit' ? 'active' : ''}`}
          onClick={() => setActiveTab('submit')}
        >
          <span className="tab-icon">📤</span>
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
        </>
      ) : null}
    </div>
  );
}

export default SellerDashboard;