/**
 * CashSubmissionsTab.jsx
 * Cashier 查看和确认现金上交记录
 * 
 * 功能：
 * 1. 显示所有 pending 状态的 cashSubmissions
 * 2. 显示提交人、金额、提交时间
 * 3. 点击查看详情
 * 4. 确认收款并输入收据编号
 * 5. 输入交易密码确认
 * 
 * 创建日期：2025-01-20
 */

import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../firebase';
import TransactionPinDialog from '@components/common/TransactionPinDialog';
import './CashSubmissionsTab.css';

const CashSubmissionsTab = ({ organizationId, eventId, cashierUid }) => {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [confirmationNote, setConfirmationNote] = useState('');
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [filter, setFilter] = useState('pending'); // 'pending' | 'confirmed' | 'all'

  // 实时监听 pending 的现金上交记录
  useEffect(() => {
    if (!organizationId || !eventId) return;

    setLoading(true);
    setError('');

    const submissionsRef = collection(
      db,
      'organizations',
      organizationId,
      'events',
      eventId,
      'cashSubmissions'
    );

    let q;
    if (filter === 'all') {
      q = query(submissionsRef, orderBy('submittedAt', 'desc'));
    } else {
      q = query(
        submissionsRef,
        where('status', '==', filter),
        orderBy('submittedAt', 'desc')
      );
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const submissionsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          submittedAt: doc.data().submittedAt?.toDate(),
          confirmedAt: doc.data().confirmedAt?.toDate()
        }));

        setSubmissions(submissionsData);
        setLoading(false);
      },
      (err) => {
        console.error('监听现金上交记录失败:', err);
        setError('加载失败: ' + err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [organizationId, eventId, filter]);

  // 打开确认对话框
  const handleConfirmClick = (submission) => {
    setSelectedSubmission(submission);
    setReceiptNumber('');
    setConfirmationNote('');
    setShowConfirmDialog(true);
  };

  // 关闭确认对话框
  const handleCloseConfirmDialog = () => {
    setShowConfirmDialog(false);
    setSelectedSubmission(null);
    setReceiptNumber('');
    setConfirmationNote('');
  };

  // 提交确认（打开密码输入）
  const handleSubmitConfirm = () => {
    if (!selectedSubmission) return;
    setShowConfirmDialog(false);
    setShowPinDialog(true);
  };

  // 确认现金上交
  const handleConfirmSubmission = async (pin) => {
    if (!selectedSubmission) return;

    setProcessing(true);
    setError('');

    try {
      const confirmCashSubmission = httpsCallable(functions, 'confirmCashSubmissionByCashier');
      
      const result = await confirmCashSubmission({
        submissionId: selectedSubmission.id,
        receiptNumber: receiptNumber || null,
        confirmationNote: confirmationNote || '',
        transactionPin: pin,
        organizationId,
        eventId
      });

      console.log('确认成功:', result.data);

      // 关闭对话框
      setShowPinDialog(false);
      setSelectedSubmission(null);
      setReceiptNumber('');
      setConfirmationNote('');

      // 显示成功消息
      alert(`✅ 确认成功！\n\n提交人：${result.data.submitterName}\n金额：RM ${result.data.amount.toFixed(2)}`);

    } catch (err) {
      console.error('确认失败:', err);
      let errorMessage = '确认失败: ';
      
      if (err.code === 'functions/failed-precondition') {
        errorMessage += err.message || '前置条件检查失败';
      } else if (err.code === 'functions/permission-denied') {
        errorMessage += '权限不足或密码错误';
      } else if (err.code === 'functions/not-found') {
        errorMessage += '记录不存在';
      } else {
        errorMessage += err.message || '未知错误';
      }
      
      setError(errorMessage);
      setShowPinDialog(false);
    } finally {
      setProcessing(false);
    }
  };

  // 取消密码输入
  const handleCancelPin = () => {
    setShowPinDialog(false);
    setShowConfirmDialog(true); // 回到确认对话框
  };

  // 格式化日期时间
  const formatDateTime = (date) => {
    if (!date) return '-';
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  // 获取状态显示
  const getStatusDisplay = (status) => {
    const statusMap = {
      pending: { label: '待确认', color: '#f59e0b' },
      confirmed: { label: '已确认', color: '#10b981' },
      disputed: { label: '有争议', color: '#ef4444' },
      rejected: { label: '已拒绝', color: '#6b7280' }
    };
    return statusMap[status] || { label: status, color: '#6b7280' };
  };

  // 获取角色显示
  const getRoleDisplay = (role) => {
    const roleMap = {
      seller: 'Seller (销售员)',
      sellerManager: 'Seller Manager (销售经理)',
      pointSeller: 'Point Seller (点数卡销售员)'
    };
    return roleMap[role] || role;
  };

  if (loading) {
    return (
      <div className="cash-submissions-loading">
        <div className="loading-spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div className="cash-submissions-container">
      {/* 标题和过滤器 */}
      <div className="submissions-header">
        <h2>现金上交确认</h2>
        <div className="filter-buttons">
          <button
            className={filter === 'pending' ? 'active' : ''}
            onClick={() => setFilter('pending')}
          >
            待确认 ({submissions.filter(s => s.status === 'pending').length})
          </button>
          <button
            className={filter === 'confirmed' ? 'active' : ''}
            onClick={() => setFilter('confirmed')}
          >
            已确认
          </button>
          <button
            className={filter === 'all' ? 'active' : ''}
            onClick={() => setFilter('all')}
          >
            全部
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="error-message">
          <span>⚠️</span>
          <p>{error}</p>
          <button onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* 记录列表 */}
      <div className="submissions-list">
        {submissions.length === 0 ? (
          <div className="empty-state">
            <p>📭</p>
            <p>暂无{filter === 'pending' ? '待确认' : filter === 'confirmed' ? '已确认' : ''}记录</p>
          </div>
        ) : (
          submissions.map(submission => {
            const statusInfo = getStatusDisplay(submission.status);
            
            return (
              <div key={submission.id} className="submission-card">
                <div className="submission-header">
                  <div className="submitter-info">
                    <h3>{submission.submitterName}</h3>
                    <span className="submitter-role">
                      {getRoleDisplay(submission.submitterRole)}
                    </span>
                  </div>
                  <div className="submission-amount">
                    <span className="amount-label">上交金额</span>
                    <span className="amount-value">RM {submission.amount.toFixed(2)}</span>
                  </div>
                </div>

                <div className="submission-details">
                  <div className="detail-row">
                    <span className="detail-label">流水号：</span>
                    <span>{submission.submissionNumber || submission.id.slice(0, 8)}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">提交时间：</span>
                    <span>{formatDateTime(submission.submittedAt)}</span>
                  </div>
                  {submission.status === 'confirmed' && (
                    <>
                      <div className="detail-row">
                        <span className="detail-label">确认时间：</span>
                        <span>{formatDateTime(submission.confirmedAt)}</span>
                      </div>
                      {submission.receiptNumber && (
                        <div className="detail-row">
                          <span className="detail-label">收据编号：</span>
                          <span>{submission.receiptNumber}</span>
                        </div>
                      )}
                      {submission.confirmationNote && (
                        <div className="detail-row">
                          <span className="detail-label">确认备注：</span>
                          <span>{submission.confirmationNote}</span>
                        </div>
                      )}
                    </>
                  )}
                  {submission.note && (
                    <div className="detail-row">
                      <span className="detail-label">备注：</span>
                      <span>{submission.note}</span>
                    </div>
                  )}

                  {/* 点数卡信息 */}
                  {submission.pointCardInfo && submission.pointCardInfo.cardsIssued > 0 && (
                    <div className="point-card-info">
                      <span className="detail-label">点数卡信息：</span>
                      <span>
                        发行 {submission.pointCardInfo.cardsIssued} 张卡，
                        共 {submission.pointCardInfo.pointsIssued} 点
                      </span>
                    </div>
                  )}
                </div>

                <div className="submission-footer">
                  <div className="status-badge" style={{ backgroundColor: `${statusInfo.color}15`, color: statusInfo.color }}>
                    {statusInfo.label}
                  </div>
                  
                  {submission.status === 'pending' && (
                    <button
                      className="confirm-button"
                      onClick={() => handleConfirmClick(submission)}
                    >
                      ✓ 确认收款
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 确认对话框 */}
      {showConfirmDialog && selectedSubmission && (
        <div className="modal-overlay" onClick={handleCloseConfirmDialog}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>确认现金上交</h3>
              <button className="close-button" onClick={handleCloseConfirmDialog}>×</button>
            </div>

            <div className="modal-body">
              <div className="confirm-info">
                <div className="info-row">
                  <span className="info-label">提交人：</span>
                  <span className="info-value">{selectedSubmission.submitterName}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">角色：</span>
                  <span className="info-value">{getRoleDisplay(selectedSubmission.submitterRole)}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">金额：</span>
                  <span className="info-value amount">RM {selectedSubmission.amount.toFixed(2)}</span>
                </div>
              </div>

              <div className="form-group">
                <label>收据编号（可选）</label>
                <input
                  type="text"
                  value={receiptNumber}
                  onChange={(e) => setReceiptNumber(e.target.value)}
                  placeholder="输入收据编号"
                />
              </div>

              <div className="form-group">
                <label>确认备注（可选）</label>
                <textarea
                  value={confirmationNote}
                  onChange={(e) => setConfirmationNote(e.target.value)}
                  placeholder="输入确认备注"
                  rows="3"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="cancel-button" onClick={handleCloseConfirmDialog}>
                取消
              </button>
              <button className="submit-button" onClick={handleSubmitConfirm}>
                确认收款
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && (
        <TransactionPinDialog
          isOpen={showPinDialog}
          onClose={handleCancelPin}
          onSubmit={handleConfirmSubmission}
          title="验证交易密码"
          description={`确认收款 RM ${selectedSubmission?.amount.toFixed(2)}`}
          loading={processing}
        />
      )}
    </div>
  );
};

export default CashSubmissionsTab;
