import { useState } from 'react';

/**
 * Seller List Component (架构修正版 v5)
 * Step 1.2: 数据渲染优化完成 ✅ (已根据正确架构修正)
 * 
 * 根据 Firestore 架构正确渲染 Seller 数据
 * 路径: organizations/{orgId}/events/{eventId}/users/{userId}
 * 
 * 数据结构：
 * - basicInfo: { phoneNumber, englishName, chineseName, email, ... }
 * - identityInfo: { identityId, identityTag, identityName, department }
 * - pointsStats: { totalReceived, currentBalance, totalSold, totalRevenue, ... }
 * - seller: { availablePoints, totalPointsSold, totalRevenue, collectionAlert, ... }
 * 
 * 注意：pointsStats 是主要统计对象，seller 对象是角色专用数据
 */
const SellerList = ({ sellers, selectedDepartment, onSelectSeller, onRecordCollection }) => {
  const [sortBy, setSortBy] = useState('name');
  const [filterStatus, setFilterStatus] = useState('all'); // 'all' | 'active' | 'warning' | 'highRisk'
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSeller, setExpandedSeller] = useState(null);

  // 确保输入是安全的
  const safeSellers = Array.isArray(sellers) ? sellers : [];

  // 筛选逻辑
  const getFilteredSellers = () => {
    let filtered = [...safeSellers];

    // 1. 部门筛选
    if (selectedDepartment) {
      filtered = filtered.filter(seller => {
        const dept = seller.identityInfo?.department || '';
        return dept === selectedDepartment.departmentCode;
      });
    }

    // 2. 状态筛选
    if (filterStatus !== 'all') {
      filtered = filtered.filter(seller => {
        const sellerData = seller.seller || {};
        const hasAlert = sellerData.collectionAlert === true;
        const totalSold = seller.pointsStats?.totalSold || 0;
        const pendingCollection = seller.pointsStats?.pendingCollection || 0;
        const totalRevenue = seller.pointsStats?.totalRevenue || 1;
        const pendingRatio = pendingCollection / totalRevenue;
        
        switch(filterStatus) {
          case 'active':
            return totalSold > 0;
          case 'warning':
            // 有警示但不是高风险（待收款比例 < 50%）
            return hasAlert && pendingRatio < 0.5;
          case 'highRisk':
            // 高风险：待收款比例 >= 50%
            return hasAlert && pendingRatio >= 0.5;
          default:
            return true;
        }
      });
    }

    // 3. 搜索筛选
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(seller => {
        const name = (seller.basicInfo?.chineseName || '').toLowerCase();
        const phone = (seller.basicInfo?.phoneNumber || '').toLowerCase();
        const dept = (seller.identityInfo?.department || '').toLowerCase();
        return name.includes(term) || phone.includes(term) || dept.includes(term);
      });
    }

    return filtered;
  };

  // 排序逻辑
  const getSortedSellers = (filtered) => {
    return [...filtered].sort((a, b) => {
      const aStats = a.pointsStats || {};
      const bStats = b.pointsStats || {};

      switch(sortBy) {
        case 'name':
          const aName = a.basicInfo?.chineseName || '';
          const bName = b.basicInfo?.chineseName || '';
          return aName.localeCompare(bName);
        case 'department':
          const aDept = a.identityInfo?.department || '';
          const bDept = b.identityInfo?.department || '';
          return aDept.localeCompare(bDept);
        case 'balance':
          return (bStats.currentBalance || 0) - (aStats.currentBalance || 0);
        case 'revenue':
          return (bStats.totalRevenue || 0) - (aStats.totalRevenue || 0);
        case 'collectionRate':
          const aRate = aStats.collectionRate || 0;
          const bRate = bStats.collectionRate || 0;
          return bRate - aRate;
        case 'pendingCollection':
          return (bStats.pendingCollection || 0) - (aStats.pendingCollection || 0);
        default:
          return 0;
      }
    });
  };

  const filteredSellers = getFilteredSellers();
  const sortedSellers = getSortedSellers(filteredSellers);

  // 统计摘要
  const getStatsSummary = () => {
    const total = filteredSellers.length;
    const active = filteredSellers.filter(s => (s.pointsStats?.totalSold || 0) > 0).length;
    
    // 计算有警示和高风险的数量
    const withWarning = filteredSellers.filter(s => {
      const sellerData = s.seller || {};
      const hasAlert = sellerData.collectionAlert === true;
      const pendingRatio = (s.pointsStats?.pendingCollection || 0) / (s.pointsStats?.totalRevenue || 1);
      return hasAlert && pendingRatio < 0.5;
    }).length;
    
    const highRisk = filteredSellers.filter(s => {
      const sellerData = s.seller || {};
      const hasAlert = sellerData.collectionAlert === true;
      const pendingRatio = (s.pointsStats?.pendingCollection || 0) / (s.pointsStats?.totalRevenue || 1);
      return hasAlert && pendingRatio >= 0.5;
    }).length;

    return { total, active, withWarning, highRisk };
  };

  const summary = getStatsSummary();

  if (safeSellers.length === 0) {
    return (
      <div style={styles.container}>
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>👥</div>
          <h3>还没有 Sellers 数据</h3>
          <p>系统正在加载用户信息，请稍候</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 标题栏 */}
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>
            👥 {selectedDepartment ? `${selectedDepartment.departmentCode} - ` : ''}Sellers 列表
          </h2>
          <div style={styles.subtitle}>
            共 {summary.total} 人
            {summary.active > 0 && ` · 活跃 ${summary.active} 人`}
            {summary.withWarning > 0 && (
              <span style={{ color: '#f59e0b' }}> · ⚠️ {summary.withWarning} 人有警示</span>
            )}
            {summary.highRisk > 0 && (
              <span style={{ color: '#ef4444' }}> · 🚨 {summary.highRisk} 人高风险</span>
            )}
          </div>
        </div>
      </div>

      {/* 控制栏 */}
      <div style={styles.controls}>
        {/* 搜索框 */}
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="搜索姓名、电话或部门..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              style={styles.clearButton}
            >
              ✕
            </button>
          )}
        </div>

        {/* 状态筛选 */}
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>状态：</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部</option>
            <option value="active">有销售活动</option>
            <option value="warning">收款警示</option>
            <option value="highRisk">高风险</option>
          </select>
        </div>

        {/* 排序 */}
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>排序：</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="name">姓名 A-Z</option>
            <option value="department">部门 A-Z</option>
            <option value="balance">余额（高到低）</option>
            <option value="revenue">销售额（高到低）</option>
            <option value="collectionRate">收款率（高到低）</option>
            <option value="pendingCollection">待收款（高到低）</option>
          </select>
        </div>
      </div>

      {/* Sellers 表格 */}
      {sortedSellers.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🔍</div>
          <h3>没有找到符合条件的 Sellers</h3>
          <p>试试调整筛选条件或搜索关键词</p>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.tableHeader}>
                <th style={styles.th}>姓名</th>
                <th style={styles.th}>部门</th>
                <th style={styles.th}>电话</th>
                <th style={styles.th}>当前余额</th>
                <th style={styles.th}>累计销售</th>
                <th style={styles.th}>收款率</th>
                <th style={styles.th}>状态</th>
                <th style={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedSellers.map((seller) => (
                <SellerRow
                  key={seller.id || seller.userId}
                  seller={seller}
                  isExpanded={expandedSeller === (seller.id || seller.userId)}
                  onToggle={() => setExpandedSeller(
                    expandedSeller === (seller.id || seller.userId) ? null : (seller.id || seller.userId)
                  )}
                  onSelect={onSelectSeller}
                  onRecordCollection={onRecordCollection}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/**
 * Seller Row Component
 * 渲染单个 Seller 的数据行（根据正确的Firestore架构）
 */
const SellerRow = ({ seller, isExpanded, onToggle, onSelect, onRecordCollection }) => {
  if (!seller || typeof seller !== 'object') return null;

  // 安全读取数据 - 根据正确的架构
  const basicInfo = seller.basicInfo || {};
  const identityInfo = seller.identityInfo || {};
  const pointsStats = seller.pointsStats || {};
  const sellerData = seller.seller || {};
  
  // 基础信息
  const displayName = basicInfo.chineseName || '未命名';
  const englishName = basicInfo.englishName || '';
  const department = identityInfo.department || '-';
  const phoneNumber = basicInfo.phoneNumber || '-';
  
  // 点数统计（使用 pointsStats，这是主要的统计对象）
  const currentBalance = pointsStats.currentBalance || 0;
  const totalRevenue = pointsStats.totalRevenue || 0;
  const collectionRate = pointsStats.collectionRate || 0;
  const pendingCollection = pointsStats.pendingCollection || 0;
  const totalSold = pointsStats.totalSold || 0;
  
  // 收款警示（seller 对象中的 collectionAlert 是布尔值）
  const hasCollectionAlert = sellerData.collectionAlert === true;
  const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

  // 收款率颜色
  const getRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981';
    if (rate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  // 状态标签
  const getStatusBadge = () => {
    // 高风险：有警示且待收款比例 >= 50%
    if (hasCollectionAlert && pendingRatio >= 0.5) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeHighRisk }}>
          🚨 高风险
        </span>
      );
    }
    // 警示：有警示但待收款比例 < 50%
    if (hasCollectionAlert) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeWarning }}>
          ⚠️ 警示
        </span>
      );
    }
    // 活跃：有销售记录
    if (totalSold > 0) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeActive }}>
          ✅ 活跃
        </span>
      );
    }
    // 未活跃
    return (
      <span style={{ ...styles.badge, ...styles.badgeInactive }}>
        ⏸️ 未活跃
      </span>
    );
  };

  return (
    <>
      <tr style={styles.tableRow}>
        <td style={styles.td}>
          <div style={styles.nameCell}>
            <div style={styles.nameText}>{displayName}</div>
            {englishName && (
              <div style={styles.englishName}>{englishName}</div>
            )}
          </div>
        </td>
        <td style={styles.td}>{department}</td>
        <td style={styles.td}>
          <span style={styles.phoneText}>{phoneNumber}</span>
        </td>
        <td style={styles.td}>
          <span style={styles.balanceText}>
            RM {currentBalance.toLocaleString()}
          </span>
        </td>
        <td style={styles.td}>
          <span style={styles.revenueText}>
            RM {totalRevenue.toLocaleString()}
          </span>
        </td>
        <td style={styles.td}>
          <div style={styles.rateCell}>
            <span style={{ 
              ...styles.rateText,
              color: getRateColor(collectionRate)
            }}>
              {Math.round(collectionRate * 100)}%
            </span>
            <div style={styles.rateBar}>
              <div style={{
                ...styles.rateBarFill,
                width: `${Math.min(100, collectionRate * 100)}%`,
                background: getRateColor(collectionRate)
              }}></div>
            </div>
          </div>
        </td>
        <td style={styles.td}>
          {getStatusBadge()}
        </td>
        <td style={styles.td}>
          <div style={styles.actionButtons}>
            <button
              onClick={onToggle}
              style={styles.actionButton}
              title="查看详情"
            >
              {isExpanded ? '▲' : '▼'}
            </button>
            {onRecordCollection && pendingCollection > 0 && (
              <button
                onClick={() => onRecordCollection(seller)}
                style={{ ...styles.actionButton, ...styles.collectionButton }}
                title="记录收款"
              >
                💰
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* 展开的详细信息 */}
      {isExpanded && (
        <tr>
          <td colSpan="8" style={styles.expandedCell}>
            <SellerDetails 
              seller={seller} 
              onSelect={onSelect}
              onRecordCollection={onRecordCollection}
            />
          </td>
        </tr>
      )}
    </>
  );
};

