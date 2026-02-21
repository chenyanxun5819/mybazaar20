/**
 * SubmitCash.jsx (数据源统一修复版)
 * 
 * 🔧 关键修复：
 * 1. 统计卡片的"当前持有现金"改为从 userInfo.sellerManager.cashStats.cashOnHand 读取
 * 2. 保持与 CollectCash.jsx 的数据源一致性
 * 3. cashCollections 集合仍用于列表展示和选择，但统计数据以 cashStats 为准
 * 
 * @version 2.1 (数据源统一)
 * @date 2025-02-15
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs,
  doc
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db, functions } from '../../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import './SubmitCash.css';

const SubmitCash = ({ userInfo, eventData }) => {
  const [collections, setCollections] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('collected');
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  // ✅ 实时监听 SM 用户文档中的 cashStats，避免依赖静态 userInfo prop
  const [liveCashStats, setLiveCashStats] = useState(null);

  const orgId = userInfo.organizationId;
  const eventId = userInfo.eventId;
  const smId = userInfo.userId;

  // ========== 数据加载 ==========

  // ✅ 实时监听 SM 用户文档，确保 cashStats 在 CollectCash 确认后立即更新
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;

    const smDocRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${smId}`);

    const unsubscribe = onSnapshot(
      smDocRef,
      (snap) => {
        if (snap.exists()) {
          setLiveCashStats(snap.data()?.sellerManager?.cashStats || {});
        }
      },
      (error) => {
        console.error('[SubmitCash] 监听 SM 用户文档失败:', error);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // 加载收款记录（从学生收集的现金）
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;

    const collectionsQuery = query(
      collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`),
      where('collectedBy', '==', smId),
      orderBy('collectedAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      collectionsQuery,
      (snapshot) => {
        const collectionsData = [];
        snapshot.forEach(doc => {
          collectionsData.push({
            id: doc.id,
            ...doc.data()
          });
        });
        setCollections(collectionsData);
        setLoading(false);
      },
      (error) => {
        console.error('加载收款记录失败:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // 加载上交记录历史
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;

    const submissionsQuery = query(
      collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`),
      where('submittedBy', '==', smId),
      where('submitterRole', '==', 'sellerManager'),
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
        setSubmissions(submissionsData);
      },
      (error) => {
        console.error('加载上交记录失败:', error);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // ========== 数据计算 ==========

  // 筛选可用的收款记录
  const filteredCollections = useMemo(() => {
    return collections.filter(c => {
      if (filterStatus === 'collected') {
        return c.status === 'collected' && !c.submittedToFinance;
      } else if (filterStatus === 'submitted') {
        return c.submittedToFinance === true;
      }
      return true;
    });
  }, [collections, filterStatus]);

  // 计算选中的总额
  const selectedTotal = useMemo(() => {
    return selectedCollections.reduce((sum, collectionId) => {
      const collection = collections.find(c => c.id === collectionId);
      return sum + (collection?.amount || 0);
    }, 0);
  }, [selectedCollections, collections]);

  // ✅ 统计数据优先读取实时监听的 liveCashStats，回退到 userInfo（首次渲染）
  const stats = useMemo(() => {
    const cashStats = liveCashStats ?? userInfo?.sellerManager?.cashStats ?? {};

    // ✅ 当前持有现金：从实时 cashStats.cashOnHand 读取
    const cashHolding = cashStats.cashOnHand || 0;
    
    // 可上交的收款记录数量（用于显示）
    const availableCollections = collections.filter(c => 
      c.status === 'collected' && !c.submittedToFinance
    );
    const availableCount = availableCollections.length;
    
    // 待认领池子（pending状态的submission）
    const submittedCount = submissions.filter(s => s.status === 'pending').length;
    const submittedAmount = submissions
      .filter(s => s.status === 'pending')
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    
    // 已确认的总额
    const confirmedAmount = submissions
      .filter(s => s.status === 'confirmed')
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    // ✅ 修正字段名：submitCashToFinance.js 写入的是 totalSubmitted（不是 totalSubmittedToCashier）
    const totalSubmitted = cashStats.totalSubmitted || 0;

    return {
      cashHolding,
      availableCount,
      submittedCount,
      submittedAmount,
      confirmedAmount,
      totalSubmitted
    };
  }, [collections, submissions, liveCashStats, userInfo]);

  // ========== 事件处理 ==========

  const toggleSelection = useCallback((collectionId) => {
    setSelectedCollections(prev => {
      if (prev.includes(collectionId)) {
        return prev.filter(id => id !== collectionId);
      } else {
        return [...prev, collectionId];
      }
    });
  }, []);

  const selectAll = useCallback(() => {
    const availableIds = filteredCollections
      .filter(c => c.status === 'collected' && !c.submittedToFinance)
      .map(c => c.id);
    setSelectedCollections(availableIds);
  }, [filteredCollections]);

  const deselectAll = useCallback(() => {
    setSelectedCollections([]);
  }, []);

  const handleOpenSubmitModal = useCallback(() => {
    if (selectedCollections.length === 0) {
      window.mybazaarShowToast('请先选择要上交的收款记录');
      return;
    }
    setShowSubmitModal(true);
    setSubmitNote('');
  }, [selectedCollections]);

  const handleCloseSubmitModal = useCallback(() => {
    setShowSubmitModal(false);
    setSubmitNote('');
  }, []);

  // 提交到待认领池子
  const handleSubmit = async () => {
    if (selectedCollections.length === 0) {
      window.mybazaarShowToast('请选择要上交的收款记录');
      return;
    }

    try {
      setSubmitting(true);

      // 获取选中的收款记录详情
      const selectedCollectionDetails = collections.filter(c => 
        selectedCollections.includes(c.id)
      );

      // 准备包含的销售数据
      const includedSales = selectedCollectionDetails.map(c => ({
        collectionId: c.id,
        sellerName: c.sellerName,
        sellerId: c.sellerId,
        amount: c.amount,
        salesDate: c.collectedAt ? formatDate(c.collectedAt) : '未知',
        hasDiscrepancy: c.discrepancy !== 0,
        discrepancy: c.discrepancy || 0
      }));

      const auth = getAuth();
      const user = auth.currentUser;
      if (!user) {
        throw new Error('用户未登录');
      }

      const idToken = await user.getIdToken();

      // 调用 Cloud Function - 提交到待认领池子
      const submitCashToFinance = httpsCallable(functions, 'submitCashToFinance');
      
      const result = await submitCashToFinance({
        orgId,
        eventId,
        amount: selectedTotal,
        note: submitNote,
        includedCollections: selectedCollections,
        includedSales: includedSales
      });

      if (result.data.success) {
        window.mybazaarShowToast('✅ 上交成功！现金已提交到待认领池子，等待Cashier确认。');
        setShowSubmitModal(false);
        setSelectedCollections([]);
        setSubmitNote('');
      } else {
        throw new Error(result.data.message || '上交失败');
      }

    } catch (error) {
      console.error('上交现金失败:', error);
      window.mybazaarShowToast('❌ 上交失败: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ========== 辅助函数 ==========

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFullDate = (timestamp) => {
    if (!timestamp) return '未知';
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

  const getStatusBadge = (status) => {
    const statusMap = {
      pending: { label: '⏳ 待确认', color: '#f59e0b' },
      confirmed: { label: '✅ 已确认', color: '#10b981' },
      disputed: { label: '⚠️ 有异议', color: '#ef4444' },
      rejected: { label: '❌ 已拒绝', color: '#dc2626' }
    };
    return statusMap[status] || { label: status, color: '#6b7280' };
  };

  // ========== 渲染 ==========

  if (loading) {
    return (
      <div style={styles.loading}>
        <div style={styles.spinner}></div>
        <p>加载数据中...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 统计卡片 */}
      <div style={styles.statsGrid}>
        <StatCard
          icon="💰"
          title="当前持有现金"
          value={`RM ${stats.cashHolding.toLocaleString()}`}
          color="#10b981"
          description={`${stats.availableCount} 笔可上交`}
        />
        <StatCard
          icon="📤"
          title="待认领现金"
          value={`RM ${stats.submittedAmount.toLocaleString()}`}
          color="#f59e0b"
          description={`${stats.submittedCount} 笔待FM确认`}
        />
        <StatCard
          icon="✅"
          title="已确认总金额"
          value={`RM ${stats.confirmedAmount.toLocaleString()}`}
          color="#10b981"
          description="Finance已确认"
        />
        <StatCard
          icon="📊"
          title="累计上交"
          value={`RM ${stats.totalSubmitted.toLocaleString()}`}
          color="#3b82f6"
          description="历史总额"
        />
      </div>

      {/* ⚠️ 待认领池子提示信息 */}
      {stats.submittedCount > 0 && (
        <div style={styles.infoBanner}>
          <span style={{ fontSize: '1.25rem' }}>ℹ️</span>
          <strong>待认领池子模式：</strong>
          上交现金会进入待认领池子，任何Cashier都可以接单确认。无需指定特定的Cashier。
        </div>
      )}

      {/* 选择工具栏 */}
      {filteredCollections.length > 0 && filterStatus === 'collected' && (
        <div style={styles.selectionToolbar}>
          <div style={styles.selectionInfo}>
            已选择 <strong>{selectedCollections.length}</strong> 笔收款，
            总额 <strong style={{ color: '#10b981' }}>RM {selectedTotal.toLocaleString()}</strong>
          </div>
          <div style={styles.selectionButtons}>
            <button onClick={selectAll} style={styles.selectButton}>
              ✅ 全选
            </button>
            <button onClick={deselectAll} style={styles.selectButton}>
              ❌ 清空
            </button>
            <button
              onClick={handleOpenSubmitModal}
              disabled={selectedCollections.length === 0}
              style={{
                ...styles.submitToPoolButton,
                opacity: selectedCollections.length === 0 ? 0.5 : 1,
                cursor: selectedCollections.length === 0 ? 'not-allowed' : 'pointer'
              }}
            >
              📤 上交现金到待认领池子
            </button>
          </div>
        </div>
      )}

      {/* 筛选标签 */}
      <div style={styles.filterTabs}>
        <button
          onClick={() => setFilterStatus('collected')}
          style={{
            ...styles.filterTab,
            ...(filterStatus === 'collected' ? styles.filterTabActive : {})
          }}
        >
          💰 可上交 ({collections.filter(c => c.status === 'collected' && !c.submittedToFinance).length})
        </button>
        <button
          onClick={() => setFilterStatus('submitted')}
          style={{
            ...styles.filterTab,
            ...(filterStatus === 'submitted' ? styles.filterTabActive : {})
          }}
        >
          📤 已上交 ({collections.filter(c => c.submittedToFinance === true).length})
        </button>
      </div>

      {/* 收款记录列表 */}
      {filteredCollections.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📭</div>
          <h3>没有收款记录</h3>
          <p>请先到"收取现金"页面收取学生现金</p>
        </div>
      ) : (
        <div style={styles.collectionsList}>
          {filteredCollections.map(collection => (
            <CollectionCard
              key={collection.id}
              collection={collection}
              isSelected={selectedCollections.includes(collection.id)}
              onToggleSelect={toggleSelection}
              canSelect={filterStatus === 'collected'}
            />
          ))}
        </div>
      )}

      {/* 上交历史记录 */}
      {submissions.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={{ marginBottom: '1.5rem', color: '#1f2937' }}>📋 分配历史</h3>
          
          <div style={styles.submissionsList}>
            {submissions.map(submission => (
              <SubmissionHistoryCard
                key={submission.id}
                submission={submission}
                formatFullDate={formatFullDate}
                getStatusBadge={getStatusBadge}
              />
            ))}
          </div>
        </div>
      )}

      {/* 上交确认对话框 */}
      {showSubmitModal && (
        <SubmitModal
          selectedTotal={selectedTotal}
          selectedCount={selectedCollections.length}
          collections={collections}
          selectedCollections={selectedCollections}
          submitNote={submitNote}
          onNoteChange={setSubmitNote}
          onSubmit={handleSubmit}
          onClose={handleCloseSubmitModal}
          submitting={submitting}
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
      <div style={styles.statTitle}>{title}</div>
      <div style={styles.statValue}>{value}</div>
      {description && <div style={styles.statDescription}>{description}</div>}
    </div>
  </div>
);

const CollectionCard = ({ collection, isSelected, onToggleSelect, canSelect }) => {
  const hasDiscrepancy = collection.discrepancy && collection.discrepancy !== 0;
  const isSubmitted = collection.submittedToFinance;

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div
      style={{
        ...styles.collectionCard,
        borderColor: isSelected ? '#10b981' : (hasDiscrepancy ? '#f59e0b' : '#e5e7eb'),
        background: isSelected ? '#f0fdf4' : (isSubmitted ? '#fafafa' : '#ffffff')
      }}
    >
      <div style={styles.cardHeader}>
        {canSelect && !isSubmitted && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelect(collection.id)}
            style={styles.checkbox}
          />
        )}
        <div style={styles.cardInfo}>
          <div style={styles.cardTitle}>
            {collection.sellerName}
            {hasDiscrepancy && <span style={{ color: '#f59e0b', fontSize: '1.25rem' }}>⚠️</span>}
          </div>
          <div style={styles.cardMeta}>
            {collection.sellerDepartment} · {formatDate(collection.collectedAt)}
          </div>
        </div>
        <div style={styles.cardAmount}>
          RM {collection.amount?.toLocaleString() || 0}
        </div>
      </div>

      {hasDiscrepancy && (
        <div style={styles.discrepancyBox}>
          ⚠️ 差额: RM {Math.abs(collection.discrepancy).toLocaleString()}
          （{collection.discrepancy > 0 ? '多收' : '少收'}）
        </div>
      )}

      {collection.note && (
        <div style={styles.noteBox}>
          📝 备注: {collection.note}
        </div>
      )}

      {isSubmitted && (
        <div style={styles.submittedBadge}>
          ✅ 已上交给Finance
        </div>
      )}
    </div>
  );
};

