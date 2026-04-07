/**
 * Direct Sale Component
 * Tab 2: 销售点数 - 直接转账到Customer账户（类似Seller）
 */

import React, { useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import TransactionPinDialog from '../common/TransactionPinDialog';
import paymentQrcodeIcon from '../../../assets/payment-qrcode.svg';
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

  // 清理电话号码（与 Firestore 存储格式一致：本地格式，不带 +60）
  const cleanPhoneNumber = (phone) => {
    if (!phone) return '';
    // 移除所有非数字字符
    let cleaned = phone.replace(/\D/g, '');
    // 如果以 60 开头，移除国家代码
    if (cleaned.startsWith('60')) {
      cleaned = '0' + cleaned.substring(2);
    }
    // 确保以 0 开头
    if (!cleaned.startsWith('0')) {
      cleaned = '0' + cleaned;
    }
    return cleaned;
  };

  // 单笔限额（PointSeller没有库存限制，但有单笔限额）
  const MAX_PER_TRANSACTION = 100;

  // 查找客户
  const handleSearchCustomer = async () => {
    if (!customerPhone.trim()) {
      setError('请输入客户手机号码');
      return;
    }

    // ✅ 使用 userProfile 中的真实文档 ID，而不是 orgCode/eventCode
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;

    if (!orgId || !evtId) {
      setError('无法获取组织或活动信息，请刷新页面');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      // 清理电话号码（与 Firestore 存储格式一致）
      const cleanedPhone = cleanPhoneNumber(customerPhone.trim());
      
      console.log('[DirectSale] 查找客户:', {
        originalPhone: customerPhone.trim(),
        cleanedPhone,
        organizationId: orgId,
        eventId: evtId,
        queryPath: `organizations/${orgId}/events/${evtId}/users`
      });

      // 查询客户
      const usersRef = collection(
        db,
        `organizations/${orgId}/events/${evtId}/users`
      );

      const q = query(
        usersRef,
        where('basicInfo.phoneNumber', '==', cleanedPhone)
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

    if (saleAmount > MAX_PER_TRANSACTION) {
      setError(`单笔销售不能超过 ${MAX_PER_TRANSACTION} 点`);
      return;
    }

    // ⚠️ 测试阶段：时间限制已禁用（isActiveHours 始终为 true）
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

      {/* ===== 今日直销统计 ===== */}
      <div className="inventory-summary">
        <div className="inventory-card">
          <div className="inventory-value">
            {statistics.todayStats?.mobileCount || 0}
          </div>
          <div className="inventory-label">今日直销笔数</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <div className="inventory-value">
            {statistics.todayStats?.mobilePoints || 0}
          </div>
          <div className="inventory-label">今日直销点数</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <div className="inventory-value">
            {formatAmount(statistics.todayStats?.mobileCash || 0)}
          </div>
          <div className="inventory-label">今日收现金</div>
        </div>
      </div>

      <small className="hint">可无限发出点数，单笔最多 {MAX_PER_TRANSACTION} 点</small>

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
                inputMode="numeric"
                pattern="[0-9]*"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                onKeyPress={handleAmountKeyPress}
                placeholder="100"
                min="1"
                max={MAX_PER_TRANSACTION}
                disabled={loading || !isActiveHours}
              />
              <span className="input-suffix">点 = {formatAmount(amount || 0)}</span>
            </div>
            {amount && (
              <div className="balance-check">
                {parseInt(amount) <= MAX_PER_TRANSACTION ? (
                  <span className="balance-ok">
                    ✓ 符合单笔限额（最多 {MAX_PER_TRANSACTION} 点）
                  </span>
                ) : (
                  <span className="balance-insufficient">
                    ✗ 超出单笔限额！单笔最多 {MAX_PER_TRANSACTION} 点
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
            disabled={loading || parseInt(amount) > MAX_PER_TRANSACTION || !isActiveHours}
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