/**
 * Seller Details Component
 * 展开后显示的详细信息（根据正确的Firestore架构）
 */
const SellerDetails = ({ seller, onSelect, onRecordCollection }) => {
  const pointsStats = seller.pointsStats || {};
  const sellerData = seller.seller || {};
  const basicInfo = seller.basicInfo || {};
  const identityInfo = seller.identityInfo || {};
  
  const hasCollectionAlert = sellerData.collectionAlert === true;
  const pendingCollection = pointsStats.pendingCollection || 0;
  const totalRevenue = pointsStats.totalRevenue || 0;
  const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

  // 将 Firestore Timestamp 转换为日期字符串
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '从未';
    if (timestamp.seconds) {
      return new Date(timestamp.seconds * 1000).toLocaleDateString('zh-CN');
    }
    if (timestamp.toDate) {
      return timestamp.toDate().toLocaleDateString('zh-CN');
    }
    return '无效日期';
  };

  return (
    <div style={styles.detailsContainer}>
      <div style={styles.detailsGrid}>
        {/* 点数统计 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>💰 点数流动</div>
          <div style={styles.detailRows}>
            <div style={styles.detailRow}>
              <span>累计收到点数:</span>
              <strong>RM {(pointsStats.totalReceived || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>当前持有:</span>
              <strong>RM {(pointsStats.currentBalance || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>累计售出:</span>
              <strong>RM {(pointsStats.totalSold || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>销售额 (=售出):</span>
              <strong>RM {(pointsStats.totalRevenue || 0).toLocaleString()}</strong>
            </div>
          </div>
        </div>

        {/* 收款统计 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>📊 收款情况</div>
          <div style={styles.detailRows}>
            <div style={styles.detailRow}>
              <span>已收款:</span>
              <strong style={{ color: '#10b981' }}>
                RM {(pointsStats.totalCollected || 0).toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>待收款:</span>
              <strong style={{ color: '#ef4444' }}>
                RM {(pointsStats.pendingCollection || 0).toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>收款率:</span>
              <strong>
                {Math.round((pointsStats.collectionRate || 0) * 100)}%
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>最后收款:</span>
              <span style={styles.timestampText}>
                {formatTimestamp(pointsStats.lastCollected)}
              </span>
            </div>
          </div>
        </div>

        {/* 分配来源 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>📦 点数来源</div>
          <div style={styles.detailRows}>
            <div style={styles.detailRow}>
              <span>来自 Event Manager:</span>
              <strong>
                RM {(pointsStats.receivedFromEventManager || 0).toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>来自 Seller Manager:</span>
              <strong>
                RM {(pointsStats.receivedFromSellerManager || 0).toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>最后分配时间:</span>
              <span style={styles.timestampText}>
                {formatTimestamp(pointsStats.lastReceived)}
              </span>
            </div>
            <div style={styles.detailRow}>
              <span>最后销售时间:</span>
              <span style={styles.timestampText}>
                {formatTimestamp(pointsStats.lastSold)}
              </span>
            </div>
          </div>
        </div>

        {/* 收款警示信息 */}
        {hasCollectionAlert && (
          <div style={styles.detailCard}>
            <div style={styles.detailCardTitle}>⚠️ 收款警示</div>
            <div style={styles.detailRows}>
              <div style={styles.detailRow}>
                <span>风险等级:</span>
                <strong style={{ 
                  color: pendingRatio >= 0.5 ? '#dc2626' : '#f59e0b' 
                }}>
                  {pendingRatio >= 0.5 ? '🚨 高风险' : '⚠️ 中等'}
                </strong>
              </div>
              <div style={styles.detailRow}>
                <span>待收款比例:</span>
                <strong style={{ color: '#ef4444' }}>
                  {Math.round(pendingRatio * 100)}%
                </strong>
              </div>
              <div style={styles.detailRow}>
                <span>待收款金额:</span>
                <strong style={{ color: '#ef4444' }}>
                  RM {pendingCollection.toLocaleString()}
                </strong>
              </div>
              <div style={styles.alertMessage}>
                {pendingRatio >= 0.5 
                  ? `待收款金额过高（${Math.round(pendingRatio * 100)}%），请尽快收款`
                  : `有待收款项（${Math.round(pendingRatio * 100)}%），请注意跟进`
                }
              </div>
            </div>
          </div>
        )}

        {/* 用户身份信息 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>👤 身份信息</div>
          <div style={styles.detailRows}>
            <div style={styles.detailRow}>
              <span>中文名:</span>
              <strong>{basicInfo.chineseName || '-'}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>英文名:</span>
              <strong>{basicInfo.englishName || '-'}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>身份标签:</span>
              <strong>{identityInfo.identityTag || '-'}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>身份编号:</span>
              <strong>{identityInfo.identityId || '-'}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={styles.detailActions}>
        {onRecordCollection && (pointsStats.pendingCollection || 0) > 0 && (
          <button
            onClick={() => onRecordCollection(seller)}
            style={styles.detailActionButton}
          >
            💰 记录收款 (待收: RM {(pointsStats.pendingCollection || 0).toLocaleString()})
          </button>
        )}
        {onSelect && (
          <button
            onClick={() => onSelect(seller)}
            style={{ ...styles.detailActionButton, ...styles.secondaryButton }}
          >
            👁️ 查看完整信息
          </button>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: { width: '100%' },
  
  header: {
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },

  controls: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },

  searchBox: {
    flex: '1 1 300px',
    position: 'relative',
    display: 'flex',
    alignItems: 'center'
  },
  searchIcon: {
    position: 'absolute',
    left: '0.75rem',
    fontSize: '1.25rem'
  },
  searchInput: {
    width: '100%',
    padding: '0.75rem 2.5rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    outline: 'none'
  },
  clearButton: {
    position: 'absolute',
    right: '0.5rem',
    padding: '0.25rem 0.5rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '0.875rem'
  },

  filterGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  filterLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  filterSelect: {
    padding: '0.5rem 0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    background: 'white'
  },

  tableWrapper: {
    overflowX: 'auto',
    background: 'white',
    borderRadius: '12px',
    border: '2px solid #e5e7eb'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeader: {
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb'
  },
  th: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background 0.2s'
  },
  td: {
    padding: '1rem',
    fontSize: '0.875rem',
    color: '#1f2937'
  },

  nameCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  nameText: {
    fontWeight: '600',
    color: '#1f2937'
  },
  englishName: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },

  phoneText: {
    fontFamily: 'monospace',
    color: '#6b7280'
  },

  balanceText: {
    fontWeight: '600',
    color: '#10b981'
  },
  revenueText: {
    fontWeight: '600',
    color: '#6366f1'
  },

  rateCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  rateText: {
    fontWeight: 'bold',
    fontSize: '0.875rem'
  },
  rateBar: {
    width: '60px',
    height: '4px',
    background: '#e5e7eb',
    borderRadius: '2px',
    overflow: 'hidden'
  },
  rateBarFill: {
    height: '100%',
    borderRadius: '2px'
  },

  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: '600',
    whiteSpace: 'nowrap'
  },
  badgeActive: {
    background: '#d1fae5',
    color: '#065f46'
  },
  badgeWarning: {
    background: '#fef3c7',
    color: '#92400e'
  },
  badgeHighRisk: {
    background: '#fee2e2',
    color: '#991b1b'
  },
  badgeInactive: {
    background: '#f3f4f6',
    color: '#6b7280'
  },

  actionButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionButton: {
    padding: '0.5rem 0.75rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'all 0.2s'
  },
  collectionButton: {
    background: '#fef3c7',
    borderColor: '#fbbf24'
  },

  expandedCell: {
    padding: '0',
    background: '#f9fafb'
  },

  detailsContainer: {
    padding: '1.5rem',
    background: '#ffffff'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem'
  },

  detailCard: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    padding: '1rem'
  },
  detailCardTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  detailRows: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  timestampText: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },

  alertMessage: {
    marginTop: '0.5rem',
    padding: '0.5rem',
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    borderRadius: '4px',
    fontSize: '0.75rem',
    color: '#92400e'
  },

  detailActions: {
    display: 'flex',
    gap: '1rem',
    paddingTop: '1rem',
    borderTop: '2px solid #e5e7eb'
  },
  detailActionButton: {
    flex: 1,
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  secondaryButton: {
    background: 'white',
    color: '#374151',
    border: '2px solid #e5e7eb'
  },

  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  }
};

export default SellerList;