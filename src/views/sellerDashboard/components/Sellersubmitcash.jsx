/**
 * SellerSubmitCash.jsx (使用 useSellerStats 版本 v2.0)
 * ✅ 修复：使用 useSellerStats hook 获取实时数据
 * ✅ 修复：正确显示老师/职员的提示信息
 * 
 * @version 2.0
 * @date 2025-01-01
 */

import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db, functions } from '../../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { useSellerStats } from '../hooks/useSellerStats'; // 🔧 使用同样的hook
import { useAuth } from '../../../contexts/AuthContext';
import './SellerSubmitCash.css';

const SellerSubmitCash = () => {
  // 🔧 使用useSellerStats获取实时数据（和PointsOverview一样）
  const { stats, loading: statsLoading, error: statsError } = useSellerStats();
  const { userProfile } = useAuth();
  
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAmount, setSubmitAmount] = useState('');
  const [submitNote, setSubmitNote] = useState('');

  // 从userProfile获取基本信息
  const orgId = userProfile?.organizationId;
  const eventId = userProfile?.eventId;
  const sellerId = userProfile?.userId;
  
  // 🔧 从stats获取现金数据（和PointsOverview一样）
  const cashOnHand = stats?.pendingCollection || 0;
  
  // 🔧 判断用户类型
  const identityTag = userProfile?.identityTag || userProfile?.identityInfo?.userType;
  const isStudent = identityTag === 'student';
  
  // 获取管理者
  const sellerManager = userProfile?.managedBy?.[0];

  console.log('[SellerSubmitCash] 🔍 数据状态:', {
    statsLoading,
    statsError,
    stats,
    cashOnHand,
    identityTag,
    isStudent,
    orgId,
    eventId,
    sellerId
  });

  // ========== 数据加载 ==========

  useEffect(() => {
    if (!orgId || !eventId || !sellerId) {
      console.warn('[SellerSubmitCash] ⚠️ 缺少必要参数');
      setLoading(false);
      return;
    }

    console.log('[SellerSubmitCash] 📊 开始加载上交记录...');

    try {
      const submissionsQuery = query(
        collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`),
        where('submittedBy', '==', sellerId),
        where('submitterRole', '==', 'seller'),
        orderBy('submittedAt', 'desc')
      );

      const unsubscribe = onSnapshot(
        submissionsQuery,
        (snapshot) => {
          const submissionsData = [];
          snapshot.forEach(doc => {
            submissionsData.push({
              id: doc.id,
              ...doc.data()
            });
          });
          console.log('[SellerSubmitCash] ✅ 加载完成:', submissionsData.length, '笔记录');
          setSubmissions(submissionsData);
          setLoading(false);
        },
        (error) => {
          console.error('[SellerSubmitCash] ❌ 加载失败:', error);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error('[SellerSubmitCash] ❌ 设置监听失败:', error);
      setLoading(false);
    }
  }, [orgId, eventId, sellerId]);

  // ========== 数据计算 ==========

  const summaryStats = useMemo(() => {
    const totalSubmitted = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);
    const pending = submissions.filter(s => s.status === 'pending');
    const confirmed = submissions.filter(s => s.status === 'confirmed');

    return {
      cashOnHand,
      totalSubmitted,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, s) => sum + (s.amount || 0), 0),
      confirmedCount: confirmed.length,
      confirmedAmount: confirmed.reduce((sum, s) => sum + (s.amount || 0), 0)
    };
  }, [cashOnHand, submissions]);

  // ========== 事件处理 ==========

  const handleOpenSubmitModal = () => {
    console.log('[SellerSubmitCash] 🔘 打开上交模态框, cashOnHand:', cashOnHand);
    
    if (cashOnHand <= 0) {
      alert('您目前没有可上交的现金');
      return;
    }
    
    if (isStudent && !sellerManager) {
      alert('错误：未找到您的Seller Manager，请联系管理员');
      return;
    }

    setSubmitAmount(cashOnHand.toString());
    setSubmitNote('');
    setShowSubmitModal(true);
  };

  const handleCloseSubmitModal = () => {
    setShowSubmitModal(false);
    setSubmitAmount('');
    setSubmitNote('');
  };

  const handleSubmit = async () => {
    const amount = parseFloat(submitAmount);

    console.log('[SellerSubmitCash] 📤 开始上交:', {
      amount,
      isStudent,
      sellerManager,
      orgId,
      eventId
    });

    if (!amount || amount <= 0) {
      alert('请输入有效的金额');
      return;
    }

    if (amount > cashOnHand) {
      alert(`上交金额不能超过手上现金 (RM ${cashOnHand})`);
      return;
    }

    try {
      setSubmitting(true);

      const auth = getAuth();
      const user = auth.currentUser;
      
      if (!user) {
        throw new Error('用户未登录，请重新登录');
      }

      if (isStudent) {
        console.log('[SellerSubmitCash] 🎓 学生上交给SM:', sellerManager);
        
        const submitToManager = httpsCallable(functions, 'submitCashToSellerManager');
        
        const result = await submitToManager({
          orgId,
          eventId,
          amount,
          note: submitNote,
          sellerManagerId: sellerManager
        });

        if (result.data.success) {
          alert('✅ 上交成功！请将现金交给您的Seller Manager。');
          handleCloseSubmitModal();
        } else {
          throw new Error(result.data.message || '上交失败');
        }
      } else {
        console.log('[SellerSubmitCash] 👨‍🏫 职员/老师直接上交到FM');
        
        const submitToFinance = httpsCallable(functions, 'submitCashToFinance');
        
        const result = await submitToFinance({
          orgId,
          eventId,
          amount,
          note: submitNote
        });

        if (result.data.success) {
          alert('✅ 上交成功！现金已提交到待认领池子，等待Finance Manager确认。');
          handleCloseSubmitModal();
        } else {
          throw new Error(result.data.message || '上交失败');
        }
      }

    } catch (error) {
      console.error('[SellerSubmitCash] ❌ 上交失败:', error);
      
      let errorMessage = '上交失败: ';
      
      if (error.code === 'functions/not-found') {
        errorMessage += 'Cloud Function不存在，请确认已部署Functions';
      } else if (error.code === 'functions/unauthenticated') {
        errorMessage += '用户未登录，请重新登录';
      } else if (error.code === 'functions/permission-denied') {
        errorMessage += '权限不足';
      } else {
        errorMessage += error.message;
      }
      
      alert('❌ ' + errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  // ========== 辅助函数 ==========

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { label: '⏳ 待确认', color: '#f59e0b' },
      confirmed: { label: '✅ 已确认', color: '#10b981' },
      disputed: { label: '⚠️ 有异议', color: '#ef4444' },
      rejected: { label: '❌ 已拒绝', color: '#dc2626' }
    };
    return statusMap[status] || { label: status, color: '#6b7280' };
  };

  const getRecipientInfo = () => {
    if (isStudent) {
      return {
        title: '上交给 Seller Manager',
        icon: '👨‍🏫',
        description: '请将现金交给您的Seller Manager'
      };
    } else {
      return {
        title: '上交到待认领池子',
        icon: '💰',
        description: '现金将提交到待认领池子，等待Finance Manager确认'
      };
    }
  };

  const recipientInfo = getRecipientInfo();

  // ========== 渲染 ==========

  if (statsLoading || loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
        <p>加载中...</p>
      </div>
    );
  }

  if (statsError) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>⚠️</div>
          <h3 style={styles.errorTitle}>加载失败</h3>
          <p style={styles.errorMessage}>{statsError}</p>
          <button 
            style={styles.retryButton}
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 统计卡片 */}
      <div style={styles.statsGrid}>
        <StatCard
          icon="💵"
          title="手上现金"
          value={`RM ${cashOnHand.toLocaleString()}`}
          color="#10b981"
          description="可上交金额"
        />
        <StatCard
          icon="📤"
          title="待确认"
          value={`RM ${summaryStats.pendingAmount.toLocaleString()}`}
          color="#f59e0b"
          description={`${summaryStats.pendingCount} 笔`}
        />
        <StatCard
          icon="✅"
          title="已确认"
          value={`RM ${summaryStats.confirmedAmount.toLocaleString()}`}
          color="#3b82f6"
          description={`${summaryStats.confirmedCount} 笔`}
        />
        <StatCard
          icon="📊"
          title="累计上交"
          value={`RM ${summaryStats.totalSubmitted.toLocaleString()}`}
          color="#8b5cf6"
          description="历史总额"
        />
      </div>

      {/* 上交操作区 */}
      <div style={styles.actionCard}>
        <div style={styles.actionHeader}>
          <div>
            <h3 style={styles.actionTitle}>
              {recipientInfo.icon} {recipientInfo.title}
            </h3>
            <p style={styles.actionDesc}>{recipientInfo.description}</p>
          </div>
          <button
            onClick={handleOpenSubmitModal}
            style={{
              ...styles.submitButton,
              opacity: cashOnHand <= 0 ? 0.5 : 1,
              cursor: cashOnHand <= 0 ? 'not-allowed' : 'pointer'
            }}
            disabled={cashOnHand <= 0}
          >
            📤 上交现金
          </button>
        </div>

        {cashOnHand > 0 && (
          <div style={styles.reminderBox}>
            💡 您有 <strong>RM {cashOnHand.toLocaleString()}</strong> 现金待上交
          </div>
        )}
      </div>

      {/* 上交历史 */}
      {submissions.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={styles.sectionTitle}>📜 上交历史</h3>
          <div style={styles.submissionsList}>
            {submissions.map(submission => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                isStudent={isStudent}
                formatDate={formatDate}
                getStatusBadge={getStatusBadge}
              />
            ))}
          </div>
        </div>
      )}

      {submissions.length === 0 && (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📭</div>
          <h3>暂无上交记录</h3>
          <p>完成第一笔现金上交后，记录将显示在这里</p>
        </div>
      )}

      {/* 上交模态框 */}
      {showSubmitModal && (
        <SubmitModal
          isStudent={isStudent}
          recipientInfo={recipientInfo}
          cashOnHand={cashOnHand}
          submitAmount={submitAmount}
          setSubmitAmount={setSubmitAmount}
          submitNote={submitNote}
          setSubmitNote={setSubmitNote}
          submitting={submitting}
          onSubmit={handleSubmit}
          onClose={handleCloseSubmitModal}
        />
      )}
    </div>
  );
};

// ========== 子组件 ==========

const StatCard = ({ icon, title, value, color, description }) => (
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
      {description && <div style={styles.statDescription}>{description}</div>}
    </div>
  </div>
);

const SubmissionCard = ({ submission, isStudent, formatDate, getStatusBadge }) => {
  const statusInfo = getStatusBadge(submission.status);

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div>
          <div style={styles.submissionTitle}>
            上交编号: {submission.submissionNumber || submission.id.slice(0, 8)}
          </div>
          <div style={styles.submissionDate}>
            {formatDate(submission.submittedAt)}
          </div>
        </div>
        <div 
          style={{
            ...styles.submissionStatus,
            background: statusInfo.color
          }}
        >
          {statusInfo.label}
        </div>
      </div>

      <div style={styles.submissionBody}>
        <div style={styles.detailRow}>
          <span>金额:</span>
          <strong>RM {(submission.amount || 0).toLocaleString()}</strong>
        </div>
        <div style={styles.detailRow}>
          <span>上交对象:</span>
          <strong>{isStudent ? 'Seller Manager' : 'Finance Manager'}</strong>
        </div>
        {submission.receiverName && (
          <div style={styles.detailRow}>
            <span>接收人:</span>
            <strong>{submission.receiverName}</strong>
          </div>
        )}
      </div>

      {submission.note && (
        <div style={styles.submissionNote}>
          📝 备注: {submission.note}
        </div>
      )}

      {submission.status === 'confirmed' && submission.confirmationNote && (
        <div style={styles.confirmedNote}>
          ✅ 确认备注: {submission.confirmationNote}
        </div>
      )}
    </div>
  );
};

const SubmitModal = ({
  isStudent,
  recipientInfo,
  cashOnHand,
  submitAmount,
  setSubmitAmount,
  submitNote,
  setSubmitNote,
  submitting,
  onSubmit,
  onClose
}) => {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>📤 上交现金</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.modalInfoBanner}>
            <span>{recipientInfo.icon}</span>
            <span>{recipientInfo.description}</span>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>上交金额 *</label>
            <div style={styles.amountInputWrapper}>
              <span style={styles.currency}>RM</span>
              <input
                type="number"
                value={submitAmount}
                onChange={(e) => setSubmitAmount(e.target.value)}
                placeholder="0.00"
                style={styles.amountInput}
                min="0"
                max={cashOnHand}
                step="0.01"
                disabled={submitting}
              />
            </div>
            <div style={styles.hint}>
              手上现金: RM {cashOnHand.toLocaleString()}
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="例如：第一周销售现金"
              style={styles.textarea}
              rows={3}
              disabled={submitting}
            />
          </div>

          <div style={styles.warningBox}>
            ⚠️ 请确认金额正确，上交后不可撤销
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button 
            style={styles.cancelButton} 
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button 
            style={styles.confirmButton} 
            onClick={onSubmit}
            disabled={submitting || !submitAmount || parseFloat(submitAmount) <= 0}
          >
            {submitting ? '提交中...' : '✅ 确认上交'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== 样式 ==========

const styles = {
  container: { padding: '20px', maxWidth: '1200px', margin: '0 auto' },
  loading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: '#6b7280' },
  spinner: { width: '40px', height: '40px', border: '4px solid #f3f4f6', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  errorCard: { background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '12px', padding: '2rem', textAlign: 'center' },
  errorIcon: { fontSize: '3rem', marginBottom: '1rem' },
  errorTitle: { color: '#991b1b', marginBottom: '0.5rem' },
  errorMessage: { color: '#7f1d1d', marginBottom: '1.5rem' },
  retryButton: { padding: '0.75rem 1.5rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1rem', marginBottom: '1.5rem' },
  statCard: { background: '#fafafa', padding: '1.25rem', borderRadius: '12px', borderLeft: '4px solid', display: 'flex', alignItems: 'flex-start', gap: '1rem' },
  statIcon: { fontSize: '2rem' },
  statContent: { flex: 1 },
  statValue: { fontSize: '1.5rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '0.25rem' },
  statTitle: { fontSize: '0.875rem', color: '#6b7280', fontWeight: '500' },
  statDescription: { fontSize: '0.75rem', color: '#9ca3af', marginTop: '0.25rem' },
  actionCard: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '1.5rem', borderRadius: '12px', color: 'white', marginBottom: '2rem' },
  actionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' },
  actionTitle: { fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' },
  actionDesc: { fontSize: '0.875rem', opacity: 0.9, margin: 0 },
  submitButton: { padding: '0.75rem 1.5rem', background: 'white', color: '#667eea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600', whiteSpace: 'nowrap' },
  reminderBox: { padding: '0.75rem 1rem', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '8px', fontSize: '0.875rem' },
  sectionTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1rem' },
  historySection: { marginTop: '2rem' },
  submissionsList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' },
  submissionCard: { background: '#fafafa', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '1.5rem' },
  submissionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem' },
  submissionTitle: { fontSize: '1rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '0.25rem' },
  submissionDate: { fontSize: '0.75rem', color: '#6b7280' },
  submissionStatus: { padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: '600', color: 'white', whiteSpace: 'nowrap' },
  submissionBody: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' },
  detailRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#374151' },
  submissionNote: { padding: '0.75rem', background: '#f3f4f6', borderRadius: '8px', fontSize: '0.75rem', color: '#374151', marginTop: '0.5rem' },
  confirmedNote: { padding: '0.75rem', background: '#d1fae5', borderRadius: '8px', fontSize: '0.75rem', color: '#065f46', marginTop: '0.5rem' },
  emptyState: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  emptyIcon: { fontSize: '4rem', marginBottom: '1rem' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modal: { background: 'white', borderRadius: '12px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { padding: '1.5rem', borderBottom: '2px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  closeButton: { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6b7280' },
  modalBody: { padding: '1.5rem' },
  modalInfoBanner: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#1e40af' },
  formGroup: { marginBottom: '1.5rem' },
  label: { display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' },
  amountInputWrapper: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  currency: { fontSize: '1rem', fontWeight: '600', color: '#6b7280' },
  amountInput: { flex: 1, padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem', fontWeight: '600' },
  hint: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' },
  textarea: { width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  warningBox: { padding: '0.75rem 1rem', background: '#fef3c7', border: '2px solid #fbbf24', color: '#92400e', borderRadius: '8px', fontSize: '0.875rem', fontWeight: '500' },
  modalFooter: { padding: '1.5rem', borderTop: '2px solid #e5e7eb', display: 'flex', gap: '1rem', justifyContent: 'flex-end' },
  cancelButton: { padding: '0.75rem 1.5rem', background: 'white', border: '2px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600', color: '#374151' },
  confirmButton: { padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' }
};

export default SellerSubmitCash;