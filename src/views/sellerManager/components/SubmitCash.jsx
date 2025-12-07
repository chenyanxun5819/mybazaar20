/**
 * SubmitCash.jsx
 * Seller Manager 上交现金给 Finance Manager 的界面
 * 
 * 功能:
 * 1. 显示所有可上交的收款记录
 * 2. 批量选择收款记录
 * 3. 创建上交提交单
 * 4. 查看上交历史
 * 
 * @version 1.0
 * @date 2024-12-04
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  doc, 
  writeBatch, 
  serverTimestamp,
  increment,
  orderBy
} from 'firebase/firestore';
import { db } from '../../../config/firebase';

const SubmitCash = ({ userInfo, eventData }) => {
  const [collections, setCollections] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('collected');

  const orgId = userInfo.organizationId;
  const eventId = userInfo.eventId;
  const smId = userInfo.userId;

  // ========== 数据加载 ==========

  // 加载收款记录
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

  // 加载上交历史
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;

    const submissionsQuery = query(
      collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`),
      where('submittedBy', '==', smId),
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
        console.error('加载上交历史失败:', error);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // ========== 数据计算 ==========

  // 筛选可用的收款记录
  const filteredCollections = useMemo(() => {
    return collections.filter(c => {
      if (filterStatus === 'collected') {
        return c.status === 'collected';
      } else if (filterStatus === 'submitted') {
        return c.status === 'submitted';
      } else if (filterStatus === 'confirmed') {
        return c.status === 'confirmed';
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
    const cashHolding = userInfo.pointsStats?.cashFlow?.cashHolding || 0;
    const submittedToFinance = userInfo.pointsStats?.cashFlow?.submittedToFinance || 0;
    const confirmedByFinance = userInfo.pointsStats?.cashFlow?.confirmedByFinance || 0;
    
    const availableCount = collections.filter(c => c.status === 'collected').length;
    const pendingCount = collections.filter(c => c.status === 'submitted').length;

    return {
      cashHolding,
      submittedToFinance,
      confirmedByFinance,
      availableCount,
      pendingCount
    };
  }, [userInfo, collections]);

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
      .filter(c => c.status === 'collected')
      .map(c => c.id);
    setSelectedCollections(availableIds);
  }, [filteredCollections]);

  const deselectAll = useCallback(() => {
    setSelectedCollections([]);
  }, []);

  const handleOpenSubmitModal = useCallback(() => {
    if (selectedCollections.length === 0) {
      alert('请先选择要上交的收款记录');
      return;
    }
    setShowSubmitModal(true);
  }, [selectedCollections]);

  const handleCloseSubmitModal = useCallback(() => {
    setShowSubmitModal(false);
  }, []);

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
          title="已上交待确认"
          value={`RM ${(stats.submittedToFinance - stats.confirmedByFinance).toLocaleString()}`}
          color="#f59e0b"
          description={`${stats.pendingCount} 笔待确认`}
        />
        <StatCard
          icon="✅"
          title="已确认总额"
          value={`RM ${stats.confirmedByFinance.toLocaleString()}`}
          color="#3b82f6"
          description="Finance 已确认"
        />
        <StatCard
          icon="📊"
          title="累计上交"
          value={`RM ${stats.submittedToFinance.toLocaleString()}`}
          color="#8b5cf6"
          description="历史总额"
        />
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
              📤 上交选中记录
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
          <option value="collected">可上交 ({collections.filter(c => c.status === 'collected').length})</option>
          <option value="submitted">已上交 ({collections.filter(c => c.status === 'submitted').length})</option>
          <option value="confirmed">已确认 ({collections.filter(c => c.status === 'confirmed').length})</option>
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
            />
          ))}
        </div>
      )}

      {/* 上交历史 */}
      {submissions.length > 0 && (
        <div style={styles.historySection}>
          <h3 style={styles.sectionTitle}>上交历史</h3>
          <div style={styles.submissionsList}>
            {submissions.map(submission => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                collections={collections}
              />
            ))}
          </div>
        </div>
      )}

      {/* 上交弹窗 */}
      {showSubmitModal && (
        <SubmitCashModal
          selectedCollections={selectedCollections}
          collections={collections}
          smInfo={userInfo}
          orgId={orgId}
          eventId={eventId}
          onClose={handleCloseSubmitModal}
          onSuccess={() => {
            setSelectedCollections([]);
            handleCloseSubmitModal();
          }}
        />
      )}
    </div>
  );
};

// ========== 子组件: StatCard ==========
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

