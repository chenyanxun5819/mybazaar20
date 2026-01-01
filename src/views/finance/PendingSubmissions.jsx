/**
 * Pending Submissions Component - Desktop Table Layout
 * Tab 2: 待认领收款池 - 表格列表模式
 */

import React, { useState } from 'react';
import TransactionPinDialog from './TransactionPinDialog';
import './PendingSubmissions.css';

const PendingSubmissions = ({ submissions, onClaim, onRefresh, currentUser }) => {
  const [claimingId, setClaimingId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState(null);

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

  // 处理接单确认按钮点击
  const handleClaimClick = (submission) => {
    setSelectedSubmission(submission);
    setShowPinDialog(true);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, confirmationNote) => {
    if (!selectedSubmission) return;

    try {
      setClaimingId(selectedSubmission.id);
      setShowPinDialog(false);

      await onClaim(selectedSubmission.id, pin, confirmationNote);

      alert('✅ 收款确认成功！');
      setSelectedSubmission(null);
      onRefresh();
    } catch (error) {
      console.error('接单确认失败:', error);
      alert('❌ 确认失败: ' + error.message);
    } finally {
      setClaimingId(null);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setSelectedSubmission(null);
  };

  // 切换展开/收起
  const toggleExpanded = (submissionId) => {
    setExpandedId(expandedId === submissionId ? null : submissionId);
  };

  // 计算总金额
  const totalAmount = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);

  return (
    <div className="pending-submissions">
      {/* 头部 */}
      <div className="pending-header">
        <h2>💰 待认领收款池</h2>
        <button className="refresh-button" onClick={onRefresh}>
          🔄 刷新
        </button>
      </div>

      {/* 说明提示 */}
      <div className="info-banner">
        <span className="info-icon">ℹ️</span>
        <span className="info-text">
          <strong>接单制收款：</strong>任何Finance Manager都可以接单处理，先到先得。提交者携带现金到财务室后，点击"接单确认"完成收款。
        </span>
      </div>

      {/* 统计摘要 */}
      {submissions.length > 0 && (
        <div className="pending-summary-bar">
          <div className="summary-info">
            <span className="summary-icon">📋</span>
            <span className="summary-text">
              当前池子有 <strong>{submissions.length}</strong> 笔待认领，
              总额 <strong>{formatAmount(totalAmount)}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 待认领表格 */}
      {submissions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <p className="empty-message">太棒了！待认领池子是空的</p>
          <p className="empty-hint">所有现金上交都已处理完毕</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="submissions-table">
            <thead>
              <tr>
                <th>提交者</th>
                <th>金额</th>
                <th>提交时间</th>
                <th>备注</th>
                <th>明细</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map(submission => (
                <React.Fragment key={submission.id}>
                  {/* 主行 */}
                  <tr>
                    {/* 提交者列 */}
                    <td>
                      <div className="submitter-cell">
                        <span className="role-icon">{getRoleIcon(submission.submitterRole)}</span>
                        <div className="submitter-info">
                          <div className="submitter-name">{submission.submitterName}</div>
                          <div className="submitter-meta">
                            <span className="role-badge">{getRoleLabel(submission.submitterRole)}</span>
                            {submission.submitterDepartment && (
                              <span className="department-text">• {submission.submitterDepartment}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 金额列 */}
                    <td>
                      <div className="amount-cell">{formatAmount(submission.amount)}</div>
                    </td>

                    {/* 时间列 */}
                    <td>
                      <div className="time-cell">{formatFullDateTime(submission.submittedAt)}</div>
                    </td>

                    {/* 备注列 */}
                    <td>
                      <div className={`note-cell ${!submission.note ? 'empty' : ''}`}>
                        {submission.note || '-'}
                      </div>
                    </td>

                    {/* 明细列 */}
                    <td className="detail-cell">
                      {(submission.includedSales?.length > 0 || submission.pointCardInfo) ? (
                        <button 
                          className="detail-button"
                          onClick={() => toggleExpanded(submission.id)}
                        >
                          {expandedId === submission.id ? '▼' : '▶'} 查看
                        </button>
                      ) : (
                        <span style={{ color: '#d1d5db' }}>-</span>
                      )}
                    </td>

                    {/* 操作列 */}
                    <td className="action-cell">
                      <button
                        className="claim-button"
                        onClick={() => handleClaimClick(submission)}
                        disabled={claimingId === submission.id}
                      >
                        {claimingId === submission.id ? '⏳ 处理中...' : '🎯 接单确认'}
                      </button>
                    </td>
                  </tr>

                  {/* 展开行 */}
                  {expandedId === submission.id && (
                    <tr className="expanded-row">
                      <td colSpan="6">
                        <div className="expanded-content">
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

      {/* 交易密码对话框 */}
      {showPinDialog && selectedSubmission && (
        <TransactionPinDialog
          submission={selectedSubmission}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
        />
      )}
    </div>
  );
};

export default PendingSubmissions;