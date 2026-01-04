/**
 * Direct Sale Component
 * Tab 2: 销售点数 - 直接转账到Customer账户（类似Seller）
 */

import React, { useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../config/firebase';
import TransactionPinDialog from '../common/TransactionPinDialog';
import './DirectSale.css';

const DirectSale = ({ 
  isActiveHours, 
  statistics, 
  onRefresh, 
  currentUser, 
  userProfile,
  organizationId,
  eventId,
  callFunction 
}) => {
  const [customerPhone, setCustomerPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // 交易密码对话框
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingSale, setPendingSale] = useState(null);

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 获取PointSeller可用点数
  const availablePoints = userProfile?.pointSeller?.availablePoints || 0;

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
      console.log('[DirectSale] 查找客户:', {
        phone: customerPhone.trim(),
        organizationId,
        eventId
      });

      // 查询客户
      const usersRef = collection(
        db,
        `organizations/${organizationId}/events/${eventId}/users`
      );

      const q = query(
        usersRef,
        where('basicInfo.phoneNumber', '==', customerPhone.trim())
      );

      const snapshot = await getDocs(q);

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

      const currentPoints = customerData.customer?.pointsAccount?.availablePoints || 0;

      console.log('[DirectSale] 找到客户:', {
        id: customerData.id,
        name: customerData.basicInfo?.chineseName || customerData.basicInfo?.englishName,
        currentPoints: currentPoints
      });

      setCustomer(customerData);
      setError(null);

    } catch (err) {
      console.error('[DirectSale] 查找客户失败:', err);

      if (err.code === 'permission-denied') {
        setError('权限不足，无法查询用户数据');
      } else if (err.message.includes('index')) {
        setError('数据库索引缺失，请联系管理员');
      } else {
        setError(`查找失败: ${err.message}`);
      }

      setCustomer(null);
    } finally {
      setLoading(false);
    }
  };

  // 处理销售按钮点击
  const handleSaleClick = () => {
    if (!customer || !amount) {
      setError('请完成所有字段');
      return;
    }

    const saleAmount = parseInt(amount);

    if (isNaN(saleAmount) || saleAmount <= 0) {
      setError('金额必须大于 0');
      return;
    }

    if (saleAmount > availablePoints) {
      setError(`您的点数库存不足！当前库存: ${availablePoints} 点`);
      return;
    }

    if (!isActiveHours) {
      setError('当前不在营业时间内（6:00 AM - 6:00 PM）');
      return;
    }

    // 显示交易密码对话框
    setPendingSale({
      customerId: customer.id,
      customerName: customer.basicInfo?.chineseName || customer.basicInfo?.englishName,
      amount: saleAmount
    });
    setShowPinDialog(true);
    setError(null);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, note) => {
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

      // 调用Cloud Function处理销售
      const result = await callFunction(
        'pointSellerDirectSale',
        {
          orgId,
          eventId: evtId,
          customerId: pendingSale.customerId,
          amount: pendingSale.amount,
          transactionPin: pin,
          note: note || ''
        },
        15000
      );

      if (result.data.success) {
        setSuccessMessage(
          `销售成功！金额: ${formatAmount(pendingSale.amount)}，客户获得 ${pendingSale.amount} 点`
        );

        // 重置表单
        setCustomerPhone('');
        setAmount('');
        setCustomer(null);
        setPendingSale(null);

        // 刷新统计
        onRefresh();
      }
    } catch (err) {
      console.error('销售失败:', err);
      setError('销售失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingSale(null);
  };

  // 处理 Enter 键
  const handlePhoneKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSearchCustomer();
    }
  };

  const handleAmountKeyPress = (e) => {
    if (e.key === 'Enter' && customer && amount) {
      handleSaleClick();
    }
  };

  return (
    <div className="direct-sale">
      <h2 className="section-title">🛒 销售点数</h2>

      {/* 显示 PointSeller 库存 */}
      <div className="seller-inventory">
        <div className="inventory-label">您的点数库存</div>
        <div className="inventory-amount">{availablePoints} 点</div>
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
              disabled={loading || !isActiveHours}
            />
            <button 
              onClick={handleSearchCustomer} 
              disabled={loading || !customerPhone.trim() || !isActiveHours}
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
                onChange={(e) => setAmount(e.target.value)}
                onKeyPress={handleAmountKeyPress}
                placeholder="100"
                min="1"
                max={availablePoints}
                disabled={loading || !isActiveHours}
              />
              <span className="input-suffix">点 = {formatAmount(amount || 0)}</span>
            </div>
            {amount && (
              <div className="balance-check">
                {parseInt(amount) <= availablePoints ? (
                  <span className="balance-ok">
                    ✓ 库存充足 (剩余 {availablePoints - parseInt(amount)} 点)
                  </span>
                ) : (
                  <span className="balance-insufficient">
                    ✗ 库存不足！您只有 {availablePoints} 点可销售
                  </span>
                )}
              </div>
            )}
            <small className="hint">
              客户支付 {formatAmount(amount || 0)} 现金，获得 {amount || 0} 点
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
        {customer && amount && (
          <button
            onClick={handleSaleClick}
            disabled={loading || parseInt(amount) > availablePoints || !isActiveHours}
            className="submit-button"
          >
            {loading ? '处理中...' : `确认销售 ${amount} 点 (收取 ${formatAmount(amount)})`}
          </button>
        )}

        {/* 提示信息 */}
        <div className="info-box">
          <p className="info-title">💡 操作说明</p>
          <ul className="info-list">
            <li>输入客户手机号查找客户</li>
            <li>输入销售点数金额</li>
            <li>点击"确认销售"按钮</li>
            <li>输入交易密码确认</li>
            <li>收取客户现金</li>
            <li>点数直接转入客户账户</li>
          </ul>
        </div>
      </div>

      {/* 交易密码对话框 */}
      {showPinDialog && pendingSale && (
        <TransactionPinDialog
          title="确认销售点数"
          message={`即将销售 ${pendingSale.amount} 点给客户 ${pendingSale.customerName}，收取现金 ${formatAmount(pendingSale.amount)}`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认销售"
        />
      )}
    </div>
  );
};

export default DirectSale;