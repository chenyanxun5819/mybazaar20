import { useState } from 'react';
import { doc, updateDoc, addDoc, collection, increment, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase'; // 假设你的firebase配置在这里

/**
 * Seller List Component (带收款功能版 v6)
 * 
 * 新增功能：
 * - 记录收款：Seller从Customer收到现金
 * - 现金上交：Seller向Manager上交现金（简化为全款一次性上交）
 * 
 * 收款流程（简化）：
 * 1. Seller点击"记录收款"
 * 2. 系统自动将全部待收款标记为已收款
 * 3. 更新 seller.totalCollected 和 seller.pendingCollection
 * 4. 更新 pointsStats（如果需要）
 */
const SellerList = ({ sellers, selectedDepartment, onSelectSeller, eventId, orgId, currentUser }) => {
  const [sortBy, setSortBy] = useState('name');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedSeller, setExpandedSeller] = useState(null);
  const [recordingCollection, setRecordingCollection] = useState(null); // 正在记录收款的seller

  // 确保输入是安全的
  const safeSellers = Array.isArray(sellers) ? sellers : [];

  // 筛选逻辑
  // ✅ 修改后
  const getFilteredSellers = () => {
    let filtered = [...safeSellers];

    if (selectedDepartment) {
      filtered = filtered.filter(seller => {
        const dept = seller.identityInfo?.department || '';
        return dept === selectedDepartment.departmentCode;
      });
    }

    if (filterStatus !== 'all') {
      filtered = filtered.filter(seller => {
        const sellerData = seller.seller || {};
        const hasAlert = sellerData.collectionAlert === true;
        const availablePoints = sellerData.availablePoints || 0;  // ✅ 正确：从 seller 读取
        const totalSold = sellerData.totalPointsSold || 0;  // ✅ 正确：从 seller 读取
        const totalCollected = sellerData.totalCashCollected || 0;  // ✅ 正确：从 seller 读取

        // 计算待收款：已售出但未收款的金额
        const totalRevenue = totalSold;
        const pendingCollection = totalRevenue - totalCollected;
        const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

        switch (filterStatus) {
          case 'active':
            return totalSold > 0;
          case 'warning':
            return hasAlert && pendingRatio < 0.5;
          case 'highRisk':
            return hasAlert && pendingRatio >= 0.5;
          default:
            return true;
        }
      });
    }

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
  // ✅ 修改后
  const getSortedSellers = (filtered) => {
    return [...filtered].sort((a, b) => {
      const aSellerData = a.seller || {};  // ✅ 正确
      const bSellerData = b.seller || {};  // ✅ 正确

      switch (sortBy) {
        case 'name':
          const aName = a.basicInfo?.chineseName || '';
          const bName = b.basicInfo?.chineseName || '';
          return aName.localeCompare(bName);
        case 'department':
          const aDept = a.identityInfo?.department || '';
          const bDept = b.identityInfo?.department || '';
          return aDept.localeCompare(bDept);
        case 'balance':
          return (bSellerData.availablePoints || 0) - (aSellerData.availablePoints || 0);  // ✅ 正确
        case 'revenue':
          return (bSellerData.totalPointsSold || 0) - (aSellerData.totalPointsSold || 0);  // ✅ 正确
        case 'collectionRate':
          // 计算收款率
          const aRevenue = aSellerData.totalPointsSold || 0;
          const aCollected = aSellerData.totalCashCollected || 0;
          const aRate = aRevenue > 0 ? aCollected / aRevenue : 0;

          const bRevenue = bSellerData.totalPointsSold || 0;
          const bCollected = bSellerData.totalCashCollected || 0;
          const bRate = bRevenue > 0 ? bCollected / bRevenue : 0;

          return bRate - aRate;  // ✅ 正确
        case 'pendingCollection':
          const aPending = (aSellerData.totalPointsSold || 0) - (aSellerData.totalCashCollected || 0);
          const bPending = (bSellerData.totalPointsSold || 0) - (bSellerData.totalCashCollected || 0);
          return bPending - aPending;  // ✅ 正确
        default:
          return 0;
      }
    });
  };

  /**
   * 改进的收款处理函数
   * 
   * 功能：Seller Manager 从 Seller 收取现金
   * 
   * 流程：
   * 1. 验证待收款金额
   * 2. 创建 cashCollection 记录（Event 级别）
   * 3. 更新 Seller 的收款统计
   * 4. 更新 Seller Manager 的待上交金额
   */

  const handleRecordCollection = async (seller) => {
    // ✅ 步骤 1: 读取并验证待收款金额
    const sellerData = seller.seller || {};
    const pendingCollection = sellerData.pendingCollection || 0;

    if (pendingCollection <= 0) {
      alert('该用户没有待收款项');
      return;
    }

    // ✅ 步骤 2: 显示确认对话框
    const confirmMessage = `
    确认收取现金？

    Seller: ${seller.basicInfo?.chineseName || '未知'}
    待收款: RM ${pendingCollection.toLocaleString()}

    此操作将：
    1. 记录你从该 Seller 收到 RM ${pendingCollection}
    2. 标记该 Seller 的待收款为已收款
    3. 增加你的待上交金额

    确认收款？
    `.trim();

    if (!window.confirm(confirmMessage)) {
      return;
    }

    // ✅ 步骤 3: 获取当前 Seller Manager 信息
    // 注意：这里需要从父组件传入 currentUser
    // 临时方案：从 seller 推断（实际应该从 props 获取）
    const currentUserId = seller.managedBy || 'CURRENT_SM_ID'; // ⚠️ 需要修改

    setRecordingCollection(seller.userId);

    try {
      const batch = writeBatch(db);

      // ✅ 步骤 4: 创建 cashCollection 记录（Event 级别）
      const collectionRef = collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`);
      const collectionDoc = doc(collectionRef); // 自动生成 ID

      batch.set(collectionDoc, {
        // 基本信息
        collectionId: collectionDoc.id,
        sellerId: seller.userId,
        sellerName: seller.basicInfo?.chineseName || '未知',
        sellerDepartment: seller.identityInfo?.department || '未分配',

        // Seller Manager 信息
        collectedBy: currentUserId,
        collectedByName: 'Seller Manager', // ⚠️ 应该从 currentUser 获取

        // 金额信息
        amount: pendingCollection,
        collectedAt: serverTimestamp(),

        // 状态
        status: 'collected',  // collected → submitted → approved

        // 备注
        note: `从 ${seller.basicInfo?.chineseName} 收取现金`,

        // 特殊情况标记
        specialCircumstance: null,
        specialNote: null,

        // 审计信息
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // ✅ 步骤 5: 更新 Seller 的统计数据
      const sellerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${seller.userId}`);

      batch.update(sellerRef, {
        // 更新 seller 对象
        'seller.totalCashCollected': increment(pendingCollection),
        'seller.pendingCollection': increment(-pendingCollection),

        // 计算新的收款率
        // 注意：这里简化处理，实际应该在 Cloud Function 中计算
        'seller.collectionRate': (sellerData.totalCashCollected || 0) + pendingCollection > 0
          ? ((sellerData.totalCashCollected || 0) + pendingCollection) / (sellerData.totalRevenue || 1)
          : 0,

        // 检查是否需要更新警示状态
        'seller.collectionAlert': false, // 收款后可能解除警示

        // 更新时间戳
        'activityData.lastCollected': serverTimestamp(),
        'activityData.updatedAt': serverTimestamp()
      });

      // ✅ 步骤 6: 更新 Seller Manager 的待上交金额
      const managerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${currentUserId}`);

      batch.update(managerRef, {
        // 增加待上交金额
        'sellerManager.pendingCashSubmission': increment(pendingCollection),

        // 更新统计
        'sellerManager.totalCashCollected': increment(pendingCollection),

        // 更新时间戳
        'activityData.lastCollected': serverTimestamp(),
        'activityData.updatedAt': serverTimestamp()
      });

      // ✅ 步骤 7: 提交批量操作
      await batch.commit();

      // ✅ 步骤 8: 显示成功消息
      alert(`
      ✅ 收款记录成功！

      已收款: RM ${pendingCollection.toLocaleString()}
      来自: ${seller.basicInfo?.chineseName || '未知'}

      该金额已加入你的待上交金额。
      请记得在"上交现金"标签页提交给 Finance Manager。
      `.trim());  

      console.log('✅ 收款成功:', {
        collectionId: collectionDoc.id,
        seller: seller.userId,
        amount: pendingCollection
      });

    } catch (error) {
      console.error('❌ 记录收款失败:', error);
      alert(`记录收款失败: ${error.message}`);
    } finally {
      setRecordingCollection(null);
    }
  };

  /**
   * 现金上交功能（简化版：全款上交）
   * 当 Seller 向 Manager 上交现金时调用
   */
  const handleCashSubmission = async (seller, managerId, managerType = 'sellerManager') => {
    const pendingCash = seller.seller?.pendingCashSubmission || 0;

    if (pendingCash <= 0) {
      alert('该用户没有待上交的现金');
      return;
    }

    const confirmMessage = `确认现金上交？\n\n上交人: ${seller.basicInfo?.chineseName}\n上交金额: RM ${pendingCash.toLocaleString()}\n接收人: ${managerType === 'sellerManager' ? 'Seller Manager' : 'Finance Manager'}\n\n此操作将记录全部待上交现金。`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      const userRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${seller.userId}`);
      const submissionsRef = collection(userRef, 'cashSubmissions');

      // 创建现金上交记录
      await addDoc(submissionsRef, {
        amount: pendingCash,
        submittedBy: seller.userId,
        submittedTo: managerType,
        submittedToUserId: managerId,
        note: `全额上交待收现金 RM ${pendingCash}`,
        timestamp: serverTimestamp(),
        status: 'pending' // 等待验证
      });

      // 更新用户的现金统计
      await updateDoc(userRef, {
        'seller.cashSubmitted': increment(pendingCash),
        'seller.pendingCashSubmission': increment(-pendingCash),
        'activityData.updatedAt': serverTimestamp()
      });

      alert(`现金上交记录成功！\n上交金额: RM ${pendingCash.toLocaleString()}\n\n等待 ${managerType === 'sellerManager' ? 'Seller Manager' : 'Finance Manager'} 验证。`);

    } catch (error) {
      console.error('现金上交失败:', error);
      alert('现金上交失败: ' + error.message);
    }
  };

  const filteredSellers = getFilteredSellers();
  const sortedSellers = getSortedSellers(filteredSellers);

  // 统计摘要
  // ✅ 修改后
  const getStatsSummary = () => {
    const total = filteredSellers.length;
    const active = filteredSellers.filter(s => {
      const sellerData = s.seller || {};
      return (sellerData.totalPointsSold || 0) > 0;  // ✅ 正确
    }).length;

    const withWarning = filteredSellers.filter(s => {
      const sellerData = s.seller || {};
      const hasAlert = sellerData.collectionAlert === true;

      const totalRevenue = sellerData.totalPointsSold || 0;
      const totalCollected = sellerData.totalCashCollected || 0;
      const pendingCollection = totalRevenue - totalCollected;
      const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;  // ✅ 正确

      return hasAlert && pendingRatio < 0.5;
    }).length;

    const highRisk = filteredSellers.filter(s => {
      const sellerData = s.seller || {};
      const hasAlert = sellerData.collectionAlert === true;

      const totalRevenue = sellerData.totalPointsSold || 0;
      const totalCollected = sellerData.totalCashCollected || 0;
      const pendingCollection = totalRevenue - totalCollected;
      const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;  // ✅ 正确

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
                <th style={styles.th}>序号</th>
                <th style={styles.th}>姓名</th>
                <th style={styles.th}>部门</th>
                <th style={styles.th}>电话</th>
                <th style={styles.th}>现有点数</th>
                <th style={styles.th}>累计销售</th>
                <th style={styles.th}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedSellers.map((seller, index) => (
                <SellerRow
                  key={seller.id || seller.userId}
                  index={index}
                  seller={seller}
                  isExpanded={expandedSeller === (seller.id || seller.userId)}
                  onToggle={() => setExpandedSeller(
                    expandedSeller === (seller.id || seller.userId) ? null : (seller.id || seller.userId)
                  )}
                  onSelect={onSelectSeller}
                  onRecordCollection={handleRecordCollection}
                  onCashSubmission={handleCashSubmission}
                  isRecording={recordingCollection === seller.userId}
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
 */
// ✅ 修改后
const SellerRow = ({ index, seller, isExpanded, onToggle, onSelect, onRecordCollection, onCashSubmission, isRecording }) => {
  if (!seller || typeof seller !== 'object') return null;

  const basicInfo = seller.basicInfo || {};
  const identityInfo = seller.identityInfo || {};
  const sellerData = seller.seller || {};  // ✅ 正确：直接读取 seller 对象

  const displayName = basicInfo.chineseName || '未命名';
  const englishName = basicInfo.englishName || '';
  const department = identityInfo.department || '-';
  const phoneNumber = basicInfo.phoneNumber || '-';

  // ✅ 正确：从 seller 对象读取所有点数相关信息
  const currentBalance = sellerData.availablePoints || 0;
  const totalSold = sellerData.totalPointsSold || 0;
  const totalCollected = sellerData.totalCashCollected || 0;

  // 计算派生数据
  const totalRevenue = totalSold;
  const pendingCollection = totalRevenue - totalCollected;
  const collectionRate = totalRevenue > 0 ? totalCollected / totalRevenue : 0;

  const hasCollectionAlert = sellerData.collectionAlert === true;
  const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

  const getRateColor = (rate) => {
    if (rate >= 0.8) return '#10b981';
    if (rate >= 0.5) return '#f59e0b';
    return '#ef4444';
  };

  const getStatusBadge = () => {
    if (hasCollectionAlert && pendingRatio >= 0.5) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeHighRisk }}>
          🚨 高风险
        </span>
      );
    }
    if (hasCollectionAlert) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeWarning }}>
          ⚠️ 警示
        </span>
      );
    }
    if (totalSold > 0) {
      return (
        <span style={{ ...styles.badge, ...styles.badgeActive }}>
          ✅ 活跃
        </span>
      );
    }
    return (
      <span style={{ ...styles.badge, ...styles.badgeInactive }}>
        ⏸️ 未活跃
      </span>
    );
  };

  return (
    <>
      <tr style={styles.tableRow}>
        {/* 序号 */}
        <td style={styles.td}>
          <span style={styles.indexText}>{index + 1}</span>
        </td>

        {/* 姓名 */}
        <td style={styles.td}>
          <div style={styles.nameCell}>
            <div style={styles.nameText}>{displayName}</div>
            {englishName && (
              <div style={styles.englishName}>{englishName}</div>
            )}
          </div>
        </td>

        {/* 部门 */}
        <td style={styles.td}>{department}</td>

        {/* 电话 */}
        <td style={styles.td}>
          <span style={styles.phoneText}>{phoneNumber}</span>
        </td>

        {/* 现有点数 */}
        <td style={styles.td}>
          <span style={styles.balanceText}>
            {currentBalance.toLocaleString()}
          </span>
        </td>

        {/* 累计销售 */}
        <td style={styles.td}>
          <span style={styles.revenueText}>
            {totalRevenue.toLocaleString()}
          </span>
        </td>

        {/* 操作 */}
        <td style={styles.td}>
          <div style={styles.actionButtons}>
            <button
              onClick={onToggle}
              style={styles.actionButton}
              title="查看详情"
            >
              {isExpanded ? '▲' : '▼'}
            </button>
            <button
              onClick={() => onSelect(seller)}
              style={{ ...styles.actionButton, ...styles.allocateButton }}
              title="分配点数"
            >
              ➕ 分配
            </button>
            {pendingCollection > 0 && (
              <button
                onClick={() => onRecordCollection(seller)}
                style={{ ...styles.actionButton, ...styles.collectionButton }}
                title="记录收款"
                disabled={isRecording}
              >
                {isRecording ? '⏳' : '💰'}
              </button>
            )}
          </div>
        </td>
      </tr>

      {isExpanded && (
        <tr>
          <td colSpan="8" style={styles.expandedCell}>
            <SellerDetails
              seller={seller}
              onSelect={onSelect}
              onRecordCollection={onRecordCollection}
              onCashSubmission={onCashSubmission}
            />
          </td>
        </tr>
      )}
    </>
  );
};

