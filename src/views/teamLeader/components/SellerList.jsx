/**
 * SellerList.jsx (修正版)
 * 
 * 修正內容:
 * - Line 164: 修正 SM ID 讀取邏輯，從 props 獲取而非從 seller.managedBy
 * 
 * 修正原因:
 * seller.managedBy 可能為空或不正確，應該從當前登入的 userInfo 獲取
 * 
 * @version 1.1 (2024-12-15)
 */

import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, writeBatch, serverTimestamp, increment, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';

/**
 * SellerList 組件
 * 
 * @param {Object} props
 * @param {Array} props.sellers - Seller 列表
 * @param {string} props.selectedDepartment - 選中的部門
 * @param {Function} props.onSelectSeller - 選擇 Seller 回調
 * @param {Function} props.onRecordCollection - 記錄收款回調
 * @param {Object} props.userInfo - ✨ 新增：當前登入的用戶信息（Team Leader）
 */
const SellerList = ({ sellers = [], selectedDepartment, onSelectSeller, onRecordCollection, userInfo // ✨ 新增 prop
}) => {
  const [sortBy, setSortBy] = useState('name');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSeller, setExpandedSeller] = useState(null);
  const [recordingCollection, setRecordingCollection] = useState(null);

  // ========== 修正：從 userInfo 獲取必要信息 ==========
  const orgId = userInfo?.organizationId;
  const eventId = userInfo?.eventId;
  const currentUserId = userInfo?.userId; // ✅ 正確的 Team Leader ID

  // 確保輸入是安全的
  const safeSellers = Array.isArray(sellers) ? sellers : [];

  // 篩選邏輯
  const getFilteredSellers = () => {
    let filtered = [...safeSellers];

    // 1. 部門篩選
    if (selectedDepartment) {
      filtered = filtered.filter(seller =>
        seller.identityInfo?.department === selectedDepartment
      );
    }

    // 2. 狀態篩選
    if (filterStatus !== 'all') {
      filtered = filtered.filter(seller => {
        const collectionAlert = seller.collectionAlert || {};

        switch (filterStatus) {
          case 'active':
            return (seller.pointSeller?.totalPointsSold || 0) > 0;
          case 'warning':
            return collectionAlert.hasWarning === true && collectionAlert.riskLevel !== 'high';
          case 'highRisk':
            return collectionAlert.riskLevel === 'high';
          default:
            return true;
        }
      });
    }

    // 3. 搜尋篩選
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(seller => {
        const name = (seller.basicInfo?.chineseName || '').toLowerCase();
        const studentId = (seller.identityInfo?.identityTag || '').toLowerCase();
        const dept = (seller.identityInfo?.department || '').toLowerCase();
        return name.includes(term) || studentId.includes(term) || dept.includes(term);
      });
    }

    return filtered;
  };

  // 排序邏輯
  const getSortedSellers = (filtered) => {
    const sorted = [...filtered];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => {
          const nameA = a.basicInfo?.chineseName || '';
          const nameB = b.basicInfo?.chineseName || '';
          return nameA.localeCompare(nameB, 'zh-CN');
        });
        break;
      case 'points':
        sorted.sort((a, b) =>
          (b.seller?.availablePoints || 0) - (a.seller?.availablePoints || 0)
        );
        break;
      case 'sold':
        sorted.sort((a, b) =>
          (b.seller?.totalPointsSold || 0) - (a.seller?.totalPointsSold || 0)
        );
        break;
      case 'pending':
        sorted.sort((a, b) => {
          const pendingA = (a.seller?.pendingCollection || 0);
          const pendingB = (b.seller?.pendingCollection || 0);
          return pendingB - pendingA;
        });
        break;
      default:
        break;
    }

    return sorted;
  };

  const filteredSellers = getFilteredSellers();
  const sortedSellers = getSortedSellers(filteredSellers);

  // ========== 收款邏輯（主要修正部分）==========

  /**
   * 記錄收款
   * 
   * 流程:
   * 1. 驗證待收款金額
   * 2. 確認操作
   * 3. 創建 cashCollection 記錄
   * 4. 更新 Seller 統計
   * 5. 更新 Team Leader 統計
   */
  const handleRecordCollection = async (seller) => {
    // ✅ 步驟 1: 驗證待收款金額
    const pendingAmount = seller.pointSeller?.pendingCollection || 0;

    if (pendingAmount <= 0) {
      window.mybazaarShowToast('該 Seller 沒有待收款金額');
      return;
    }

    // ✅ 步驟 2: 確認操作
    if (!window.confirm(
      `確認從 ${seller.basicInfo?.chineseName || '未知'} 收取現金 RM ${pendingAmount}？\n\n` +
      `學號: ${seller.identityInfo?.identityTag || '未知'}\n` +
      `部門: ${seller.identityInfo?.department || '未知'}`
    )) {
      return;
    }

    // ✅ 步驟 3: 獲取當前 Team Leader 信息
    // ✨ 修正：從 userInfo prop 獲取，而非從 seller.managedBy
    if (!currentUserId) {
      window.mybazaarShowToast('❌ 錯誤：無法獲取當前用戶信息');
      console.error('currentUserId is undefined, userInfo:', userInfo);
      return;
    }

    setRecordingCollection(seller.userId);

    try {
      const batch = writeBatch(db);

      // ✅ 步驟 4: 創建 cashCollection 記錄（Event 級別）
      const collectionRef = collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`);
      const collectionDoc = doc(collectionRef); // 自動生成 ID

      batch.set(collectionDoc, {
        // 基本信息
        collectionId: collectionDoc.id,
        sellerId: seller.userId,
        sellerName: seller.basicInfo?.chineseName || '未知',
        sellerDepartment: seller.identityInfo?.department || '未分配',
        sellerIdentityTag: seller.identityInfo?.identityTag || 'student',  // 身份标签（student/teacher/staff）
        sellerIdentityId: seller.identityInfo?.identityId || '未知',      // 🆕 新增：学号

        // ✨ 修正：使用正確的 currentUserId
        collectedBy: currentUserId,
        collectedByName: userInfo?.basicInfo?.chineseName || 'Team Leader',
        collectedByRole: 'teamLeader',

        // 金額信息
        amount: pendingAmount,

        // 狀態
        status: 'collected', // collected | submitted | confirmed
        collectedAt: serverTimestamp(),
        submittedAt: null,
        submittedToFinance: false,
        submissionId: null,
        confirmedAt: null,
        confirmedBy: null,

        // 關聯信息
        eventId: eventId,
        organizationId: orgId,

        // 時間戳
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // ✅ 步驟 5: 更新 Seller 的 cashFlow 統計
      const sellerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${seller.userId}`);

      batch.update(sellerRef, {
        // 增加已收款總額
        'pointSeller.totalCashCollected': increment(pendingAmount),
        // 清零待收款金額
        'pointSeller.pendingCollection': 0,
        // 更新最後收款時間
        'pointSeller.lastCollectionAt': serverTimestamp(),
        // 更新文檔時間
        'updatedAt': serverTimestamp()
      });

      // ✅ 步驟 6: 更新 Team Leader 的 cashFlow 統計
      // ✨ 修正：使用正確的 currentUserId
      const smRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${currentUserId}`);

      batch.update(smRef, {
        // 增加現金統計
        'teamLeader.cashStats.confirmedFromSellers': increment(pendingAmount),
        'teamLeader.cashStats.cashOnHand': increment(pendingAmount),
        'teamLeader.cashStats.totalReceivedFromSellers': increment(pendingAmount),
        // 更新最後收款時間
        'teamLeader.cashStats.lastConfirmedAt': serverTimestamp(),
        // 更新文檔時間
        'updatedAt': serverTimestamp()
      });

      // ✅ 步驟 7: 提交 Batch
      await batch.commit();

      console.log('✅ 收款成功');
      window.mybazaarShowToast(`✅ 成功收取 RM ${pendingAmount} 從 ${seller.basicInfo?.chineseName || '未知'}`);

      // 可選：調用父組件的回調
      if (onRecordCollection) {
        onRecordCollection(seller, pendingAmount);
      }

    } catch (error) {
      console.error('❌ 收款失敗:', error);
      window.mybazaarShowToast('收款失敗，請重試。錯誤: ' + error.message);
    } finally {
      setRecordingCollection(null);
    }
  };

  // ========== UI 渲染 ==========

  return (
    <div style={styles.container}>
      {/* 工具欄 */}
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <input
            type="text"
            placeholder="搜尋姓名、學號或部門..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        <div style={styles.filters}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="all">全部狀態</option>
            <option value="active">活躍中</option>
            <option value="warning">收款警示</option>
            <option value="highRisk">高風險</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="name">按姓名</option>
            <option value="points">按現有點數</option>
            <option value="sold">按已銷售</option>
            <option value="pending">按待收款</option>
          </select>
        </div>
      </div>

      {/* Sellers 表格 */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>#</th>
              <th style={styles.th}>姓名</th>
              <th style={styles.th}>學號</th>
              <th style={styles.th}>部門</th>
              <th style={styles.th}>現有點數</th>
              <th style={styles.th}>已銷售</th>
              <th style={styles.th}>待收款</th>
              <th style={styles.th}>狀態</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedSellers.length === 0 ? (
              <tr>
                <td colSpan="9" style={styles.noData}>
                  沒有符合條件的 Sellers
                </td>
              </tr>
            ) : (
              sortedSellers.map((seller, index) => {
                const pending = seller.pointsStats?.cashFlow?.pendingCollection || 0;
                const isExpanded = expandedSeller === seller.userId;
                const isRecording = recordingCollection === seller.userId;
                const hasWarning = seller.collectionAlert?.hasWarning;
                const riskLevel = seller.collectionAlert?.riskLevel;

                return (
                  <React.Fragment key={seller.userId}>
                    <tr style={styles.row}>
                      <td style={styles.td}>{index + 1}</td>
                      <td style={styles.td}>
                        {seller.basicInfo?.chineseName || seller.basicInfo?.englishName || '未知'}
                      </td>
                      <td style={styles.td}>
                        {seller.identityInfo?.identityId || '-'}  {/* 🆕 新增 - JSON第381行 */}
                      </td>
                      <td style={styles.td}>
                        {seller.identityInfo?.department || '-'}
                      </td>
                      <td style={styles.td}>
                        {seller.pointSeller?.availablePoints || 0}
                      </td>
                      <td style={styles.td}>
                        {seller.pointSeller?.totalPointsSold || 0}
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          color: pending > 0 ? '#ef4444' : '#6b7280',
                          fontWeight: pending > 0 ? 'bold' : 'normal'
                        }}>
                          RM {pending.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {hasWarning ? (
                          <span style={{
                            ...styles.badge,
                            background: riskLevel === 'high' ? '#fee2e2' : '#fef3c7',
                            color: riskLevel === 'high' ? '#dc2626' : '#d97706'
                          }}>
                            {riskLevel === 'high' ? '⚠️ 高風險' : '⚡ 警示'}
                          </span>
                        ) : (
                          <span style={{
                            ...styles.badge,
                            background: '#dcfce7',
                            color: '#16a34a'
                          }}>
                            ✓ 正常
                          </span>
                        )}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actionButtons}>
                          {/* ✅ 新增：分配点数按钮 */}
                          {onSelectSeller && (
                            <button
                              onClick={() => onSelectSeller(seller)}
                              style={{
                                ...styles.actionBtn,
                                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                                color: 'white'
                              }}
                            >
                              📦 分配
                            </button>
                          )}
                          {pending > 0 && (
                            <button
                              onClick={() => handleRecordCollection(seller)}
                              disabled={isRecording}
                              style={{
                                ...styles.actionBtn,
                                background: '#10b981',
                                opacity: isRecording ? 0.5 : 1
                              }}
                            >
                              {isRecording ? '處理中...' : '💰 收款'}
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedSeller(isExpanded ? null : seller.userId)}
                            style={{
                              ...styles.actionBtn,
                              background: '#6b7280'
                            }}
                          >
                            {isExpanded ? '收起' : '詳情'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 展開的詳情行 */}
                    {isExpanded && (
                      <tr>
                        <td colSpan="10" style={styles.detailsCell}>  {/* 注意：colSpan要加1，因为多了学号列 */}
                          <div style={styles.detailsContainer}>
                            <h4 style={styles.detailsTitle}>详细信息</h4>
                            <div style={styles.detailsGrid}>

                              {/* 现有的详情 */}
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>电话:</span>
                                <span>{seller.basicInfo?.phoneNumber || '-'}</span>  {/* ✅ 已修正 */}
                              </div>

                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>学号:</span>
                                <span>{seller.identityInfo?.identityId || '-'}</span>  {/* 🆕 新增 */}
                              </div>

                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>累计销售额:</span>
                                <span>RM {seller.pointSeller?.totalRevenue || 0}</span>
                              </div>

                              {/* 🆕 新增：现金交付情况 */}
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>手上现金:</span>
                                <span style={{ color: '#ef4444', fontWeight: 'bold' }}>
                                  RM {seller.pointSeller?.pendingCollection || 0}
                                </span>
                              </div>

                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>已交付SM:</span>
                                <span style={{ color: '#10b981', fontWeight: 'bold' }}>
                                  RM {seller.pointSeller?.totalSubmitted || 0}
                                </span>
                              </div>

                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>累计收款:</span>
                                <span>RM {seller.pointSeller?.totalCashCollected || 0}</span>
                              </div>

                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 統計摘要 */}
      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>總人數:</span>
          <span style={styles.summaryValue}>{sortedSellers.length}</span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>總待收款:</span>
          <span style={{ ...styles.summaryValue, color: '#ef4444' }}>
            RM {sortedSellers.reduce((sum, s) => sum + (s.pointsStats?.cashFlow?.pendingCollection || 0), 0).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};

// ========== 樣式 ==========
const styles = {
  container: {
    padding: '1.5rem',
    background: 'white',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap'
  },
  searchBox: {
    flex: '1 1 300px'
  },
  searchInput: {
    width: '100%',
    padding: '0.5rem 1rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem'
  },
  filters: {
    display: 'flex',
    gap: '0.5rem'
  },
  select: {
    padding: '0.5rem 1rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    background: 'white'
  },
  tableContainer: {
    overflowX: 'auto',
    marginBottom: '1rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  headerRow: {
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb'
  },
  th: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#374151',
    textTransform: 'uppercase'
  },
  row: {
    borderBottom: '1px solid #e5e7eb',
    ':hover': {
      background: '#f9fafb'
    }
  },
  td: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    color: '#111827'
  },
  noData: {
    padding: '2rem',
    textAlign: 'center',
    color: '#6b7280'
  },
  badge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionBtn: {
    padding: '0.375rem 0.75rem',
    border: 'none',
    borderRadius: '6px',
    color: 'white',
    fontSize: '0.75rem',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  detailsCell: {
    padding: '0',
    background: '#f9fafb'
  },
  detailsContainer: {
    padding: '1.5rem',
    borderTop: '1px solid #e5e7eb'
  },
  detailsTitle: {
    margin: '0 0 1rem 0',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem'
  },
  detailItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  detailLabel: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  summary: {
    display: 'flex',
    gap: '2rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '6px',
    marginTop: '1rem'
  },
  summaryItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  summaryLabel: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  summaryValue: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#111827'
  }
};

export default SellerList;
