import { TrendingUp, ShoppingBag, DollarSign } from 'lucide-react';
import { formatAmount } from '../../services/transactionService';
import './MerchantStats.css';

/**
 * StatCard - 单个统计卡片
 */
const StatCard = ({ icon: Icon, label, value, subValue, trend, color = 'purple' }) => {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <div className={`stat-icon ${color}`}>
          <Icon />
        </div>
        {trend && (
          <span className={`stat-trend ${trend > 0 ? 'positive' : 'neutral'}`}>
        {trend > 0 ? `+${trend}%` : trend === 0 ? '±0%' : `${trend}%`}
          </span>
        )}
      </div>
      <div className="stat-card-content">
        <p>{label}</p>
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
 */
const MerchantStats = ({ stats }) => {
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
    isActive = true
  } = stats;

  // 计算平均交易金额
  const averageAmount = transactionCount > 0 
    ? Math.round(totalRevenue / transactionCount)
    : 0;

  // 计算今日平均
  const todayAverage = todayTransactionCount > 0
    ? Math.round(todayRevenue / todayTransactionCount)
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