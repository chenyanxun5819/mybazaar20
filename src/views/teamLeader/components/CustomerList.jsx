/**
 * CustomerList.jsx (重构版)
 * 
 * 新功能：
 * - 显示 Customer 列表及其应收现金状态
 * - 区分应收现金来源：EventManager 分配 + TeamLeader 派发
 * - 支持确认收款（减少 pendingCash，增加 confirmedCash）
 * 
 * 架构对应：
 * - customer.cashAccount.pendingCash - 待支付现金
 * - customer.cashAccount.confirmedCash - 已支付现金
 * - customer.cashAccount.emAllocatedCash - EM 分配的应收现金
 * - customer.cashAccount.tlAllocatedCash - TL 派发的应收现金
 * 
 * @version 2.0 (2026-04-26)
 * @author AI Assistant
 */

import React, { useState, useMemo } from 'react';
import { collection, query, where, onSnapshot, doc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { db } from '../../../config/firebase';

/**
 * CustomerList 组件 - 显示学生列表及应收现金
 * 
 * @param {Object} props
 * @param {Array} props.customers - Customer 列表
 * @param {string} props.selectedDepartment - 选中的部门
 * @param {Function} props.onSelectCustomer - 选择 Customer 回调
 * @param {Function} props.onConfirmPayment - 确认支付回调
 * @param {Object} props.userInfo - 当前登入的用户信息（Team Leader）
 */
const CustomerList = ({ 
  customers = [], 
  selectedDepartment, 
  onSelectCustomer, 
  onConfirmPayment, 
  userInfo 
}) => {
  const [sortBy, setSortBy] = useState('name');
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedCustomer, setExpandedCustomer] = useState(null);
  const [confirmingPayment, setConfirmingPayment] = useState(null);

  // ========== 获取必要信息 ==========
  const orgId = userInfo?.organizationId;
  const eventId = userInfo?.eventId;
  const teamLeaderId = userInfo?.userId;

  const safeCustomers = Array.isArray(customers) ? customers : [];

  // ========== 筛选逻辑 ==========
  const getFilteredCustomers = () => {
    let filtered = [...safeCustomers];

    // 1. 部门筛选
    if (selectedDepartment) {
      filtered = filtered.filter(customer =>
        customer.identityInfo?.department === selectedDepartment
      );
    }

    // 2. 状态筛选
    if (filterStatus !== 'all') {
      filtered = filtered.filter(customer => {
        const cashAccount = customer.customer?.cashAccount || {};
        const pendingCash = cashAccount.pendingCash || 0;
        const confirmedCash = cashAccount.confirmedCash || 0;

        switch (filterStatus) {
          case 'pending': // 有待支付现金
            return pendingCash > 0;
          case 'confirmed': // 已支付
            return confirmedCash > 0;
          case 'settled': // 无应收现金
            return (cashAccount.totalAllocatedCash || 0) === 0;
          default:
            return true;
        }
      });
    }

    // 3. 搜索筛选
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(customer => {
        const name = (customer.basicInfo?.chineseName || '').toLowerCase();
        const studentId = (customer.identityInfo?.identityId || '').toLowerCase();
        const dept = (customer.identityInfo?.department || '').toLowerCase();
        return name.includes(term) || studentId.includes(term) || dept.includes(term);
      });
    }

    return filtered;
  };

  // ========== 排序逻辑 ==========
  const getSortedCustomers = (filtered) => {
    const sorted = [...filtered];

    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => {
          const nameA = a.basicInfo?.chineseName || '';
          const nameB = b.basicInfo?.chineseName || '';
          return nameA.localeCompare(nameB, 'zh-CN');
        });
        break;
      case 'pending': // 按待支付现金降序
        sorted.sort((a, b) => {
          const pendingA = a.customer?.cashAccount?.pendingCash || 0;
          const pendingB = b.customer?.cashAccount?.pendingCash || 0;
          return pendingB - pendingA;
        });
        break;
      case 'total': // 按应收现金总额降序
        sorted.sort((a, b) => {
          const totalA = a.customer?.cashAccount?.totalAllocatedCash || 0;
          const totalB = b.customer?.cashAccount?.totalAllocatedCash || 0;
          return totalB - totalA;
        });
        break;
      case 'status': // 按状态（未支付 > 部分支付 > 已支付）
        sorted.sort((a, b) => {
          const getPriority = (c) => {
            const pending = c.customer?.cashAccount?.pendingCash || 0;
            const total = c.customer?.cashAccount?.totalAllocatedCash || 0;
            if (pending === total) return 2; // 完全未支付
            if (pending > 0) return 1;        // 部分支付
            return 0;                         // 已全部支付
          };
          return getPriority(b) - getPriority(a);
        });
        break;
      default:
        break;
    }

    return sorted;
  };

  const filteredCustomers = getFilteredCustomers();
  const sortedCustomers = getSortedCustomers(filteredCustomers);

  // ========== 支付确认逻辑 ==========
  const handleConfirmPayment = async (customer) => {
    const cashAccount = customer.customer?.cashAccount || {};
    const pendingAmount = cashAccount.pendingCash || 0;

    if (pendingAmount <= 0) {
      window.mybazaarShowToast('该学生没有待支付现金');
      return;
    }

    // 确认操作
    if (!window.confirm(
      `确认从 ${customer.basicInfo?.chineseName || '未知'} 收取现金 RM ${pendingAmount}？\n\n` +
      `学号: ${customer.identityInfo?.identityId || '未知'}\n` +
      `部门: ${customer.identityInfo?.department || '未知'}`
    )) {
      return;
    }

    if (!teamLeaderId) {
      window.mybazaarShowToast('❌ 错误：无法获取当前用户信息');
      return;
    }

    setConfirmingPayment(customer.userId);

    try {
      const batch = writeBatch(db);

      // 1. 更新 Customer 的现金账户
      const customerRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${customer.userId}`);

      batch.update(customerRef, {
        // 减少待支付现金
        'customer.cashAccount.pendingCash': increment(-pendingAmount),
        // 增加已支付现金
        'customer.cashAccount.confirmedCash': increment(pendingAmount),
        // 更新最后支付时间
        'customer.cashAccount.lastConfirmedAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      // 2. 创建 cashCollection 记录（用于财务追踪）
      const collectionsRef = collection(db, `organizations/${orgId}/events/${eventId}/cashCollections`);
      const collectionDoc = doc(collectionsRef);

      batch.set(collectionDoc, {
        collectionId: collectionDoc.id,
        type: 'customerToTeamLeader',
        collectedBy: teamLeaderId,
        collectedByName: userInfo?.basicInfo?.chineseName || 'Team Leader',
        collectedByRole: 'teamLeader',
        collectedByDepartment: userInfo?.identityInfo?.department || '',
        submittedBy: customer.userId,
        submittedByName: customer.basicInfo?.chineseName || '未知',
        submittedByRole: 'customer',
        submittedByDepartment: customer.identityInfo?.department || '',
        customerId: customer.userId,
        customerDepartment: customer.identityInfo?.department || '',
        amount: pendingAmount,
        pointsValue: pendingAmount, // 假设 1 点 = 1 RM
        status: 'collected',
        collectedAt: serverTimestamp(),
        submittedAt: serverTimestamp(),
        organizationId: orgId,
        eventId: eventId,
        note: `确认收取应付现金`,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 3. 更新 TeamLeader 的现金统计
      const teamLeaderRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${teamLeaderId}`);

      batch.update(teamLeaderRef, {
        // 减少待确认现金
        'teamLeader.cashStats.pendingFromCustomers': increment(-pendingAmount),
        // 增加已确认现金
        'teamLeader.cashStats.confirmedFromCustomers': increment(pendingAmount),
        // 增加当前持有现金
        'teamLeader.cashStats.cashOnHand': increment(pendingAmount),
        // 累计收款
        'teamLeader.cashStats.totalReceivedFromCustomers': increment(pendingAmount),
        // 更新时间戳
        'teamLeader.cashStats.lastConfirmedAt': serverTimestamp(),
        'updatedAt': serverTimestamp()
      });

      await batch.commit();

      window.mybazaarShowToast(`✅ 成功确认收取 RM ${pendingAmount} 从 ${customer.basicInfo?.chineseName || '未知'}`);

      if (onConfirmPayment) {
        onConfirmPayment(customer, pendingAmount);
      }

    } catch (error) {
      console.error('❌ 确认收款失败:', error);
      window.mybazaarShowToast('确认收款失败，请重试。错误: ' + error.message);
    } finally {
      setConfirmingPayment(null);
    }
  };

  // ========== 辅助函数 ==========
  const getPaymentStatus = (cashAccount) => {
    if (!cashAccount) return '无应收';
    
    const total = cashAccount.totalAllocatedCash || 0;
    const pending = cashAccount.pendingCash || 0;
    const confirmed = cashAccount.confirmedCash || 0;

    if (total === 0) return { status: '无应收', color: '#6b7280' };
    if (pending === 0) return { status: '已全部支付', color: '#10b981' };
    if (pending === total) return { status: '待支付', color: '#ef4444' };
    return { status: '部分支付', color: '#f59e0b' };
  };

  // ========== UI 渲染 ==========

  return (
    <div style={styles.container}>
      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <div style={styles.searchBox}>
          <input
            type="text"
            placeholder="搜索姓名、学号或部门..."
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
            <option value="all">全部状态</option>
            <option value="pending">待支付</option>
            <option value="confirmed">已支付</option>
            <option value="settled">无应收</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="name">按姓名</option>
            <option value="pending">按待支付金额</option>
            <option value="total">按应收总额</option>
            <option value="status">按支付状态</option>
          </select>
        </div>
      </div>

      {/* 表格 */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.headerRow}>
              <th style={styles.th}>#</th>
              <th style={styles.th}>姓名</th>
              <th style={styles.th}>学号</th>
              <th style={styles.th}>部门</th>
              <th style={styles.th}>应收总额</th>
              <th style={styles.th}>待支付</th>
              <th style={styles.th}>已支付</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedCustomers.length === 0 ? (
              <tr>
                <td colSpan="9" style={styles.noData}>
                  没有符合条件的学生
                </td>
              </tr>
            ) : (
              sortedCustomers.map((customer, index) => {
                const cashAccount = customer.customer?.cashAccount || {};
                const totalCash = cashAccount.totalAllocatedCash || 0;
                const pendingCash = cashAccount.pendingCash || 0;
                const confirmedCash = cashAccount.confirmedCash || 0;
                const isExpanded = expandedCustomer === customer.userId;
                const isConfirming = confirmingPayment === customer.userId;
                const statusInfo = getPaymentStatus(cashAccount);

                return (
                  <React.Fragment key={customer.userId}>
                    <tr style={styles.row}>
                      <td style={styles.td}>{index + 1}</td>
                      <td style={styles.td}>
                        {customer.basicInfo?.chineseName || customer.basicInfo?.englishName || '未知'}
                      </td>
                      <td style={styles.td}>
                        {customer.identityInfo?.identityId || '-'}
                      </td>
                      <td style={styles.td}>
                        {customer.identityInfo?.department || '-'}
                      </td>
                      <td style={styles.td}>
                        <span style={{ fontWeight: 'bold', color: '#1f2937' }}>
                          RM {totalCash.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          color: pendingCash > 0 ? '#ef4444' : '#6b7280',
                          fontWeight: pendingCash > 0 ? 'bold' : 'normal'
                        }}>
                          RM {pendingCash.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          color: confirmedCash > 0 ? '#10b981' : '#6b7280',
                          fontWeight: confirmedCash > 0 ? 'bold' : 'normal'
                        }}>
                          RM {confirmedCash.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          background: `${statusInfo.color}20`,
                          color: statusInfo.color
                        }}>
                          {statusInfo.status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <div style={styles.actionButtons}>
                          {pendingCash > 0 && (
                            <button
                              onClick={() => handleConfirmPayment(customer)}
                              disabled={isConfirming}
                              style={{
                                ...styles.actionBtn,
                                background: '#10b981',
                                opacity: isConfirming ? 0.5 : 1
                              }}
                            >
                              {isConfirming ? '处理中...' : '💰 确认收款'}
                            </button>
                          )}
                          <button
                            onClick={() => setExpandedCustomer(isExpanded ? null : customer.userId)}
                            style={{
                              ...styles.actionBtn,
                              background: '#6b7280'
                            }}
                          >
                            {isExpanded ? '收起' : '详情'}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* 展开的详情行 */}
                    {isExpanded && (
                      <tr>
                        <td colSpan="9" style={styles.detailsCell}>
                          <div style={styles.detailsContainer}>
                            <h4 style={styles.detailsTitle}>应收现金详情</h4>
                            <div style={styles.detailsGrid}>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>EventManager 分配:</span>
                                <span>RM {(cashAccount.emAllocatedCash || 0).toLocaleString()}</span>
                              </div>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>TeamLeader 派发:</span>
                                <span>RM {(cashAccount.tlAllocatedCash || 0).toLocaleString()}</span>
                              </div>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>赠送点数 (无需支付):</span>
                                <span>{(customer.customer?.pointsAccount?.grantedPoints || 0).toLocaleString()} 点</span>
                              </div>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>电话:</span>
                                <span>{customer.basicInfo?.phoneNumber || '-'}</span>
                              </div>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>最后支付时间:</span>
                                <span>
                                  {cashAccount.lastConfirmedAt 
                                    ? new Date(cashAccount.lastConfirmedAt.toDate?.() || cashAccount.lastConfirmedAt).toLocaleDateString('zh-CN')
                                    : '-'}
                                </span>
                              </div>
                              <div style={styles.detailItem}>
                                <span style={styles.detailLabel}>支付进度:</span>
                                <span>
                                  {totalCash > 0 
                                    ? `${((confirmedCash / totalCash) * 100).toFixed(1)}%`
                                    : '0%'}
                                </span>
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

      {/* 统计摘要 */}
      <div style={styles.summary}>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>总人数:</span>
          <span style={styles.summaryValue}>{sortedCustomers.length}</span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>总应收:</span>
          <span style={{ ...styles.summaryValue, color: '#1f2937' }}>
            RM {sortedCustomers.reduce((sum, c) => sum + (c.customer?.cashAccount?.totalAllocatedCash || 0), 0).toLocaleString()}
          </span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>待支付:</span>
          <span style={{ ...styles.summaryValue, color: '#ef4444' }}>
            RM {sortedCustomers.reduce((sum, c) => sum + (c.customer?.cashAccount?.pendingCash || 0), 0).toLocaleString()}
          </span>
        </div>
        <div style={styles.summaryItem}>
          <span style={styles.summaryLabel}>已支付:</span>
          <span style={{ ...styles.summaryValue, color: '#10b981' }}>
            RM {sortedCustomers.reduce((sum, c) => sum + (c.customer?.cashAccount?.confirmedCash || 0), 0).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};

// ========== 样式 ==========
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
    borderBottom: '1px solid #e5e7eb'
  },
  td: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem'
  },
  noData: {
    textAlign: 'center',
    color: '#9ca3af',
    padding: '2rem'
  },
  actionButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionBtn: {
    padding: '0.375rem 0.75rem',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    color: 'white',
    transition: 'all 0.2s'
  },
  badge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '999px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  detailsCell: {
    padding: '1rem',
    background: '#f9fafb'
  },
  detailsContainer: {
    background: 'white',
    padding: '1rem',
    borderRadius: '6px',
    border: '1px solid #e5e7eb'
  },
  detailsTitle: {
    margin: '0 0 1rem 0',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  detailsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1rem'
  },
  detailItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem',
    borderBottom: '1px solid #e5e7eb'
  },
  detailLabel: {
    fontWeight: '600',
    color: '#6b7280',
    marginRight: '1rem'
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '6px'
  },
  summaryItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  summaryLabel: {
    fontWeight: '600',
    color: '#6b7280',
    fontSize: '0.875rem'
  },
  summaryValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937'
  }
};

export default CustomerList;