// ========== 子组件: CollectionCard ==========
const CollectionCard = ({ collection, isSelected, onToggle }) => {
  const isAvailable = collection.status === 'collected';
  
  const getStatusBadge = () => {
    switch (collection.status) {
      case 'collected':
        return <span style={styles.statusBadge}>⏳ 可上交</span>;
      case 'submitted':
        return <span style={{ ...styles.statusBadge, background: '#fbbf24', color: '#78350f' }}>📤 已上交</span>;
      case 'confirmed':
        return <span style={{ ...styles.statusBadge, background: '#10b981', color: 'white' }}>✅ 已确认</span>;
      case 'rejected':
        return <span style={{ ...styles.statusBadge, background: '#ef4444', color: 'white' }}>❌ 已拒绝</span>;
      default:
        return null;
    }
  };

  return (
    <div style={{
      ...styles.collectionCard,
      borderColor: isSelected ? '#10b981' : '#e5e7eb',
      background: isSelected ? '#f0fdf4' : '#fafafa'
    }}>
      {isAvailable && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggle}
          style={styles.checkbox}
        />
      )}
      
      <div style={styles.collectionContent}>
        <div style={styles.collectionHeader}>
          <div style={styles.sellerInfo}>
            <span style={styles.sellerName}>{collection.submittedByName}</span>
            <span style={styles.sellerDept}>{collection.submittedByDepartment}</span>
          </div>
          {getStatusBadge()}
        </div>

        <div style={styles.collectionDetails}>
          <div style={styles.detailRow}>
            <span>收款金额:</span>
            <strong style={{ color: '#10b981' }}>RM {collection.amount.toLocaleString()}</strong>
          </div>
          {collection.discrepancy !== 0 && (
            <div style={styles.detailRow}>
              <span>差额:</span>
              <strong style={{ color: '#ef4444' }}>RM {Math.abs(collection.discrepancy).toLocaleString()}</strong>
              <span style={styles.discrepancyType}>
                ({collection.discrepancyType === 'partial' && '部分收款'}
                {collection.discrepancyType === 'pointsRecovery' && '点数回收'}
                {collection.discrepancyType === 'waiver' && '豁免'})
              </span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span>收款时间:</span>
            <span style={styles.dateText}>
              {collection.collectedAt?.toDate ? 
                new Date(collection.collectedAt.toDate()).toLocaleString('zh-CN') :
                '时间未知'
              }
            </span>
          </div>
        </div>

        {collection.note && (
          <div style={styles.noteBox}>
            <strong>备注:</strong> {collection.note}
          </div>
        )}

        {collection.discrepancyReason && (
          <div style={styles.discrepancyBox}>
            <strong>差额原因:</strong> {collection.discrepancyReason}
          </div>
        )}
      </div>
    </div>
  );
};

