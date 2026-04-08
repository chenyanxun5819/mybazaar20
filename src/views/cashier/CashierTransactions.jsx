/**
 * Collection History Component - Desktop 1000px Layout
 * Tab 3: 收款记录 - 添加FM统计行和电话/工号列
 */

import React, { useState, useMemo } from 'react';
import './CashierTransactions.css';

const CashierTransactions = ({ submissions, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [expandedId, setExpandedId] = useState(null);

  // 验证提交者身份是否符合 Cashier 直接交款条件
  // 仅允许：sellerManager / pointSeller / seller+teacher / seller+staff
  const isValidSubmitter = (submission) => {
    const submitterRole = submission.submitterRole;
    const identityTag = submission.resolvedSubmitterIdentityTag ?? submission.submitterIdentityTag ?? null;

    if (submitterRole === 'sellerManager' || submitterRole === 'pointSeller') {
      return true;
    }

    if (submitterRole === 'seller') {
      return identityTag === 'teacher' || identityTag === 'staff';
    }

    return false;
  };

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 格式化日期时间
  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 格式化完整日期时间
  const formatFullDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // 角色翻译
  const getRoleLabel = (role) => {
    const roleMap = {
      seller: 'Seller',
      sellerManager: 'Seller Manager',
      pointSeller: 'Point Seller'
    };
    return roleMap[role] || role;
  };

  // 获取角色图标
  const getRoleIcon = (role) => {
    const iconMap = {
      seller: '🛍️',
      sellerManager: '👨‍🏫',
      pointSeller: '💳'
    };
    return iconMap[role] || '👤';
  };

  // 状态翻译
  const getStatusLabel = (status) => {
    const statusMap = {
      pending: '待确认',
      confirmed: '已确认',
      disputed: '有争议',
      rejected: '已拒绝'
    };
    return statusMap[status] || status;
  };

  // 筛选和搜索
  const filteredSubmissions = useMemo(() => {
    return submissions.filter(submission => {
      // 身份验证：只显示符合条件的提交者
      if (!isValidSubmitter(submission)) {
        return false;
      }

      // 状态筛选
      if (statusFilter !== 'all' && submission.status !== statusFilter) {
        return false;
      }

      // 角色筛选
      if (roleFilter !== 'all' && submission.submitterRole !== roleFilter) {
        return false;
      }

      // 搜索
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchName = submission.submitterName?.toLowerCase().includes(term);
        const matchNote = submission.note?.toLowerCase().includes(term);
        const matchReceiver = submission.receivedByName?.toLowerCase().includes(term);
        const matchAmount = submission.amount?.toString().includes(term);
        const matchPhone = submission.submitterPhone?.includes(term);
        const matchEmployeeId = submission.submitterEmployeeId?.toLowerCase().includes(term);

        if (!matchName && !matchNote && !matchReceiver && !matchAmount && !matchPhone && !matchEmployeeId) {
          return false;
        }
      }

      return true;
    });
  }, [submissions, statusFilter, roleFilter, searchTerm]);

  // 统计数据
  const statistics = useMemo(() => {
    // 只统计符合条件的提交者
    const validSubmissions = submissions.filter(isValidSubmitter);
    
    const total = validSubmissions.length;
    const confirmed = validSubmissions.filter(s => s.status === 'confirmed').length;
    const pending = validSubmissions.filter(s => s.status === 'pending').length;

    const totalAmount = validSubmissions.reduce((sum, s) => sum + (s.amount || 0), 0);
    const confirmedAmount = validSubmissions
      .filter(s => s.status === 'confirmed')
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    const pendingAmount = validSubmissions
      .filter(s => s.status === 'pending')
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    return {
      total,
      confirmed,
      pending,
      totalAmount,
      confirmedAmount,
      pendingAmount
    };
  }, [submissions]);

  // Cashier统计
  const fmStatistics = useMemo(() => {
    const fmMap = new Map();
    
    submissions
      .filter(s => isValidSubmitter(s) && s.status === 'confirmed' && s.receivedBy)
      .forEach(s => {
        const key = s.receivedBy;
        if (!fmMap.has(key)) {
          // 组合中英文名显示
          const chineseName = s.receiverChineseName || '';
          const englishName = s.receiverEnglishName || '';
          
          let displayName = '';
          if (chineseName && englishName) {
            displayName = `${chineseName} ${englishName}`;
          } else if (chineseName) {
            displayName = chineseName;
          } else if (englishName) {
            displayName = englishName;
          } else {
            // 向后兼容：如果新字段不存在，使用receiverName
            displayName = s.receiverName || s.receivedBy;
          }
          
          fmMap.set(key, {
            name: displayName,
            count: 0,
            amount: 0
          });
        }
        const fm = fmMap.get(key);
        fm.count += 1;
        fm.amount += s.amount || 0;
      });

    return Array.from(fmMap.values()).sort((a, b) => b.count - a.count);
  }, [submissions]);

  // 重置筛选
  const handleResetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setRoleFilter('all');
  };

  // 切换展开/收起
  const toggleExpanded = (submissionId) => {
    setExpandedId(expandedId === submissionId ? null : submissionId);
  };

  return (
    <div className="collection-history">
      {/* 头部 */}
      <div className="history-header">
        <div className="header-title">
          <h2>📋 收款记录</h2>
          <p className="header-subtitle">所有Cashier的收款记录（共 {submissions.length} 笔）</p>
        </div>
        <button className="refresh-button" onClick={onRefresh}>
          🔄 刷新
        </button>
      </div>

      {/* 统计卡片 - 单行无底色 */}
      <div className="history-stats">
        <div className="stat-card total">
          <div className="stat-content">
            <div className="stat-label">📊 总记录</div>
            <div className="stat-value">{statistics.total} 笔</div>
            <div className="stat-amount">{formatAmount(statistics.totalAmount)}</div>
          </div>
        </div>
        <div className="stat-card confirmed">
          <div className="stat-content">
            <div className="stat-label">✅ 已确认</div>
            <div className="stat-value">{statistics.confirmed} 笔</div>
            <div className="stat-amount">{formatAmount(statistics.confirmedAmount)}</div>
          </div>
        </div>
        <div className="stat-card pending">
          <div className="stat-content">
            <div className="stat-label">⏳ 待确认</div>
            <div className="stat-value">{statistics.pending} 笔</div>
            <div className="stat-amount">{formatAmount(statistics.pendingAmount)}</div>
          </div>
        </div>
      </div>

      {/* Cashier统计行 */}
      {fmStatistics.length > 0 && (
        <div className="fm-statistics">
          <h3>👥 Cashier 收款统计</h3>
          <div className="fm-list">
            {fmStatistics.map((fm, index) => (
              <div key={index} className="fm-item">
                <span className="fm-name">{fm.name}</span>
                <span className="fm-count">{fm.count} 笔</span>
                <span className="fm-amount">{formatAmount(fm.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 筛选器 */}
      <div className="history-filters">
        <div className="filter-group">
          <label>状态</label>
          <select
            className="filter-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">全部状态</option>
            <option value="pending">待确认</option>
            <option value="confirmed">已确认</option>
            <option value="disputed">有争议</option>
            <option value="rejected">已拒绝</option>
          </select>
        </div>

        <div className="filter-group">
          <label>角色</label>
          <select
            className="filter-select"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">全部角色</option>
            <option value="seller">Seller</option>
            <option value="sellerManager">Seller Manager</option>
            <option value="pointSeller">Point Seller</option>
          </select>
        </div>

        <div className="filter-group search-group">
          <label>搜索</label>
          <div className="search-wrapper">
            <input
              type="text"
              className="search-input"
              placeholder="搜索姓名、电话、工号、金额..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                className="clear-search-btn"
                onClick={() => setSearchTerm('')}
              >
                ✕
              </button>
            )}
          </div>
        </div>

        <button className="reset-filters-btn" onClick={handleResetFilters}>
          🔄 重置
        </button>
      </div>

      {/* 收款记录表格 */}
      {filteredSubmissions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📭</div>
          <p className="empty-message">没有找到符合条件的记录</p>
          {(searchTerm || statusFilter !== 'all' || roleFilter !== 'all') && (
            <button className="reset-btn" onClick={handleResetFilters}>
              重置筛选条件
            </button>
          )}
        </div>
      ) : (
        <div className="table-container">
          <table className="history-table">
            <thead>
              <tr>
                <th>提交者</th>
                <th>电话</th>
                <th>工号</th>
                <th>金额</th>
                <th>状态</th>
                <th>提交时间</th>
                <th>接收者</th>
                <th>明细</th>
              </tr>
            </thead>
            <tbody>
              {filteredSubmissions.map(submission => (
                <React.Fragment key={submission.id}>
                  {/* 主行 */}
                  <tr className={`status-${submission.status}`}>
                    {/* 提交者列 */}
                    <td>
                      <div className="submitter-cell">
                        <span className="role-icon">{getRoleIcon(submission.submitterRole)}</span>
                        <div className="submitter-info">
                          <div className="submitter-name">{submission.submitterName}</div>
                          <div className="submitter-meta">
                            <span className="role-badge">{getRoleLabel(submission.submitterRole)}</span>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 电话列 */}
                    <td>
                      <div className="phone-cell">{submission.submitterPhone || '-'}</div>
                    </td>

                    {/* 工号列 */}
                    <td>
                      <div className="employee-id-cell">{submission.submitterEmployeeId || '-'}</div>
                    </td>

                    {/* 金额列 */}
                    <td>
                      <div className="amount-cell">{formatAmount(submission.amount)}</div>
                    </td>

                    {/* 状态列 */}
                    <td>
                      <span className={`status-badge status-${submission.status}`}>
                        {getStatusLabel(submission.status)}
                      </span>
                    </td>

                    {/* 提交时间列 */}
                    <td>
                      <div className="time-cell">{formatDateTime(submission.submittedAt)}</div>
                    </td>

                    {/* 接收者列 */}
                    <td>
                      <div className="receiver-cell">
                        {(() => {
                          const chineseName = submission.receiverChineseName || '';
                          const englishName = submission.receiverEnglishName || '';
                          
                          if (chineseName && englishName) {
                            return `${chineseName} ${englishName}`;
                          } else if (chineseName) {
                            return chineseName;
                          } else if (englishName) {
                            return englishName;
                          } else {
                            // 向后兼容
                            return submission.receiverName || '-';
                          }
                        })()}
                      </div>
                    </td>

                    {/* 明细列 */}
                    <td className="detail-cell">
                      {(submission.includedSales?.length > 0 || 
                        submission.confirmationNote || 
                        submission.pointCardInfo) ? (
                        <button 
                          className="detail-button"
                          onClick={() => toggleExpanded(submission.id)}
                        >
                          {expandedId === submission.id ? '▼' : '▶'}
                        </button>
                      ) : (
                        <span style={{ color: '#d1d5db' }}>-</span>
                      )}
                    </td>
                  </tr>

                  {/* 展开行 */}
                  {expandedId === submission.id && (
                    <tr className="expanded-row">
                      <td colSpan="8">
                        <div className="expanded-content">
                          {/* 确认信息 */}
                          {submission.status === 'confirmed' && submission.confirmationNote && (
                            <div className="expanded-section">
                              <div className="section-title">✅ 确认信息</div>
                              <div className="confirmed-info">
                                {(() => {
                                  const chineseName = submission.receiverChineseName || '';
                                  const englishName = submission.receiverEnglishName || '';
                                  const receiverDisplay = chineseName && englishName 
                                    ? `${chineseName} ${englishName}`
                                    : chineseName || englishName || submission.receiverName;
                                  
                                  return receiverDisplay && (
                                    <div className="confirmed-item">
                                      <span className="confirmed-label">接收者：</span>
                                      <span className="confirmed-value">{receiverDisplay}</span>
                                    </div>
                                  );
                                })()}
                                {submission.confirmedAt && (
                                  <div className="confirmed-item">
                                    <span className="confirmed-label">确认时间：</span>
                                    <span className="confirmed-value">{formatFullDateTime(submission.confirmedAt)}</span>
                                  </div>
                                )}
                                {submission.confirmationNote && (
                                  <div className="confirmed-item">
                                    <span className="confirmed-label">确认备注：</span>
                                    <span className="confirmed-value">{submission.confirmationNote}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                          {/* 点数卡信息 */}
                          {submission.pointCardInfo && (
                            <div className="expanded-section">
                              <div className="section-title">💳 点数卡信息</div>
                              <div className="pointcard-info">
                                <div className="pointcard-item">
                                  <span className="pointcard-label">发行卡数：</span>
                                  <span className="pointcard-value">{submission.pointCardInfo.cardsIssued} 张</span>
                                </div>
                                <div className="pointcard-item">
                                  <span className="pointcard-label">总点数：</span>
                                  <span className="pointcard-value">{submission.pointCardInfo.totalPoints} 点</span>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* 销售明细 */}
                          {submission.includedSales && submission.includedSales.length > 0 && (
                            <div className="expanded-section">
                              <div className="section-title">📊 包含销售明细 ({submission.includedSales.length} 笔)</div>
                              <table className="sales-table">
                                <thead>
                                  <tr>
                                    <th>Seller</th>
                                    <th>销售日期</th>
                                    <th>金额</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {submission.includedSales.map((sale, index) => (
                                    <tr key={index}>
                                      <td>{sale.sellerName}</td>
                                      <td>{sale.salesDate}</td>
                                      <td>{formatAmount(sale.amount)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default CashierTransactions;
