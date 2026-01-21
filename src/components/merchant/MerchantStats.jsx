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
          label="总收入（全部）"
          value={`${formatAmount(totalRevenue)} 点`}
          subValue={`平均 ${formatAmount(averageAmount)} 点/笔`}
          color="purple"
          badge="全部"
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

        {/* ⭐ 摊主个人收入 */}
        <StatCard
          icon={User}
          label="摊主收入"
          value={`${formatAmount(ownerCollectedRevenue)} 点`}
          subValue={`助理收入 ${formatAmount(asistsCollectedRevenue)} 点`}
          color="orange"
          badge="个人"
        />
      </div>
    );
  }

  // merchantAsist: 只显示个人统计
  if (isMerchantAsist) {
    // 计算个人平均交易金额
    const personalAverage = personalTransactionCount > 0
      ? Math.round(personalTotalCollected / personalTransactionCount)
      : 0;

    return (
      <div className="merchant-stats-grid">
        {/* 个人总收入 */}
        <StatCard
          icon={User}
          label="个人总收入"
          value={`${formatAmount(personalTotalCollected)} 点`}
          subValue={`平均 ${formatAmount(personalAverage)} 点/笔`}
          color="purple"
          badge="个人"
        />

        {/* 今日个人收入 */}
        <StatCard
          icon={TrendingUp}
          label="今日收入"
          value={`${formatAmount(personalTodayCollected)} 点`}
          subValue={personalTodayTransactionCount > 0 ? `${personalTodayTransactionCount} 笔交易` : '尚无交易'}
          color="blue"
        />

        {/* 个人交易笔数 */}
        <StatCard
          icon={ShoppingBag}
          label="交易笔数"
          value={formatAmount(personalTransactionCount)}
          subValue={`今日 ${personalTodayTransactionCount} 笔`}
          color="green"
        />

        {/* ⭐ 摊位总收入（参考） */}
        <StatCard
          icon={Users}
          label="摊位总收入"
          value={`${formatAmount(totalRevenue)} 点`}
          subValue="包含所有人"
          color="gray"
          badge="参考"
        />
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
