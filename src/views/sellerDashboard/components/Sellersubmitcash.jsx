/**
 * SellerSubmitCash.jsx (智能修复版 v3.3)
 * 
 * 🔧 本次修复：
 * 1. ✅ 智能处理有/无 identityTag 的情况
 * 2. ✅ 2秒后自动判定为非学生（避免无限等待）
 * 3. ✅ 保留原有的学生检测逻辑
 * 
 * @version 3.3
 * @date 2025-01-04
 */

import { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db, functions } from '../../../config/firebase';
import { httpsCallable } from 'firebase/functions';
import { useSellerStats } from '../hooks/useSellerStats';
import { useAuth } from '../../../contexts/AuthContext';
import './SellerSubmitCash.css';

const SellerSubmitCash = () => {
  const { stats, loading: statsLoading, error: statsError } = useSellerStats();
  const { userProfile, loading: authLoading } = useAuth();
  
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitAmount, setSubmitAmount] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const [sellerManager, setSellerManager] = useState(null);
  const [smLoading, setSmLoading] = useState(false);
  
  // 🆕 2秒后放宽检查
  const [identityTagTimeout, setIdentityTagTimeout] = useState(false);

  const orgId = userProfile?.organizationId?.replace('organization_', '') || '';
  const eventId = userProfile?.eventId?.replace('event_', '') || '';
  const sellerId = userProfile?.userId;
  
  const cashOnHand = stats?.pendingCollection || 0;
  
  // 支持多种 identityTag 格式
  const identityTag = userProfile?.identityTag || userProfile?.identityInfo?.identityTag;
  const isStudent = identityTag === 'student' || identityTag === 'students';
  const department = userProfile?.identityInfo?.department;

  // 🔧 智能加载检查：
  // 1. 如果有 identityTag → 等待它加载完成
  // 2. 如果 2 秒后还没有 identityTag → 判定为非学生，继续
  const hasSellerRole = userProfile?.roles?.includes('seller');
  const hasBasicProfile = !!userProfile && !!userProfile.roles;
  const hasIdentityTag = !!identityTag;
  
  const isUserProfileLoaded = hasBasicProfile && 
                               (!hasSellerRole || hasIdentityTag || identityTagTimeout);

  console.log('=================================');
  console.log('[SellerSubmitCash] 🔍 加载状态检查:');
  console.log('  authLoading:', authLoading);
  console.log('  userProfile存在:', !!userProfile);
  console.log('  roles:', userProfile?.roles);
  console.log('  hasSellerRole:', hasSellerRole);
  console.log('  identityTag:', identityTag);
  console.log('  hasIdentityTag:', hasIdentityTag);
  console.log('  identityTagTimeout:', identityTagTimeout);
  console.log('  isStudent:', isStudent);
  console.log('  isUserProfileLoaded:', isUserProfileLoaded);
  console.log('  department:', department);
  console.log('  smLoading:', smLoading);
  console.log('  sellerManager:', sellerManager);
  console.log('=================================');

  // 🆕 2秒超时机制：如果Seller角色但没有identityTag，2秒后自动判定为非学生
  useEffect(() => {
    if (hasSellerRole && !hasIdentityTag && !identityTagTimeout) {
      console.warn('[SellerSubmitCash] ⚠️ Seller角色但identityTag未加载，启动2秒超时...');
      
      const timer = setTimeout(() => {
        console.warn('[SellerSubmitCash] ⏰ identityTag超时！判定为非学生角色');
        setIdentityTagTimeout(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [hasSellerRole, hasIdentityTag, identityTagTimeout]);

  // ========== 查找SellerManager ==========

  useEffect(() => {
    // 等待 userProfile 完全加载
    if (authLoading || !isUserProfileLoaded) {
      console.log('[SellerSubmitCash] ⏳ 等待 userProfile 加载...');
      return;
    }

    // 只有学生需要查找SM
    if (!isStudent) {
      console.log('[SellerSubmitCash] ⏭️ 不是学生，跳过SM查找');
      setSellerManager(null);
      setSmLoading(false);
      return;
    }

    if (!orgId || !eventId || !department) {
      console.log('[SellerSubmitCash] ⏭️ 缺少必要参数，跳过SM查找:', { orgId, eventId, department });
      setSmLoading(false);
      return;
    }

    const findSellerManager = async () => {
      setSmLoading(true);
      
      try {
        console.log('[SellerSubmitCash] 🔍 开始查找SellerManager');
        console.log('  orgId:', orgId);
        console.log('  eventId:', eventId);
        console.log('  department:', department);

        const usersRef = collection(
          db,
          `organizations/${orgId}/events/${eventId}/users`
        );

        const smQuery = query(
          usersRef,
          where('roles', 'array-contains', 'sellerManager')
        );

        const smSnapshot = await getDocs(smQuery);
        console.log('[SellerSubmitCash] 📊 找到', smSnapshot.size, '个SellerManager');

        let foundSM = null;
        smSnapshot.forEach(doc => {
          const smData = doc.data();
          const managedDepts = smData.sellerManager?.managedDepartments || [];
          
          console.log('[SellerSubmitCash] 检查SM:', {
            id: doc.id,
            name: smData.basicInfo?.chineseName,
            managedDepts,
            matchesDepartment: managedDepts.includes(department)
          });

          if (managedDepts.includes(department)) {
            foundSM = {
              id: doc.id,
              name: smData.basicInfo?.chineseName || smData.basicInfo?.englishName || 'SM'
            };
            console.log('[SellerSubmitCash] ✅ 找到管理者:', foundSM);
          }
        });

        if (foundSM) {
          setSellerManager(foundSM);
          console.log('[SellerSubmitCash] ✅ 设置sellerManager:', foundSM);
        } else {
          console.warn('[SellerSubmitCash] ⚠️ 未找到管理', department, '的SellerManager');
          setSellerManager(null);
        }
      } catch (error) {
        console.error('[SellerSubmitCash] ❌ 查找SM失败:', error);
        setSellerManager(null);
      } finally {
        setSmLoading(false);
      }
    };

    findSellerManager();
  }, [authLoading, isUserProfileLoaded, isStudent, orgId, eventId, department]);

  // ========== 数据加载 ==========

  useEffect(() => {
    if (!orgId || !eventId || !sellerId) {
      console.warn('[SellerSubmitCash] ⚠️ 缺少必要参数:', { orgId, eventId, sellerId });
      setLoading(false);
      return;
    }

    console.log('[SellerSubmitCash] 📊 开始加载上交记录...');

    try {
      const submissionsQuery = query(
        collection(db, `organizations/${orgId}/events/${eventId}/cashSubmissions`),
        where('submittedBy', '==', sellerId),
        where('submitterRole', '==', 'seller'),
        orderBy('submittedAt', 'desc')
      );

      const unsubscribe = onSnapshot(
        submissionsQuery,
        (snapshot) => {
          const submissionsData = [];
          snapshot.forEach(doc => {
            submissionsData.push({
              id: doc.id,
              ...doc.data()
            });
          });
          console.log('[SellerSubmitCash] ✅ 加载完成:', submissionsData.length, '笔记录');
          setSubmissions(submissionsData);
          setLoading(false);
        },
        (error) => {
          console.error('[SellerSubmitCash] ❌ 加载失败:', error);
          setLoading(false);
        }
      );

      return () => unsubscribe();
    } catch (error) {
      console.error('[SellerSubmitCash] ❌ 设置监听失败:', error);
      setLoading(false);
    }
  }, [orgId, eventId, sellerId]);

  // ========== 数据计算 ==========

  const summaryStats = useMemo(() => {
    const totalSubmitted = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);
    const pending = submissions.filter(s => s.status === 'pending');
    const confirmed = submissions.filter(s => s.status === 'confirmed');

    return {
      cashOnHand,
      totalSubmitted,
      pendingCount: pending.length,
      pendingAmount: pending.reduce((sum, s) => sum + (s.amount || 0), 0),
      confirmedCount: confirmed.length,
      confirmedAmount: confirmed.reduce((sum, s) => sum + (s.amount || 0), 0)
    };
  }, [cashOnHand, submissions]);

  // ========== 事件处理 ==========

  const handleOpenSubmitModal = () => {
    console.log('[SellerSubmitCash] 🔓 打开上交模态框');
    
    if (cashOnHand <= 0) {
      window.mybazaarShowToast('您目前没有可上交的现金');
      return;
    }
    
    if (isStudent && !sellerManager) {
      window.mybazaarShowToast('未找到您的班导师（Seller Manager）。\n\n请联系管理员为您的班级（' + department + '）分配管理者。');
      return;
    }
    
    setShowSubmitModal(true);
  };

  const handleSubmit = async () => {
    const amount = parseFloat(submitAmount);
    
    console.log('[SellerSubmitCash] 🔄 开始验证提交...');
    console.log('  amount:', amount);
    console.log('  isStudent:', isStudent);
    console.log('  sellerManager:', sellerManager);

    if (!amount || amount <= 0) {
      window.mybazaarShowToast('请输入有效金额');
      return;
    }

    if (amount > cashOnHand) {
      window.mybazaarShowToast(`上交金额不能超过手上现金（RM ${cashOnHand}）`);
      return;
    }

    if (isStudent && !sellerManager) {
      window.mybazaarShowToast('未找到您的班导师（Seller Manager）。请联系管理员设置。');
      return;
    }

    setSubmitting(true);

    try {
      console.log('[SellerSubmitCash] 🔄 开始上交...');
      let result;

      if (isStudent) {
        console.log('[SellerSubmitCash] 📤 学生上交给SellerManager:', sellerManager.id);
        
        const submitToManager = httpsCallable(functions, 'submitCashToSellerManager');
        result = await submitToManager({
          orgId,
          eventId,
          amount,
          note: submitNote,
          sellerManagerId: sellerManager.id
        });

        console.log('[SellerSubmitCash] ✅ 上交到SellerManager成功:', result.data);
        window.mybazaarShowToast(`✅ 成功上交 RM ${amount} 给 ${sellerManager.name}`);
      } else {
        console.log('[SellerSubmitCash] 📤 职员/老师上交到Cashier待认领池子');
        
        const submitToFinance = httpsCallable(functions, 'submitCashToFinance');
        result = await submitToFinance({
          orgId,
          eventId,
          amount,
          note: submitNote
        });

        console.log('[SellerSubmitCash] ✅ 上交到Cashier成功:', result.data);
        window.mybazaarShowToast(`✅ 成功上交 RM ${amount} 到待认领池子`);
      }

      setSubmitAmount('');
      setSubmitNote('');
      setShowSubmitModal(false);
    } catch (error) {
      console.error('[SellerSubmitCash] ❌ 上交失败:', error);
      window.mybazaarShowToast('上交失败: ' + (error.message || '未知错误'));
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '未知时间';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  };

  // ========== 渲染 ==========

  // 最终加载检查
  const isFullyLoaded = !authLoading && 
                        isUserProfileLoaded && 
                        (!isStudent || !smLoading);

  console.log('[SellerSubmitCash] 🎯 最终加载状态:');
  console.log('  authLoading:', authLoading);
  console.log('  isUserProfileLoaded:', isUserProfileLoaded);
  console.log('  isStudent:', isStudent);
  console.log('  smLoading:', smLoading);
  console.log('  isFullyLoaded:', isFullyLoaded);

  if (!isFullyLoaded) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
          {smLoading && <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>正在查找班导师...</p>}
          {hasSellerRole && !hasIdentityTag && !identityTagTimeout && (
            <p style={{ fontSize: '0.875rem', color: '#f59e0b' }}>等待身份信息...</p>
          )}
        </div>
      </div>
    );
  }

  // 如果 Auth 加载完成但没有 Profile，显示错误
  if (!authLoading && !hasBasicProfile) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>⚠️</div>
          <h2 style={styles.errorTitle}>无法加载用户信息</h2>
          <p style={styles.errorMessage}>请尝试刷新页面或重新登录</p>
          <button style={styles.retryButton} onClick={() => window.location.reload()}>
            刷新页面
          </button>
        </div>
      </div>
    );
  }

  if (statsError) {
    return (
      <div style={styles.container}>
        <div style={styles.errorCard}>
          <div style={styles.errorIcon}>⚠️</div>
          <h2 style={styles.errorTitle}>加载失败</h2>
          <p style={styles.errorMessage}>{statsError}</p>
          <button style={styles.retryButton} onClick={() => window.location.reload()}>
            重试
          </button>
        </div>
      </div>
    );
  }

  // 根据用户类型设置接收人信息
  const recipientInfo = isStudent 
    ? {
        icon: '👨‍🏫',
        description: sellerManager 
          ? `上交给班导师: ${sellerManager.name}`
          : '未设置班导师'
      }
    : {
        icon: '🏦',
        description: '上交到 Cashier 待认领池子'
      };

  return (
    <div style={styles.container}>
      {/* 统计卡片 */}
      <div style={styles.summaryWrapper}>
        <div style={styles.summaryCard}>
          {/* 第一行：左边(现有现金+提示) + 右边(金额+按钮+描述) */}
          <div style={styles.summaryHeaderRow}>
            {/* 左边 */}
            <div style={styles.summaryLeftCol}>
              <div style={styles.summaryLabel}>现有现金</div>
              {cashOnHand > 0 && (
                <div style={styles.reminderBoxSmall}>
                  - 记得及时上交
                </div>
              )}
            </div>
            {/* 右边 */}
            <div style={styles.summaryRightCol}>
              <div style={styles.summaryAmount}>RM {summaryStats.cashOnHand.toLocaleString()}</div>
              <button 
                style={styles.submitButton}
                onClick={handleOpenSubmitModal}
                disabled={cashOnHand <= 0 || (isStudent && !sellerManager)}
              >
                {cashOnHand > 0 ? '立即上交' : '暂无现金'}
              </button>
              <p style={styles.summaryDesc}>{recipientInfo.description}</p>
              {isStudent && !sellerManager && (
                <div style={styles.warningBox}>
                  ⚠️ 您的班级（{department}）还没有分配 Seller Manager，请联系管理员设置后才能上交现金。
                </div>
              )}
            </div>
          </div>

          {/* 第二行：三列统计 */}
          <div style={styles.summaryStats}>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{summaryStats.pendingCount} 笔</span>
              <span style={styles.summaryStatLabel}>待确认笔数</span>
              <span style={styles.summaryStatAmt}>RM {summaryStats.pendingAmount.toLocaleString()}</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>{summaryStats.confirmedCount} 笔</span>
              <span style={styles.summaryStatLabel}>已确认笔数</span>
              <span style={styles.summaryStatAmt}>RM {summaryStats.confirmedAmount.toLocaleString()}</span>
            </div>
            <div style={styles.summaryStatDivider}></div>
            <div style={styles.summaryStatItem}>
              <span style={styles.summaryStatValue}>RM {summaryStats.totalSubmitted.toLocaleString()}</span>
              <span style={styles.summaryStatLabel}>总收取现金</span>
            </div>
          </div>
        </div>
      </div>


      {/* 历史记录 */}
      <div style={styles.historySection}>
        <h2 style={styles.sectionTitle}>📋 上交历史</h2>

        {submissions.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>📭</div>
            <p>暂无上交记录</p>
          </div>
        ) : (
          <div style={styles.submissionsList}>
            {submissions.map(submission => (
              <SubmissionCard 
                key={submission.id}
                submission={submission}
                isStudent={isStudent}
                formatDate={formatDate}
              />
            ))}
          </div>
        )}
      </div>

      {/* 上交模态框 */}
      {showSubmitModal && (
        <SubmitModal
          isStudent={isStudent}
          recipientInfo={recipientInfo}
          cashOnHand={cashOnHand}
          submitAmount={submitAmount}
          setSubmitAmount={setSubmitAmount}
          submitNote={submitNote}
          setSubmitNote={setSubmitNote}
          submitting={submitting}
          onSubmit={handleSubmit}
          onClose={() => setShowSubmitModal(false)}
        />
      )}
    </div>
  );
};