// ========== 子组件: SubmissionCard ==========
const SubmissionCard = ({ submission, collections }) => {
  const [expanded, setExpanded] = useState(false);

  const getStatusInfo = () => {
    switch (submission.status) {
      case 'pending':
        return { icon: '⏳', text: '待确认', color: '#f59e0b' };
      case 'confirmed':
        return { icon: '✅', text: '已确认', color: '#10b981' };
      case 'rejected':
        return { icon: '❌', text: '已拒绝', color: '#ef4444' };
      default:
        return { icon: '❓', text: '未知', color: '#6b7280' };
    }
  };

  const statusInfo = getStatusInfo();

  const includedCollectionDetails = useMemo(() => {
    return (submission.includedCollections || [])
      .map(collectionId => collections.find(c => c.id === collectionId))
      .filter(Boolean);
  }, [submission, collections]);

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div>
          <div style={styles.submissionTitle}>
            📤 上交批次 #{submission.id.slice(-6)}
          </div>
          <div style={styles.submissionDate}>
            {submission.submittedAt?.toDate ? 
              new Date(submission.submittedAt.toDate()).toLocaleString('zh-CN') :
              '时间未知'
            }
          </div>
        </div>
        <div style={{ ...styles.submissionStatus, background: statusInfo.color }}>
          {statusInfo.icon} {statusInfo.text}
        </div>
      </div>

      <div style={styles.submissionStats}>
        <div style={styles.submissionStat}>
          <span>总金额</span>
          <strong>RM {submission.totalAmount.toLocaleString()}</strong>
        </div>
        <div style={styles.submissionStat}>
          <span>包含笔数</span>
          <strong>{submission.collectionCount}</strong>
        </div>
      </div>

      {submission.note && (
        <div style={styles.submissionNote}>
          <strong>备注:</strong> {submission.note}
        </div>
      )}

      {submission.rejectionReason && (
        <div style={styles.rejectionBox}>
          <strong>拒绝原因:</strong> {submission.rejectionReason}
        </div>
      )}

      <button
        onClick={() => setExpanded(!expanded)}
        style={styles.expandButton}
      >
        {expanded ? '▲ 收起明细' : `▼ 查看明细 (${includedCollectionDetails.length})`}
      </button>

      {expanded && (
        <div style={styles.detailsSection}>
          {includedCollectionDetails.map(collection => (
            <div key={collection.id} style={styles.detailItem}>
              <span>{collection.submittedByName}</span>
              <span style={{ color: '#10b981' }}>RM {collection.amount.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ========== 子组件: SubmitCashModal ==========
const SubmitCashModal = ({ selectedCollections, collections, smInfo, orgId, eventId, onClose, onSuccess }) => {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedDetails = useMemo(() => {
    return selectedCollections
      .map(id => collections.find(c => c.id === id))
      .filter(Boolean);
  }, [selectedCollections, collections]);

  const totalAmount = useMemo(() => {
    return selectedDetails.reduce((sum, c) => sum + c.amount, 0);
  }, [selectedDetails]);

  const breakdown = useMemo(() => {
    const normal = selectedDetails.filter(c => !c.discrepancy || c.discrepancy === 0);
    const partial = selectedDetails.filter(c => c.discrepancyType === 'partial');
    const recovery = selectedDetails.filter(c => c.discrepancyType === 'pointsRecovery');
    const waiver = selectedDetails.filter(c => c.discrepancyType === 'waiver');

    return {
      normalCollections: normal.reduce((sum, c) => sum + c.amount, 0),
      partialCollections: partial.reduce((sum, c) => sum + c.amount, 0),
      pointsRecovery: recovery.reduce((sum, c) => sum + c.amount, 0),
      waivers: waiver.reduce((sum, c) => sum + c.amount, 0),
      totalDiscrepancy: selectedDetails.reduce((sum, c) => sum + (c.discrepancy || 0), 0)
    };
  }, [selectedDetails]);

  const handleSubmit = async () => {
    if (!confirm(`确认上交 ${selectedCollections.length} 笔收款记录，总金额 RM ${totalAmount.toLocaleString()}？`)) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const batch = writeBatch(db);

      // 获取所有管理的部门
      const managedDepartments = smInfo.sellerManager?.managedDepartments || [];

      // 1. 创建 cashSubmission 记录
      const submissionRef = doc(collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`));
      batch.set(submissionRef, {
        submissionId: submissionRef.id,
        type: 'managerToFinance',
        
        // 提交方
        submittedBy: smInfo.userId,
        submittedByName: smInfo.basicInfo?.chineseName || 'Seller Manager',
        submittedByRole: 'sellerManager',
        submittedByDepartments: managedDepartments,
        
        // 接收方（暂时为空，Finance Manager 确认时填写）
        receivedBy: null,
        receivedByName: null,
        receivedByRole: 'financeManager',
        
        // 金额信息
        totalAmount: totalAmount,
        collectionCount: selectedCollections.length,
        includedCollections: selectedCollections,
        
        // 明细统计
        breakdown: breakdown,
        
        // 状态
        status: 'pending',
        submittedAt: serverTimestamp(),
        confirmedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        
        // 关联
        eventId: eventId,
        organizationId: orgId,
        
        // 备注
        note: note,
        financeNote: null,
        
        // 时间戳
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 2. 更新每个 cashCollection 的状态
      selectedCollections.forEach(collectionId => {
        const collectionRef = doc(db, `organizations/${orgId}/events/${eventId}/cashCollections/${collectionId}`);
        batch.update(collectionRef, {
          status: 'submitted',
          submittedAt: serverTimestamp(),
          submissionId: submissionRef.id,
          updatedAt: serverTimestamp()
        });
      });

      // 3. 更新 SellerManager cashFlow
      const smRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${smInfo.userId}`);
      batch.update(smRef, {
        'pointsStats.cashFlow.cashHolding': increment(-totalAmount),
        'pointsStats.cashFlow.submittedToFinance': increment(totalAmount),
        'pointsStats.cashFlow.lastSubmissionAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      await batch.commit();

      alert('✅ 上交成功！等待 Finance Manager 确认');
      onSuccess();
    } catch (err) {
      console.error('上交失败:', err);
      setError('上交失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2>📤 上交现金</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* 汇总信息 */}
          <div style={styles.summaryBox}>
            <div style={styles.summaryRow}>
              <span>选中笔数:</span>
              <strong>{selectedCollections.length} 笔</strong>
            </div>
            <div style={styles.summaryRow}>
              <span>总金额:</span>
              <strong style={{ fontSize: '1.5rem', color: '#10b981' }}>
                RM {totalAmount.toLocaleString()}
              </strong>
            </div>
          </div>

          {/* 明细统计 */}
          <div style={styles.breakdownBox}>
            <h4 style={styles.breakdownTitle}>明细统计</h4>
            <div style={styles.breakdownItem}>
              <span>正常收款:</span>
              <strong>RM {breakdown.normalCollections.toLocaleString()}</strong>
            </div>
            {breakdown.partialCollections > 0 && (
              <div style={styles.breakdownItem}>
                <span>部分收款:</span>
                <strong style={{ color: '#f59e0b' }}>RM {breakdown.partialCollections.toLocaleString()}</strong>
              </div>
            )}
            {breakdown.pointsRecovery > 0 && (
              <div style={styles.breakdownItem}>
                <span>点数回收:</span>
                <strong style={{ color: '#3b82f6' }}>RM {breakdown.pointsRecovery.toLocaleString()}</strong>
              </div>
            )}
            {breakdown.waivers > 0 && (
              <div style={styles.breakdownItem}>
                <span>豁免:</span>
                <strong style={{ color: '#8b5cf6' }}>RM {breakdown.waivers.toLocaleString()}</strong>
              </div>
            )}
            {breakdown.totalDiscrepancy !== 0 && (
              <div style={styles.breakdownItem}>
                <span>总差额:</span>
                <strong style={{ color: '#ef4444' }}>RM {Math.abs(breakdown.totalDiscrepancy).toLocaleString()}</strong>
              </div>
            )}
          </div>

          {/* 明细列表 */}
          <div style={styles.detailsList}>
            <h4 style={styles.detailsTitle}>包含的收款记录</h4>
            {selectedDetails.map(collection => (
              <div key={collection.id} style={styles.detailListItem}>
                <span>{collection.submittedByName}</span>
                <span style={{ color: '#10b981' }}>RM {collection.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* 备注 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注给 Finance Manager</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={styles.textarea}
              placeholder="选填，如有特殊情况请说明..."
              rows={3}
            />
          </div>

          {error && (
            <div style={styles.errorBox}>
              ❌ {error}
            </div>
          )}
        </div>

        <div style={styles.modalFooter}>
          <button
            onClick={onClose}
            style={styles.cancelButton}
            disabled={submitting}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            style={{
              ...styles.submitButton,
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? 'not-allowed' : 'pointer'
            }}
            disabled={submitting}
          >
            {submitting ? '处理中...' : '✅ 确认上交'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== 样式 ==========
const styles = {
  container: {
    padding: '1.5rem',
    maxWidth: '1400px',
    margin: '0 auto'
  },
  loading: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  spinner: {
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    width: '40px',
    height: '40px',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 1rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem'
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
  batchActions: {
    background: '#f0fdf4',
    border: '2px solid #10b981',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '1.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  selectionInfo: {
    flex: '1 1 auto'
  },
  selectionText: {
    fontSize: '0.875rem',
    color: '#374151'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  actionButton: {
    padding: '0.5rem 1rem',
    background: 'white',
    border: '2px solid #10b981',
    color: '#10b981',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  submitBtn: {
    padding: '0.5rem 1rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
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
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    background: 'white',
    cursor: 'pointer'
  },
  collectionsList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem'
  },
  collectionCard: {
    background: '#fafafa',
    border: '2px solid',
    borderRadius: '12px',
    padding: '1rem',
    display: 'flex',
    gap: '1rem',
    alignItems: 'flex-start'
  },
  checkbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer',
    marginTop: '0.25rem'
  },
  collectionContent: {
    flex: 1
  },
  collectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '0.75rem',
    gap: '1rem'
  },
  sellerInfo: {
    flex: 1
  },
  sellerName: {
    fontSize: '1rem',
    fontWeight: 'bold',
    color: '#1f2937',
    display: 'block',
    marginBottom: '0.25rem'
  },
  sellerDept: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  statusBadge: {
    padding: '0.25rem 0.75rem',
    background: '#dbeafe',
    color: '#1e40af',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  collectionDetails: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#374151'
  },
  discrepancyType: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginLeft: '0.5rem'
  },
  dateText: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  noteBox: {
    marginTop: '0.75rem',
    padding: '0.75rem',
    background: '#f3f4f6',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#374151'
  },
  discrepancyBox: {
    marginTop: '0.75rem',
    padding: '0.75rem',
    background: '#fef3c7',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#92400e'
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
  rejectionBox: {
    padding: '0.75rem',
    background: '#fee2e2',
    borderRadius: '8px',
    fontSize: '0.75rem',
    color: '#991b1b',
    marginBottom: '1rem'
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
    maxWidth: '700px',
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
  breakdownBox: {
    background: '#f3f4f6',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '1.5rem'
  },
  breakdownTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  breakdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
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
  errorBox: {
    background: '#fee2e2',
    border: '2px solid #ef4444',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginTop: '1rem'
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
