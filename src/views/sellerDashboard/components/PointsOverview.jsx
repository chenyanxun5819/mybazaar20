import React from 'react';
import { useSellerStats } from '../hooks/useSellerStats';
import { useAuth } from '../../../contexts/AuthContext';
import StockForSellIcon from '../../../assets/stockForSell.svg?react';
import HandHoldingUsdIcon from '../../../assets/hand-holding-usd.svg?react';

function PointsOverview() {
  const { stats, loading, error } = useSellerStats();
  const { userProfile } = useAuth();

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

  // 🔧 正确读取 identityTag (支持 student/students)
  const identityTag = userProfile?.identityTag || userProfile?.identityInfo?.identityTag;
  const isStudent = identityTag === 'student' || identityTag === 'students';

  console.log('[PointsOverview] 用户类型:', { identityTag, isStudent });

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
        <h2 className="card-title"><StockForSellIcon className="card-icon" /> 我的点数</h2>
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
        <h2 className="card-title"><HandHoldingUsdIcon className="card-icon" /> 现金状态</h2>
        
        <div className="cash-summary">
          <div className="cash-item highlight">
            <span className="cash-label">手上现金</span>
            <span className="cash-amount">RM {stats.pendingCollection || 0}</span>
            {/* 🔧 根据用户类型显示不同提示 */}
            <small className="cash-hint">
              {isStudent 
                ? '待上交给班导师' 
                : '待上交现金'
              }
            </small>
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
              {/* 🔧 根据用户类型显示不同提醒 */}
              {isStudent 
                ? '记得上交现金给 Seller Manager' 
                : '记得上交现金'
              }
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default PointsOverview;
