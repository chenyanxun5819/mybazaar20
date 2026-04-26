import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../../config/firebase';

/**
 * CollectCashPhone
 *
 * 手机版确认收款：
 * - 实时监听 cashSubmissions（status=pending, receivedBy=smId）
 * - 点击卡片 → 底部抽屉确认
 * - 调用 confirmCashSubmission Cloud Function
 * - 历史记录 tab：所有 receivedBy=smId 的记录（含全部状态）
 */
const CollectCashPhone = ({ userInfo }) => {
  const orgId = userInfo?.organizationId?.replace('organization_', '') || '';
  const eventId = userInfo?.eventId?.replace('event_', '') || '';
  const smId = userInfo?.userId;

  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'history'
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [liveCashStats, setLiveCashStats] = useState(null);

  // 确认抽屉
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [confirmNote, setConfirmNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const [searchTerm, setSearchTerm] = useState('');

  // 实时监听 SM 的 cashStats
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;
    const smRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${smId}`);
    const unsub = onSnapshot(smRef, snap => {
      if (snap.exists()) {
        setLiveCashStats(snap.data()?.teamLeader?.cashStats || {});
      }
    });
    return () => unsub();
  }, [orgId, eventId, smId]);

  // 实时监听待确认的 submissions
  useEffect(() => {
    if (!orgId || !eventId || !smId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ref = collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`);
      const q = query(
        ref,
        where('receivedBy', '==', smId),
        where('status', '==', 'pending'),
        orderBy('submittedAt', 'desc')
      );
      const unsub = onSnapshot(q, snapshot => {
        const list = [];
        snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
        setPendingSubmissions(list);
        setLoading(false);
      }, err => {
        console.error('[CollectCashPhone] 监听失败:', err);
        setLoading(false);
      });
      return () => unsub();
    } catch (err) {
      console.error('[CollectCashPhone] 设置监听失败:', err);
      setLoading(false);
    }
  }, [orgId, eventId, smId]);

  // 实时监听所有上交记录（历史 tab 用，含全部状态）
  // 不加 orderBy 避免需要额外的 Firestore 复合索引，改在 JS 排序
  useEffect(() => {
    if (!orgId || !eventId || !smId) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    try {
      const ref = collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`);
      const q = query(
        ref,
        where('receivedBy', '==', smId)
      );
      const unsub = onSnapshot(q, snapshot => {
        const list = [];
        snapshot.forEach(d => list.push({ id: d.id, ...d.data() }));
        // 按提交时间降序排列
        list.sort((a, b) => (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0));
        setAllSubmissions(list);
        setHistoryLoading(false);
      }, err => {
        console.error('[CollectCashPhone] 历史监听失败:', err);
        setHistoryLoading(false);
      });
      return () => unsub();
    } catch (err) {
      console.error('[CollectCashPhone] 历史监听设置失败:', err);
      setHistoryLoading(false);
    }
  }, [orgId, eventId, smId]);

  const cashStats = liveCashStats ?? userInfo?.teamLeader?.cashStats ?? {};
  const totalPending = pendingSubmissions.reduce((s, sub) => s + (sub.amount || 0), 0);

  const filterFn = (list) => {
    if (!searchTerm) return list;
    const term = searchTerm.toLowerCase();
    return list.filter(s =>
      s.submitterName?.toLowerCase().includes(term) ||
      s.submitterDepartment?.toLowerCase().includes(term) ||
      s.submissionNumber?.toLowerCase().includes(term)
    );
  };

  const displayed = filterFn(pendingSubmissions);
  const displayedHistory = filterFn(allSubmissions);

  const handleConfirm = async () => {
    if (!selectedSubmission) return;
    setConfirming(true);
    try {
      const confirmFunc = httpsCallable(functions, 'confirmCashSubmission');
      const result = await confirmFunc({
        orgId,
        eventId,
        submissionId: selectedSubmission.id,
        note: confirmNote
      });
      window.mybazaarShowToast?.(`✅ ${result.data.message}`);
      setSelectedSubmission(null);
      setConfirmNote('');
    } catch (err) {
      console.error('[CollectCashPhone] 确认失败:', err);
      window.mybazaarShowToast?.(`❌ 确认失败: ${err.message}`);
    } finally {
      setConfirming(false);
    }
  };

  const formatDate = (ts) => {
    if (!ts?.toDate) return '-';
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    }).format(ts.toDate());
  };

  if (loading) {
    return (
      <div style={styles.centered}><p style={{ color: '#6b7280' }}>加载数据中...</p></div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 顶部统计条 */}
      <div style={styles.statsBar}>
        <StatChip
          icon="⏳"
          label="待确认"
          value={`${pendingSubmissions.length} 笔`}
          color="#f59e0b"
        />
        <StatChip
          icon="💰"
          label="待确认金额"
          value={`RM ${totalPending.toLocaleString()}`}
          color="#ef4444"
        />
        <StatChip
          icon="🏦"
          label="持有现金"
          value={`RM ${(cashStats.cashOnHand || 0).toLocaleString()}`}
          color="#3b82f6"
        />
      </div>

      {/* Tab 切换 */}
      <div style={styles.tabBar}>
        <button
          style={{ ...styles.tabBtn, ...(activeTab === 'pending' ? styles.tabBtnActive : {}) }}
          onClick={() => { setActiveTab('pending'); setSearchTerm(''); }}
        >
          待确认
          {pendingSubmissions.length > 0 && (
            <span style={styles.tabBadge}>{pendingSubmissions.length}</span>
          )}
        </button>
        <button
          style={{ ...styles.tabBtn, ...(activeTab === 'history' ? styles.tabBtnActive : {}) }}
          onClick={() => { setActiveTab('history'); setSearchTerm(''); }}
        >
          上交记录
        </button>
      </div>

      {/* 搜索 */}
      <input
        type="text"
        placeholder="搜索姓名、班级或流水号..."
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        style={styles.searchInput}
      />

      {/* 待确认列表 */}
      {activeTab === 'pending' && (
        displayed.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>📭</div>
            <p>{searchTerm ? '没有符合的记录' : '暂无待确认现金'}</p>
            {!searchTerm && <p style={styles.emptyHint}>当卖家上交现金后，会在这里显示</p>}
          </div>
        ) : (
          <div style={styles.cardList}>
            {displayed.map(sub => (
              <SubmissionCard
                key={sub.id}
                submission={sub}
                formatDate={formatDate}
                onConfirm={() => {
                  setSelectedSubmission(sub);
                  setConfirmNote('');
                }}
              />
            ))}
          </div>
        )
      )}

      {/* 上交记录（历史）列表 */}
      {activeTab === 'history' && (
        historyLoading ? (
          <div style={styles.centered}><p style={{ color: '#6b7280' }}>加载记录中...</p></div>
        ) : displayedHistory.length === 0 ? (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>📋</div>
            <p>{searchTerm ? '没有符合的记录' : '暂无上交记录'}</p>
            {!searchTerm && <p style={styles.emptyHint}>卖家上交后，记录会显示在这里</p>}
          </div>
        ) : (
          <div style={styles.cardList}>
            {displayedHistory.map(sub => (
              <HistoryCard
                key={sub.id}
                submission={sub}
                formatDate={formatDate}
              />
            ))}
          </div>
        )
      )}

      {/* 确认抽屉 */}
      {selectedSubmission && (
        <ConfirmDrawer
          submission={selectedSubmission}
          note={confirmNote}
          onNoteChange={setConfirmNote}
          onConfirm={handleConfirm}
          onCancel={() => { setSelectedSubmission(null); setConfirmNote(''); }}
          confirming={confirming}
        />
      )}
    </div>
  );
};

// ===== 子组件 =====

const StatChip = ({ icon, label, value, color }) => (
  <div style={{ ...styles.statChip, borderTopColor: color }}>
    <div style={styles.statChipIcon}>{icon}</div>
    <div style={{ ...styles.statChipValue, color }}>{value}</div>
    <div style={styles.statChipLabel}>{label}</div>
  </div>
);

const STATUS_CONFIG = {
  pending:   { label: '待确认', color: '#f59e0b', bg: '#fef3c7' },
  confirmed: { label: '已确认', color: '#10b981', bg: '#d1fae5' },
  rejected:  { label: '已拒绝', color: '#ef4444', bg: '#fee2e2' },
};

const HistoryCard = ({ submission, formatDate }) => {
  const status = STATUS_CONFIG[submission.status] || { label: '未知', color: '#6b7280', bg: '#f3f4f6' };
  return (
    <div style={styles.card}>
      <div style={styles.cardTop}>
        <div style={{ flex: 1 }}>
          <div style={styles.submitterName}>{submission.submitterName || '未知'}</div>
          <div style={styles.submitterMeta}>
            {submission.submitterDepartment || '-'} &nbsp;|&nbsp; #{submission.submissionNumber || '-'}
          </div>
          <div style={styles.submitterDate}>{formatDate(submission.submittedAt)}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem' }}>
          <div style={{ ...styles.statusBadge, color: status.color, background: status.bg }}>
            {status.label}
          </div>
          <div style={styles.amountValue}>RM {(submission.amount || 0).toLocaleString()}</div>
        </div>
      </div>
      {submission.note && (
        <div style={styles.noteRow}>📝 {submission.note}</div>
      )}
      {submission.status === 'confirmed' && submission.confirmationNote && (
        <div style={{ ...styles.noteRow, color: '#065f46', background: '#d1fae5' }}>
          ✅ 确认备注: {submission.confirmationNote}
        </div>
      )}
    </div>
  );
};

const SubmissionCard = ({ submission, formatDate, onConfirm }) => (
  <div style={styles.card}>
    <div style={styles.cardTop}>
      <div>
        <div style={styles.submitterName}>{submission.submitterName || '未知'}</div>
        <div style={styles.submitterMeta}>
          {submission.submitterDepartment || '-'} &nbsp;|&nbsp; #{submission.submissionNumber || '-'}
        </div>
        <div style={styles.submitterDate}>{formatDate(submission.submittedAt)}</div>
      </div>
      <div style={styles.amountBlock}>
        <div style={styles.amountLabel}>金额</div>
        <div style={styles.amountValue}>RM {(submission.amount || 0).toLocaleString()}</div>
      </div>
    </div>
    {submission.note && (
      <div style={styles.noteRow}>备注: {submission.note}</div>
    )}
    <button style={styles.confirmBtn} onClick={onConfirm}>
      ✅ 确认收款
    </button>
  </div>
);

const ConfirmDrawer = ({ submission, note, onNoteChange, onConfirm, onCancel, confirming }) => (
  <>
    {/* 遮罩 */}
    <div style={styles.overlay} onClick={onCancel} />
    {/* 抽屉 */}
    <div style={styles.drawer}>
      <div style={styles.drawerHandle} />
      <h3 style={styles.drawerTitle}>确认收款</h3>

      <div style={styles.confirmInfo}>
        <InfoRow label="卖家" value={submission.submitterName || '-'} />
        <InfoRow label="班级" value={submission.submitterDepartment || '-'} />
        <InfoRow label="流水号" value={submission.submissionNumber || '-'} />
        <InfoRow
          label="金额"
          value={`RM ${(submission.amount || 0).toLocaleString()}`}
          valueColor="#ef4444"
          valueBold
        />
      </div>

      <div style={styles.inputGroup}>
        <label style={styles.drawerLabel}>确认备注（可选）</label>
        <textarea
          value={note}
          onChange={e => onNoteChange(e.target.value)}
          placeholder="例：已清点，现金无误"
          rows={2}
          style={styles.textarea}
        />
      </div>

      <div style={styles.drawerWarning}>
        ⚠️ 确认后，此笔现金将加入您的持有现金
      </div>

      <div style={styles.drawerButtons}>
        <button style={styles.cancelBtn} onClick={onCancel} disabled={confirming}>
          取消
        </button>
        <button
          style={{
            ...styles.submitBtn,
            opacity: confirming ? 0.6 : 1,
            cursor: confirming ? 'not-allowed' : 'pointer'
          }}
          onClick={onConfirm}
          disabled={confirming}
        >
          {confirming ? '确认中...' : '✅ 确认收款'}
        </button>
      </div>
    </div>
  </>
);

const InfoRow = ({ label, value, valueColor, valueBold }) => (
  <div style={styles.infoRow}>
    <span style={styles.infoLabel}>{label}</span>
    <span style={{
      ...styles.infoValue,
      ...(valueColor ? { color: valueColor } : {}),
      ...(valueBold ? { fontWeight: '800', fontSize: '1.125rem' } : {})
    }}>
      {value}
    </span>
  </div>
);

// ===== 样式 =====
const styles = {
  container: { paddingBottom: '1.5rem' },
  centered: { textAlign: 'center', padding: '3rem', color: '#6b7280' },

  statsBar: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: '0.625rem',
    marginBottom: '1rem'
  },
  statChip: {
    background: 'white',
    borderRadius: '10px',
    borderTop: '3px solid',
    padding: '0.75rem 0.5rem',
    textAlign: 'center',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  statChipIcon: { fontSize: '1.25rem', marginBottom: '0.25rem' },
  statChipValue: { fontSize: '0.875rem', fontWeight: '800', marginBottom: '0.2rem' },
  statChipLabel: { fontSize: '0.625rem', color: '#9ca3af' },

  searchInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    marginBottom: '0.875rem',
    boxSizing: 'border-box',
    outline: 'none'
  },

  tabBar: {
    display: 'flex',
    background: '#f3f4f6',
    borderRadius: '10px',
    padding: '3px',
    marginBottom: '0.875rem',
    gap: '3px',
  },
  tabBtn: {
    flex: 1,
    padding: '0.5rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    background: 'transparent',
    color: '#6b7280',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.375rem',
  },
  tabBtnActive: {
    background: 'white',
    color: '#1f2937',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  },
  tabBadge: {
    background: '#f59e0b',
    color: 'white',
    borderRadius: '999px',
    fontSize: '0.6875rem',
    fontWeight: '700',
    padding: '1px 6px',
  },
  statusBadge: {
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '700',
    padding: '2px 8px',
  },

  empty: { textAlign: 'center', padding: '3rem', color: '#9ca3af' },
  emptyIcon: { fontSize: '3rem', marginBottom: '0.75rem' },
  emptyHint: { fontSize: '0.8125rem', color: '#d1d5db', marginTop: '0.375rem' },

  cardList: { display: 'flex', flexDirection: 'column', gap: '0.875rem' },
  card: {
    background: 'white',
    border: '1.5px solid #e5e7eb',
    borderRadius: '14px',
    padding: '1rem',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)'
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '0.75rem'
  },
  submitterName: { fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginBottom: '0.25rem' },
  submitterMeta: { fontSize: '0.8125rem', color: '#6b7280', marginBottom: '0.2rem' },
  submitterDate: { fontSize: '0.75rem', color: '#9ca3af' },
  amountBlock: { textAlign: 'right' },
  amountLabel: { fontSize: '0.75rem', color: '#9ca3af', marginBottom: '0.25rem' },
  amountValue: { fontSize: '1.25rem', fontWeight: '800', color: '#ef4444' },
  noteRow: {
    fontSize: '0.8125rem',
    color: '#6b7280',
    background: '#f9fafb',
    padding: '0.5rem',
    borderRadius: '6px',
    marginBottom: '0.75rem'
  },
  confirmBtn: {
    width: '100%',
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontWeight: '700',
    cursor: 'pointer'
  },

  // 抽屉
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 200
  },
  drawer: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    background: 'white',
    borderRadius: '20px 20px 0 0',
    padding: '1rem 1.25rem 2rem',
    zIndex: 201,
    maxHeight: '85vh',
    overflowY: 'auto'
  },
  drawerHandle: {
    width: '40px',
    height: '4px',
    background: '#e5e7eb',
    borderRadius: '2px',
    margin: '0 auto 1rem'
  },
  drawerTitle: { fontSize: '1.125rem', fontWeight: '700', color: '#1f2937', margin: '0 0 1rem' },
  confirmInfo: {
    background: '#f9fafb',
    borderRadius: '10px',
    padding: '0.875rem',
    marginBottom: '1rem'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '0.5rem',
    marginBottom: '0.5rem',
    borderBottom: '1px solid #e5e7eb'
  },
  infoLabel: { fontSize: '0.875rem', color: '#6b7280', fontWeight: '500' },
  infoValue: { fontSize: '0.9375rem', color: '#1f2937', fontWeight: '600' },
  inputGroup: { marginBottom: '0.875rem' },
  drawerLabel: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.375rem'
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    resize: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    outline: 'none'
  },
  drawerWarning: {
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    color: '#92400e',
    padding: '0.625rem',
    borderRadius: '8px',
    fontSize: '0.8125rem',
    fontWeight: '500',
    marginBottom: '1rem',
    textAlign: 'center'
  },
  drawerButtons: { display: 'flex', gap: '0.75rem' },
  cancelBtn: {
    flex: 1,
    padding: '0.875rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#374151',
    cursor: 'pointer'
  },
  submitBtn: {
    flex: 2,
    padding: '0.875rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    fontWeight: '700',
    cursor: 'pointer'
  }
};

export default CollectCashPhone;
