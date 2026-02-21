import React, { useState } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs
} from 'firebase/firestore';
import { db, functions } from '../../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../../contexts/AuthContext';
import { useEvent } from '../../../contexts/EventContext';
import { useSellerStats } from '../hooks/useSellerStats';

function MakeSale() {
  const { userProfile } = useAuth();
  const { organizationId, eventId } = useEvent();
  const { stats: sellerStats, loading: statsLoading } = useSellerStats();
  const [customerPhone, setCustomerPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  const [showPinInput, setShowPinInput] = useState(false);
  const [transactionPin, setTransactionPin] = useState('');
  const [pinError, setPinError] = useState('');

  // 查找客户
  const handleSearchCustomer = async () => {
    if (!customerPhone.trim()) {
      setError('请输入客户手机号码');
      return;
    }

    if (!organizationId || !eventId) {
      setError('无法获取组织或活动信息，请刷新页面');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      console.log('[MakeSale] 查找客户:', {
        phone: customerPhone.trim(),
        organizationId,
        eventId,
        currentUserId: userProfile?.userId
      });

      // 查询客户（单条件查询 + 客户端过滤）
      const usersRef = collection(
        db,
        `organizations/${organizationId}/events/${eventId}/users`
      );

      const q = query(
        usersRef,
        where('basicInfo.phoneNumber', '==', customerPhone.trim())
      );

      console.log('[MakeSale] 执行查询...');
      const snapshot = await getDocs(q);
      console.log('[MakeSale] 查询结果:', snapshot.size, '个文档');

      if (snapshot.empty) {
        setError('找不到该手机号码的用户，请检查是否正确');
        setCustomer(null);
        return;
      }

      // 在客户端过滤 customer 角色
      const customerDocs = snapshot.docs.filter(doc => {
        const data = doc.data();
        return data.roles && data.roles.includes('customer');
      });

      console.log('[MakeSale] 过滤后的客户:', customerDocs.length, '个');

      if (customerDocs.length === 0) {
        setError('该用户不是客户角色，无法进行销售');
        setCustomer(null);
        return;
      }

      // 使用第一个匹配的客户
      const customerDoc = customerDocs[0];
      const customerData = {
        id: customerDoc.id,
        ...customerDoc.data()
      };

      // ✅ 修复：使用新架构读取点数
      const currentPoints = customerData.customer?.pointsAccount?.availablePoints || 0;

      console.log('[MakeSale] 找到客户:', {
        id: customerData.id,
        name: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName,
        currentPoints: currentPoints
      });

      setCustomer(customerData);
      setError(null);

    } catch (err) {
      console.error('[MakeSale] 查找客户失败:', err);
      console.error('[MakeSale] 错误详情:', {
        code: err.code,
        message: err.message,
        stack: err.stack
      });

      if (err.code === 'permission-denied') {
        setError('权限不足，无法查询用户数据。请联系管理员检查 Security Rules。');
      } else if (err.message.includes('index')) {
        setError('数据库索引缺失，请联系管理员创建必要的索引。');
      } else {
        setError(`查找失败: ${err.message}`);
      }

      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  // 提交销售
  const handleSubmitSale = () => {
    if (!customer || !amount) {
      setError('请完成所有字段');
      return;
    }

    if (!organizationId || !eventId || !userProfile?.userId) {
      setError('无法获取组织、活动或用户信息，请刷新页面');
      return;
    }

    const saleAmount = parseInt(amount);

    if (isNaN(saleAmount) || saleAmount <= 0) {
      setError('金额必须大于 0');
      return;
    }

    // 🔥 检查 Seller 的点数库存（使用实时数据）
    if (sellerBalance < saleAmount) {
      setError(`您的点数库存不足！当前库存: ${sellerBalance} 点`);
      return;
    }

    setPinError('');
    setTransactionPin('');
    setShowPinInput(true);
    setError(null);
  };

  const handleConfirmSaleWithPin = async () => {
    if (!customer || !amount) {
      setError('请完成所有字段');
      return;
    }

    if (!organizationId || !eventId || !userProfile?.userId) {
      setError('无法获取组织、活动或用户信息，请刷新页面');
      return;
    }

    const saleAmount = parseInt(amount, 10);

    if (isNaN(saleAmount) || saleAmount <= 0) {
      setError('金额必须大于 0');
      return;
    }

    if (sellerBalance < saleAmount) {
      setError(`您的点数库存不足！当前库存: ${sellerBalance} 点`);
      return;
    }

    if (!transactionPin || transactionPin.length !== 6) {
      setPinError('请输入6位交易密码');
      return;
    }

    if (!/^\d{6}$/.test(transactionPin)) {
      setPinError('交易密码必须是6位数字');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setPinError('');

    try {
      console.log('[MakeSale] 开始销售:', {
        sellerId: userProfile.userId,
        sellerBalance: sellerBalance,
        customerId: customer.id,
        saleAmount: saleAmount
      });

      const sellerDirectSale = httpsCallable(functions, 'sellerDirectSale');
      const result = await sellerDirectSale({
        orgId: organizationId,
        eventId,
        customerId: customer.id,
        amount: saleAmount,
        transactionPin
      });

      console.log('[MakeSale] ✅ 销售成功:', result.data);

      // 成功提示
      setSuccessMessage(`销售成功！金额: RM ${saleAmount}，客户获得 ${saleAmount} 点`);

      // 重置表单
      setCustomerPhone('');
      setAmount('');
      setCustomer(null);
      setShowPinInput(false);
      setTransactionPin('');
      setPinError('');

    } catch (err) {
      console.error('[MakeSale] 销售失败:', err);
      console.error('[MakeSale] 错误详情:', {
        code: err.code,
        message: err.message
      });

      if (err.code === 'functions/permission-denied' || err.code === 'permission-denied') {
        const message = err.message || '交易密码错误或权限不足';
        setPinError(message);
      } else if (err.code === 'functions/failed-precondition' || err.code === 'failed-precondition') {
        const message = err.message || '操作失败';
        if (message.includes('密码') || message.includes('锁定')) {
          setPinError(message);
        } else {
          setError(message);
        }
      } else {
        setError(`销售失败: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // 处理 Enter 键
  const handlePhoneKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearchCustomer();
    }
  };

  const handleAmountKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSubmitSale();
    }
  };

  // 🔥 从实时数据获取 Seller 的点数库存
  const sellerBalance = sellerStats?.availablePoints || 0;

  // 如果正在加载统计数据，显示加载状态
  if (statsLoading) {
    return (
      <div className="make-sale">
        <div className="loading-message">加载库存数据中...</div>
      </div>
    );
  }

  return (
    <div className="make-sale">
      <h2 className="section-title">🛒 销售点数</h2>

      {/* 显示 Seller 库存 */}
      <div className="seller-inventory">
        <div className="inventory-label">您的点数库存</div>
        <div className="inventory-amount">{sellerBalance} 点</div>
        <div className="inventory-hint">可销售给客户</div>
      </div>

      {/* 查找客户 */}
      <div className="form-section">
        <div className="form-group">
          <label htmlFor="customerPhone">客户手机号码</label>
          <div className="input-group">
            <input
              id="customerPhone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              onKeyPress={handlePhoneKeyPress}
              placeholder="60123456789"
              disabled={loading}
            />
            <button 
              onClick={handleSearchCustomer} 
              disabled={loading || !customerPhone.trim()}
              className="search-button"
            >
              {loading ? '查找中...' : '查找客户'}
            </button>
          </div>
          <small className="hint">马来西亚手机号（含国家代码60）</small>
        </div>

        {/* 显示客户信息 */}
        {customer && (
          <div className="customer-info success-box">
            <div className="customer-name">
              ✓ 找到客户: <strong>{customer.basicInfo?.chineseName || customer.basicInfo?.englishName}</strong>
            </div>
            <div className="customer-balance">
              {/* ✅ 修复：使用新架构显示点数 */}
              客户当前点数: <strong>{customer.customer?.pointsAccount?.availablePoints || 0}</strong> 点
            </div>
          </div>
        )}

        {/* 输入销售金额 */}
        {customer && (
          <div className="form-group">
            <label htmlFor="amount">销售金额 (点数)</label>
            <div className="amount-input-wrapper">
              <input
                id="amount"
                type="number"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setShowPinInput(false);
                  setTransactionPin('');
                  setPinError('');
                }}
                onKeyPress={handleAmountKeyPress}
                placeholder="100"
                min="1"
                max={sellerBalance}
                disabled={loading}
              />
              <span className="input-suffix">点 = RM {amount || 0}</span>
            </div>
            {amount && (
              <div className="balance-check">
                {parseInt(amount) <= sellerBalance ? (
                  <span className="balance-ok">
                    ✓ 库存充足 (剩余 {sellerBalance - parseInt(amount)} 点)
                  </span>
                ) : (
                  <span className="balance-insufficient">
                    ✗ 库存不足！您只有 {sellerBalance} 点可销售
                  </span>
                )}
              </div>
            )}
            <small className="hint">
              客户支付 RM {amount || 0} 现金，获得 {amount || 0} 点
            </small>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="error-message">
            ⚠️ {error}
          </div>
        )}

        {/* 成功提示 */}
        {successMessage && (
          <div className="success-message">
            ✓ {successMessage}
          </div>
        )}

        {/* 提交按钮 */}
        {customer && amount && !showPinInput && (
          <button
            onClick={handleSubmitSale}
            disabled={loading || parseInt(amount) > sellerBalance}
            className="submit-button"
          >
            {loading ? '处理中...' : `确认销售 ${amount} 点 (收取 RM ${amount})`}
          </button>
        )}

        {/* 交易密码输入页面（复制 CustomerPayment UI 风格） */}
        {customer && amount && showPinInput && (
          <div style={pinStyles.pinContainer}>
            <div style={pinStyles.pinCard}>
              <div style={pinStyles.pinIcon}>🔐</div>
              <h2 style={pinStyles.pinTitle}>请输入交易密码</h2>
              <p style={pinStyles.pinSubtitle}>
                向 {customer.basicInfo?.chineseName || customer.basicInfo?.englishName || '客户'} 销售 {amount} 点
              </p>

              <input
                type="password"
                inputMode="numeric"
                maxLength="6"
                value={transactionPin}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '');
                  setTransactionPin(value);
                  setPinError('');
                }}
                placeholder="请输入6位数字"
                style={{
                  ...pinStyles.pinInput,
                  ...(pinError ? pinStyles.inputError : {})
                }}
                autoFocus
                disabled={loading}
              />

              {pinError && <p style={pinStyles.errorText}>{pinError}</p>}

              <p style={pinStyles.pinHint}>
                交易密码是您在注册时设置的6位数字密码
              </p>

              <div style={pinStyles.pinActions}>
                <button
                  onClick={() => {
                    setShowPinInput(false);
                    setTransactionPin('');
                    setPinError('');
                  }}
                  style={{
                    ...pinStyles.button,
                    ...pinStyles.secondaryButton
                  }}
                  disabled={loading}
                >
                  返回修改金额
                </button>
                <button
                  onClick={handleConfirmSaleWithPin}
                  style={{
                    ...pinStyles.button,
                    ...pinStyles.primaryButton,
                    ...(loading ? pinStyles.buttonDisabled : {})
                  }}
                  disabled={loading || transactionPin.length !== 6}
                >
                  {loading ? '验证中...' : '确认销售'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const pinStyles = {
  pinContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '220px',
    marginTop: '1rem'
  },
  pinCard: {
    width: '100%',
    maxWidth: '380px',
    padding: '1.5rem',
    backgroundColor: '#fff',
    borderRadius: '12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    textAlign: 'center'
  },
  pinIcon: {
    fontSize: '2.5rem',
    marginBottom: '0.75rem'
  },
  pinTitle: {
    fontSize: '1.3rem',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 0.4rem 0'
  },
  pinSubtitle: {
    fontSize: '0.9rem',
    color: '#666',
    marginBottom: '1.5rem'
  },
  pinInput: {
    width: '100%',
    padding: '1.2rem',
    fontSize: '1.8rem',
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: '0.5rem',
    border: '2px solid #ddd',
    borderRadius: '8px',
    outline: 'none',
    marginBottom: '0.75rem',
    boxSizing: 'border-box'
  },
  pinHint: {
    fontSize: '0.8rem',
    color: '#999',
    marginBottom: '1.5rem'
  },
  pinActions: {
    display: 'flex',
    gap: '0.6rem'
  },
  button: {
    flex: 1,
    padding: '0.65rem',
    fontSize: '0.9rem',
    fontWeight: '600',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  primaryButton: {
    backgroundColor: '#2196F3',
    color: '#fff'
  },
  secondaryButton: {
    backgroundColor: '#fff',
    color: '#2196F3',
    border: '1px solid #2196F3'
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  inputError: {
    borderColor: '#f44336'
  },
  errorText: {
    margin: '0.2rem 0 0 0',
    fontSize: '0.75rem',
    color: '#f44336'
  }
};

export default MakeSale;

