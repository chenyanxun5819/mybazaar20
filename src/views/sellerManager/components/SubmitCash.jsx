/**
 * SubmitCash.jsx (待认领池子模式)
 * Seller Manager 上交现金给 Cashier 的界面
 * 
 * 🆕 更新：改为待认领池子模式（receivedBy=null）
 * - 不再选择特定的FM
 * - 直接提交到待认领池子
 * - 任何FM都可以接单确认
 * 
 * @version 2.0
 * @date 2025-01-01
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs
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

  const orgId = userInfo.organizationId;
  const eventId = userInfo.eventId;
  const smId = userInfo.userId;

  // ========== 数据加载 ==========

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

  // 统计数据
  const stats = useMemo(() => {
    const availableCollections = collections.filter(c => 
      c.status === 'collected' && !c.submittedToFinance
    );
    const cashHolding = availableCollections.reduce((sum, c) => sum + (c.amount || 0), 0);
    
    const submittedCount = submissions.filter(s => s.status === 'pending').length;
    const submittedAmount = submissions
      .filter(s => s.status === 'pending')
      .reduce((sum, s) => sum + (s.amount || 0), 0);
    
    const confirmedAmount = submissions
      .filter(s => s.status === 'confirmed')
      .reduce((sum, s) => sum + (s.amount || 0), 0);

    return {
      cashHolding,
      availableCount: availableCollections.length,
      submittedCount,
      submittedAmount,
      confirmedAmount,
      totalSubmitted: submissions.reduce((sum, s) => sum + (s.amount || 0), 0)
    };
  }, [collections, submissions]);

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

  // 🆕 提交到待认领池子
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

      // 🔴 调用 Cloud Function - 提交到待认领池子
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
          title="待认领池子"
          value={`RM ${stats.submittedAmount.toLocaleString()}`}
          color="#f59e0b"
          description={`${stats.submittedCount} 笔等待FM确认`}
        />
        <StatCard
          icon="✅"
          title="已确认总额"
          value={`RM ${stats.confirmedAmount.toLocaleString()}`}
          color="#3b82f6"
          description="Finance 已确认"
        />
        <StatCard
          icon="📊"
          title="累计上交"
          value={`RM ${stats.totalSubmitted.toLocaleString()}`}
          color="#8b5cf6"
          description="历史总额"
        />
      </div>

      {/* 提示横幅 */}
      <div style={styles.infoBanner}>
        <span style={styles.infoIcon}>ℹ️</span>
        <span style={styles.infoText}>
          <strong>待认领池子模式：</strong>
          上交的现金将进入待认领池子，任何Cashier都可以接单确认，无需指定特定的Cashier。
        </span>
      </div>

      {/* 批量操作栏 */}
      {stats.availableCount > 0 && (
        <div style={styles.batchActions}>
          <div style={styles.selectionInfo}>
            <span style={styles.selectionText}>
              已选择 <strong>{selectedCollections.length}</strong> 笔，
              总额 <strong style={{ color: '#10b981' }}>RM {selectedTotal.toLocaleString()}</strong>
            </span>
          </div>
          <div style={styles.actionButtons}>
            <button onClick={selectAll} style={styles.actionButton}>
              全选可上交
            </button>
            <button onClick={deselectAll} style={styles.actionButton}>
              取消选择
            </button>
            <button
              onClick={handleOpenSubmitModal}
              style={{
                ...styles.submitBtn,
                opacity: selectedCollections.length === 0 ? 0.5 : 1,
                cursor: selectedCollections.length === 0 ? 'not-allowed' : 'pointer'
              }}
              disabled={selectedCollections.length === 0}
            >
              📤 上交到待认领池子
            </button>
          </div>
        </div>
      )}

      {/* 筛选器 */}
      <div style={styles.toolbar}>
        <h3 style={styles.sectionTitle}>收款记录</h3>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={styles.select}
        >
          <option value="collected">
            可上交 ({collections.filter(c => c.status === 'collected' && !c.submittedToFinance).length})
          </option>
          <option value="submitted">
            已上交 ({collections.filter(c => c.submittedToFinance).length})
          </option>
          <option value="all">全部 ({collections.length})</option>
        </select>
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
              onToggle={() => toggleSelection(collection.id)}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}

      {/* 上交历史 */}
      {submissions.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={styles.sectionTitle}>📜 上交历史</h3>
          <div style={styles.submissionsList}>
            {submissions.map(submission => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                formatFullDate={formatFullDate}
                getStatusBadge={getStatusBadge}
              />
            ))}
          </div>
        </div>
      )}

      {/* 上交确认模态框 */}
      {showSubmitModal && (
        <SubmitModal
          selectedTotal={selectedTotal}
          selectedCount={selectedCollections.length}
          collections={collections}
          selectedCollections={selectedCollections}
          submitNote={submitNote}
          setSubmitNote={setSubmitNote}
          submitting={submitting}
          onSubmit={handleSubmit}
          onClose={handleCloseSubmitModal}
          formatDate={formatDate}
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

const CollectionCard = ({ collection, isSelected, onToggle, formatDate }) => {
  const canSelect = collection.status === 'collected' && !collection.submittedToFinance;
  
  return (
    <div 
      style={{
        ...styles.collectionCard,
        borderColor: isSelected ? '#10b981' : '#e5e7eb',
        background: isSelected ? '#f0fdf4' : '#fafafa'
      }}
    >
      <div style={styles.cardHeader}>
        {canSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            style={styles.checkbox}
          />
        )}
        <div style={styles.cardInfo}>
          <div style={styles.cardTitle}>
            <span className="seller-icon">🛍️</span>
            <span>{collection.sellerName}</span>
          </div>
          <div style={styles.cardMeta}>
            <span>{formatDate(collection.collectedAt)}</span>
          </div>
        </div>
        <div style={styles.cardAmount}>
          RM {(collection.amount || 0).toLocaleString()}
        </div>
      </div>

      {collection.discrepancy !== 0 && (
        <div style={styles.discrepancyBox}>
          ⚠️ 差异: RM {collection.discrepancy} ({collection.discrepancyType})
        </div>
      )}

      {collection.notes && (
        <div style={styles.noteBox}>
          📝 {collection.notes}
        </div>
      )}

      {collection.submittedToFinance && (
        <div style={styles.submittedBadge}>
          ✅ 已上交到待认领池子
        </div>
      )}
    </div>
  );
};

const SubmissionCard = ({ submission, formatFullDate, getStatusBadge }) => {
  const [showDetails, setShowDetails] = useState(false);
  const statusInfo = getStatusBadge(submission.status);

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div>
          <div style={styles.submissionTitle}>
            上交编号: {submission.submissionNumber || submission.id.slice(0, 8)}
          </div>
          <div style={styles.submissionDate}>
            提交时间: {formatFullDate(submission.submittedAt)}
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

      <div style={styles.submissionStats}>
        <div style={styles.submissionStat}>
          <span>金额</span>
          <strong>RM {(submission.amount || 0).toLocaleString()}</strong>
        </div>
        <div style={styles.submissionStat}>
          <span>包含记录</span>
          <strong>{submission.includedSales?.length || 0} 笔</strong>
        </div>
      </div>

      {submission.note && (
        <div style={styles.submissionNote}>
          📝 提交备注: {submission.note}
        </div>
      )}

      {submission.status === 'confirmed' && (
        <div style={styles.confirmedInfo}>
          <div style={styles.detailRow}>
            <span>接收人:</span>
            <strong>{submission.receiverName}</strong>
          </div>
          <div style={styles.detailRow}>
            <span>确认时间:</span>
            <strong>{formatFullDate(submission.confirmedAt)}</strong>
          </div>
          {submission.confirmationNote && (
            <div style={styles.submissionNote}>
              ✅ 确认备注: {submission.confirmationNote}
            </div>
          )}
        </div>
      )}

      <button
        style={styles.expandButton}
        onClick={() => setShowDetails(!showDetails)}
      >
        {showDetails ? '▲ 收起明细' : '▼ 查看明细'}
      </button>

      {showDetails && submission.includedSales && (
        <div style={styles.detailsSection}>
          {submission.includedSales.map((sale, index) => (
            <div key={index} style={styles.detailItem}>
              <span>{sale.sellerName}</span>
              <span>RM {sale.amount?.toLocaleString()}</span>
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
  setSubmitNote,
  submitting,
  onSubmit,
  onClose,
  formatDate
}) => {
  const selectedDetails = collections.filter(c => selectedCollections.includes(c.id));

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>📤 确认上交现金</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* 提示横幅 */}
          <div style={styles.modalInfoBanner}>
            <span>ℹ️</span>
            <span>
              现金将提交到<strong>待认领池子</strong>，任何Cashier都可以接单确认。
            </span>
          </div>

          {/* 汇总 */}
          <div style={styles.summaryBox}>
            <div style={styles.summaryRow}>
              <span>选中记录数:</span>
              <strong style={{ fontSize: '1.25rem' }}>{selectedCount} 笔</strong>
            </div>
            <div style={styles.summaryRow}>
              <span>上交总额:</span>
              <strong style={{ fontSize: '1.5rem', color: '#10b981' }}>
                RM {selectedTotal.toLocaleString()}
              </strong>
            </div>
          </div>

          {/* 明细列表 */}
          <div style={styles.detailsList}>
            <div style={styles.detailsTitle}>包含的收款记录:</div>
            {selectedDetails.map(detail => (
              <div key={detail.id} style={styles.detailListItem}>
                <span>{detail.sellerName}</span>
                <span>RM {detail.amount?.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* 备注输入 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="例如：第一批学生现金上交"
              style={styles.textarea}
              rows={3}
              disabled={submitting}
            />
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
            style={styles.submitButton} 
            onClick={onSubmit}
            disabled={submitting}
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
    padding: '20px',
    maxWidth: '1400px',
    margin: '0 auto'
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
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
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
    gap: '1rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
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
  infoBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'linear-gradient(135deg, #dbeafe 0%, #e0f2fe 100%)',
    borderLeft: '4px solid #3b82f6',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  infoIcon: {
    fontSize: '20px'
  },
  infoText: {
    fontSize: '14px',
    color: '#1e40af',
    lineHeight: '1.5'
  },
  batchActions: {
    background: 'white',
    padding: '1rem',
    borderRadius: '12px',
    border: '2px solid #e5e7eb',
    marginBottom: '1.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  selectionInfo: {
    flex: '1',
    minWidth: '200px'
  },
  selectionText: {
    fontSize: '0.875rem',
    color: '#374151'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap'
  },
  actionButton: {
    padding: '0.5rem 1rem',
    background: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    transition: 'all 0.2s'
  },
  submitBtn: {
    padding: '0.5rem 1.5rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    transition: 'all 0.2s'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  select: {
    padding: '0.5rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    background: 'white'
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
