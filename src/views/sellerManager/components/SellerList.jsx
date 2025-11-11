import { useState } from 'react';

/**
 * Seller List 组件
 * 
 * @description
 * 显示 Seller Manager 管理的所有 Sellers（学生）列表
 * 每个卡片显示：
 * - 学生基本信息
 * - 可用固本
 * - 已售出金额
 * - 操作按钮（分配固本、查看详情、回收固本）
 * 
 * @param {Array} sellers - Sellers 列表
 * @param {Function} onAllocatePoints - 分配固本回调
 * @param {Function} onRefresh - 刷新数据回调
 */
const SellerList = ({ sellers, onAllocatePoints, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('name'); // name, points, sales

  /**
   * 过滤和排序 Sellers
   */
  const getFilteredAndSortedSellers = () => {
    let filtered = sellers;

    // 🔍 搜索过滤
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = sellers.filter(seller => {
        const englishName = seller.basicInfo?.englishName?.toLowerCase() || '';
        const chineseName = seller.basicInfo?.chineseName?.toLowerCase() || '';
        const icNumber = seller.basicInfo?.icNumber?.toLowerCase() || '';
        
        return englishName.includes(search) || 
               chineseName.includes(search) || 
               icNumber.includes(search);
      });
    }

    // 📊 排序
    const sorted = [...filtered].sort((a, b) => {
      const aData = a.roleSpecificData?.seller || {};
      const bData = b.roleSpecificData?.seller || {};

      switch (sortBy) {
        case 'points':
          return (bData.availablePoints || 0) - (aData.availablePoints || 0);
        case 'sales':
          return (bData.totalPointsSold || 0) - (aData.totalPointsSold || 0);
        case 'name':
        default:
          return (a.basicInfo?.englishName || '').localeCompare(
            b.basicInfo?.englishName || ''
          );
      }
    });

    return sorted;
  };

  const filteredSellers = getFilteredAndSortedSellers();

  return (
    <div style={styles.container}>
      {/* 🔍 搜索和排序栏 */}
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <span style={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="搜索学生姓名或 IC..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          {searchTerm && (
            <button
              style={styles.clearButton}
              onClick={() => setSearchTerm('')}
            >
              ✕
            </button>
          )}
        </div>

        <div style={styles.sortBox}>
          <label style={styles.sortLabel}>排序：</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.sortSelect}
          >
            <option value="name">姓名 A-Z</option>
            <option value="points">可用固本（高到低）</option>
            <option value="sales">已售出（高到低）</option>
          </select>
        </div>
      </div>

      {/* 📊 Sellers Grid */}
      {filteredSellers.length === 0 ? (
        <div style={styles.emptyState}>
          {searchTerm ? (
            <>
              <div style={styles.emptyIcon}>🔍</div>
              <h3>找不到匹配的学生</h3>
              <p>试试其他关键词</p>
            </>
          ) : (
            <>
              <div style={styles.emptyIcon}>📝</div>
              <h3>还没有学生</h3>
              <p>点击上方按钮创建第一位学生</p>
            </>
          )}
        </div>
      ) : (
        <div style={styles.grid}>
          {filteredSellers.map(seller => (
            <SellerCard
              key={seller.id}
              seller={seller}
              onAllocatePoints={onAllocatePoints}
            />
          ))}
        </div>
      )}

      {/* 显示结果统计 */}
      {filteredSellers.length > 0 && (
        <div style={styles.resultStats}>
          显示 {filteredSellers.length} / {sellers.length} 位学生
        </div>
      )}
    </div>
  );
};

/**
 * 单个 Seller 卡片组件
 */
