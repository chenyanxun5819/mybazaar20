/**
 * CashSubmissionForm.jsx
 * 现金上交共用组件
 * 
 * 适用角色：
 * - PointSeller: 直接上交到 Cashier 池子
 * - Seller (教师/职员): 直接上交到 Cashier 池子
 * - Seller (学生): 上交到 SellerManager
 * - SellerManager: 上交到 Cashier 池子
 * 
 * 创建日期：2025-01-20
 */

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../config/firebase';
import TransactionPinDialog from '../../views/PointSellerDashboard/common/TransactionPinDialog';
import './CashSubmissionForm.css';

const CashSubmissionForm = ({ 
  userRole,           // 'pointSeller' | 'seller' | 'sellerManager'
  userType,           // 'student' | 'teacher' | 'staff' (只有 seller 需要)
  userId, 
  userName,
  organizationId, 
  eventId,
  onSubmitSuccess     // 回调函数
}) => {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [receiverId, setReceiverId] = useState(null);
  const [receiverName, setReceiverName] = useState('');
  const [sellerManagers, setSellerManagers] = useState([]);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // 判断是否需要选择 SellerManager
  const needSelectManager = userRole === 'seller' && userType === 'student';

  // 加载 SellerManager 列表（如果需要）
  useEffect(() => {
    if (!needSelectManager) return;
    
    const loadSellerManagers = async () => {
      try {
        const usersRef = collection(
          db,
          'organizations',
          organizationId,
          'events',
          eventId,
          'users'
        );

        const q = query(
          usersRef,
          where('roles', 'array-contains', 'sellerManager')
        );

        const snapshot = await getDocs(q);
        const managers = snapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().basicInfo?.chineseName || doc.data().basicInfo?.englishName || 'SellerManager',
          ...doc.data()
        }));

        setSellerManagers(managers);

        // 如果只有一个 SellerManager，自动选择
        if (managers.length === 1) {
          setReceiverId(managers[0].id);
          setReceiverName(managers[0].name);
        }
      } catch (err) {
        console.error('加载 SellerManager 失败:', err);
        setError('加载 SellerManager 失败: ' + err.message);
      }
    };

    loadSellerManagers();
  }, [needSelectManager, organizationId, eventId]);

  // 验证表单
  const validateForm = () => {
    if (!amount || parseFloat(amount) <= 0) {
      setError('请输入有效的上交金额');
      return false;
    }

    if (needSelectManager && !receiverId) {
      setError('请选择接收的 Seller Manager');
      return false;
    }

    return true;
  };

  // 打开交易密码对话框
  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!validateForm()) return;

    setShowPinDialog(true);
  };

  // 提交上交记录
  const handleConfirmSubmit = async (pin) => {
    setSubmitting(true);
    setError('');

    try {
      const createCashSubmission = httpsCallable(functions, 'createCashSubmission');

      const submissionData = {
        organizationId,
        eventId,
        submittedBy: userId,
        submitterName: userName,
        submitterRole: userRole,
        amount: parseFloat(amount),
        note: note || '',
        transactionPin: pin
      };

      // 如果是学生 Seller，添加 receivedBy
      if (needSelectManager) {
        submissionData.receivedBy = receiverId;
        submissionData.receiverName = receiverName;
        submissionData.receiverRole = 'sellerManager';
      } else {
        // 其他角色上交到待认领池子
        submissionData.receivedBy = null;
        submissionData.receiverName = null;
        submissionData.receiverRole = null;
      }

      console.log('提交上交记录:', submissionData);

      const result = await createCashSubmission(submissionData);

      console.log('上交成功:', result.data);

      // 显示成功消息
      const successMsg = needSelectManager
        ? `✅ 已提交 RM ${amount} 给 ${receiverName}`
        : `✅ 已提交 RM ${amount} 到收银台`;

      setSuccess(successMsg);
      setShowPinDialog(false);

      // 清空表单
      setAmount('');
      setNote('');
      setReceiverId(null);
      setReceiverName('');

      // 调用成功回调
      if (onSubmitSuccess) {
        onSubmitSuccess(result.data);
      }

      // 3秒后清除成功消息
      setTimeout(() => {
        setSuccess('');
      }, 3000);

    } catch (err) {
      console.error('提交失败:', err);
      
      let errorMessage = '提交失败: ';
      if (err.code === 'functions/permission-denied') {
        errorMessage += '密码错误或权限不足';
      } else if (err.code === 'functions/invalid-argument') {
        errorMessage += '参数错误';
      } else {
        errorMessage += err.message || '未知错误';
      }

      setError(errorMessage);
      setShowPinDialog(false);
    } finally {
      setSubmitting(false);
    }
  };

  // 获取标题
  const getTitle = () => {
    if (needSelectManager) {
      return '上交现金给 Seller Manager';
    }
    return '上交现金到收银台';
  };

  // 获取描述
  const getDescription = () => {
    if (needSelectManager) {
      return '学生 Seller 需要先将现金上交给 Seller Manager';
    }
    return '请输入上交金额，提交后将进入待认领池子，由 Cashier 确认收款';
  };

  return (
    <div className="cash-submission-form">
      {/* 标题和描述 */}
      <div className="form-header">
        <h2>{getTitle()}</h2>
        <p className="form-description">{getDescription()}</p>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="alert alert-error">
          <span className="alert-icon">⚠️</span>
          <span className="alert-message">{error}</span>
          <button className="alert-close" onClick={() => setError('')}>×</button>
        </div>
      )}

      {/* 成功提示 */}
      {success && (
        <div className="alert alert-success">
          <span className="alert-icon">✅</span>
          <span className="alert-message">{success}</span>
        </div>
      )}

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="submission-form">
        {/* 上交金额 */}
        <div className="form-group">
          <label htmlFor="amount">
            上交金额 <span className="required">*</span>
          </label>
          <div className="input-with-prefix">
            <span className="input-prefix">RM</span>
            <input
              id="amount"
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
        </div>

        {/* 选择 SellerManager（仅学生 Seller） */}
        {needSelectManager && (
          <div className="form-group">
            <label htmlFor="manager">
              选择 Seller Manager <span className="required">*</span>
            </label>
            {sellerManagers.length === 0 ? (
              <div className="loading-state">
                <div className="spinner"></div>
                <span>加载中...</span>
              </div>
            ) : (
              <select
                id="manager"
                value={receiverId || ''}
                onChange={(e) => {
                  const manager = sellerManagers.find(m => m.id === e.target.value);
                  setReceiverId(e.target.value);
                  setReceiverName(manager?.name || '');
                }}
                required
              >
                <option value="">-- 请选择 --</option>
                {sellerManagers.map(manager => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* 备注 */}
        <div className="form-group">
          <label htmlFor="note">备注（可选）</label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="输入备注信息"
            rows="3"
          />
        </div>

        {/* 提交按钮 */}
        <button 
          type="submit" 
          className="submit-button"
          disabled={submitting}
        >
          {submitting ? '提交中...' : '提交上交'}
        </button>
      </form>

      {/* 交易密码对话框 */}
      {showPinDialog && (
        <TransactionPinDialog
          isOpen={showPinDialog}
          onClose={() => setShowPinDialog(false)}
          onSubmit={handleConfirmSubmit}
          title="验证交易密码"
          description={`确认上交 RM ${amount}`}
          loading={submitting}
        />
      )}
    </div>
  );
};

export default CashSubmissionForm;
