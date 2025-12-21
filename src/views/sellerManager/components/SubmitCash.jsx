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
  orderBy,
  getDocs  // ✨ 添加這個
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '../../../config/firebase';
import { safeFetch } from '../../../services/safeFetch';

const SubmitCash = ({ userInfo, eventData }) => {
  const [collections, setCollections] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState([]);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState('collected');

  // ✨ 新增：Finance Manager 相關狀態
  const [financeManagers, setFinanceManagers] = useState([]);
  const [selectedFM, setSelectedFM] = useState('');
  const [loadingFMs, setLoadingFMs] = useState(true);

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

  // ✨ 新增：加載 Finance Managers
  useEffect(() => {
    const fetchFinanceManagers = async () => {
      if (!orgId || !eventId) return;

      setLoadingFMs(true);
      try {
        const usersRef = collection(
          db,
          'organizations', orgId,
          'events', eventId,
          'users'
        );

        // 查詢所有有 financeManager 角色的用戶
        const q = query(
          usersRef,
          where('roles', 'array-contains', 'financeManager')
        );

        const snapshot = await getDocs(q);
        const fmList = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));

        console.log('[SubmitCash] 查詢到 Finance Managers:', fmList.length, '位');
        setFinanceManagers(fmList);

        // 如果只有一位 FM，自動選中
        if (fmList.length === 1) {
          setSelectedFM(fmList[0].id);
          console.log('[SubmitCash] 自動選中唯一的 FM:', fmList[0].basicInfo?.chineseName);
        }

      } catch (error) {
        console.error('[SubmitCash] 獲取 Finance Manager 失敗:', error);
        alert('無法加載 Finance Manager 列表，請重試');
      } finally {
        setLoadingFMs(false);
      }
    };

    fetchFinanceManagers();
  }, [orgId, eventId]);

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
        <SubmitModal
          selectedCollections={selectedCollections}
          collections={collections}
          onClose={handleCloseSubmitModal}
          onSuccess={() => {
            setSelectedCollections([]);
            setSelectedFM(''); // ✨ 重置選擇
          }}
          smInfo={userInfo}
          // ✨ 新增 props
          financeManagers={financeManagers}
          selectedFM={selectedFM}
          setSelectedFM={setSelectedFM}
          loadingFMs={loadingFMs}
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


// ========================================
// 第3部分：完全替換 SubmitModal 組件（第 595-735 行）
// ========================================

/**
 * SubmitModal - 上交確認對話框
 * 
 * ✨ 主要改動：
 * 1. 添加 Finance Manager 選擇下拉列表
 * 2. 驗證 FM 選擇
 * 3. 將選中的 FM 傳遞給 handleSubmit
 */