// ========== 子组件 ==========

const SubmissionCard = ({ submission, isStudent, formatDate }) => {
  const statusConfig = {
    pending: { label: '待确认', color: '#3b82f6' },
    confirmed: { label: '已确认', color: '#10b981' },
    rejected: { label: '已拒绝', color: '#ef4444' }
  };

  const statusInfo = statusConfig[submission.status] || { label: '未知', color: '#6b7280' };

  return (
    <div style={styles.submissionCard}>
      <div style={styles.submissionHeader}>
        <div>
          <div style={styles.submissionTitle}>
            上交编号: {submission.submissionNumber || submission.id.slice(0, 8)}
          </div>
          <div style={styles.submissionDate}>
            {formatDate(submission.submittedAt)}
          </div>
        </div>
        <div 
          style={{
            ...styles.submissionStatus,
            background: statusInfo.color
          }}
        >
          {statusInfo.label}
        </div>
      </div>

      <div style={styles.submissionBody}>
        <div style={styles.detailRow}>
          <span>金额:</span>
          <strong>RM {(submission.amount || 0).toLocaleString()}</strong>
        </div>
        <div style={styles.detailRow}>
          <span>上交对象:</span>
          <strong>{isStudent ? 'Seller Manager' : 'Cashier'}</strong>
        </div>
        {submission.receiverName && (
          <div style={styles.detailRow}>
            <span>接收人:</span>
            <strong>{submission.receiverName}</strong>
          </div>
        )}
      </div>

      {submission.note && (
        <div style={styles.submissionNote}>
          📝 备注: {submission.note}
        </div>
      )}

      {submission.status === 'confirmed' && submission.confirmationNote && (
        <div style={styles.confirmedNote}>
          ✅ 确认备注: {submission.confirmationNote}
        </div>
      )}
    </div>
  );
};