const SubmissionHistoryCard = ({ submission, formatFullDate, getStatusBadge }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const statusBadge = getStatusBadge(submission.status);

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div>
          <div style={styles.submissionTitle}>
            流水号: {submission.submissionNumber || submission.id.slice(0, 8)}
          </div>
          <div style={styles.submissionDate}>
            {formatFullDate(submission.submittedAt)}
          </div>
        </div>
        <div
          style={{
            ...styles.submissionStatus,
            background: statusBadge.color
          }}
        >
          {statusBadge.label}
        </div>
      </div>

      <div style={styles.submissionStats}>
        <div style={styles.submissionStat}>
          <span>上交金额</span>
          <strong style={{ color: '#10b981', fontSize: '1.125rem' }}>
            RM {submission.amount?.toLocaleString() || 0}
          </strong>
        </div>
        <div style={styles.submissionStat}>
          <span>包含收款</span>
          <strong>{submission.includedCollections?.length || 0} 笔</strong>
        </div>
      </div>

      {submission.note && (
        <div style={styles.submissionNote}>
          📝 备注: {submission.note}
        </div>
      )}

      {submission.status === 'confirmed' && submission.confirmedBy && (
        <div style={styles.confirmedInfo}>
          <div style={styles.detailRow}>
            <span>确认人:</span>
            <strong>{submission.confirmedByName || '未知'}</strong>
          </div>
          <div style={styles.detailRow}>
            <span>确认时间:</span>
            <strong>{formatFullDate(submission.confirmedAt)}</strong>
          </div>
          {submission.confirmNote && (
            <div style={styles.detailRow}>
              <span>确认备注:</span>
              <strong>{submission.confirmNote}</strong>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={styles.expandButton}
      >
        {isExpanded ? '收起详情' : '查看详情'}
      </button>

      {isExpanded && submission.includedSales && (
        <div style={styles.detailsSection}>
          <h4 style={{ fontSize: '0.875rem', fontWeight: '600', marginBottom: '0.75rem' }}>
            包含的收款明细
          </h4>
          {submission.includedSales.map((sale, index) => (
            <div key={index} style={styles.detailItem}>
              <span>{sale.sellerName} ({sale.salesDate})</span>
              <strong>RM {sale.amount?.toLocaleString() || 0}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SubmitModal = ({
  selectedTotal,
  selectedCount,
  collections,
  selectedCollections,
  submitNote,
  onNoteChange,
  onSubmit,
  onClose,
  submitting
}) => {
  const selectedDetails = collections.filter(c => selectedCollections.includes(c.id));

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h3>📤 上交现金到待认领池子</h3>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* 🆕 待认领池子说明 */}
          <div style={styles.modalInfoBanner}>
            <span style={{ fontSize: '1.25rem' }}>ℹ️</span>
            <span>
              <strong>待认领池子模式：</strong>提交后，任何Cashier都可以认领并确认收款。无需指定特定的Cashier。
            </span>
          </div>

          <div style={styles.summaryBox}>
            <div style={styles.summaryRow}>
              <span style={{ color: '#6b7280' }}>上交金额</span>
              <strong style={{ fontSize: '1.5rem', color: '#10b981' }}>
                RM {selectedTotal.toLocaleString()}
              </strong>
            </div>
            <div style={styles.summaryRow}>
              <span style={{ color: '#6b7280' }}>包含收款</span>
              <strong>{selectedCount} 笔</strong>
            </div>
          </div>

          <div style={styles.detailsList}>
            <div style={styles.detailsTitle}>明细列表</div>
            {selectedDetails.map(collection => (
              <div key={collection.id} style={styles.detailListItem}>
                <span>{collection.sellerName} ({formatDate(collection.collectedAt)})</span>
                <strong>RM {collection.amount?.toLocaleString() || 0}</strong>
              </div>
            ))}
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              备注（可选）
            </label>
            <textarea
              value={submitNote}
              onChange={(e) => onNoteChange(e.target.value)}
              placeholder="添加备注信息..."
              rows="3"
              style={styles.textarea}
            />
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button onClick={onClose} style={styles.cancelButton}>
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            style={styles.submitButton}
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
    alignItems: 'center',
    gap: '1rem'
  },
  statIcon: {
    fontSize: '2rem'
  },
  statContent: {
    flex: 1
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500',
    marginBottom: '0.25rem'
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statDescription: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.25rem'
  },
  infoBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    background: '#dbeafe',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
    color: '#1e40af'
  },
  selectionToolbar: {
    background: '#f3f4f6',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  selectionInfo: {
    fontSize: '0.875rem',
    color: '#374151'
  },
  selectionButtons: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  selectButton: {
    padding: '0.5rem 1rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  submitToPoolButton: {
    padding: '0.5rem 1.5rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  filterTabs: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    borderBottom: '2px solid #e5e7eb',
    paddingBottom: '0.5rem'
  },
  filterTab: {
    padding: '0.5rem 1rem',
    background: 'transparent',
    border: 'none',
    borderRadius: '8px 8px 0 0',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    transition: 'all 0.2s'
  },
  filterTabActive: {
    color: '#10b981',
    background: '#f0fdf4'
  },
  collectionsList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem'
  },
  collectionCard: {
    background: '#fafafa',
    border: '2px solid',
    borderRadius: '12px',
    padding: '1rem',
    transition: 'all 0.2s'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    marginBottom: '0.75rem'
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer',
    accentColor: '#10b981'
  },
  cardInfo: {
    flex: 1
  },
  cardTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  cardMeta: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  cardAmount: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#10b981'
  },
  discrepancyBox: {
    marginTop: '0.75rem',
    padding: '0.75rem',
    background: '#fef3c7',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#92400e'
  },
  noteBox: {
    marginTop: '0.75rem',
    padding: '0.75rem',
    background: '#f3f4f6',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#374151'
  },
  submittedBadge: {
    marginTop: '0.75rem',
    padding: '0.5rem',
    background: '#d1fae5',
    borderRadius: '6px',
    fontSize: '0.75rem',
    color: '#065f46',
    textAlign: 'center',
    fontWeight: '600'
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
  historySection: {
    marginTop: '3rem',
    paddingTop: '2rem',
    borderTop: '2px solid #e5e7eb'
  },
  submissionsList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '1.5rem'
  },
  submissionCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem'
  },
  submissionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
    gap: '1rem'
  },
  submissionTitle: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  submissionDate: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  submissionStatus: {
    padding: '0.5rem 1rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: 'white',
    whiteSpace: 'nowrap'
  },
  submissionStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem',
    padding: '1rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  submissionStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  submissionNote: {
    padding: '0.75rem',
    background: '#f3f4f6',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#374151',
    marginBottom: '1rem'
  },
  confirmedInfo: {
    padding: '1rem',
    background: '#f0fdf4',
    border: '2px solid #10b981',
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
  expandButton: {
    width: '100%',
    padding: '0.75rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  detailsSection: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '2px solid #e5e7eb'
  },
  detailItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '0.5rem',
    fontSize: '0.875rem'
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
    maxWidth: '600px',
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
    color: '#6b7280'
  },
  modalBody: {
    padding: '1.5rem'
  },
  modalInfoBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px',
    background: '#dbeafe',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
    color: '#1e40af'
  },
  summaryBox: {
    background: '#f0fdf4',
    border: '2px solid #10b981',
    borderRadius: '12px',
    padding: '1.5rem',
    marginBottom: '1.5rem'
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  detailsList: {
    marginBottom: '1.5rem'
  },
  detailsTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  detailListItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem',
    background: '#f3f4f6',
    borderRadius: '8px',
    marginBottom: '0.5rem',
    fontSize: '0.875rem'
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

export default SubmitCash;