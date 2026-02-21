/**
 * DashboardHeader.jsx - 共用 Header 組件
 * 
 * 支援所有 Dashboard（Seller、Customer、Merchant、PointSeller 等）
 * 透過 props 傳遞動態內容，實現高度可客製化
 */

import React, { useState } from 'react';
import RoleSwitcher from './RoleSwitcher'; // 🆕 導入 RoleSwitcher
import LeaveIcon from '../../assets/leave.svg?react'; // 🆕 導入登出圖標
import RefreshIcon from '../../assets/refresh.svg?react'; // 🆕 導入刷新圖標
import './DashboardHeader.css';

const DashboardHeader = ({
  // 標題相關
  logoUrl,           // event logo URL
  title,             // 主標題（例如"点数销售介面"）
  subtitle,          // 副標題（例如"Seller Dashboard"）
  
  // 用戶信息相關
  userName,          // 顯示的用戶名
  userPhone,         // 用戶電話（可選）
  
  // 操作相關
  onLogout,          // 登出回調
  onRefresh,         // 重新整理回調（可選）
  
  // 角色切換相關 (🆕 新增)
  currentRole,       // 當前角色（例如 "seller"）
  orgEventCode,      // 組織活動代碼（例如 "code-eventcode"）
  availableRoles,    // 可用角色陣列
  userInfo,          // 用戶信息對象
  
  // 額外自訂
  showRoleSwitcher = false,  // 是否顯示角色切換器
  showRefreshButton = false, // 是否顯示重新整理按鈕
  customActions,     // 自訂操作按鈕陣列（可選）
}) => {
  const [logoutHover, setLogoutHover] = useState(false);
  const resolvedUserName = userName || userInfo?.basicInfo?.chineseName || userInfo?.basicInfo?.englishName || '';
  const resolvedUserPhone = userPhone || userInfo?.basicInfo?.phoneNumber || userInfo?.phoneNumber || '';

  return (
    <header className="dashboard-header-shared">
      <div className="dashboard-header-content">
        {/* 左側：Logo + Title + Subtitle + User Info */}
        <div className="dashboard-header-left">
          {logoUrl && (
            <img 
              src={logoUrl} 
              alt="logo" 
              className="dashboard-header-logo" 
            />
          )}
          <div className="dashboard-header-text">
            <h1 className="dashboard-header-title">{title}</h1>
            {subtitle && (
              <p className="dashboard-header-subtitle">{subtitle}</p>
            )}
            {(resolvedUserName || resolvedUserPhone) && (
              <p className="dashboard-header-user">
                {resolvedUserName}
                {resolvedUserPhone && ` · ${resolvedUserPhone}`}
              </p>
            )}
          </div>
        </div>

        {/* 右側：操作按鈕 */}
        <div className="dashboard-header-right">
                    {/* 角色切換器 */}
          {showRoleSwitcher && currentRole && orgEventCode && (
            <RoleSwitcher 
              currentRole={currentRole}
              orgEventCode={orgEventCode}
              availableRoles={availableRoles || []}
              userInfo={userInfo}
            />
          )}

          {/* 自訂操作按鈕 */}
          {customActions && customActions.map((action, idx) => (
            <button
              key={idx}
              onClick={action.onClick}
              className="dashboard-header-action-btn"
              title={action.title}
            >
              {action.icon}
            </button>
          ))}
          
          {/* 重新整理按鈕 */}
          {showRefreshButton && onRefresh && (
            <button 
              onClick={onRefresh}
              className="dashboard-header-action-btn"
              title="重新整理"
            >
              <RefreshIcon style={{ width: '20px', height: '20px' }} />
            </button>
          )}



          {/* 登出按鈕 */}
          {onLogout && (
            <button
              onClick={onLogout}
              className="dashboard-header-logout-btn"
              onMouseEnter={() => setLogoutHover(true)}
              onMouseLeave={() => setLogoutHover(false)}
              style={{
                opacity: logoutHover ? 0.8 : 1,
                transform: logoutHover ? 'translateY(-1px)' : 'translateY(0)'
              }}
              title="登出"
            >
              <LeaveIcon style={{ width: '20px', height: '20px' }} />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