const SubmitModal = ({
  isStudent,
  recipientInfo,
  cashOnHand,
  submitAmount,
  setSubmitAmount,
  submitNote,
  setSubmitNote,
  submitting,
  onSubmit,
  onClose
}) => {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={{ margin: 0 }}>📤 上交现金</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.modalBody}>
          <div style={styles.modalInfoBanner}>
            <span>{recipientInfo.icon}</span>
            <span>{recipientInfo.description}</span>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>上交金额 *</label>
            <div style={styles.amountInputWrapper}>
              <span style={styles.currency}>RM</span>
              <input
                type="number"
                value={submitAmount}
                onChange={(e) => setSubmitAmount(e.target.value)}
                placeholder="0.00"
                style={styles.amountInput}
                min="0"
                max={cashOnHand}
                step="0.01"
                disabled={submitting}
              />
            </div>
            <div style={styles.hint}>
              手上现金: RM {cashOnHand.toLocaleString()}
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>备注（可选）</label>
            <textarea
              value={submitNote}
              onChange={(e) => setSubmitNote(e.target.value)}
              placeholder="例如：第一周销售现金"
              style={styles.textarea}
              rows={3}
              disabled={submitting}
            />
          </div>

          <div style={styles.warningBox}>
            ⚠️ 请确认金额正确，上交后不可撤销
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button 
            style={styles.cancelButton} 
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button 
            style={styles.confirmButton} 
            onClick={onSubmit}
            disabled={submitting || !submitAmount || parseFloat(submitAmount) <= 0}
          >
            {submitting ? '提交中...' : '✅ 确认上交'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ========== 样式 ==========

const styles = {
  container: { padding: '20px', maxWidth: '1200px', margin: '0 auto' },
  loading: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '3rem', color: '#6b7280' },
  spinner: { width: '40px', height: '40px', border: '4px solid #f3f4f6', borderTop: '4px solid #3b82f6', borderRadius: '50%', animation: 'spin 1s linear infinite' },
  errorCard: { background: '#fee2e2', border: '2px solid #ef4444', borderRadius: '12px', padding: '2rem', textAlign: 'center' },
  errorIcon: { fontSize: '3rem', marginBottom: '1rem' },
  errorTitle: { color: '#991b1b', marginBottom: '0.5rem' },
  errorMessage: { color: '#7f1d1d', marginBottom: '1.5rem' },
  retryButton: { padding: '0.75rem 1.5rem', background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' },
  summaryWrapper: { width: '100%', marginBottom: '1.5rem' },
  summaryCard: { padding: '1.5rem', borderRadius: '12px', boxShadow: '0 4px 12px rgba(33, 150, 243, 0.3)', color: '#fff', background: 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)' },
  summaryHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255, 255, 255, 0.2)', gap: '2rem' },
  summaryLeftCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' },
  summaryRightCol: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem', flex: 1, textAlign: 'right' },
  summaryLabel: { fontSize: '0.9rem', opacity: 0.9, fontWeight: 500 },
  reminderBoxSmall: { fontSize: '0.75rem', opacity: 0.8, fontStyle: 'italic' },
  summaryAmount: { fontSize: '1.8rem', fontWeight: 700 },
  summaryDesc: { fontSize: '0.75rem', opacity: 0.85, margin: '0.25rem 0 0 0' },
  summaryStats: { display: 'flex', justifyContent: 'space-around', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'nowrap' },
  summaryStatItem: { display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1 1 150px', textAlign: 'center' },
  summaryStatValue: { fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' },
  summaryStatLabel: { fontSize: '0.8rem', opacity: 0.8, marginBottom: '0.5rem' },
  summaryStatAmt: { fontSize: '0.9rem', fontWeight: 500 },
  summaryStatDivider: { width: '1px', backgroundColor: 'rgba(255, 255, 255, 0.2)', alignSelf: 'stretch', margin: '0 0.5rem' },
  actionCard: { background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '1.5rem', borderRadius: '12px', color: 'white', marginBottom: '2rem' },
  actionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem', flexWrap: 'wrap' },
  actionTitle: { fontSize: '1.25rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' },
  actionDesc: { fontSize: '0.875rem', opacity: 0.9, margin: 0 },
  submitButton: { padding: '0.75rem 1.5rem', background: 'white', color: '#667eea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600', whiteSpace: 'nowrap' },
  reminderBox: { padding: '0.75rem 1rem', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '8px', fontSize: '0.875rem', marginTop: '1rem' },
  warningBox: { padding: '0.75rem 1rem', background: '#fef3c7', border: '2px solid #fbbf24', color: '#92400e', borderRadius: '8px', fontSize: '0.875rem', fontWeight: '500', marginTop: '1rem' },
  sectionTitle: { fontSize: '1.25rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '1rem' },
  historySection: { marginTop: '2rem', width: '100%', boxSizing: 'border-box', overflow: 'hidden' },
  submissionsList: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', width: '100%', boxSizing: 'border-box' },
  submissionCard: { background: '#fafafa', border: '2px solid #e5e7eb', borderRadius: '12px', padding: '1.5rem', width: '100%', boxSizing: 'border-box', overflow: 'hidden' },
  submissionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem' },
  submissionTitle: { fontSize: '1rem', fontWeight: 'bold', color: '#1f2937', marginBottom: '0.25rem' },
  submissionDate: { fontSize: '0.75rem', color: '#6b7280' },
  submissionStatus: { padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: '600', color: 'white', whiteSpace: 'nowrap' },
  submissionBody: { display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' },
  detailRow: { display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#374151' },
  submissionNote: { padding: '0.75rem', background: '#f3f4f6', borderRadius: '8px', fontSize: '0.75rem', color: '#374151', marginTop: '0.5rem' },
  confirmedNote: { padding: '0.75rem', background: '#d1fae5', borderRadius: '8px', fontSize: '0.75rem', color: '#065f46', marginTop: '0.5rem' },
  emptyState: { textAlign: 'center', padding: '3rem', color: '#6b7280' },
  emptyIcon: { fontSize: '4rem', marginBottom: '1rem' },
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' },
  modal: { background: 'white', borderRadius: '12px', maxWidth: '500px', width: '100%', maxHeight: '90vh', overflow: 'auto' },
  modalHeader: { padding: '1.5rem', borderBottom: '2px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  closeButton: { background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#6b7280' },
  modalBody: { padding: '1.5rem' },
  modalInfoBanner: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', background: '#dbeafe', borderRadius: '8px', marginBottom: '1.5rem', fontSize: '0.875rem', color: '#1e40af' },
  formGroup: { marginBottom: '1.5rem' },
  label: { display: 'block', fontSize: '0.875rem', fontWeight: '600', color: '#374151', marginBottom: '0.5rem' },
  amountInputWrapper: { display: 'flex', alignItems: 'center', gap: '0.5rem' },
  currency: { fontSize: '1rem', fontWeight: '600', color: '#6b7280' },
  amountInput: { flex: 1, padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '1rem', fontWeight: '600' },
  hint: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' },
  textarea: { width: '100%', padding: '0.75rem', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '0.875rem', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  modalFooter: { padding: '1.5rem', borderTop: '2px solid #e5e7eb', display: 'flex', gap: '1rem', justifyContent: 'flex-end' },
  cancelButton: { padding: '0.75rem 1.5rem', background: 'white', border: '2px solid #e5e7eb', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600', color: '#374151' },
  confirmButton: { padding: '0.75rem 1.5rem', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: '600' }
};

export default SellerSubmitCash;
