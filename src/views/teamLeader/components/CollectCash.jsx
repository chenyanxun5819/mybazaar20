/**
 * CollectCash.jsx - 现金收款管理
 * 
 * 新模型专注：
 * - 显示管理的学生列表及其应收现金
 * - 只显示有待收款的学生
 * - 一键确认收款
 * - 支持批量确认
 * - 按应收金额排序，优先收高额项
 * 
 * @version 2026-04-26
 * @date 2026-04-26
 */

import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, writeBatch, doc, orderBy } from 'firebase/firestore';
import { db } from '../../../config/firebase';

const CollectCash = ({ userInfo, eventData }) => {
  // 学生列表
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // UI状态
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('pendingDesc');
  const [filterStatus, setFilterStatus] = useState('pending'); // pending, confirmed, all
  const [expandedStudent, setExpandedStudent] = useState(null);
  
  // 批量操作
  const [selectedStudents, setSelectedStudents] = useState(new Set());
  const [confirmingIds, setConfirmingIds] = useState(new Set());

  const orgId = userInfo?.organizationId?.replace('organization_', '') || '';
  const eventId = userInfo?.eventId?.replace('event_', '') || '';
  const teamLeaderId = userInfo?.userId;
  const departmentId = userInfo?.managedDepartments?.[0]; // 简化: 使用第一个部门

  // ===== 实时监听学生列表 =====
  useEffect(() => {
    if (!orgId || !eventId || !teamLeaderId || !departmentId) {
      console.warn('[CollectCash] 缺少必要参数', { orgId, eventId, teamLeaderId, departmentId });
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // 查询这个部门的所有学生
      const customersRef = collection(
        db,
        `organizations/${orgId}/events/${eventId}/departments/${departmentId}/customers`
      );

      const q = query(customersRef, orderBy('name', 'asc'));

      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const data = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setStudents(data);
          setLoading(false);
        },
        (error) => {
          console.error('[CollectCash] 监听学生列表失败:', error);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error('[CollectCash] 初始化查询失败:', error);
      setLoading(false);
    }
  }, [orgId, eventId, teamLeaderId, departmentId]);

  // ===== 计算统计数据 =====
  const calculateStats = () => {
    let stats = {
      totalStudents: students.length,
      studentsWithDebt: 0,
      totalPending: 0,
      totalConfirmed: 0,
      collectionRate: 0
    };

    students.forEach(student => {
      const cashAccount = student.cashAccount || {};
      const pending = cashAccount.pendingCash || 0;
      const confirmed = cashAccount.confirmedCash || 0;
      const total = (cashAccount.totalAllocatedCash || 0);

      if (pending > 0) {
        stats.studentsWithDebt += 1;
        stats.totalPending += pending;
      }
      stats.totalConfirmed += confirmed;
    });

    if (stats.totalConfirmed + stats.totalPending > 0) {
      stats.collectionRate = Math.round(
        (stats.totalConfirmed / (stats.totalConfirmed + stats.totalPending)) * 100
      );
    }

    return stats;
  };

  // ===== 过滤和排序 =====
  const getDisplayedStudents = () => {
    let result = [...students];

    // 过滤
    if (filterStatus === 'pending') {
      result = result.filter(s => (s.cashAccount?.pendingCash || 0) > 0);
    } else if (filterStatus === 'confirmed') {
      result = result.filter(s => (s.cashAccount?.confirmedCash || 0) > 0);
    }

    // 搜索
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(s =>
        (s.name || '').toLowerCase().includes(term) ||
        (s.studentId || '').toLowerCase().includes(term) ||
        (s.phone || '').includes(term)
      );
    }

    // 排序
    result.sort((a, b) => {
      const aPending = a.cashAccount?.pendingCash || 0;
      const bPending = b.cashAccount?.pendingCash || 0;
      const aConfirmed = a.cashAccount?.confirmedCash || 0;
      const bConfirmed = b.cashAccount?.confirmedCash || 0;

      switch (sortBy) {
        case 'pendingDesc':
          return bPending - aPending;
        case 'pendingAsc':
          return aPending - bPending;
        case 'confirmedDesc':
          return bConfirmed - aConfirmed;
        case 'nameAsc':
          return (a.name || '').localeCompare(b.name || '');
        case 'nameDesc':
          return (b.name || '').localeCompare(a.name || '');
        default:
          return 0;
      }
    });

    return result;
  };

  // ===== 确认单笔收款 =====
  const handleConfirmPayment = async (student, amount) => {
    if (!student || !amount || amount <= 0) return;

    const studentId = student.id;
    setConfirmingIds(new Set([...confirmingIds, studentId]));

    try {
      const batch = writeBatch(db);

      // 更新学生的现金账户
      const customerRef = doc(
        db,
        `organizations/${orgId}/events/${eventId}/departments/${departmentId}/customers/${studentId}`
      );

      batch.update(customerRef, {
        'cashAccount.pendingCash': Math.max(0, (student.cashAccount?.pendingCash || 0) - amount),
        'cashAccount.confirmedCash': (student.cashAccount?.confirmedCash || 0) + amount,
        'cashAccount.lastConfirmedAt': new Date()
      });

      // 创建现金收款记录（审计日志）
      const collectionsRef = collection(
        db,
        `organizations/${orgId}/events/${eventId}/departments/${departmentId}/cashCollections`
      );

      const newCollectionRef = doc(collectionsRef);
      batch.set(newCollectionRef, {
        id: newCollectionRef.id,
        customerId: studentId,
        customerName: student.name,
        amount: amount,
        type: 'studentToTeamLeader',
        teamLeaderId: teamLeaderId,
        status: 'confirmed',
        collectedAt: new Date(),
        createdAt: new Date()
      });

      // 更新 TeamLeader 的现金统计
      const tlRef = doc(
        db,
        `organizations/${orgId}/events/${eventId}/users/${teamLeaderId}`
      );

      batch.update(tlRef, {
        'teamLeader.cashStats.pendingFromCustomers': Math.max(0, (userInfo?.teamLeader?.cashStats?.pendingFromCustomers || 0) - amount),
        'teamLeader.cashStats.confirmedFromCustomers': (userInfo?.teamLeader?.cashStats?.confirmedFromCustomers || 0) + amount,
        'teamLeader.cashStats.cashOnHand': (userInfo?.teamLeader?.cashStats?.cashOnHand || 0) + amount,
        'teamLeader.cashStats.lastConfirmedAt': new Date()
      });

      await batch.commit();

      console.log('[CollectCash] 收款成功:', { studentId, amount });
      window.mybazaarShowToast?.(`✅ 已确认收款 RM ${amount.toLocaleString()}`);

      // 取消选中
      setSelectedStudents(prev => {
        const newSet = new Set(prev);
        newSet.delete(studentId);
        return newSet;
      });
    } catch (error) {
      console.error('[CollectCash] 收款失败:', error);
      window.mybazaarShowToast?.(`❌ 收款失败: ${error.message}`);
    } finally {
      setConfirmingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(studentId);
        return newSet;
      });
    }
  };

  // ===== 批量确认 =====
  const handleBatchConfirm = async () => {
    if (selectedStudents.size === 0) {
      window.mybazaarShowToast?.('⚠️ 请先选择学生');
      return;
    }

    const batch = writeBatch(db);
    let totalAmount = 0;

    try {
      for (const studentId of selectedStudents) {
        const student = students.find(s => s.id === studentId);
        if (!student) continue;

        const pending = student.cashAccount?.pendingCash || 0;
        if (pending <= 0) continue;

        totalAmount += pending;

        const customerRef = doc(
          db,
          `organizations/${orgId}/events/${eventId}/departments/${departmentId}/customers/${studentId}`
        );

        batch.update(customerRef, {
          'cashAccount.pendingCash': 0,
          'cashAccount.confirmedCash': (student.cashAccount?.confirmedCash || 0) + pending,
          'cashAccount.lastConfirmedAt': new Date()
        });

        // 创建审计记录
        const collectionsRef = collection(
          db,
          `organizations/${orgId}/events/${eventId}/departments/${departmentId}/cashCollections`
        );
        const newCollectionRef = doc(collectionsRef);
        batch.set(newCollectionRef, {
          id: newCollectionRef.id,
          customerId: studentId,
          customerName: student.name,
          amount: pending,
          type: 'studentToTeamLeader',
          teamLeaderId: teamLeaderId,
          status: 'confirmed',
          collectedAt: new Date(),
          createdAt: new Date()
        });
      }

      // 更新 TL 统计
      const tlRef = doc(
        db,
        `organizations/${orgId}/events/${eventId}/users/${teamLeaderId}`
      );

      const currentPending = userInfo?.teamLeader?.cashStats?.pendingFromCustomers || 0;
      batch.update(tlRef, {
        'teamLeader.cashStats.pendingFromCustomers': Math.max(0, currentPending - totalAmount),
        'teamLeader.cashStats.confirmedFromCustomers': (userInfo?.teamLeader?.cashStats?.confirmedFromCustomers || 0) + totalAmount,
        'teamLeader.cashStats.cashOnHand': (userInfo?.teamLeader?.cashStats?.cashOnHand || 0) + totalAmount,
        'teamLeader.cashStats.lastConfirmedAt': new Date()
      });

      await batch.commit();

      window.mybazaarShowToast?.(`✅ 已批量确认 RM ${totalAmount.toLocaleString()}`);
      setSelectedStudents(new Set());
    } catch (error) {
      console.error('[CollectCash] 批量确认失败:', error);
      window.mybazaarShowToast?.(`❌ 批量确认失败: ${error.message}`);
    }
  };

  // ===== 渲染 =====
  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner} />
        <p>加载现金收款数据中...</p>
      </div>
    );
  }

  const stats = calculateStats();
  const displayedStudents = getDisplayedStudents();

  return (
    <div style={styles.container}>
      {/* 统计卡片 */}
      <div style={styles.statsGrid}>
        <StatCard
          icon="👥"
          title="待收款学生"
          value={stats.studentsWithDebt}
          color="#f59e0b"
        />
        <StatCard
          icon="⏳"
          title="待收款总额"
          value={`RM ${stats.totalPending.toLocaleString()}`}
          color="#ef4444"
          highlight
        />
        <StatCard
          icon="✅"
          title="已确认收款"
          value={`RM ${stats.totalConfirmed.toLocaleString()}`}
          color="#10b981"
        />
        <StatCard
          icon="📊"
          title="收款率"
          value={`${stats.collectionRate}%`}
          color={stats.collectionRate >= 50 ? '#10b981' : '#f59e0b'}
        />
      </div>

      {/* 工具栏 */}
      <div style={styles.toolbar}>
        <input
          type="text"
          placeholder="🔍 搜索学生姓名、学号或手机号..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <div style={styles.controls}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            style={styles.select}
          >
            <option value="pending">待收款</option>
            <option value="confirmed">已确认</option>
            <option value="all">全部</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.select}
          >
            <option value="pendingDesc">应收金额: 高→低</option>
            <option value="pendingAsc">应收金额: 低→高</option>
            <option value="confirmedDesc">已收金额: 高→低</option>
            <option value="nameAsc">学生姓名: A→Z</option>
            <option value="nameDesc">学生姓名: Z→A</option>
          </select>
        </div>
      </div>

      {/* 批量操作 */}
      {selectedStudents.size > 0 && (
        <div style={styles.batchActionBar}>
          <span style={styles.selectionInfo}>
            已选择 {selectedStudents.size} 位学生
          </span>
          <button
            onClick={handleBatchConfirm}
            style={styles.batchConfirmButton}
          >
            ✅ 批量确认收款
          </button>
          <button
            onClick={() => setSelectedStudents(new Set())}
            style={styles.batchCancelButton}
          >
            ❌ 清除选择
          </button>
        </div>
      )}

      {/* 学生列表 */}
      {displayedStudents.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={styles.emptyIcon}>🏦</div>
          <h3>{filterStatus === 'pending' ? '没有待收款的学生' : '没有找到匹配的学生'}</h3>
          <p>
            {searchTerm
              ? '尝试调整搜索条件'
              : filterStatus === 'pending'
                ? '所有学生都已确认支付'
                : '暂无记录'}
          </p>
        </div>
      ) : (
        <div style={styles.studentsList}>
          {displayedStudents.map(student => {
            const isExpanded = expandedStudent === student.id;
            const cashAccount = student.cashAccount || {};
            const pending = cashAccount.pendingCash || 0;
            const confirmed = cashAccount.confirmedCash || 0;
            const total = cashAccount.totalAllocatedCash || 0;
            const isSelected = selectedStudents.has(student.id);
            const isConfirming = confirmingIds.has(student.id);

            return (
              <div
                key={student.id}
                style={{
                  ...styles.studentCard,
                  background: isSelected ? '#dbeafe' : 'white',
                  borderLeft: `4px solid ${pending > 0 ? '#ef4444' : '#10b981'}`
                }}
              >
                {/* 主行 */}
                <div style={styles.cardHeader}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedStudents(new Set([...selectedStudents, student.id]));
                      } else {
                        const newSet = new Set(selectedStudents);
                        newSet.delete(student.id);
                        setSelectedStudents(newSet);
                      }
                    }}
                    style={styles.checkbox}
                  />

                  <div style={styles.studentInfo}>
                    <div style={styles.studentName}>{student.name}</div>
                    <div style={styles.studentMeta}>
                      {student.studentId && `学号: ${student.studentId}`}
                      {student.phone && ` | 📞 ${student.phone}`}
                    </div>
                  </div>

                  <div style={styles.amountSection}>
                    <div style={styles.amountBox}>
                      <div style={styles.amountLabel}>待收</div>
                      <div style={{ ...styles.amountValue, color: '#ef4444' }}>
                        RM {pending.toLocaleString()}
                      </div>
                    </div>
                    <div style={styles.amountBox}>
                      <div style={styles.amountLabel}>已收</div>
                      <div style={{ ...styles.amountValue, color: '#10b981' }}>
                        RM {confirmed.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* 按钮 */}
                  <button
                    onClick={() => {
                      if (pending > 0) {
                        handleConfirmPayment(student, pending);
                      } else {
                        setExpandedStudent(isExpanded ? null : student.id);
                      }
                    }}
                    disabled={isConfirming}
                    style={{
                      ...styles.confirmButton,
                      opacity: isConfirming ? 0.6 : 1,
                      background: pending > 0 ? '#10b981' : '#e5e7eb'
                    }}
                  >
                    {isConfirming ? '⏳' : pending > 0 ? '✅ 确认收款' : '📊'}
                  </button>

                  <button
                    onClick={() => setExpandedStudent(isExpanded ? null : student.id)}
                    style={styles.expandButton}
                  >
                    {isExpanded ? '⬆️' : '⬇️'}
                  </button>
                </div>

                {/* 详情面板 */}
                {isExpanded && (
                  <div style={styles.detailPanel}>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>应收总额</span>
                      <span style={styles.detailValue}>RM {total.toLocaleString()}</span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>EM 分配</span>
                      <span style={styles.detailValue}>
                        RM {(cashAccount.emAllocatedCash || 0).toLocaleString()}
                      </span>
                    </div>
                    <div style={styles.detailRow}>
                      <span style={styles.detailLabel}>TL 派发</span>
                      <span style={styles.detailValue}>
                        RM {(cashAccount.tlAllocatedCash || 0).toLocaleString()}
                      </span>
                    </div>
                    {cashAccount.lastConfirmedAt && (
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>最后支付时间</span>
                        <span style={styles.detailValue}>
                          {new Date(cashAccount.lastConfirmedAt.toDate?.() || cashAccount.lastConfirmedAt).toLocaleString('zh-CN')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// StatCard 组件
const StatCard = ({ icon, title, value, color, highlight }) => (
  <div style={{
    ...styles.statCard,
    background: highlight ? `${color}15` : '#f9fafb',
    borderLeft: `4px solid ${color}`
  }}>
    <div style={styles.statIcon}>{icon}</div>
    <div style={styles.statContent}>
      <div style={styles.statTitle}>{title}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
    </div>
  </div>
);

// 样式
const styles = {
  container: {
    padding: '1.5rem',
    background: '#f9fafb',
    borderRadius: '0.5rem'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem'
  },
  statCard: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem',
    borderRadius: '0.375rem',
    alignItems: 'center'
  },
  statIcon: {
    fontSize: '2rem',
    minWidth: '3rem',
    textAlign: 'center'
  },
  statContent: {
    flex: 1
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap'
  },
  searchInput: {
    flex: 1,
    minWidth: '250px',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '0.375rem',
    fontSize: '0.875rem'
  },
  controls: {
    display: 'flex',
    gap: '1rem'
  },
  select: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '0.375rem',
    fontSize: '0.875rem',
    background: 'white'
  },
  batchActionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    background: '#dbeafe',
    border: '2px solid #3b82f6',
    borderRadius: '0.375rem',
    marginBottom: '1rem'
  },
  selectionInfo: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#1e40af'
  },
  batchConfirmButton: {
    padding: '0.5rem 1rem',
    background: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  batchCancelButton: {
    padding: '0.5rem 1rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  studentsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  studentCard: {
    background: 'white',
    borderRadius: '0.375rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    flexWrap: 'wrap'
  },
  checkbox: {
    width: '1.25rem',
    height: '1.25rem',
    cursor: 'pointer'
  },
  studentInfo: {
    flex: 1,
    minWidth: '200px'
  },
  studentName: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  studentMeta: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  amountSection: {
    display: 'flex',
    gap: '1rem'
  },
  amountBox: {
    textAlign: 'center'
  },
  amountLabel: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.25rem'
  },
  amountValue: {
    fontSize: '1.125rem',
    fontWeight: 'bold'
  },
  confirmButton: {
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: 'white'
  },
  expandButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    padding: '0'
  },
  detailPanel: {
    background: '#f9fafb',
    padding: '1rem',
    borderTop: '1px solid #e5e7eb'
  },
  detailRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '0.75rem',
    fontSize: '0.875rem',
    borderBottom: '1px solid #e5e7eb'
  },
  detailLabel: {
    color: '#6b7280',
    fontWeight: '500'
  },
  detailValue: {
    color: '#1f2937',
    fontWeight: '600'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    background: 'white',
    borderRadius: '0.375rem'
  },
  emptyIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  loadingContainer: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  spinner: {
    display: 'inline-block',
    width: '2rem',
    height: '2rem',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  }
};

export default CollectCash;
