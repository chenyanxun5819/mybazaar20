import React from 'react';
import { useSellerStats } from '../hooks/useSellerStats';

function PointsOverview() {
  const { stats, loading, error } = useSellerStats();

  console.log('=== PointsOverview Debug ===');
  console.log('1. Loading:', loading);
  console.log('2. Error:', error);
  console.log('3. Stats:', stats);
  console.log('4. Stats type:', typeof stats);
  console.log('5. Stats is null:', stats === null);
  console.log('6. Stats is undefined:', stats === undefined);
  console.log('7. Stats keys:', stats ? Object.keys(stats) : 'N/A');
  console.log('8. availablePoints:', stats?.availablePoints);
  console.log('============================');

  if (loading) {
    console.log('[PointsOverview] 显示加载中...');
    return (
      <div className="points-overview">
        <div className="loading-message">加载中...</div>
      </div>
    );
  }

  if (error) {
    console.log('[PointsOverview] 显示错误:', error);
    return (
      <div className="points-overview">
        <div className="error-message">错误: {error}</div>
      </div>
    );
  }

  if (!stats) {
    console.log('[PointsOverview] Stats 是 null/undefined，显示"无数据"');
    return (
      <div className="points-overview">
        <div className="no-data-message">无数据</div>
      </div>
    );
  }

  console.log('[PointsOverview] 渲染正常界面，availablePoints:', stats.availablePoints);

  return (
    <div className="points-overview">
      {/* 点数卡片 */}
      <div className="card points-card">
        <h2 className="card-title">💰 我的点数</h2>
        <div className="balance-display">
          <span className="balance-amount">{stats.availablePoints || 0}</span>
          <span className="balance-unit">点</span>
        </div>
        <div className="sub-info">
          可用于销售给客户
        </div>
        
        {/* 销售统计 */}
        <div className="sales-stats">
          <div className="stat-row">
            <span className="stat-label">累计售出</span>
            <span className="stat-value">{stats.totalPointsSold || 0} 点</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">累计销售额</span>
            <span className="stat-value">RM {stats.totalRevenue || 0}</span>
          </div>
        </div>
      </div>

      {/* 现金卡片 */}
      <div className="card cash-card">
        <h2 className="card-title">💵 现金状态</h2>
        
        <div className="cash-summary">
          <div className="cash-item highlight">
            <span className="cash-label">手上现金</span>
            <span className="cash-amount">RM {stats.pendingCollection || 0}</span>
            <small className="cash-hint">待上交给 Seller Manager</small>
          </div>
          
          <div className="cash-divider"></div>
          
          <div className="cash-item">
            <span className="cash-label">累计收到现金</span>
            <span className="cash-amount secondary">RM {stats.totalCashCollected || 0}</span>
          </div>
        </div>

        {/* 提醒 */}
        {(stats.pendingCollection || 0) > 0 && (
          <div className="collection-reminder">
            <span className="reminder-icon">💡</span>
            <span className="reminder-text">
              记得上交现金给 Seller Manager
            </span>
          </div>
        )}
      </div>

      {/* 交易提示 */}
      <div className="card info-card">
        <h3 className="info-title">📌 提示</h3>
        <ul className="info-list">
          <li>您的点数用于销售给客户</li>
          <li>客户支付现金，您转移点数</li>
          <li>收到的现金需上交给 Seller Manager</li>
          <li>1 点 = RM 1</li>
        </ul>
      </div>
    </div>
  );
}

export default PointsOverview;
