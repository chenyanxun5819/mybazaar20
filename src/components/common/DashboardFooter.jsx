/**
 * DashboardFooter.jsx - 共用 Footer 組件
 * 
 * 用於所有 Dashboard（Seller、Customer、Merchant 等）
 * 顯示 Event Logo + Event Name 和版權宣告
 */

import React from 'react';
import './DashboardFooter.css';

const DashboardFooter = ({ 
  event, 
  eventCode,
  showEventInfo = true 
}) => {
  return (
    <footer className="dashboard-footer">
      {showEventInfo && event && (
        <div className="dashboard-footer-event">
          {event.logoUrl && (
            <img 
              src={event.logoUrl} 
              alt={event?.eventName?.['zh-CN'] || event?.eventName?.['en-US'] || 'logo'} 
              className="dashboard-footer-logo" 
            />
          )}
          <div className="dashboard-footer-eventName">
            {event?.eventName?.['zh-CN'] || event?.eventName?.['en-US'] || eventCode}
          </div>
        </div>
      )}
      <div className="dashboard-footer-copyright">
        © 2026 My Bazaar Solution. All rights reserved.
      </div>
    </footer>
  );
};

export default DashboardFooter;
