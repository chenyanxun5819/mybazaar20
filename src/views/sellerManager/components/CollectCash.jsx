/**
 * CollectCash.jsx
 * Seller Manager 收取学生现金的主要界面
 * 
 * 功能:
 * 1. 显示所有管理范围内的 Sellers
 * 2. 显示每个 Seller 的待收款金额
 * 3. 支持正常收款和特殊情况处理
 * 4. 实时更新统计数据
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
import { db } from '../../config/firebase';

const CollectCash = ({ userInfo, eventData }) => {
  const [sellers, setSellers] = useState([]);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [showCollectModal, setShowCollectModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('pendingDesc');

  const orgId = userInfo.organizationId;
  const eventId = userInfo.eventId;
  const smId = userInfo.userId;

  // ========== 数据加载 ==========

  // 加载管理的 Sellers
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;

    const sellersQuery = query(
      collection(db, `organizations/${orgId}/events/${eventId}/users`),
      where('managedBy', 'array-contains', smId),
      where('roles', 'array-contains', 'seller')
    );

    const unsubscribe = onSnapshot(
      sellersQuery,
      (snapshot) => {
        const sellersData = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          sellersData.push({
            id: doc.id,
            ...data,
            // 计算待收款金额
            pendingAmount: (data.pointsStats?.cashFlow?.cashOnHand || 0)
          });
        });
        setSellers(sellersData);
        setLoading(false);
      },
      (error) => {
        console.error('加载 Sellers 失败:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // 加载收款历史
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
      },
      (error) => {
        console.error('加载收款历史失败:', error);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, smId]);

  // ========== 数据计算 ==========

  // 计算统计数据
  const stats = useMemo(() => {
    const cashHolding = userInfo.pointsStats?.cashFlow?.cashHolding || 0;
    const collectedFromSellers = userInfo.pointsStats?.cashFlow?.collectedFromSellers || 0;
    const submittedToFinance = userInfo.pointsStats?.cashFlow?.submittedToFinance || 0;
    
    const availableCollections = collections.filter(c => c.status === 'collected').length;
    const totalPending = sellers.reduce((sum, s) => sum + s.pendingAmount, 0);

    return {
      cashHolding,
      collectedFromSellers,
      submittedToFinance,
      availableCollections,
      totalPending
    };
  }, [userInfo, collections, sellers]);

  // 筛选和排序 Sellers
  const filteredAndSortedSellers = useMemo(() => {
    let result = [...sellers];

    // 搜索筛选
    if (searchTerm) {
      result = result.filter(s => 
        s.basicInfo?.chineseName?.includes(searchTerm) ||
        s.basicInfo?.englishName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.identityInfo?.identityId?.includes(searchTerm)
      );
    }

    // 状态筛选
    if (filterStatus === 'pending') {
      result = result.filter(s => s.pendingAmount > 0);
    } else if (filterStatus === 'collected') {
      result = result.filter(s => s.pendingAmount === 0);
    }

    // 排序
    result.sort((a, b) => {
      switch (sortBy) {
        case 'pendingDesc':
          return b.pendingAmount - a.pendingAmount;
        case 'pendingAsc':
          return a.pendingAmount - b.pendingAmount;
        case 'nameAsc':
          return (a.basicInfo?.chineseName || '').localeCompare(b.basicInfo?.chineseName || '');
        case 'revenueDesc':
          return (b.pointsStats?.totalRevenue || 0) - (a.pointsStats?.totalRevenue || 0);
        default:
          return 0;
      }
    });

    return result;
  }, [sellers, searchTerm, filterStatus, sortBy]);

  // ========== 事件处理 ==========

  const handleOpenCollectModal = useCallback((seller) => {
    setSelectedSeller(seller);
    setShowCollectModal(true);
  }, []);

  const handleCloseCollectModal = useCallback(() => {
    setSelectedSeller(null);
    setShowCollectModal(false);
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
          description="可上交的现金"
        />
        <StatCard
          icon="📊"
          title="累计收取"
          value={`RM ${stats.collectedFromSellers.toLocaleString()}`}
          color="#3b82f6"
          description="从学生收取的总额"
        />
        <StatCard
          icon="📤"
          title="已上交"
          value={`RM ${stats.submittedToFinance.toLocaleString()}`}
          color="#8b5cf6"
          description="已提交给财务"
        />
        <StatCard
          icon="⏳"
          title="待收款总额"
          value={`RM ${stats.totalPending.toLocaleString()}`}
          color="#f59e0b"
          description={`${sellers.filter(s => s.pendingAmount > 0).length} 位学生`}
        />
      </div>

      {/* 搜索和筛选 */}
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 搜索学生姓名或学号..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />
        
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          style={styles.select}
        >
          <option value="all">全部状态</option>
          <option value="pending">待收款</option>
          <option value="collected">已收齐</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          style={styles.select}
        >
          <option value="pendingDesc">待收款: 高→低</option>
          <option value="pendingAsc">待收款: 低→高</option>
          <option value="nameAsc">姓名: A→Z</option>
          <option value="revenueDesc">销售额: 高→低</option>
        </select>
      </div>

      {/* Sellers 列表 */}
      {filteredAndSortedSellers.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>📭</div>
          <h3>没有找到学生</h3>
          <p>尝试调整搜索条件</p>
        </div>
      ) : (
        <div style={styles.sellersList}>
          {filteredAndSortedSellers.map(seller => (
            <SellerCard
              key={seller.id}
              seller={seller}
              collections={collections.filter(c => c.sellerId === seller.id)}
              onCollect={() => handleOpenCollectModal(seller)}
            />
          ))}
        </div>
      )}

      {/* 收款弹窗 */}
      {showCollectModal && selectedSeller && (
        <CollectCashModal
          seller={selectedSeller}
          smInfo={userInfo}
          eventData={eventData}
          orgId={orgId}
          eventId={eventId}
          onClose={handleCloseCollectModal}
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

// ========== 子组件: SellerCard ==========
const SellerCard = ({ seller, collections, onCollect }) => {
  const [expanded, setExpanded] = useState(false);

  const pendingAmount = seller.pendingAmount || 0;
  const totalRevenue = seller.pointsStats?.totalRevenue || 0;
  const cashFlow = seller.pointsStats?.cashFlow || {};
  const submittedToManager = cashFlow.submittedToManager || 0;
  const collectionRate = totalRevenue > 0 ? (submittedToManager / totalRevenue) : 0;

  const hasAlert = seller.seller?.collectionAlert || false;

  return (
    <div style={styles.sellerCard}>
      <div style={styles.sellerHeader}>
        <div style={styles.sellerInfo}>
          <div style={styles.sellerName}>
            {seller.basicInfo?.chineseName || '未知'}
            {hasAlert && <span style={styles.alertBadge}>⚠️</span>}
          </div>
          <div style={styles.sellerMeta}>
            {seller.identityInfo?.identityId} | {seller.identityInfo?.department}
          </div>
        </div>

        <div style={styles.sellerActions}>
          <div style={styles.pendingAmount}>
            <div style={styles.pendingLabel}>待收款</div>
            <div style={{
              ...styles.pendingValue,
              color: pendingAmount > 0 ? '#ef4444' : '#10b981'
            }}>
              RM {pendingAmount.toLocaleString()}
            </div>
          </div>
          {pendingAmount > 0 && (
            <button
              onClick={() => onCollect()}
              style={styles.collectButton}
            >
              💰 收取现金
            </button>
          )}
        </div>
      </div>

      <div style={styles.sellerStats}>
        <div style={styles.statItem}>
          <span>累计销售:</span>
          <strong>RM {totalRevenue.toLocaleString()}</strong>
        </div>
        <div style={styles.statItem}>
          <span>已上交:</span>
          <strong>RM {submittedToManager.toLocaleString()}</strong>
        </div>
        <div style={styles.statItem}>
          <span>收款率:</span>
          <strong style={{
            color: collectionRate >= 0.8 ? '#10b981' : collectionRate >= 0.5 ? '#f59e0b' : '#ef4444'
          }}>
            {Math.round(collectionRate * 100)}%
          </strong>
        </div>
      </div>

      {collections.length > 0 && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            style={styles.expandButton}
          >
            {expanded ? '▲ 收起历史' : `▼ 收款历史 (${collections.length})`}
          </button>

          {expanded && (
            <div style={styles.historySection}>
              {collections.map(collection => (
                <div key={collection.id} style={styles.historyItem}>
                  <div style={styles.historyHeader}>
                    <span style={styles.historyDate}>
                      {collection.collectedAt?.toDate ? 
                        new Date(collection.collectedAt.toDate()).toLocaleString('zh-CN') :
                        '时间未知'
                      }
                    </span>
                    <span style={{
                      ...styles.historyAmount,
                      color: collection.discrepancy < 0 ? '#f59e0b' : '#10b981'
                    }}>
                      RM {collection.amount.toLocaleString()}
                    </span>
                  </div>
                  {collection.discrepancy !== 0 && (
                    <div style={styles.historyNote}>
                      {collection.discrepancyType === 'partial' && '⚠️ 部分收款'}
                      {collection.discrepancyType === 'pointsRecovery' && '🔄 点数回收'}
                      {collection.discrepancyType === 'waiver' && '✓ 已豁免'}
                      {collection.discrepancyReason && `: ${collection.discrepancyReason}`}
                    </div>
                  )}
                  {collection.note && (
                    <div style={styles.historyNote}>备注: {collection.note}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ========== 子组件: CollectCashModal ==========
const CollectCashModal = ({ seller, smInfo, eventData, orgId, eventId, onClose }) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSpecialCase, setIsSpecialCase] = useState(false);
  const [actualAmount, setActualAmount] = useState('');
  const [discrepancyType, setDiscrepancyType] = useState('partial');
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const pendingAmount = seller.pendingAmount || 0;

  useEffect(() => {
    // 自动填充待收款金额
    setAmount(pendingAmount.toString());
  }, [pendingAmount]);

  // 计算差额
  const discrepancy = useMemo(() => {
    if (!isSpecialCase) return 0;
    const actual = parseFloat(actualAmount) || 0;
    const expected = parseFloat(amount) || 0;
    return actual - expected;
  }, [isSpecialCase, actualAmount, amount]);

  // 表单验证
  const validate = useCallback(() => {
    if (!isSpecialCase) {
      const amountNum = parseFloat(amount);
      if (!amountNum || amountNum <= 0) {
        return '请输入有效的收款金额';
      }
      if (amountNum > pendingAmount) {
        return '收款金额不能超过待收款金额';
      }
    } else {
      const actualNum = parseFloat(actualAmount);
      if (!actualNum || actualNum <= 0) {
        return '请输入实际收到的金额';
      }
      if (!discrepancyReason.trim()) {
        return '请填写差额原因';
      }
    }
    return '';
  }, [amount, isSpecialCase, actualAmount, discrepancyReason, pendingAmount]);

  // 提交收款
  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const batch = writeBatch(db);

      // 计算金额
      const collectionAmount = isSpecialCase ? parseFloat(actualAmount) : parseFloat(amount);
      const pointsValue = parseFloat(amount);
      const finalDiscrepancy = isSpecialCase ? discrepancy : 0;

      // 1. 创建 cashCollection 记录
      const collectionRef = doc(collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`));
      batch.set(collectionRef, {
        collectionId: collectionRef.id,
        type: 'sellerToManager',
        
        // 收款方
        collectedBy: smInfo.userId,
        collectedByName: smInfo.basicInfo?.chineseName || 'Seller Manager',
        collectedByRole: 'sellerManager',
        collectedByDepartment: smInfo.identityInfo?.department || '',
        
        // 提交方
        submittedBy: seller.id,
        submittedByName: seller.basicInfo?.chineseName || '未知',
        submittedByRole: 'seller',
        submittedByDepartment: seller.identityInfo?.department || '',
        
        // 金额
        amount: collectionAmount,
        pointsValue: pointsValue,
        discrepancy: finalDiscrepancy,
        discrepancyReason: isSpecialCase ? discrepancyReason : '',
        discrepancyType: isSpecialCase ? discrepancyType : '',
        
        // 状态
        status: 'collected',
        collectedAt: serverTimestamp(),
        submittedAt: null,
        confirmedAt: null,
        
        // 关联
        submissionId: null,
        sellerId: seller.id,
        sellerDepartment: seller.identityInfo?.department || '',
        eventId: eventId,
        organizationId: orgId,
        
        // 备注
        note: note,
        
        // 时间戳
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 2. 更新 Seller cashFlow
      const sellerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${seller.id}`);
      
      if (!isSpecialCase) {
        // 正常收款
        batch.update(sellerRef, {
          'pointsStats.cashFlow.submittedToManager': increment(collectionAmount),
          'pointsStats.cashFlow.cashOnHand': increment(-collectionAmount),
          'pointsStats.cashFlow.lastCollectionAt': serverTimestamp(),
          'updatedAt': serverTimestamp()
        });
      } else {
        // 特殊情况处理
        const updates = {
          'pointsStats.cashFlow.submittedToManager': increment(collectionAmount),
          'pointsStats.cashFlow.cashOnHand': increment(-collectionAmount),
          'pointsStats.cashFlow.lastCollectionAt': serverTimestamp(),
          'updatedAt': serverTimestamp()
        };

        if (discrepancyType === 'pointsRecovery') {
          // 点数回收：退还点数
          const recoveryAmount = Math.abs(finalDiscrepancy);
          updates['seller.availablePoints'] = increment(recoveryAmount);
          updates['pointsStats.pendingCollection'] = increment(-recoveryAmount);
        } else if (discrepancyType === 'waiver') {
          // 豁免：直接减少待收款
          const waiverAmount = Math.abs(finalDiscrepancy);
          updates['pointsStats.pendingCollection'] = increment(-waiverAmount);
          updates['pointsStats.cashFlow.cashOnHand'] = increment(-waiverAmount);
        }
        // partial 不需要额外处理，学生后续补交

        batch.update(sellerRef, updates);
      }

      // 3. 更新 SellerManager cashFlow
      const smRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${smInfo.userId}`);
      batch.update(smRef, {
        'pointsStats.cashFlow.collectedFromSellers': increment(collectionAmount),
        'pointsStats.cashFlow.cashHolding': increment(collectionAmount),
        'pointsStats.cashFlow.lastCollectionAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      await batch.commit();

      alert('✅ 收款成功！');
      onClose();
    } catch (err) {
      console.error('收款失败:', err);
      setError('收款失败: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2>💰 收取现金</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* 学生信息 */}
          <div style={styles.sellerInfoBox}>
            <div style={styles.infoRow}>
              <span>学生姓名:</span>
              <strong>{seller.basicInfo?.chineseName}</strong>
            </div>
            <div style={styles.infoRow}>
              <span>学号:</span>
              <strong>{seller.identityInfo?.identityId}</strong>
            </div>
            <div style={styles.infoRow}>
              <span>部门:</span>
              <strong>{seller.identityInfo?.department}</strong>
            </div>
            <div style={styles.infoRow}>
              <span>累计销售:</span>
              <strong>RM {(seller.pointsStats?.totalRevenue || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.infoRow}>
              <span>已上交:</span>
              <strong>RM {(seller.pointsStats?.cashFlow?.submittedToManager || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.infoRow}>
              <span style={{ color: '#ef4444' }}>待收款:</span>
              <strong style={{ color: '#ef4444' }}>RM {pendingAmount.toLocaleString()}</strong>
            </div>
          </div>

          {/* 正常收款 */}
          {!isSpecialCase && (
            <div style={styles.formGroup}>
              <label style={styles.label}>收取金额 (RM)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                style={styles.input}
                placeholder="请输入收款金额"
                min="0"
                step="0.01"
              />
            </div>
          )}

          {/* 特殊情况 */}
          <div style={styles.formGroup}>
            <label style={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={isSpecialCase}
                onChange={(e) => setIsSpecialCase(e.target.checked)}
                style={styles.checkbox}
              />
              ⚠️ 特殊情况（部分收款/点数回收/豁免）
            </label>
          </div>

          {isSpecialCase && (
            <div style={styles.specialCaseBox}>
              <div style={styles.formGroup}>
                <label style={styles.label}>应收金额 (RM)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  style={styles.input}
                  placeholder="应该收取的金额"
                  min="0"
                  step="0.01"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>实际收到 (RM)</label>
                <input
                  type="number"
                  value={actualAmount}
                  onChange={(e) => setActualAmount(e.target.value)}
                  style={styles.input}
                  placeholder="实际收到的金额"
                  min="0"
                  step="0.01"
                />
              </div>

              {actualAmount && amount && (
                <div style={styles.discrepancyInfo}>
                  <span>差额:</span>
                  <strong style={{ color: discrepancy < 0 ? '#ef4444' : '#10b981' }}>
                    RM {discrepancy.toFixed(2)}
                  </strong>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>处理方式</label>
                <div style={styles.radioGroup}>
                  <label style={styles.radioLabel}>
                    <input
                      type="radio"
                      name="discrepancyType"
                      value="partial"
                      checked={discrepancyType === 'partial'}
                      onChange={(e) => setDiscrepancyType(e.target.value)}
                      style={styles.radio}
                    />
                    部分收款 (学生后续补交)
                  </label>
                  <label style={styles.radioLabel}>
                    <input
                      type="radio"
                      name="discrepancyType"
                      value="pointsRecovery"
                      checked={discrepancyType === 'pointsRecovery'}
                      onChange={(e) => setDiscrepancyType(e.target.value)}
                      style={styles.radio}
                    />
                    点数回收 (扣除未付款的点数)
                  </label>
                  <label style={styles.radioLabel}>
                    <input
                      type="radio"
                      name="discrepancyType"
                      value="waiver"
                      checked={discrepancyType === 'waiver'}
                      onChange={(e) => setDiscrepancyType(e.target.value)}
                      style={styles.radio}
                    />
                    豁免 (特殊情况免除)
                  </label>
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>原因说明 *</label>
                <textarea
                  value={discrepancyReason}
                  onChange={(e) => setDiscrepancyReason(e.target.value)}
                  style={styles.textarea}
                  placeholder="请详细说明差额原因..."
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* 备注 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>备注</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={styles.textarea}
              placeholder="选填"
              rows={2}
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
            {submitting ? '处理中...' : '✅ 确认收款'}
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
  sellersList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
    gap: '1.5rem'
  },
  sellerCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem'
  },
  sellerHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '1rem',
    gap: '1rem'
  },
  sellerInfo: {
    flex: 1
  },
  sellerName: {
    fontSize: '1.125rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  alertBadge: {
    marginLeft: '0.5rem',
    fontSize: '1rem'
  },
  sellerMeta: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  sellerActions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '0.75rem'
  },
  pendingAmount: {
    textAlign: 'right'
  },
  pendingLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  pendingValue: {
    fontSize: '1.25rem',
    fontWeight: 'bold'
  },
  collectButton: {
    padding: '0.5rem 1rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  sellerStats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    padding: '1rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    fontSize: '0.875rem',
    color: '#6b7280'
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
  historySection: {
    marginTop: '1rem',
    paddingTop: '1rem',
    borderTop: '2px solid #e5e7eb'
  },
  historyItem: {
    padding: '0.75rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '0.5rem'
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  historyDate: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  historyAmount: {
    fontSize: '0.875rem',
    fontWeight: 'bold'
  },
  historyNote: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
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
  sellerInfoBox: {
    background: '#f3f4f6',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
    fontSize: '0.875rem',
    color: '#374151'
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
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    boxSizing: 'border-box'
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
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer'
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  specialCaseBox: {
    background: '#fef3c7',
    padding: '1rem',
    borderRadius: '8px',
    border: '2px solid #fbbf24'
  },
  discrepancyInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem',
    background: 'white',
    borderRadius: '8px',
    marginBottom: '1rem',
    fontSize: '0.875rem'
  },
  radioGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    fontSize: '0.875rem',
    color: '#374151',
    cursor: 'pointer'
  },
  radio: {
    width: '16px',
    height: '16px',
    cursor: 'pointer'
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

export default CollectCash;
