/**
 * CollectCash.jsx (完全重构版 v3.0)
 * SellerManager确认收到学生Seller的现金
 * 
 * 🔧 架构对齐修改：
 * 1. 从cashSubmissions集合读取待确认数据（不是seller.pendingCollection）
 * 2. 查询条件：receivedBy=smId, status='pending'
 * 3. 调用confirmCashSubmission函数确认收款
 * 4. 实时监听数据更新
 * 
 * 数据流：
 * 学生上交 → cashSubmissions (status=pending) → SM确认 → status=confirmed
 * 
 * @version 3.0
 * @date 2025-01-03
 */

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../config/firebase';

const CollectCash = ({ userInfo, eventData }) => {
  // 待确认的submissions
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 确认对话框
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  // 搜索和筛选
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('dateDesc');

  const orgId = userInfo?.organizationId?.replace('organization_', '') || '';
  const eventId = userInfo?.eventId?.replace('event_', '') || '';
  const smId = userInfo?.userId;

  console.log('[CollectCash] 初始化:', { orgId, eventId, smId });

  // ===== 加载待确认的submissions =====
  useEffect(() => {
    if (!orgId || !eventId || !smId) {
      console.warn('[CollectCash] 缺少必要参数');
      setLoading(false);
      return;
    }

    console.log('[CollectCash] 开始监听cashSubmissions...');
    setLoading(true);

    try {
      // 查询条件：receivedBy=smId, status=pending
      const submissionsRef = collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`);
      const q = query(
        submissionsRef,
        where('receivedBy', '==', smId),
        where('status', '==', 'pending'),
        orderBy('submittedAt', 'desc')
      );

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const submissions = [];
          snapshot.forEach(doc => {
            submissions.push({
              id: doc.id,
              ...doc.data()
            });
          });

          console.log(`[CollectCash] 加载了 ${submissions.length} 条待确认记录`);
          setPendingSubmissions(submissions);
          setLoading(false);
        },
        (error) => {
          console.error('[CollectCash] 监听失败:', error);
          
          // 检查是否是索引错误
          if (error.code === 'failed-precondition') {
            console.error('[CollectCash] ⚠️ 需要创建Firestore索引！');
            console.error('请点击Console中的链接创建索引，或手动在Firebase Console创建：');
            console.error('集合: cashSubmissions');
            console.error('字段: receivedBy (升序), status (升序), submittedAt (降序)');
          }
          
          setLoading(false);
        }
      );

      return () => {
        console.log('[CollectCash] 清理监听器');
        unsubscribe();
      };

    } catch (error) {
      console.error('[CollectCash] 设置监听失败:', error);
      setLoading(false);
    }
  }, [orgId, eventId, smId]);

  // ===== 统计数据计算 =====
  const stats = {
    totalPending: pendingSubmissions.reduce((sum, s) => sum + (s.amount || 0), 0),
    count: pendingSubmissions.length,
    cashOnHand: userInfo?.sellerManager?.cashStats?.cashOnHand || 0,
    confirmedFromSellers: userInfo?.sellerManager?.cashStats?.confirmedFromSellers || 0
  };

  // ===== 搜索和排序 =====
  const filteredAndSortedSubmissions = () => {
    let result = [...pendingSubmissions];

    // 搜索
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(s =>
        s.submitterName?.toLowerCase().includes(term) ||
        s.submitterDepartment?.toLowerCase().includes(term) ||
        s.submissionNumber?.toLowerCase().includes(term)
      );
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case 'dateDesc':
          return (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0);
        case 'dateAsc':
          return (a.submittedAt?.toMillis?.() || 0) - (b.submittedAt?.toMillis?.() || 0);
        case 'amountDesc':
          return (b.amount || 0) - (a.amount || 0);
        case 'amountAsc':
          return (a.amount || 0) - (b.amount || 0);
        case 'nameAsc':
          return (a.submitterName || '').localeCompare(b.submitterName || '');
        default:
          return 0;
      }
    });

    return result;
  };

  // ===== 确认收款 =====
  const handleConfirmSubmission = async () => {
    if (!selectedSubmission) return;

    console.log('[CollectCash] 开始确认收款:', selectedSubmission.id);
    setConfirming(true);

    try {
      const confirmFunc = httpsCallable(functions, 'confirmCashSubmission');
      
      const result = await confirmFunc({
        orgId: `organization_${orgId}`,
        eventId: `event_${eventId}`,
        submissionId: selectedSubmission.id,
        note: confirmNote
      });

      console.log('[CollectCash] 确认成功:', result.data);
      
      alert(`✅ ${result.data.message}`);
      
      // 关闭对话框
      setShowConfirmModal(false);
      setSelectedSubmission(null);
      setConfirmNote('');

    } catch (error) {
      console.error('[CollectCash] 确认失败:', error);
      alert(`❌ 确认失败: ${error.message}`);
    } finally {
      setConfirming(false);
    }
  };

  // ===== 渲染 =====

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
        <p>加载数据中...</p>
      </div>
    );
  }

  const displayedSubmissions = filteredAndSortedSubmissions();

  return (
    <div style={styles.container}>
      {/* 统计卡片 */}
      <div style={styles.statsGrid}>
        <StatCard
          icon="⏳"
          title="待确认笔数"
          value={stats.count}
          color="#f59e0b"
          description="学生已上交"
        />
        <StatCard
          icon="💰"
          title="待确认金额"
          value={`RM ${stats.totalPending.toLocaleString()}`}
          color="#ef4444"
          description="需要确认收款"
        />
        <StatCard
          icon="✅"
          title="已确认金额"
          value={`RM ${stats.confirmedFromSellers.toLocaleString()}`}
          color="#10b981"
          description="累计已确认"
        />
        <StatCard
          icon="🏦"
          title="持有现金"
          value={`RM ${stats.cashOnHand.toLocaleString()}`}
          color="#3b82f6"
          description="可上交给Finance"
        />
      </div>

      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 搜索学生姓名、班级或流水号..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={styles.select}
        >
          <option value="dateDesc">提交时间: 新→旧</option>
          <option value="dateAsc">提交时间: 旧→新</option>
          <option value="amountDesc">金额: 高→低</option>
          <option value="amountAsc">金额: 低→高</option>
          <option value="nameAsc">姓名: A→Z</option>
        </select>
      </div>

      {/* Submissions列表 */}
      {displayedSubmissions.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📭</div>
          <h3>没有待确认的现金</h3>
          {searchTerm ? (
            <p>尝试调整搜索条件</p>
          ) : (
            <p>当学生上交现金后，会在这里显示</p>
          )}
        </div>
      ) : (
        <div style={styles.submissionsList}>
          {displayedSubmissions.map(submission => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              onConfirm={() => {
                setSelectedSubmission(submission);
                setShowConfirmModal(true);
              }}
            />
          ))}
        </div>
      )}

      {/* 确认对话框 */}
      {showConfirmModal && selectedSubmission && (
        <ConfirmModal
          submission={selectedSubmission}
          note={confirmNote}
          onNoteChange={setConfirmNote}
          onConfirm={handleConfirmSubmission}
          onCancel={() => {
            setShowConfirmModal(false);
            setSelectedSubmission(null);
            setConfirmNote('');
          }}
          confirming={confirming}
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

const SubmissionCard = ({ submission, onConfirm }) => {
  const formatDate = (timestamp) => {
    if (!timestamp || !timestamp.toDate) return '-';
    const date = timestamp.toDate();
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div style={styles.submissionInfo}>
          <div style={styles.submitterName}>
            {submission.submitterName || '未知'}
          </div>
          <div style={styles.submissionMeta}>
            {submission.submitterDepartment || '-'} | {submission.submissionNumber || '-'}
          </div>
        </div>
        <div style={styles.submissionActions}>
          <div style={styles.submissionAmount}>
            <div style={styles.amountLabel}>金额</div>
            <div style={styles.amountValue}>
              RM {(submission.amount || 0).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div style={styles.submissionDetails}>
        <div style={styles.detailRow}>
          <span style={styles.detailLabel}>提交时间:</span>
          <span>{formatDate(submission.submittedAt)}</span>
        </div>
        {submission.note && (
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>备注:</span>
            <span>{submission.note}</span>
          </div>
        )}
      </div>

      <button
        onClick={onConfirm}
        style={styles.confirmButton}
      >
        ✅ 确认收款
      </button>
    </div>
  );
};

const ConfirmModal = ({ submission, note, onNoteChange, onConfirm, onCancel, confirming }) => (
  <div style={styles.modalOverlay} onClick={onCancel}>
    <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
      <div style={styles.modalHeader}>
        <h3 style={{ margin: 0 }}>确认收款</h3>
        <button onClick={onCancel} style={styles.closeButton}>×</button>
      </div>

      <div style={styles.modalBody}>
        <div style={styles.confirmInfo}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>学生:</span>
            <span style={styles.infoValue}>{submission.submitterName}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>班级:</span>
            <span style={styles.infoValue}>{submission.submitterDepartment || '-'}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>金额:</span>
            <span style={{ ...styles.infoValue, color: '#ef4444', fontWeight: 'bold', fontSize: '1.125rem' }}>
              RM {(submission.amount || 0).toLocaleString()}
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>流水号:</span>
            <span style={styles.infoValue}>{submission.submissionNumber}</span>
          </div>
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>确认备注（可选）:</label>
          <textarea
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="例如：已清点核对，现金无误"
            rows={3}
            style={styles.textarea}
          />
        </div>

        <div style={styles.warningBox}>
          ⚠️ 确认后，此笔现金将加入您的持有现金中，可上交给Finance Manager
        </div>
      </div>

      <div style={styles.modalFooter}>
        <button onClick={onCancel} style={styles.cancelButton} disabled={confirming}>
          取消
        </button>
        <button
          onClick={onConfirm}
          style={styles.submitButton}
          disabled={confirming}
        >
          {confirming ? '确认中...' : '✅ 确认收款'}
        </button>
      </div>
    </div>
  </div>
);

// ========== 样式 ==========
const styles = {
  container: {
    padding: '0'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  spinner: {
    width: '3rem',
    height: '3rem',
    border: '4px solid #e5e7eb',
    borderTopColor: '#f59e0b',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  statCard: {
    background: '#fafafa',
    padding: '1.25rem',
    borderRadius: '12px',
    borderLeft: '4px solid',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem'
  },
  statIcon: {
    fontSize: '2rem'
  },
  statContent: {
    flex: 1
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap'
  },
  searchInput: {
    flex: '1 1 300px',
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem'
  },
  select: {
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    background: 'white',
    cursor: 'pointer'
  },
  submissionsList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem'
  },
  submissionCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem',
    transition: 'all 0.2s',
    ':hover': {
      borderColor: '#f59e0b',
      boxShadow: '0 4px 12px rgba(245, 158, 11, 0.1)'
    }
  },
  submissionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
    gap: '1rem'
  },
  submissionInfo: {
    flex: 1
  },
  submitterName: {
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  submissionMeta: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  submissionActions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end'
  },
  submissionAmount: {
    textAlign: 'right'
  },
  amountLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  amountValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#ef4444'
  },
  submissionDetails: {
    padding: '1rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  detailLabel: {
    color: '#6b7280',
    fontWeight: '500'
  },
  confirmButton: {
    width: '100%',
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    transition: 'opacity 0.2s'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'white',
    borderRadius: '12px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto'
  },
  modalHeader: {
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0',
    width: '2rem',
    height: '2rem'
  },
  modalBody: {
    padding: '1.5rem'
  },
  confirmInfo: {
    background: '#f3f4f6',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    fontSize: '0.875rem'
  },
  infoLabel: {
    color: '#6b7280',
    fontWeight: '500'
  },
  infoValue: {
    color: '#1f2937',
    fontWeight: '600'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  warningBox: {
    background: '#fef3c7',
    border: '2px solid #fbbf24',
    color: '#92400e',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  modalFooter: {
    padding: '1.5rem',
    borderTop: '2px solid #e5e7eb',
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  }
};

// 添加keyframes动画
const styleSheet = document.styleSheets[0];
if (styleSheet) {
  try {
    styleSheet.insertRule(`@keyframes spin { to { transform: rotate(360deg); } }`, styleSheet.cssRules.length);
  } catch (e) { }
}

export default CollectCash;