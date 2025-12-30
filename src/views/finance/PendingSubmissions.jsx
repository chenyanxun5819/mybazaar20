/**
 * Pending Submissions Component
 * Tab 2: 待确认收款 - 显示和处理待确认的现金上交记录
 */

import React, { useState } from 'react';
import './PendingSubmissions.css';

const PendingSubmissions = ({ submissions, onConfirm, onRefresh }) => {
  const [selectedSubmissions, setSelectedSubmissions] = useState([]);
  const [confirmingId, setConfirmingId] = useState(null);
  const [showDetailId, setShowDetailId] = useState(null);
  const [confirmNote, setConfirmNote] = useState('');

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

  // 处理选中
  const handleToggleSelection = (submissionId) => {
    setSelectedSubmissions(prev => {
      if (prev.includes(submissionId)) {
        return prev.filter(id => id !== submissionId);
      } else {
        return [...prev, submissionId];
      }
    });
  };

  // 确认单笔收款
  const handleConfirmSingle = async (submissionId) => {
    if (confirmingId) return; // 防止重复点击

    const confirmed = window.confirm('确认收到此笔现金？');
    if (!confirmed) return;

    try {
      setConfirmingId(submissionId);
      await onConfirm(submissionId, confirmNote);
      setConfirmNote('');
      alert('收款确认成功！');
      onRefresh();
    } catch (error) {
      alert('确认失败: ' + error.message);
    } finally {
      setConfirmingId(null);
    }
  };

  // 查看明细
  const handleToggleDetail = (submissionId) => {
    setShowDetailId(showDetailId === submissionId ? null : submissionId);
  };

  // 计算总金额
  const totalAmount = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);

  return (
    <div className="pending-submissions">
      {/* 头部 */}
      <div className="pending-header">
        <h2>💵 待确认收款</h2>
        <button className="refresh-button" onClick={onRefresh}>
          🔄 刷新
        </button>
      </div>

      {/* 统计摘要 */}
      {submissions.length > 0 && (
        <div className="pending-summary-bar">
          <div className="summary-info">
            <span className="summary-icon">⚠️</span>
            <span className="summary-text">
              您有 <strong>{submissions.length}</strong> 笔待确认，
              总额 <strong>{formatAmount(totalAmount)}</strong>
            </span>
          </div>
        </div>
      )}

      {/* 待确认列表 */}
      <div className="submissions-list">
        {submissions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <p className="empty-message">太棒了！没有待确认的收款</p>
            <p className="empty-hint">所有现金上交都已处理完毕</p>
          </div>
        ) : (
          submissions.map(submission => (
            <div key={submission.id} className="submission-card">
              {/* 卡片头部 */}
              <div className="card-header">
                <div className="header-left">
                  <span className="submission-number">
                    {submission.submissionNumber || submission.id.slice(0, 8)}
                  </span>
                  <span className="separator">|</span>
                  <span className="submitter-name">{submission.submitterName}</span>
                  <span className="role-badge">{getRoleLabel(submission.submitterRole)}</span>
                </div>
                <div className="header-right">
                  <span className="amount-large">{formatAmount(submission.amount)}</span>
                </div>
              </div>

              {/* 卡片内容 */}
              <div className="card-content">
                <div className="info-row">
                  <div className="info-item">
                    <span className="info-label">提交时间：</span>
                    <span className="info-value">{formatFullDateTime(submission.submittedAt)}</span>
                  </div>
                  {submission.submitterDepartment && (
                    <div className="info-item">
                      <span className="info-label">部门：</span>
                      <span className="info-value">{submission.submitterDepartment}</span>
                    </div>
                  )}
                </div>

                {submission.note && (
                  <div className="info-row">
                    <div className="info-item full-width">
                      <span className="info-label">备注：</span>
                      <span className="info-value">{submission.note}</span>
                    </div>
                  </div>
                )}

                {/* 销售明细 */}
                {submission.includedSales && submission.includedSales.length > 0 && (
                  <div className="sales-detail">
                    <button 
                      className="detail-toggle"
                      onClick={() => handleToggleDetail(submission.id)}
                    >
                      {showDetailId === submission.id ? '▼' : '▶'} 
                      包含 {submission.includedSales.length} 笔销售
                    </button>

                    {showDetailId === submission.id && (
                      <div className="detail-content">
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
                )}
              </div>

              {/* 卡片操作 */}
              <div className="card-actions">
                <button
                  className="confirm-button"
                  onClick={() => handleConfirmSingle(submission.id)}
                  disabled={confirmingId === submission.id}
                >
                  {confirmingId === submission.id ? (
                    <>⏳ 确认中...</>
                  ) : (
                    <>✅ 确认收款</>
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 备注输入（全局） */}
      {submissions.length > 0 && (
        <div className="global-note">
          <label htmlFor="confirmNote">确认备注（可选）：</label>
          <input
            id="confirmNote"
            type="text"
            value={confirmNote}
            onChange={(e) => setConfirmNote(e.target.value)}
            placeholder="例如：已核对无误"
            maxLength={100}
          />
        </div>
      )}
    </div>
  );
};

export default PendingSubmissions;
