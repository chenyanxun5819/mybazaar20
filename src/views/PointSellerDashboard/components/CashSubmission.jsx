/**
 * Cash Submission Component - 修复版 v3.1
 * Tab 4: 现金上交 - 批量选择上交记录，提交到Cashier
 * 
 * 修复：
 * 1. 查询字段从 submitterId 改为 submittedBy
 * 2. 过滤逻辑改为检查 recordIds 数组
 * 3. 上交成功后刷新数据
 */

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { maskPhoneNumber } from '../../../services/transactionService';
import TransactionPinDialog from '@components/common/TransactionPinDialog';
import './CashSubmission.css';

const CashSubmission = ({ 
  statistics, 
  records, 
  onRefresh, 
  currentUser, 
  userProfile,
  organizationId,
  eventId,
  callFunction 
}) => {
  const [selectedRecords, setSelectedRecords] = useState(new Set());
  const [submittedRecords, setSubmittedRecords] = useState([]);
  const [activeTab, setActiveTab] = useState('available');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // 交易密码对话框
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingSubmission, setPendingSubmission] = useState(null);

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 格式化日期时间
  const formatDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // 短日期格式 (dd MM, hh:mm)，月份用英文缩写
  const formatShortDateTime = (timestamp) => {
    if (!timestamp) return '-';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day} ${month}, ${hours}:${minutes}`;
  };

  // 监听已提交的现金记录
  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    const submissionsRef = collection(db, 'organizations', orgId, 'events', evtId, 'cashSubmissions');
    const q = query(
      submissionsRef,
      where('submittedBy', '==', userId),  // ✅ 修正：使用 submittedBy
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      console.log('[CashSubmission] 监听到提交记录:', submissions.length);
      setSubmittedRecords(submissions);
    }, (error) => {
      console.error('[CashSubmission] 监听现金提交记录失败:', error);
      
      // 如果是索引错误，提示用户
      if (error.message && error.message.includes('index')) {
        setError('Firestore 索引缺失，请联系管理员配置');
      }
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, organizationId, eventId]);

  // 监听所有销售记录（从 transactions 集合读取，支持两种交易类型）
  const [localRecords, setLocalRecords] = useState([]);

  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    const transactionsRef = collection(db, 'organizations', orgId, 'events', evtId, 'transactions');
    const qTransactions = query(
      transactionsRef,
      where('sellerId', '==', userId),
      where('transactionType', 'in', ['pointseller_card_issuance', 'pointseller_to_customer']),
      orderBy('timestamp', 'desc')
    );

    const unsubscribe = onSnapshot(qTransactions, (snapshot) => {
      const transactions = snapshot.docs.map(doc => {
        const data = doc.data();
        // 适配数据格式：将 transactions 字段转换为 pointSellerSales 格式以保持现有逻辑
        return {
          id: doc.id,
          saleType: data.transactionType === 'pointseller_card_issuance' ? 'card' : 'cash',
          cashReceived: data.transactionType === 'pointseller_card_issuance' ? data.cashAmount : data.amount,
          saleNumber: doc.id,  // 使用 transactionId 作为编号
          metadata: {
            createdAt: data.timestamp
          },
          cash: {
            customerName: data.customerName || ''
          },
          ...data  // 保留原始数据供其他逻辑使用
        };
      });

      console.log('[CashSubmission] 监听到销售记录:', transactions.length);
      setLocalRecords(transactions);
    }, (error) => {
      console.error('[CashSubmission] 监听销售记录失败:', error);

      if (error.message && error.message.includes('index')) {
        setError('Firestore 索引缺失，请联系管理员配置');
      }
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, organizationId, eventId]);

  // ✅ 使用本地监听的记录，如果没有则使用 props
  const effectiveRecords = localRecords.length > 0 ? localRecords : records;

  // ✅ 修正：可上交的记录（检查 recordIds 数组）
  const availableRecords = effectiveRecords.filter(record => {
    console.log(`\n[DEBUG] ========== 开始过滤记录 ${record.id} (${record.type}) ==========`);
    console.log(`[DEBUG] submittedRecords 数量: ${submittedRecords.length}`);
    
    // 检查是否已经在任何提交记录中
    const isSubmitted = submittedRecords.some(sub => {
      if (sub.recordIds && Array.isArray(sub.recordIds)) {
        return sub.recordIds.includes(record.id);
      }
      return false;
    });
    
    console.log(`[DEBUG] isSubmitted = ${isSubmitted}`);
    console.log(`[DEBUG] 返回 ${!isSubmitted} (${!isSubmitted ? '可上交' : '已上交'})`);
    console.log(`[DEBUG] ========== 结束 ==========\n`);
    
    if (!isSubmitted) {
      console.log(`[CashSubmission] 📝 记录 ${record.id} (${record.type}) 可上交`);
    }
    
    return !isSubmitted;
  });

  console.log(`[CashSubmission] 总记录: ${effectiveRecords.length}, 可上交: ${availableRecords.length}, 已提交: ${submittedRecords.length}, card: ${effectiveRecords.filter(r => r.saleType === 'card').length}, cash: ${effectiveRecords.filter(r => r.saleType === 'cash').length}`);

  // 已上交的记录
  const pendingSubmissions = submittedRecords.filter(sub => sub.status === 'pending');
  const confirmedSubmissions = submittedRecords.filter(sub => sub.status === 'confirmed');

  // 统计计算（cashReceived 字段在新架构中两种类型统一）
  // 1. 今日收现金（总额）- 从 effectiveRecords 实时计算
  const todayTotalCash = effectiveRecords.reduce((sum, record) => {
    return sum + (record.cashReceived || 0);
  }, 0);
  
  // 2. 上交待确认（pending 状态的总额）
  const pendingAmount = pendingSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 3. 已上交（confirmed 状态的总额）
  const confirmedAmount = confirmedSubmissions.reduce((sum, sub) => sum + (sub.amount || 0), 0);
  
  // 4. 未上交现金（可上交记录的总额）
  const unsubmittedAmount = availableRecords.reduce((sum, record) => {
    return sum + (record.cashReceived || 0);
  }, 0);

  // 5. 总收取现金（PointSeller 累计统计，对齐 Firestore 新架构 totalStats.totalCash）
  const totalReceivedCash = statistics?.totalStats?.totalCash || 0;

  // 计算选中金额
  const selectedAmount = Array.from(selectedRecords).reduce((sum, recordId) => {
    const record = availableRecords.find(r => r.id === recordId);
    if (!record) return sum;
    return sum + (record.cashReceived || 0);
  }, 0);

  const getSubmissionRecordCount = (submission) => {
    if (Array.isArray(submission.recordIds)) return submission.recordIds.length;
    if (Array.isArray(submission.records)) return submission.records.length;
    return 0;
  };

  // 处理选择/取消选择
  const handleToggleSelect = (recordId) => {
    setSelectedRecords(prev => {
      const newSet = new Set(prev);
      if (newSet.has(recordId)) {
        newSet.delete(recordId);
      } else {
        newSet.add(recordId);
      }
      return newSet;
    });
  };

  // 全选/取消全选
  const handleToggleSelectAll = () => {
    if (selectedRecords.size === availableRecords.length) {
      setSelectedRecords(new Set());
    } else {
      setSelectedRecords(new Set(availableRecords.map(r => r.id)));
    }
  };

  // 处理上交现金按钮点击
  const handleSubmitClick = () => {
    if (selectedRecords.size === 0) {
      setError('请至少选择一条记录');
      return;
    }

    // 显示交易密码对话框
    setPendingSubmission({
      recordIds: Array.from(selectedRecords),
      amount: selectedAmount,
      count: selectedRecords.size
    });
    setShowPinDialog(true);
    setError(null);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, confirmationNote) => {
    try {
      setLoading(true);
      setShowPinDialog(false);
      setError(null);
      setSuccessMessage(null);

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        throw new Error('无法获取活动信息');
      }

      // 准备上交数据
      const submissionData = {
        orgId,
        eventId: evtId,
        amount: pendingSubmission.amount,
        recordIds: pendingSubmission.recordIds,
        records: pendingSubmission.recordIds.map(id => {
          const record = availableRecords.find(r => r.id === id);
          return {
            id: record.id,
            saleType: record.saleType,
            amount: record.cashReceived || 0,
            saleNumber: record.saleNumber,
            customerName: record.cash?.customerName,
            timestamp: record.metadata?.createdAt
          };
        }),
        transactionPin: pin,
        note: confirmationNote || note || ''
      };

      console.log('[CashSubmission] 提交数据:', submissionData);

      // 调用Cloud Function提交现金
      const result = await callFunction(
        'submitCashAsPointSeller',
        submissionData,
        15000
      );

      if (result.data.success) {
        setSuccessMessage(
          `✅ 现金上交成功！金额: ${formatAmount(pendingSubmission.amount)}，共 ${pendingSubmission.count} 笔记录`
        );

        // 重置表单
        setSelectedRecords(new Set());
        setNote('');
        setPendingSubmission(null);

        // ✅ 刷新数据
        onRefresh();

        // 3秒后清除成功消息
        setTimeout(() => {
          setSuccessMessage(null);
        }, 3000);
      }
    } catch (err) {
      console.error('[CashSubmission] 上交现金失败:', err);
      setError('上交失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingSubmission(null);
  };

  return (
    <div className="cash-submission">
     
      {/* 统计卡片 - 参考 SellerSubmitCash 的摘要模板 */}
      <div style={styles.summaryWrapper}>
        <div style={styles.summaryCard}>
          <div style={styles.summaryHeaderRow}>
            <div style={styles.summaryLeftCol}>
              <div style={styles.summaryLabel}>现有现金</div>
              {unsubmittedAmount > 0 && (
                <div style={styles.reminderBoxSmall}>
                  - 记得及时上交
                </div>
              )}
            </div>
            <div style={styles.summaryRightCol}>
              <div style={styles.amountButtonRow}>
                <div style={styles.summaryAmount}>{formatAmount(unsubmittedAmount)}</div>
              </div>
            </div>
          </div>

          <div style={styles.summaryStats}>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{pendingSubmissions.length} 笔</span>
              <span style={styles.summaryStatLabel}>待确认笔数</span>
              <span style={styles.summaryStatAmt}>{formatAmount(pendingAmount)}</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{confirmedSubmissions.length} 笔</span>
              <span style={styles.summaryStatLabel}>已确认笔数</span>
              <span style={styles.summaryStatAmt}>{formatAmount(confirmedAmount)}</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{formatAmount(totalReceivedCash)}</span>
              <span style={styles.summaryStatLabel}>总收取现金</span>
            </div>
          </div>
        </div>
      </div>

      {/* 下方列表区 */}
        <div className="section-header">
          <div style={styles.tabGroup}>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(activeTab === 'available' ? styles.tabButtonActive : null)
              }}
              onClick={() => setActiveTab('available')}
            >
              可上交
              <span
                style={{
                  ...styles.tabCountBadge,
                  ...(activeTab === 'available' ? styles.tabCountBadgeActive : null)
                }}
              >
                {availableRecords.length}
              </span>
            </button>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(activeTab === 'pending' ? styles.tabButtonActive : null)
              }}
              onClick={() => setActiveTab('pending')}
            >
              待确认
              <span
                style={{
                  ...styles.tabCountBadge,
                  ...(activeTab === 'pending' ? styles.tabCountBadgeActive : null)
                }}
              >
                {pendingSubmissions.length}
              </span>
            </button>
            <button
              type="button"
              style={{
                ...styles.tabButton,
                ...(activeTab === 'confirmed' ? styles.tabButtonActive : null)
              }}
              onClick={() => setActiveTab('confirmed')}
            >
              已确认
              <span
                style={{
                  ...styles.tabCountBadge,
                  ...(activeTab === 'confirmed' ? styles.tabCountBadgeActive : null)
                }}
              >
                {confirmedSubmissions.length}
              </span>
            </button>
          </div>
        </div>

        {activeTab === 'available' && (
          <div style={{ marginTop: '5px', marginBottom: '0.75rem' }}>
            <span className="select-all-link" onClick={handleToggleSelectAll}>
              {selectedRecords.size === availableRecords.length && availableRecords.length > 0
                ? '取消全选'
                : '全选'}
            </span>
          </div>
        )}

        {activeTab === 'available' && availableRecords.length > 0 ? (
          <div style={styles.cardList}>
            {availableRecords.map(record => (
              <div
                key={record.id}
                style={{
                  ...styles.recordCard,
                  ...(selectedRecords.has(record.id) ? styles.recordCardSelected : null)
                }}
                onClick={() => handleToggleSelect(record.id)}
              >
                {/* 第一行：短日期 + 交易序号，分散对齐 */}
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardDate}>
                    {formatShortDateTime(record.metadata?.createdAt)}
                  </div>
                  <div style={styles.recordCardTransId}>
                    {record.transactionId || record.saleNumber || record.id}
                  </div>
                </div>

                {/* 第二行：根据类型显示不同内容 */}
                <div style={styles.recordCardSecondRow}>
                  {record.saleType === 'card' ? (
                    <>
                      <div style={styles.recordCardCardLabel}>
                        🎫 点数卡交易
                      </div>
                      <div style={styles.recordCardQuantity}>
                        {formatAmount(record.cashReceived || 0)}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={styles.recordCardLeftInfo}>
                        <div style={styles.recordCardName}>
                          {record.customerEnglishName || record.customerName || '未知'}
                        </div>
                        <div style={styles.recordCardPhone}>
                          {maskPhoneNumber(record.customerPhone || '')}
                        </div>
                      </div>
                      <div style={styles.recordCardQuantity}>
                        {formatAmount(record.cashReceived || 0)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === 'available' && availableRecords.length === 0 ? (
          <div className="records-empty">
            <div className="empty-icon">✅</div>
            <p className="empty-message">所有记录已上交或暂无可上交记录</p>
          </div>
        ) : null}

        {activeTab === 'pending' && pendingSubmissions.length > 0 ? (
          <div style={styles.cardList}>
            {pendingSubmissions.map(sub => (
              <div
                key={sub.id}
                style={styles.recordCard}
              >
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardDate}>
                    {formatShortDateTime(sub.submittedAt)}
                  </div>
                  <div style={styles.recordCardTransId}>
                    {sub.submissionNumber || sub.submissionId || sub.id}
                  </div>
                </div>

                <div style={styles.recordCardSecondRow}>
                  <div style={styles.recordCardLeftInfo}>
                    <div style={styles.recordCardName}>⏳ 待确认</div>
                    <div style={styles.recordCardPhone}>
                      {getSubmissionRecordCount(sub)} 笔记录{sub.note ? ` · ${sub.note}` : ''}
                    </div>
                  </div>
                  <div style={styles.recordCardQuantity}>
                    {formatAmount(sub.amount || 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === 'pending' && pendingSubmissions.length === 0 ? (
          <div className="records-empty">
            <div className="empty-icon">⏳</div>
            <p className="empty-message">暂无待确认记录</p>
          </div>
        ) : null}

        {activeTab === 'confirmed' && confirmedSubmissions.length > 0 ? (
          <div style={styles.cardList}>
            {confirmedSubmissions.map(sub => (
              <div
                key={sub.id}
                style={styles.recordCard}
              >
                <div style={styles.recordCardFirstRow}>
                  <div style={styles.recordCardDate}>
                    {formatShortDateTime(sub.confirmedAt || sub.submittedAt)}
                  </div>
                  <div style={styles.recordCardTransId}>
                    {sub.submissionNumber || sub.submissionId || sub.id}
                  </div>
                </div>

                <div style={styles.recordCardSecondRow}>
                  <div style={styles.recordCardLeftInfo}>
                    <div style={styles.recordCardName}>✅ 已确认</div>
                    <div style={styles.recordCardPhone}>
                      {sub.receiverName ? `确认人: ${sub.receiverName}` : `${getSubmissionRecordCount(sub)} 笔记录`}
                    </div>
                  </div>
                  <div style={styles.recordCardQuantity}>
                    {formatAmount(sub.amount || 0)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {activeTab === 'confirmed' && confirmedSubmissions.length === 0 ? (
          <div className="records-empty">
            <div className="empty-icon">✅</div>
            <p className="empty-message">暂无已确认记录</p>
          </div>
        ) : null}

        {/* 选中金额和提交按钮 */}
        {activeTab === 'available' && selectedRecords.size > 0 && (
          <div className="selection-summary">
            <div className="summary-info">
              已选择 <strong>{selectedRecords.size}</strong> 笔记录，
              金额总计 <strong>{formatAmount(selectedAmount)}</strong>
            </div>

            <button
              onClick={handleSubmitClick}
              disabled={loading}
              className="submit-button"
            >
              {loading ? '提交中...' : `💰 上交 ${formatAmount(selectedAmount)}`}
            </button>
          </div>
        )}

        {/* 错误和成功消息 */}
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {successMessage && (
          <div className="success-message">
            {successMessage}
          </div>
        )}

      {/* 交易密码对话框 */}
      {showPinDialog && pendingSubmission && (
        <TransactionPinDialog
          title="确认上交现金"
          message={`即将上交 ${formatAmount(pendingSubmission.amount)}（${pendingSubmission.count} 笔记录）给 Cashier`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认上交"
          allowNote={true}
          noteLabel="备注（可选）"
          notePlaceholder="请输入备注信息..."
        />
      )}
    </div>
  );
};

// ===== 内联样式定义 =====
const styles = {
  summaryWrapper: {
    width: '100%',
    marginBottom: '1rem'
  },
  summaryCard: {
    padding: '1.25rem 0.65rem',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
    color: '#fff',
    background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)'
  },
  summaryHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'stretch',
    marginBottom: '1.5rem',
    paddingBottom: '1rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
    gap: '0.5rem'
  },
  summaryLeftCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.5rem',
    width: '33.33%',
    flex: '0 0 33.33%'
  },
  summaryRightCol: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    gap: '0.2rem',
    width: '66.67%',
    flex: '0 0 66.67%',
    textAlign: 'left'
  },
  amountButtonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    justifyContent: 'flex-start'
  },
  summaryLabel: {
    fontSize: '0.9rem',
    opacity: 0.9,
    fontWeight: 500
  },
  reminderBoxSmall: {
    fontSize: '0.75rem',
    opacity: 0.8,
    fontStyle: 'italic'
  },
  summaryAmount: {
    fontSize: '1.6rem',
    fontWeight: 700
  },
  summaryDesc: {
    fontSize: '0.75rem',
    opacity: 0.85,
    margin: '0.25rem 0 0 0'
  },
  summaryStats: {
    display: 'flex',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    gap: '0.75rem',
    flexWrap: 'nowrap'
  },
  summaryStatItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: '1 1 150px',
    textAlign: 'center'
  },
  summaryStatValue: {
    fontSize: '1.4rem',
    fontWeight: '700',
    marginBottom: '0.25rem'
  },
  summaryStatLabel: {
    fontSize: '0.85rem',
    opacity: 0.85,
    marginBottom: '0.25rem'
  },
  summaryStatAmt: {
    fontSize: '0.9rem',
    fontWeight: 500
  },
  summaryStatDivider: {
    width: '1px',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'stretch',
    margin: '0 0.5rem'
  },
  tabGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  tabButton: {
    border: 'none',
    background: '#e5e7eb',
    color: '#374151',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.45rem',
    padding: '0.6rem 0.9rem',
    borderRadius: '999px',
    fontSize: '0.875rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease'
  },
  tabButtonActive: {
    background: '#3b82f6',
    color: '#fff',
    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)'
  },
  tabCountBadge: {
    minWidth: '1.35rem',
    height: '1.35rem',
    padding: '0 0.35rem',
    borderRadius: '999px',
    background: '#dc2626',
    color: '#fff',
    fontSize: '0.75rem',
    fontWeight: 700,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    lineHeight: 1
  },
  tabCountBadgeActive: {
    background: '#991b1b',
    color: '#fff'
  },
  cardList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0'
  },
  recordCard: {
    background: 'transparent',
    padding: '0.5rem 0.75rem',
    marginBottom: '0.25rem',
    borderBottom: '1px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'background-color 0.2s ease, box-shadow 0.2s ease'
  },
  recordCardSelected: {
    background: '#eff6ff',
    boxShadow: 'inset 0 0 0 1px #bfdbfe'
  },
  recordCardFirstRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '0.5rem'
  },
  recordCardDate: {
    fontSize: '0.8rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  recordCardTransId: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  recordCardType: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    fontFamily: 'monospace'
  },
  recordCardSecondRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem'
  },
  recordCardLeftInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.2rem'
  },
  recordCardName: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardPhone: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  recordCardCardLabel: {
    flex: 1,
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  recordCardCustomer: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  recordCardQuantity: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#3b82f6',
    whiteSpace: 'nowrap'
  }
};

export default CashSubmission;
