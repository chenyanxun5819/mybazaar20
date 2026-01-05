/**
 * Issue Point Card Component
 * Tab 1: 发行点数卡 - 生成QR Code和卡号
 */

import React, { useState, useRef } from 'react';
import QRCode from 'qrcode';
import TransactionPinDialog from '../common/TransactionPinDialog';
import './IssuePointCard.css';

const IssuePointCard = ({ 
  isActiveHours, 
  statistics, 
  onRefresh, 
  currentUser, 
  userProfile,
  organizationId,
  eventId,
  callFunction 
}) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);
  
  // 交易密码对话框
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(null);
  
  // 已发行的点数卡
  const [issuedCard, setIssuedCard] = useState(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState(null);
  const qrCanvasRef = useRef(null);

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 单笔限额（PointSeller没有库存限制，但有单笔限额）
  const MAX_PER_TRANSACTION = 100;

  // 处理发行点数卡按钮点击
  const handleIssueClick = () => {
    // 验证
    if (!amount || isNaN(amount) || parseInt(amount) <= 0) {
      setError('请输入有效的金额');
      return;
    }

    if (parseInt(amount) > MAX_PER_TRANSACTION) {
      setError(`单笔发行不能超过 ${MAX_PER_TRANSACTION} 点`);
      return;
    }

    // ⚠️ 测试阶段：时间限制已禁用（isActiveHours 始终为 true）
    if (!isActiveHours) {
      setError('当前不在营业时间内（6:00 AM - 6:00 PM）');
      return;
    }

    // 显示交易密码对话框
    setPendingAmount(parseInt(amount));
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

      // 调用Cloud Function创建点数卡
      const result = await callFunction(
        'createPointCard',
        {
          orgId,
          eventId: evtId,
          amount: pendingAmount,
          cashReceived: pendingAmount,
          transactionPin: pin,
          note: note || ''
        },
        15000
      );

      if (result.data.success) {
        const cardData = result.data.data;
        
        // 生成QR Code
        const qrData = JSON.stringify({
          type: 'POINT_CARD_PAYMENT',
          version: '1.0',
          cardId: cardData.cardId,
          cardNumber: cardData.cardNumber,
          eventId: evtId,
          organizationId: orgId,
          generatedAt: new Date().toISOString()
        });

        const qrDataUrl = await QRCode.toDataURL(qrData, {
          width: 400,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF'
          }
        });

        setQrCodeDataUrl(qrDataUrl);
        setIssuedCard(cardData);
        setSuccessMessage(`✅ 点数卡发行成功！卡号: ${cardData.cardNumber}`);
        
        // 重置表单
        setAmount('');
        setPendingAmount(null);
        
        // 刷新统计
        onRefresh();
      }
    } catch (err) {
      console.error('发行点数卡失败:', err);
      setError('发行失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingAmount(null);
  };

  // 下载QR Code
  const handleDownloadQRCode = () => {
    if (!qrCodeDataUrl || !issuedCard) return;

    const link = document.createElement('a');
    link.download = `PointCard-${issuedCard.cardNumber}.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  // 清除已发行卡片（准备发行下一张）
  const handleClearCard = () => {
    setIssuedCard(null);
    setQrCodeDataUrl(null);
    setSuccessMessage(null);
    setError(null);
  };

  return (
    <div className="issue-point-card">
      <h2 className="section-title">🎫 发行点数卡</h2>

      {/* 库存统计 */}
      <div className="inventory-summary">
        <div className="inventory-card">
          <div className="inventory-label">今日已发行</div>
          <div className="inventory-value">
            {statistics.todayStats?.cardsIssued || 0} 张
          </div>
        </div>
        <div className="inventory-card">
          <div className="inventory-label">今日发行点数</div>
          <div className="inventory-value">
            {statistics.todayStats?.totalPointsIssued || 0} 点
          </div>
        </div>
        <div className="inventory-card">
          <div className="inventory-label">今日收现金</div>
          <div className="inventory-value">
            {formatAmount(statistics.todayStats?.totalCashReceived || 0)}
          </div>
        </div>
      </div>

      {/* 已发行的卡片显示 */}
      {issuedCard && qrCodeDataUrl && (
        <div className="issued-card-display">
          <div className="card-header">
            <h3>✅ 点数卡已发行</h3>
            <button className="clear-button" onClick={handleClearCard}>
              发行下一张
            </button>
          </div>

          <div className="card-details">
            <div className="card-info">
              <div className="info-row">
                <span className="info-label">卡号：</span>
                <span className="info-value card-number">{issuedCard.cardNumber}</span>
              </div>
              <div className="info-row">
                <span className="info-label">点数：</span>
                <span className="info-value">{issuedCard.balance?.initial || 0} 点</span>
              </div>
              <div className="info-row">
                <span className="info-label">现金：</span>
                <span className="info-value">{formatAmount(issuedCard.issuer?.cashReceived || 0)}</span>
              </div>
            </div>

            <div className="qr-code-display">
              <img src={qrCodeDataUrl} alt="点数卡QR Code" className="qr-code-image" />
              <p className="qr-hint">请交给客户此QR Code</p>
            </div>
          </div>

          <div className="card-actions">
            <button className="download-button" onClick={handleDownloadQRCode}>
              📥 下载QR Code
            </button>
            <button className="print-button" disabled title="打印功能开发中">
              🖨️ 打印点数卡
            </button>
          </div>

          <div className="reminder-box">
            <p className="reminder-icon">⚠️</p>
            <p className="reminder-text">
              请确认已收到客户 <strong>{formatAmount(issuedCard.issuer?.cashReceived || 0)}</strong> 现金后，
              再将此点数卡交给客户。
            </p>
          </div>
        </div>
      )}

      {/* 发行新卡表单 */}
      {!issuedCard && (
        <div className="issue-form">
          <div className="form-section">
            <div className="form-group">
              <label htmlFor="cardAmount">点数金额</label>
              <div className="amount-input-wrapper">
                <input
                  id="cardAmount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  min="1"
                  max={MAX_PER_TRANSACTION}
                  disabled={loading || !isActiveHours}
                />
                <span className="input-suffix">点 = {formatAmount(amount || 0)}</span>
              </div>
              <small className="hint">
                客户支付 {formatAmount(amount || 0)} 现金，获得点数卡 {amount || 0} 点（单笔最多 {MAX_PER_TRANSACTION} 点）
              </small>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            {/* 成功提示 */}
            {successMessage && (
              <div className="success-message">
                {successMessage}
              </div>
            )}

            {/* 提交按钮 */}
            <button
              onClick={handleIssueClick}
              disabled={loading || !amount || !isActiveHours}
              className="submit-button"
            >
              {loading ? '处理中...' : `🎫 发行点数卡 ${amount || 0} 点`}
            </button>

            {/* 提示信息 */}
            <div className="info-box">
              <p className="info-title">💡 操作说明</p>
              <ul className="info-list">
                <li>输入点数金额（点数 = 现金金额）</li>
                <li>点击"发行点数卡"按钮</li>
                <li>输入交易密码确认</li>
                <li>收取客户现金</li>
                <li>下载/打印QR Code给客户</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && pendingAmount && (
        <TransactionPinDialog
          title="确认发行点数卡"
          message={`即将发行 ${pendingAmount} 点的点数卡，收取现金 ${formatAmount(pendingAmount)}`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认发行"
        />
      )}
    </div>
  );
};

export default IssuePointCard;