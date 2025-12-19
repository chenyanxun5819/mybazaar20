import React, { useState } from 'react';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  setDoc,
  updateDoc,
  increment, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../../../config/firebase';
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
  const handleSubmitSale = async () => {
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

    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      console.log('[MakeSale] 开始销售:', {
        sellerId: userProfile.userId,
        sellerBalance: sellerBalance,
        customerId: customer.id,
        saleAmount: saleAmount
      });

      // 1. 创建交易记录（單步提交）
      const transactionRef = doc(
        collection(
          db,
          `organizations/${organizationId}/events/${eventId}/transactions`
        )
      );
      console.log('[MakeSale] 將寫入 transaction 路徑:', transactionRef.path);
      
      const transactionData = {
        transactionId: transactionRef.id,
        organizationId: organizationId,
        eventId: eventId,
        type: 'seller_to_customer',
        sellerId: userProfile.userId,
        sellerName: userProfile.basicInfo?.chineseName || userProfile.basicInfo?.englishName || 'Unknown',
        customerId: customer.id,
        customerName: customer.basicInfo?.chineseName || customer.basicInfo?.englishName || 'Unknown',
        points: saleAmount,
        amount: saleAmount,
        paymentMethod: 'cash',
        status: 'completed',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp()
      };
      
      try {
        await setDoc(transactionRef, transactionData);
        console.log('[MakeSale] ✅ 交易寫入成功');
      } catch (e) {
        console.error('[MakeSale] ❌ 交易寫入失敗:', e);
        setError('交易建立失敗: ' + (e.message || '未知錯誤'));
        setLoading(false);
        return;
      }

      // 2. 🔥 更新 Seller（减少点数库存，增加现金收入）
      const sellerRef = doc(
        db,
        `organizations/${organizationId}/events/${eventId}/users/${userProfile.userId}`
      );
      console.log('[MakeSale] 將更新 seller 路徑:', sellerRef.path);
      
      const sellerUpdate = {
        'seller.availablePoints': increment(-saleAmount),
        'seller.totalPointsSold': increment(saleAmount),
        'seller.totalRevenue': increment(saleAmount),
        'seller.totalCashCollected': increment(saleAmount),
        'seller.pendingCollection': increment(saleAmount),
        'updatedAt': serverTimestamp()
      };
      
      try {
        await updateDoc(sellerRef, sellerUpdate);
        console.log('[MakeSale] ✅ Seller 更新成功');
      } catch (e) {
        console.error('[MakeSale] ❌ Seller 更新失敗:', e);
        setError('更新 Seller 失敗: ' + (e.message || '未知錯誤'));
        setLoading(false);
        return;
      }

      // 3. ✅ 修复：更新 Customer（使用新架构）
      const customerRef = doc(
        db,
        `organizations/${organizationId}/events/${eventId}/users/${customer.id}`
      );
      console.log('[MakeSale] 將更新 customer 路徑:', customerRef.path);
      
      const customerUpdate = {
        // ✅ 新架构：嵌套在 pointsAccount 下
        'customer.pointsAccount.availablePoints': increment(saleAmount),
        'customer.pointsAccount.totalReceived': increment(saleAmount),
        'updatedAt': serverTimestamp()
      };
      
      try {
        await updateDoc(customerRef, customerUpdate);
        console.log('[MakeSale] ✅ Customer 更新成功');
      } catch (e) {
        console.error('[MakeSale] ❌ Customer 更新失敗:', e);
        setError('更新 Customer 失敗: ' + (e.message || '未知錯誤'));
        setLoading(false);
        return;
      }
      
      console.log('[MakeSale] ✅ 銷售三步驟全部成功');

      // 成功提示
      setSuccessMessage(`销售成功！金额: RM ${saleAmount}，客户获得 ${saleAmount} 点`);

      // 重置表单
      setCustomerPhone('');
      setAmount('');
      setCustomer(null);

    } catch (err) {
      console.error('[MakeSale] 销售失败:', err);
      console.error('[MakeSale] 错误详情:', {
        code: err.code,
        message: err.message
      });

      if (err.code === 'permission-denied') {
        setError('权限不足，无法完成销售。请联系管理员检查 Security Rules。');
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
                onChange={(e) => setAmount(e.target.value)}
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
        {customer && amount && (
          <button
            onClick={handleSubmitSale}
            disabled={loading || parseInt(amount) > sellerBalance}
            className="submit-button"
          >
            {loading ? '处理中...' : `确认销售 ${amount} 点 (收取 RM ${amount})`}
          </button>
        )}
      </div>
    </div>
  );
}

export default MakeSale;