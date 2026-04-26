import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../../../config/firebase';

/**
 * SubmitCashPhone
 * 手机版上交现金（teamLeader → Cashier）
 */
const SubmitCashPhone = ({ userInfo }) => {
  const orgId = userInfo?.organizationId?.replace('organization_', '') || '';
  const eventId = userInfo?.eventId?.replace('event_', '') || '';
  const smId = userInfo?.userId;

  const [cashOnHand, setCashOnHand] = useState(0);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAmount, setSubmitAmount] = useState('');
  const [submitNote, setSubmitNote] = useState('');

  // 实时监听 SM 手上现金
  useEffect(() => {
    if (!orgId || !eventId || !smId) return;
    const smRef = doc(db, `organizations/${orgId}/events/${eventId}/users/${smId}`);
    const unsub = onSnapshot(smRef, snap => {
      if (snap.exists()) {
        const data = snap.data();
        const cash =
          data?.teamLeader?.cashStats?.cashOnHand ??
          data?.teamLeader?.cashOnHand ??
          0;
        setCashOnHand(cash);
      }
    });
    return () => unsub();
  }, [orgId, eventId, smId]);

  // 实时监听上交历史
  useEffect(() => {
    if (!orgId || !eventId || !smId) { setLoading(false); return; }
    try {
      const q = query(
        collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`),
        where('submittedBy', '==', smId),
        where('submitterRole', '==', 'teamLeader'),
        orderBy('submittedAt', 'desc')
      );
      const unsub = onSnapshot(q, snap => {
        const list = [];
        snap.forEach(d => list.push({ id: d.id, ...d.data() }));
        setSubmissions(list);
        setLoading(false);
      }, () => setLoading(false));
      return () => unsub();
    } catch { setLoading(false); }
  }, [orgId, eventId, smId]);

  const summaryStats = useMemo(() => {
    const totalSubmitted = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);
    const pending = submissions.filter(s => s.status === 'pending');
    const confirmed = submissions.filter(s => s.status === 'confirmed');
    return {
      totalSubmitted,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, s) => sum + (s.amount || 0), 0),
      confirmedCount: confirmed.length,
      confirmedAmount: confirmed.reduce((sum, s) => sum + (s.amount || 0), 0),
    };
  }, [submissions]);

  const handleSubmit = async () => {
    const amount = parseFloat(submitAmount);
    if (!amount || amount <= 0) { window.mybazaarShowToast?.('请输入有效金额'); return; }
    if (amount > cashOnHand) { window.mybazaarShowToast?.(`金额不能超过手上现金 RM ${cashOnHand}`); return; }
    setSubmitting(true);
    try {
      const submitToFinance = httpsCallable(functions, 'submitCashToFinance');
      await submitToFinance({ orgId, eventId, amount, note: submitNote });
      window.mybazaarShowToast?.(`✅ 已上交 RM ${amount} 至财务`);
      setSubmitAmount('');
      setSubmitNote('');
      setShowModal(false);
    } catch (err) {
      window.mybazaarShowToast?.('上交失败: ' + (err.message || '未知错误'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  if (loading) return (
    <div style={s.centered}><p style={{ color: '#6b7280' }}>加载中...</p></div>
  );

  return (
    <div style={s.container}>
      {/* 统计卡片 */}
      <div style={s.summaryWrapper}>
        <div style={s.summaryCard}>
          <div style={s.summaryHeaderRow}>
            <div style={s.summaryLeftCol}>
              <div style={s.summaryLabel}>手上现金</div>
              {cashOnHand > 0 && (
                <div style={s.reminderBoxSmall}>- 记得及时上交至财务</div>
              )}
            </div>
            <div style={s.summaryRightCol}>
              <div style={s.amountButtonRow}>
                <div style={s.summaryAmount}>RM {cashOnHand.toLocaleString()}</div>
                <button
                  style={{ ...s.submitButton, opacity: cashOnHand <= 0 ? 0.5 : 1 }}
                  onClick={() => cashOnHand > 0 ? setShowModal(true) : window.mybazaarShowToast?.('暂无可上交现金')}
                  disabled={cashOnHand <= 0}
                >
                  {cashOnHand > 0 ? '立即上交' : '暂无现金'}
                </button>
              </div>
            </div>
          </div>

          <div style={s.summaryStats}>
            <div style={s.summaryStatItem}>
              <span style={s.summaryStatValue}>{summaryStats.pendingCount} 笔</span>
              <span style={s.summaryStatLabel}>待确认笔数</span>
              <span style={s.summaryStatAmt}>RM {summaryStats.pendingAmount.toLocaleString()}</span>
            </div>
            <div style={s.summaryStatDivider} />
            <div style={s.summaryStatItem}>
              <span style={s.summaryStatValue}>{summaryStats.confirmedCount} 笔</span>
              <span style={s.summaryStatLabel}>已确认笔数</span>
              <span style={s.summaryStatAmt}>RM {summaryStats.confirmedAmount.toLocaleString()}</span>
            </div>
            <div style={s.summaryStatDivider} />
            <div style={s.summaryStatItem}>
              <span style={s.summaryStatValue}>RM {summaryStats.totalSubmitted.toLocaleString()}</span>
              <span style={s.summaryStatLabel}>累计上交</span>
            </div>
          </div>
        </div>
      </div>

      {/* 上交历史 */}
      <h2 style={s.sectionTitle}>📋 上交历史</h2>
      {submissions.length === 0 ? (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>📭</div>
          <p>暂无上交记录</p>
        </div>
      ) : (
        <div style={s.list}>
          {submissions.map(sub => {
            const statusMap = {
              pending: { label: '待确认', color: '#3b82f6' },
              confirmed: { label: '已确认', color: '#10b981' },
              rejected: { label: '已拒绝', color: '#ef4444' },
            };
            const st = statusMap[sub.status] || { label: '未知', color: '#6b7280' };
            return (
              <div key={sub.id} style={s.card}>
                <div style={s.cardHeader}>
                  <div>
                    <div style={s.cardTitle}>上交 #{sub.submissionNumber || sub.id.slice(0, 8)}</div>
                    <div style={s.cardDate}>{formatDate(sub.submittedAt)}</div>
                  </div>
                  <div style={{ ...s.statusBadge, background: st.color }}>{st.label}</div>
                </div>
                <div style={s.cardRow}><span>金额</span><strong>RM {(sub.amount || 0).toLocaleString()}</strong></div>
                <div style={s.cardRow}><span>上交对象</span><strong>Cashier</strong></div>
                {sub.note && <div style={s.noteBox}>📝 {sub.note}</div>}
                {sub.status === 'confirmed' && sub.confirmationNote && (
                  <div style={s.confirmedNote}>✅ 确认备注: {sub.confirmationNote}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 上交模态框 */}
      {showModal && (
        <div style={s.overlay} onClick={() => setShowModal(false)}>
          <div style={s.modal} onClick={e => e.stopPropagation()}>
            <div style={s.modalHeader}>
              <h3 style={{ margin: 0 }}>上交现金至财务</h3>
              <button style={s.closeBtn} onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div style={s.modalBody}>
              <div style={s.infoBanner}>💰 上交对象：Cashier 待认领池</div>
              <div style={s.formGroup}>
                <label style={s.label}>上交金额 *</label>
                <div style={s.amountRow}>
                  <span style={s.currency}>RM</span>
                  <input
                    type="number"
                    value={submitAmount}
                    onChange={e => setSubmitAmount(e.target.value)}
                    placeholder="0.00"
                    style={s.amountInput}
                    min="0"
                    max={cashOnHand}
                    step="0.01"
                    disabled={submitting}
                  />
                </div>
                <div style={s.hint}>手上现金: RM {cashOnHand.toLocaleString()}</div>
              </div>
              <div style={s.formGroup}>
                <label style={s.label}>备注（可选）</label>
                <textarea
                  value={submitNote}
                  onChange={e => setSubmitNote(e.target.value)}
                  placeholder="例如：第一周收款现金"
                  style={s.textarea}
                  rows={3}
                  disabled={submitting}
                />
              </div>
              <div style={s.warningBox}>⚠️ 请确认金额正确，上交后不可撤销</div>
            </div>
            <div style={s.modalFooter}>
              <button style={s.cancelBtn} onClick={() => setShowModal(false)} disabled={submitting}>取消</button>
              <button
                style={{ ...s.confirmBtn, opacity: (!submitAmount || parseFloat(submitAmount) <= 0 || submitting) ? 0.5 : 1 }}
                onClick={handleSubmit}
                disabled={submitting || !submitAmount || parseFloat(submitAmount) <= 0}
              >
                {submitting ? '提交中...' : '✅ 确认上交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const s = {
  container: { paddingBottom: '1rem' },
  centered: { textAlign: 'center', padding: '3rem' },

  summaryWrapper: { width: '100%', marginBottom: '1.5rem' },
  summaryCard: { padding: '1.25rem 0.65rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(33,150,243,0.3)', color: '#fff', background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)' },
  summaryHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.2)', gap: '0.5rem' },
  summaryLeftCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem', flex: '0 0 33%' },
  summaryRightCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-end', gap: '0.2rem', flex: '0 0 67%' },
  amountButtonRow: { display: 'flex', alignItems: 'center', gap: '0.75rem' },
  summaryLabel: { fontSize: '0.9rem', opacity: 0.9, fontWeight: 500 },
  reminderBoxSmall: { fontSize: '0.75rem', opacity: 0.8, fontStyle: 'italic' },
  summaryAmount: { fontSize: '1.6rem', fontWeight: 700 },
  submitButton: { padding: '0.5rem 1.2rem', background: 'white', color: '#667eea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', transform: 'scale(0.8)' },
  summaryStats: { display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'nowrap' },
  summaryStatItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 150px', textAlign: 'center' },
  summaryStatValue: { fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' },
  summaryStatLabel: { fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.5rem' },
  summaryStatAmt: { fontSize: '0.9rem', fontWeight: 500 },
  summaryStatDivider: { width: '1px', backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'stretch', margin: '0 0.5rem' },

  sectionTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1rem' },
  list: { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  card: { background: '#fafafa', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '1rem' },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem', gap: '0.5rem' },
  cardTitle: { fontSize: '0.9rem', fontWeight: 700, color: '#1f2937' },
  cardDate: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.2rem' },
  statusBadge: { padding: '0.3rem 0.75rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600, color: 'white', whiteSpace: 'nowrap' },
  cardRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#374151', marginBottom: '0.25rem' },
  noteBox: { marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#f3f4f6', borderRadius: '8px', fontSize: '0.75rem', color: '#374151' },
  confirmedNote: { marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#d1fae5', borderRadius: '8px', fontSize: '0.75rem', color: '#065f46' },
  emptyState: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  emptyIcon: { fontSize: '4rem', marginBottom: '1rem' },

  overlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modal: { background: 'white', borderRadius: '12px', width: '100%', maxWidth: '480px', maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { padding: '1.25rem', borderBottom: '2px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  closeBtn: { background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#6b7280' },
  modalBody: { padding: '1.25rem' },
  infoBanner: { padding: '0.75rem 1rem', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.875rem', color: '#1e40af' },
  formGroup: { marginBottom: '1.25rem' },
  label: { display: 'block', fontSize: '0.875rem', fontWeight: 600, color: '#374151', marginBottom: '0.4rem' },
  amountRow: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  currency: { fontSize: '1rem', fontWeight: 600, color: '#6b7280' },
  amountInput: { flex: 1, padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem', fontWeight: 600 },
  hint: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' },
  textarea: { width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  warningBox: { padding: '0.75rem 1rem', background: '#fef3c7', border: '2px solid #fbbf24', color: '#92400e', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 500 },
  modalFooter: { padding: '1.25rem', borderTop: '2px solid #e5e7eb', display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' },
  cancelBtn: { padding: '0.6rem 1.25rem', background: 'white', border: '2px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, color: '#374151' },
  confirmBtn: { padding: '0.6rem 1.25rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 },
};

export default SubmitCashPhone;