/**
 * Seller Details Component
 */
const SellerDetails = ({ seller, onSelect, onRecordCollection, onCashSubmission }) => {
  const pointsStats = seller.pointsStats || {};
  const sellerData = seller.seller || {};
  const basicInfo = seller.basicInfo || {};
  const identityInfo = seller.identityInfo || {};

  const hasCollectionAlert = sellerData.collectionAlert === true;
  const pendingCollection = pointsStats.pendingCollection || 0;
  const totalRevenue = pointsStats.totalRevenue || 0;
  const pendingRatio = totalRevenue > 0 ? pendingCollection / totalRevenue : 0;

  // 现金相关
  const cashSubmitted = sellerData.cashSubmitted || 0;
  const pendingCashSubmission = sellerData.pendingCashSubmission || 0;

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
              <strong>{(pointsStats.totalReceived || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>当前持有:</span>
              <strong>{(pointsStats.currentBalance || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>累计售出:</span>
              <strong>{(pointsStats.totalSold || 0).toLocaleString()}</strong>
            </div>
            <div style={styles.detailRow}>
              <span>销售额 (=售出):</span>
              <strong>{(pointsStats.totalRevenue || 0).toLocaleString()}</strong>
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
                {(pointsStats.totalCollected || 0).toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>待收款:</span>
              <strong style={{ color: '#ef4444' }}>
                {pendingCollection.toLocaleString()}
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

        {/* 现金上交统计 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>💵 现金上交</div>
          <div style={styles.detailRows}>
            <div style={styles.detailRow}>
              <span>已上交现金:</span>
              <strong style={{ color: '#10b981' }}>
                {cashSubmitted.toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>待上交现金:</span>
              <strong style={{ color: '#f59e0b' }}>
                {pendingCashSubmission.toLocaleString()}
              </strong>
            </div>
            <div style={styles.detailRow}>
              <span>上交率:</span>
              <strong>
                {totalRevenue > 0
                  ? `${Math.round((cashSubmitted / totalRevenue) * 100)}%`
                  : '0%'
                }
              </strong>
            </div>
          </div>
        </div>

        {/* 分配来源 */}
        <div style={styles.detailCard}>
          <div style={styles.detailCardTitle}>📦 点数来源</div>
          <div style={styles.detailRows}>
            {(() => {
              const sellerData = seller.seller || {};
              const transactions = sellerData.transactions || {};

              let fromEventManager = 0;
              let fromSellerManager = 0;
              let lastAllocatedAt = null;
              let txCount = 0;

              // 遍历 transactions 对象（Map 格式，键为时间戳）
              try {
                Object.entries(transactions).forEach(([key, tx]) => {
                  // 跳过非对象和继承属性
                  if (!tx || typeof tx !== 'object') return;

                  // 只处理 allocation 类型的交易
                  if (tx.type === 'allocation') {
                    txCount++;
                    const amount = parseFloat(tx.amount) || 0;

                    // 根据 allocatedBy 分类统计
                    const allocatedBy = tx.allocatedBy || '';
                    if (allocatedBy === 'eventManager') {
                      fromEventManager += amount;
                    } else if (allocatedBy === 'sellerManager' || allocatedBy === 'sm') {
                      fromSellerManager += amount;
                    }

                    // 记录最后分配时间（比较时间戳字符串）
                    if (tx.timestamp) {
                      if (!lastAllocatedAt) {
                        lastAllocatedAt = tx.timestamp;
                      } else {
                        // 时间戳比较：尝试转换为毫秒数
                        const currentTs = typeof tx.timestamp === 'object' && tx.timestamp.seconds
                          ? tx.timestamp.seconds * 1000
                          : tx.timestamp;
                        const lastTs = typeof lastAllocatedAt === 'object' && lastAllocatedAt.seconds
                          ? lastAllocatedAt.seconds * 1000
                          : lastAllocatedAt;

                        if (currentTs > lastTs) {
                          lastAllocatedAt = tx.timestamp;
                        }
                      }
                    }
                  }
                });
              } catch (err) {
                console.error('❌ 处理 transactions 出错:', err);
              }

              const totalAllocated = fromEventManager + fromSellerManager;

              return (
                <>
                  <div style={styles.detailRow}>
                    <span>来自 Event Manager:</span>
                    <strong style={{ color: '#3b82f6' }}>
                      {fromEventManager.toLocaleString()}
                    </strong>
                  </div>
                  <div style={styles.detailRow}>
                    <span>来自 Seller Manager:</span>
                    <strong style={{ color: '#f59e0b' }}>
                      {fromSellerManager.toLocaleString()}
                    </strong>
                  </div>
                  <div style={styles.detailRow}>
                    <span>总计已分配:</span>
                    <strong style={{ color: '#10b981' }}>
                      {totalAllocated.toLocaleString()}
                    </strong>
                  </div>
                  <div style={styles.detailRow}>
                    <span>最后分配时间:</span>
                    <span style={styles.timestampText}>
                      {lastAllocatedAt ? formatTimestamp(lastAllocatedAt) : '暂无分配'}
                    </span>
                  </div>
                  {txCount > 0 && (
                    <div style={styles.detailRow}>
                      <span>分配记录:</span>
                      <span style={styles.timestampText}>{txCount} 条</span>
                    </div>
                  )}
                </>
              );
            })()}
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
                  {pendingCollection.toLocaleString()}
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
      </div>

      {/* 操作按钮 */}
      <div style={styles.detailActions}>
        {onSelect && (
          <button
            onClick={() => onSelect(seller)}
            style={{ ...styles.detailActionButton, ...styles.allocateDetailButton }}
          >
            ➕ 分配点数
          </button>
        )}
        {pendingCollection > 0 && (
          <button
            onClick={() => onRecordCollection(seller)}
            style={styles.detailActionButton}
          >
            💰 记录收款 (待收: {pendingCollection.toLocaleString()})
          </button>
        )}
        {pendingCashSubmission > 0 && onCashSubmission && (
          <button
            onClick={() => {
              // 这里需要传入 managerId，实际使用时从context或props获取
              const managerId = 'MANAGER_ID_HERE'; // TODO: 从context获取当前登录的manager ID
              onCashSubmission(seller, managerId, 'sellerManager');
            }}
            style={{ ...styles.detailActionButton, ...styles.cashButton }}
          >
            💵 上交现金 (待交: {pendingCashSubmission.toLocaleString()})
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
  indexText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
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
  allocateButton: {
    background: '#dbeafe',
    borderColor: '#93c5fd',
    color: '#1e40af',
    fontWeight: '600'
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
    borderTop: '2px solid #e5e7eb',
    flexWrap: 'wrap'
  },
  detailActionButton: {
    flex: 1,
    minWidth: '200px',
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  allocateDetailButton: {
    background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
    order: -1
  },
  cashButton: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
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