const SellerCard = ({ seller, onAllocatePoints }) => {
  const sellerData = seller.roleSpecificData?.seller || {};
  const basicInfo = seller.basicInfo || {};

  // 计算销售进度百分比（假设目标是可用固本）
  const totalReceived = sellerData.availablePoints + (sellerData.currentSalesAmount || 0);
  const salesPercentage = totalReceived > 0 
    ? Math.round((sellerData.currentSalesAmount / totalReceived) * 100) 
    : 0;

  return (
    <div 
      style={styles.card}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.15)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
      }}
    >
      {/* 学生头像和基本信息 */}
      <div style={styles.cardHeader}>
        <div style={styles.avatar}>
          {(basicInfo.englishName || '?')[0].toUpperCase()}
        </div>
        <div style={styles.cardHeaderInfo}>
          <h3 style={styles.sellerName}>
            {basicInfo.englishName || 'N/A'}
          </h3>
          {basicInfo.chineseName && (
            <p style={styles.sellerChineseName}>
              {basicInfo.chineseName}
            </p>
          )}
          <p style={styles.sellerClass}>
            {basicInfo.className || '未分配班级'}
          </p>
        </div>
        
        {/* 状态标签 */}
        <div style={{
          ...styles.statusBadge,
          background: seller.accountStatus?.isActive ? '#d1fae5' : '#fee2e2',
          color: seller.accountStatus?.isActive ? '#065f46' : '#991b1b'
        }}>
          {seller.accountStatus?.isActive ? '✓ 活跃' : '✕ 停用'}
        </div>
      </div>

      {/* 统计信息 */}
      <div style={styles.statsRow}>
        <div style={styles.stat}>
          <div style={styles.statLabel}>可用固本</div>
          <div style={styles.statValue}>
            RM {(sellerData.availablePoints || 0).toLocaleString()}
          </div>
        </div>
        <div style={styles.statDivider}></div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>已售出</div>
          <div style={styles.statValue}>
            RM {(sellerData.currentSalesAmount || 0).toLocaleString()}
          </div>
        </div>
        <div style={styles.statDivider}></div>
        <div style={styles.stat}>
          <div style={styles.statLabel}>累计售出</div>
          <div style={styles.statValue}>
            RM {(sellerData.totalPointsSold || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* 销售进度条 */}
      {totalReceived > 0 && (
        <div style={styles.progressSection}>
          <div style={styles.progressHeader}>
            <span style={styles.progressLabel}>销售进度</span>
            <span style={styles.progressPercent}>{salesPercentage}%</span>
          </div>
          <div style={styles.progressBar}>
            <div 
              style={{
                ...styles.progressFill,
                width: `${salesPercentage}%`,
                background: salesPercentage >= 80 ? '#10b981' : 
                           salesPercentage >= 50 ? '#f59e0b' : '#ef4444'
              }}
            ></div>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div style={styles.actions}>
        <button
          style={styles.primaryActionButton}
          onClick={() => onAllocatePoints(seller)}
        >
          💰 分配固本
        </button>
        <button
          style={styles.secondaryActionButton}
          onClick={() => alert('查看详情功能开发中')}
        >
          👁️ 查看详情
        </button>
        {sellerData.availablePoints > 0 && (
          <button
            style={styles.warningActionButton}
            onClick={() => {
              if (confirm(`确定要回收 ${basicInfo.englishName} 的固本吗？`)) {
                alert('回收固本功能开发中');
              }
            }}
          >
            ↩️ 回收
          </button>
        )}
      </div>

      {/* 最后更新时间 */}
      {seller.accountStatus?.lastLogin && (
        <div style={styles.lastLogin}>
          最后登录: {new Date(seller.accountStatus.lastLogin.seconds * 1000).toLocaleDateString('zh-CN')}
        </div>
      )}
    </div>
  );
};

const styles = {
  container: {
    width: '100%'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap'
  },
  searchBox: {
    flex: 1,
    minWidth: '250px',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    background: '#f9fafb',
    borderRadius: '8px',
    padding: '0 1rem'
  },
  searchIcon: {
    fontSize: '1.25rem',
    marginRight: '0.5rem'
  },
  searchInput: {
    flex: 1,
    border: 'none',
    background: 'transparent',
    padding: '0.75rem 0',
    fontSize: '0.875rem',
    outline: 'none'
  },
  clearButton: {
    background: 'none',
    border: 'none',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '1.25rem',
    padding: '0.25rem'
  },
  sortBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  sortLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  sortSelect: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    background: 'white',
    outline: 'none'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem'
  },
  card: {
    background: '#fafafa',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem',
    transition: 'all 0.2s',
    cursor: 'default'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1.5rem',
    position: 'relative'
  },
  avatar: {
    width: '60px',
    height: '60px',
    borderRadius: '12px',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  cardHeaderInfo: {
    flex: 1
  },
  sellerName: {
    margin: '0 0 0.25rem 0',
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  sellerChineseName: {
    margin: '0 0 0.25rem 0',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  sellerClass: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontWeight: '500'
  },
  statusBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  statsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    marginBottom: '1rem',
    padding: '1rem',
    background: 'white',
    borderRadius: '8px'
  },
  stat: {
    flex: 1,
    textAlign: 'center'
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  statValue: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  statDivider: {
    width: '1px',
    height: '40px',
    background: '#e5e7eb'
  },
  progressSection: {
    marginBottom: '1rem'
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.5rem'
  },
  progressLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  progressPercent: {
    fontSize: '0.75rem',
    color: '#1f2937',
    fontWeight: '600'
  },
  progressBar: {
    height: '8px',
    background: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    transition: 'width 0.3s ease',
    borderRadius: '4px'
  },
  actions: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.75rem'
  },
  primaryActionButton: {
    flex: 1,
    padding: '0.625rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  },
  secondaryActionButton: {
    flex: 1,
    padding: '0.625rem',
    background: 'white',
    color: '#6b7280',
    border: '2px solid #e5e7eb',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  warningActionButton: {
    padding: '0.625rem 1rem',
    background: 'white',
    color: '#dc2626',
    border: '2px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  lastLogin: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    textAlign: 'center'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: '#6b7280'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  resultStats: {
    marginTop: '1.5rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: '#6b7280'
  }
};

export default SellerList;