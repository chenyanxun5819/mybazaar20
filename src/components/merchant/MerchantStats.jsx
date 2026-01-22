import { TrendingUp, ShoppingBag, DollarSign, User, Users } from 'lucide-react';
import { formatAmount } from '../../services/transactionService';
import './MerchantStats.css';

/**
 * StatCard - 单个统计卡片
 */
const StatCard = ({ icon: Icon, label, value, subValue, trend, color = 'purple', badge }) => {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <div className={`stat-icon ${color}`}>
          <Icon />
        </div>
        {badge && (
          <span className="stat-badge">{badge}</span>
        )}
        {trend && (
          <span className={`stat-trend ${trend > 0 ? 'positive' : 'neutral'}`}>
            {trend > 0 ? `+${trend}%` : trend === 0 ? '±0%' : `${trend}%`}
          </span>
        )}
      </div>
      <div className="stat-card-content">
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        {subValue && (
          <p className="stat-subvalue">{subValue}</p>
        )}
      </div>
    </div>
  );
};

/**
 * MerchantStats - 商家统计卡片组
 * @param {Object} props
 * @param {Object} props.stats - 统计资料
 * @param {string} props.userRole - 用户角色 (merchantOwner | merchantAsist)
 */
const MerchantStats = ({ stats, userRole }) => {
  if (!stats) {
    return (
      <div className="stat-skeleton-grid">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="stat-skeleton">
            <div className="skeleton-icon"></div>
            <div className="skeleton-label"></div>
            <div className="skeleton-value"></div>
          </div>
        ))}
      </div>
    );
  }

  const {
    totalRevenue = 0,
    todayRevenue = 0,
    transactionCount = 0,
    todayTransactionCount = 0,
    // ⭐ merchantOwner 和 merchantAsist 特有的统计
    ownerCollectedRevenue = 0,
    asistsCollectedRevenue = 0,
    // ⭐ merchantAsist 个人统计
    personalTotalCollected = 0,
    personalTodayCollected = 0,
    personalTransactionCount = 0,
    personalTodayTransactionCount = 0,
    isActive = true
  } = stats;

  // ⭐ 根据角色决定显示哪些统计
  const isMerchantOwner = userRole === 'merchantOwner';
  const isMerchantAsist = userRole === 'merchantAsist';

  // merchantOwner: 显示所有统计
  if (isMerchantOwner) {
    return (
      <div className="merchant-owner-summary">
        <div className="merchant-summary-card">
          <div className="merchant-summary-header">
            <span className="merchant-summary-label">总收入</span>
            <span className="merchant-summary-badge">全部</span>
          </div>

          <div className="merchant-summary-amount">
            <span className="merchant-summary-number">{formatAmount(totalRevenue)}</span>
            <span className="merchant-summary-unit">点</span>
          </div>

          <div className="merchant-summary-stats">
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(todayRevenue)}</span>
              <span className="merchant-summary-stat-label">今日收入</span>
            </div>
            <div className="merchant-summary-stat-divider"></div>
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(transactionCount)}</span>
              <span className="merchant-summary-stat-label">总交易笔数</span>
            </div>
            <div className="merchant-summary-stat-divider"></div>
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(ownerCollectedRevenue)}</span>
              <span className="merchant-summary-stat-label">摊主收入</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // merchantAsist: 只显示个人统计
  if (isMerchantAsist) {
    return (
      <div className="merchant-owner-summary">
        <div className="merchant-summary-card">
          <div className="merchant-summary-header">
            <span className="merchant-summary-label">个人总收入</span>
            <span className="merchant-summary-badge">个人</span>
          </div>

          <div className="merchant-summary-amount">
            <span className="merchant-summary-number">{formatAmount(personalTotalCollected)}</span>
            <span className="merchant-summary-unit">点</span>
          </div>

          <div className="merchant-summary-stats">
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(personalTodayCollected)}</span>
              <span className="merchant-summary-stat-label">今日收入</span>
            </div>
            <div className="merchant-summary-stat-divider"></div>
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(personalTransactionCount)}</span>
              <span className="merchant-summary-stat-label">交易笔数</span>
            </div>
            <div className="merchant-summary-stat-divider"></div>
            <div className="merchant-summary-stat-item">
              <span className="merchant-summary-stat-value">{formatAmount(totalRevenue)}</span>
              <span className="merchant-summary-stat-label">摊位总收入</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 默认：显示基本统计（如果角色未知）
  const averageAmount = transactionCount > 0 
    ? Math.round(totalRevenue / transactionCount)
    : 0;

  return (
    <div className="merchant-stats-grid">
      {/* 总收入 */}
      <StatCard
        icon={DollarSign}
        label="总收入"
        value={`${formatAmount(totalRevenue)} 点`}
        subValue={`平均 ${formatAmount(averageAmount)} 点/笔`}
        color="purple"
      />

      {/* 今日收入 */}
      <StatCard
        icon={TrendingUp}
        label="今日收入"
        value={`${formatAmount(todayRevenue)} 点`}
        subValue={todayTransactionCount > 0 ? `${todayTransactionCount} 笔交易` : '尚无交易'}
        color="blue"
      />

      {/* 交易笔数 */}
      <StatCard
        icon={ShoppingBag}
        label="总交易笔数"
        value={formatAmount(transactionCount)}
        subValue={`今日 ${todayTransactionCount} 笔`}
        color="green"
      />
    </div>
  );
};

export default MerchantStats;