const SubmitModal = ({
  selectedCollections,
  collections,
  onClose,
  onSuccess,
  smInfo,
  // ✨ 新增 props
  financeManagers,
  selectedFM,
  setSelectedFM,
  loadingFMs
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const orgId = smInfo.organizationId;
  const eventId = smInfo.eventId;

  // 獲取選中的詳細信息
  const selectedDetails = collections.filter(c =>
    selectedCollections.includes(c.id)
  );

  // 計算總金額
  const totalAmount = selectedDetails.reduce((sum, c) => sum + c.amount, 0);

  // 計算明細統計
  const breakdown = {
    normalCollections: selectedDetails.reduce((sum, c) =>
      c.type === 'normal' ? sum + c.amount : sum, 0
    ),
    partialCollections: selectedDetails.reduce((sum, c) =>
      c.type === 'partial' ? sum + c.amount : sum, 0
    ),
    pointsRecovery: selectedDetails.reduce((sum, c) =>
      c.type === 'recovery' ? sum + c.amount : sum, 0
    ),
    waivers: selectedDetails.reduce((sum, c) =>
      c.type === 'waiver' ? sum + c.amount : sum, 0
    ),
    totalDiscrepancy: 0 // 可以後續計算差額
  };

  // ✨ 修改後的 handleSubmit
  const handleSubmit = async () => {
    // ========== 步驟 1: 驗證 FM 選擇 ==========
    if (!selectedFM) {
      setError('請選擇接收的 Finance Manager');
      return;
    }

    // ========== 步驟 2: 獲取 FM 信息 ==========
    const fmInfo = financeManagers.find(fm => fm.id === selectedFM);
    if (!fmInfo) {
      setError('找不到選中的 Finance Manager');
      return;
    }

    // ========== 步驟 3: 二次確認 ==========
    if (!confirm(
      `確認上交 ${selectedCollections.length} 筆收款記錄，` +
      `總金額 RM ${totalAmount.toLocaleString()}？\n\n` +
      `接收方：${fmInfo.basicInfo?.chineseName || fmInfo.displayName || '未知'}`
    )) {
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      // ========== 步驟 4: 獲取 Firebase Auth Token ==========
      const auth = getAuth();
      const currentUser = auth.currentUser;

      if (!currentUser) {
        throw new Error('用戶未登入');
      }

      const idToken = await currentUser.getIdToken();
      console.log('[SubmitCash] 獲取 ID Token 成功');

      // ========== 步驟 5: 調用 Cloud Function ==========
      const functionUrl = 'https://submitcashtofinancehttp-zgmq4nw2bq-as.a.run.app';

      console.log('[SubmitCash] 開始調用 Cloud Function...');
      console.log('  - URL:', functionUrl);
      console.log('  - 收款記錄數:', selectedCollections.length);
      console.log('  - 總金額:', totalAmount);

      const response = await safeFetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId: orgId,
          eventId: eventId,
          financeManagerId: selectedFM,
          selectedCollections: selectedCollections,
          totalAmount: totalAmount,
          note: note
        })
      });

      console.log('[SubmitCash] Cloud Function 響應狀態:', response.status);

      // ========== 步驟 6: 處理響應 ==========
      if (!response.ok) {
        const errorData = await response.json();
        console.error('[SubmitCash] Cloud Function 返回錯誤:', errorData);
        throw new Error(errorData.error || errorData.message || '上交失敗');
      }

      const data = await response.json();
      console.log('[SubmitCash] ✅ Cloud Function 成功:', data);

      // ========== 步驟 7: 顯示成功訊息 ==========
      alert(
        `✅ 上交成功！\n\n` +
        `金額：RM ${totalAmount.toLocaleString()}\n` +
        `接收方：${fmInfo.basicInfo?.chineseName || fmInfo.displayName}\n` +
        `提交編號：${data.submissionId}\n\n` +
        `等待 Finance Manager 確認`
      );

      // ========== 步驟 8: 清理並關閉 ==========
      onSuccess(); // 清空選擇
      onClose();   // 關閉 Modal

    } catch (err) {
      console.error('[SubmitCash] ❌ 上交失敗:', err);

      // 詳細的錯誤訊息
      let errorMessage = '上交失敗: ' + err.message;

      if (err.message.includes('Failed to fetch')) {
        errorMessage = '網絡錯誤，請檢查網絡連接後重試';
      } else if (err.message.includes('unauthorized') || err.message.includes('401')) {
        errorMessage = '授權失敗，請重新登入';
      } else if (err.message.includes('403')) {
        errorMessage = '沒有權限執行此操作';
      }

      setError(errorMessage);
      alert('❌ ' + errorMessage);

    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2>📤 上交現金給 Finance Manager</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* 匯總信息 */}
          <div style={styles.summaryBox}>
            <div style={styles.summaryRow}>
              <span>選中筆數:</span>
              <strong>{selectedCollections.length} 筆</strong>
            </div>
            <div style={styles.summaryRow}>
              <span>總金額:</span>
              <strong style={{ fontSize: '1.5rem', color: '#10b981' }}>
                RM {totalAmount.toLocaleString()}
              </strong>
            </div>
          </div>

          {/* ✨ 新增：Finance Manager 選擇 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              選擇接收的 Finance Manager <span style={{ color: '#ef4444' }}>*</span>
            </label>
            {loadingFMs ? (
              <div style={styles.loadingText}>加載 Finance Managers...</div>
            ) : financeManagers.length === 0 ? (
              <div style={styles.warningBox}>
                ⚠️ 沒有找到 Finance Manager，請先在 Event Manager Dashboard 創建一位 Finance Manager。
              </div>
            ) : (
              <select
                value={selectedFM}
                onChange={(e) => setSelectedFM(e.target.value)}
                style={styles.select}
                required
              >
                <option value="">-- 請選擇 Finance Manager --</option>
                {financeManagers.map(fm => (
                  <option key={fm.id} value={fm.id}>
                    {fm.basicInfo?.chineseName || fm.displayName || '未命名'}
                    {' - '}
                    {fm.basicInfo?.phoneNumber || fm.phone || '無電話'}
                    {fm.identityInfo?.department ? ` (${fm.identityInfo.department})` : ''}
                  </option>
                ))}
              </select>
            )}
            <div style={styles.hint}>
              💡 提示：上交後需要 Finance Manager 登入確認才算完成
            </div>
          </div>

          {/* 明細統計 */}
          <div style={styles.breakdownBox}>
            <h4 style={styles.breakdownTitle}>明細統計</h4>
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
                <span>點數回收:</span>
                <strong style={{ color: '#3b82f6' }}>RM {breakdown.pointsRecovery.toLocaleString()}</strong>
              </div>
            )}
            {breakdown.waivers > 0 && (
              <div style={styles.breakdownItem}>
                <span>豁免:</span>
                <strong style={{ color: '#8b5cf6' }}>RM {breakdown.waivers.toLocaleString()}</strong>
              </div>
            )}
          </div>

          {/* 明細列表 */}
          <div style={styles.detailsList}>
            <h4 style={styles.detailsTitle}>包含的收款記錄</h4>
            {selectedDetails.map(collection => (
              <div key={collection.id} style={styles.detailListItem}>
                <span>
                  {collection.sellerName ||
                    collection.submittedByName ||
                    collection.seller?.basicInfo?.chineseName ||
                    '未知'}
                </span>
                <span style={{ color: '#10b981' }}>RM {collection.amount.toLocaleString()}</span>
              </div>
            ))}
          </div>

          {/* 備註 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>備註給 Finance Manager</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={styles.textarea}
              placeholder="選填，如有特殊情況請說明..."
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
              opacity: (submitting || !selectedFM) ? 0.6 : 1,
              cursor: (submitting || !selectedFM) ? 'not-allowed' : 'pointer'
            }}
            disabled={submitting || !selectedFM}
          >
            {submitting ? '處理中...' : '✅ 確認上交'}
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
  },
  loadingText: {
    padding: '0.75rem',
    textAlign: 'center',
    color: '#6b7280',
    background: '#f9fafb',
    borderRadius: '6px'
  },
  warningBox: {
    padding: '1rem',
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    borderRadius: '6px',
    color: '#92400e',
    fontSize: '0.875rem'
  }


};

export default SubmitCash;
