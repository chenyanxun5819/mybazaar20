import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../../../config/firebase';
import { safeFetch } from '../../../../services/safeFetch';

/**
 * AllocatePointsPhone - 手机版分配点数
 *
 * Team Leader 销售点数给 Customer（收现金）
 * - 直接从 Firestore 查询 customer
 * - 读取 customer.pointsAccount.availablePoints（新模型）
 * - 调用 /api/allocatePointsByteamLeader
 */
const AllocatePointsPhone = ({
  userInfo,
  selectedCustomer,
  onSelectCustomer,
  organizationId,
  eventId,
  maxPerAllocation = 100,
  onClose
}) => {
  const orgId = userInfo?.organizationId;
  const teamLeaderId = userInfo?.userId;
  const managedDepartments = userInfo?.managedDepartments || [];

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // 加载 Customers 数据
  useEffect(() => {
    if (!orgId || !eventId || !Array.isArray(managedDepartments) || managedDepartments.length === 0) {
      setCustomers([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const usersRef = collection(db, `organizations/${orgId}/events/${eventId}/users`);
    const customerQuery = query(
      usersRef,
      where('roles', 'array-contains', 'customer')
    );

    const unsubscribe = onSnapshot(
      customerQuery,
      (snapshot) => {
        const list = snapshot.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data()
          }))
          .filter(c => managedDepartments.includes(c.identityInfo?.department || ''));

        setCustomers(list);
        setLoading(false);
      },
      (err) => {
        console.error('[AllocatePointsPhone] 加载失败:', err);
        setCustomers([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [orgId, eventId, managedDepartments]);

  const quickAmounts = [10, 20, 50, 100, 200, 500].filter(a => a <= maxPerAllocation);

  const filteredCustomers = (customers || []).filter(c => {
    const name = (c.basicInfo?.chineseName || '') + (c.basicInfo?.englishName || '');
    const dept = c.identityInfo?.department || '';
    const term = searchTerm.toLowerCase();
    return name.toLowerCase().includes(term) || dept.toLowerCase().includes(term);
  });

  // 处理销售
  const handleSubmit = async () => {
    if (!selectedCustomer) {
      setError('请先选择一位学生');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效点数');
      return;
    }
    const pts = parseFloat(amount);
    if (isNaN(pts)) {
      setError('点数必须是数字');
      return;
    }
    if (pts > maxPerAllocation) {
      setError(`单次最多 ${maxPerAllocation} 点`);
      return;
    }

    setSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const user = auth.currentUser;
      if (!user) throw new Error('未登录，请重新登录');
      const token = await user.getIdToken();

      const response = await safeFetch('/api/allocatePointsByteamLeader', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          recipientId: selectedCustomer.id,
          points: pts,
          allocationType: 'personal',
          notes: notes || ''
        })
      });

      // 先检查响应状态
      if (!response.ok) {
        // 尝试解析错误信息
        let errorMsg = `HTTP ${response.status}: 销售失败`;
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorData.message || errorMsg;
        } catch (parseErr) {
          // 如果响应不是 JSON，使用状态码信息
          console.warn('[AllocatePointsPhone] 无法解析错误响应:', response.status, response.statusText);
        }
        throw new Error(errorMsg);
      }

      // 解析成功响应
      let result;
      try {
        result = await response.json();
      } catch (parseErr) {
        console.error('[AllocatePointsPhone] 解析成功响应失败:', parseErr);
        throw new Error('服务器响应格式错误');
      }

      const customerName = selectedCustomer.basicInfo?.chineseName || selectedCustomer.basicInfo?.englishName;
      setSuccessMessage(`✅ 成功销售 ${pts} 点给 ${customerName}（收现金 RM ${pts}）`);
      setAmount('');
      setNotes('');

      setTimeout(() => {
        setSuccessMessage('');
        onSelectCustomer?.(null);
      }, 2500);
    } catch (err) {
      console.error('[AllocatePointsPhone] 销售失败:', err);
      setError(err.message || '销售失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  // 如果还没选 customer，显示选择列表
  if (!selectedCustomer) {
    return (
      <div style={styles.container}>
        <p style={styles.hint}>请选择一位学生来分配点数</p>

        <input
          type="text"
          placeholder="搜索姓名或班级..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        {loading ? (
          <div style={styles.centered}><p style={{ color: '#6b7280' }}>加载中...</p></div>
        ) : filteredCustomers.length === 0 ? (
          <div style={styles.centered}><p style={{ color: '#9ca3af' }}>没有符合的学生</p></div>
        ) : (
          <div style={styles.pickList}>
            {filteredCustomers.map(customer => {
              const name = customer.basicInfo?.chineseName || customer.basicInfo?.englishName || '未知';
              const dept = customer.identityInfo?.department || '-';
              const availablePoints = customer.customer?.pointsAccount?.availablePoints || 0;
              return (
                <button
                  key={customer.id}
                  style={styles.pickItem}
                  onClick={() => { onSelectCustomer?.(customer); setSearchTerm(''); }}
                >
                  <div style={styles.pickAvatar}>
                    {(name[0] || '?').toUpperCase()}
                  </div>
                  <div style={styles.pickInfo}>
                    <div style={styles.pickName}>{name}</div>
                    <div style={styles.pickDept}>{dept}</div>
                    <div style={styles.pickBalance}>可用: {availablePoints.toLocaleString()} 点</div>
                  </div>
                  <div style={styles.pickArrow}>›</div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // 已选 customer，显示分配表单
  const customerName = selectedCustomer.basicInfo?.chineseName || selectedCustomer.basicInfo?.englishName || '未知';
  const availablePoints = selectedCustomer.customer?.pointsAccount?.availablePoints || 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button style={styles.backButton} onClick={() => onSelectCustomer?.(null)}>‹ 返回</button>
        <h2 style={styles.headerTitle}>分配点数</h2>
      </div>

      <div style={styles.customerCard}>
        <div style={styles.customerName}>{customerName}</div>
        <div style={styles.customerInfo}>
          学号: {selectedCustomer.identityInfo?.identityId || '-'}
        </div>
        <div style={styles.customerBalance}>
          当前可用: <strong>{availablePoints.toLocaleString()} 点</strong>
        </div>
      </div>

      {error && <div style={styles.errorBox}>{error}</div>}
      {successMessage && <div style={styles.successBox}>{successMessage}</div>}

      <div style={styles.form}>
        <label style={styles.label}>分配点数</label>
        <input
          type="number"
          placeholder="输入点数"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          style={styles.input}
          min="1"
          max={maxPerAllocation}
          disabled={submitting}
        />

        <div style={styles.quickButtons}>
          {quickAmounts.map(amt => (
            <button
              key={amt}
              style={{
                ...styles.quickBtn,
                ...(amount === amt.toString() ? styles.quickBtnActive : {})
              }}
              onClick={() => setAmount(amt.toString())}
              disabled={submitting}
            >
              {amt}
            </button>
          ))}
        </div>

        <label style={styles.label}>备注（可选）</label>
        <textarea
          placeholder="输入备注..."
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={styles.textarea}
          disabled={submitting}
        />

        <div style={styles.actionButtons}>
          <button
            style={styles.cancelButton}
            onClick={() => onSelectCustomer?.(null)}
            disabled={submitting}
          >
            取消
          </button>
          <button
            style={{...styles.submitButton, opacity: submitting ? 0.5 : 1}}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? '处理中...' : `确认销售 ${amount || 0} 点`}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    paddingBottom: '1.5rem'
  },
  centered: {
    textAlign: 'center',
    padding: '2rem',
    color: '#6b7280'
  },
  hint: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.75rem',
    textAlign: 'center'
  },
  searchInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '10px',
    fontSize: '0.9375rem',
    marginBottom: '0.75rem',
    boxSizing: 'border-box',
    outline: 'none'
  },
  pickList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.625rem'
  },
  pickItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    background: 'white',
    border: '1.5px solid #e5e7eb',
    borderRadius: '12px',
    padding: '0.875rem',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%'
  },
  pickAvatar: {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.125rem',
    fontWeight: 'bold',
    flexShrink: 0
  },
  pickInfo: {
    flex: 1
  },
  pickName: {
    fontSize: '0.9375rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.2rem'
  },
  pickDept: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  pickBalance: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.1rem'
  },
  pickArrow: {
    fontSize: '1.25rem',
    color: '#d1d5db'
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    marginBottom: '1rem'
  },
  backButton: {
    padding: '0.5rem 0.75rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1.25rem',
    color: '#374151'
  },
  headerTitle: {
    margin: 0,
    fontSize: '1.125rem',
    fontWeight: '700',
    color: '#1f2937',
    flex: 1
  },

  customerCard: {
    background: '#f0f9ff',
    border: '1.5px solid #bfdbfe',
    borderRadius: '12px',
    padding: '0.875rem',
    marginBottom: '1rem'
  },
  customerName: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  customerInfo: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  customerBalance: {
    fontSize: '0.875rem',
    color: '#1f2937'
  },

  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  input: {
    padding: '0.75rem 1rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none'
  },
  quickButtons: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.5rem',
    marginBottom: '0.5rem'
  },
  quickBtn: {
    padding: '0.5rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    background: 'white',
    fontSize: '0.8125rem',
    fontWeight: '600',
    cursor: 'pointer',
    color: '#6b7280',
    transition: 'all 0.2s'
  },
  quickBtnActive: {
    background: '#dbeafe',
    borderColor: '#3b82f6',
    color: '#1e40af'
  },
  textarea: {
    padding: '0.75rem 1rem',
    border: '1.5px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    outline: 'none',
    minHeight: '60px',
    resize: 'vertical'
  },

  errorBox: {
    padding: '0.75rem 1rem',
    background: '#fee2e2',
    border: '1px solid #fca5a5',
    borderRadius: '8px',
    color: '#7f1d1d',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  successBox: {
    padding: '0.75rem 1rem',
    background: '#dcfce7',
    border: '1px solid #86efac',
    borderRadius: '8px',
    color: '#166534',
    fontSize: '0.875rem',
    fontWeight: '500'
  },

  actionButtons: {
    display: 'flex',
    gap: '0.75rem'
  },
  cancelButton: {
    flex: 1,
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280'
  },
  submitButton: {
    flex: 1,
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: 'white'
  }
};

export default AllocatePointsPhone;
