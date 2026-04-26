/**
 * Cashier Dashboard
 * 收银员控制台 - 管理现金收款和财务统计
 * 
 * Tabs:
 * 1. 收款概览 - 统计和图表
 * 2. 收款记录 - 历史查询（所有收银员可互相查看）
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import { auth, db, functions } from '../../config/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './CashierDashboard.css';

// 移除旧的 CSS 引用，改用内联样式或新的 CSS 策略
// import './CashierDashboard.css';

// 导入子组件
import CollectionOverview from './CollectionOverview';
import CashierTransactions from './CashierTransactions';

const CashierDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { currentUser, userProfile, loading: authLoading, logout } = useAuth();
  const { organizationId, eventId, loading: eventLoading, error: eventError } = useEvent();

  // ===== 🆕 强制全宽布局 =====
  useEffect(() => {
    // 强制覆盖 #root 样式以允许全宽显示
    const root = document.getElementById('root');
    const originalMaxWidth = root?.style.maxWidth;
    const originalPadding = root?.style.padding;
    const originalTextAlign = root?.style.textAlign;
    const originalMargin = root?.style.margin;

    if (root) {
      root.style.maxWidth = '100%';
      root.style.padding = '0';
      root.style.textAlign = 'center';
      root.style.margin = '0';
    }

    return () => {
      // 卸载时恢复原始样式
      if (root) {
        root.style.maxWidth = originalMaxWidth || '1280px';
        root.style.padding = originalPadding || '2rem';
        root.style.textAlign = originalTextAlign || 'center';
        root.style.margin = originalMargin || '0 auto';
      }
    };
  }, []);

  const withTimeout = (promise, ms, label) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`请求超时（${ms}ms）：${label}`)), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  const getFreshIdToken = async () => {
    const user = currentUser || auth.currentUser;
    if (!user) throw new Error('用户未登录');
    return user.getIdToken(true);
  };

  const callOnCallWithAuthFallback = async (name, data, timeoutMs = 12000) => {
    const fn = httpsCallable(functions, name);

    try {
      return await withTimeout(fn(data), timeoutMs, name);
    } catch (err) {
      const code = err?.code || '';
      const message = err?.message || '';
      const isUnauth =
        code === 'functions/unauthenticated' ||
        code === 'unauthenticated' ||
        /unauthenticated/i.test(message) ||
        /用户未登录/.test(message);

      if (!isUnauth) throw err;

      const idToken = await getFreshIdToken();
      const url = `/api/${name}`;

      const resp = await withTimeout(
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({ data })
        }),
        timeoutMs,
        `${name} (fetch fallback)`
      );

      const text = await resp.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (_) {
        json = null;
      }

      if (!resp.ok) {
        const serverMsg = json?.error?.message || json?.message || text || `HTTP ${resp.status}`;
        throw new Error(serverMsg);
      }

      return { data: json?.result };
    }
  };

  // 状态管理
  const [activeTab, setActiveTab] = useState('overview'); // overview | pending | history
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 数据状态
  const [financeData, setFinanceData] = useState(null);
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [usersIdentityMap, setUsersIdentityMap] = useState({});
  const [statistics, setStatistics] = useState({
    cashStats: {
      totalCollected: 0,
      todayCollected: 0,
      thisWeekCollected: 0,
      thisMonthCollected: 0,
      totalCollections: 0,
      todayCollections: 0
    },
    pendingStats: {
      pendingAmount: 0,
      pendingCount: 0
    }
  });

  // 解析 orgEventCode
  const [orgCode, eventCode] = orgEventCode?.split('-') || [];

  // 验证提交者身份是否符合 Cashier 直接交款条件
  // 仅允许：teamLeader / pointSeller
  const isValidSubmitter = (submission) => {
    const submitterRole = submission.submitterRole;
    return submitterRole === 'teamLeader' || submitterRole === 'pointSeller';
  };

  const enrichSubmissionWithIdentityTag = (submission) => {
    const identityTagFromUser = usersIdentityMap[submission.submittedBy] || null;
    return {
      ...submission,
      resolvedSubmitterIdentityTag: submission.submitterIdentityTag ?? identityTagFromUser
    };
  };

  const resolvedPendingSubmissions = useMemo(
    () => pendingSubmissions.map(enrichSubmissionWithIdentityTag),
    [pendingSubmissions, usersIdentityMap]
  );

  const resolvedAllSubmissions = useMemo(
    () => allSubmissions.map(enrichSubmissionWithIdentityTag),
    [allSubmissions, usersIdentityMap]
  );

  const eligiblePendingSubmissions = useMemo(
    () => resolvedPendingSubmissions.filter(isValidSubmitter),
    [resolvedPendingSubmissions]
  );

  const eligibleAllSubmissions = useMemo(
    () => resolvedAllSubmissions.filter(isValidSubmitter),
    [resolvedAllSubmissions]
  );

  const effectivePendingStats = useMemo(() => {
    const pendingAmount = eligiblePendingSubmissions.reduce((sum, submission) => sum + (submission.amount || 0), 0);
    return {
      ...statistics.pendingStats,
      pendingAmount,
      pendingCount: eligiblePendingSubmissions.length
    };
  }, [eligiblePendingSubmissions, statistics.pendingStats]);

  // 登出处理
  const handleLogout = async () => {
    const confirmed = window.confirm('确定要退出登录吗？');
    if (!confirmed) return;

    try {
      await logout();
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('退出登录失败:', error);
      window.mybazaarShowToast('退出登录失败: ' + error.message);
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  // ===== 1. 权限验证 =====
  useEffect(() => {
    if (authLoading || eventLoading) return;

    if (eventError) {
      setError(eventError);
      setLoading(false);
      return;
    }

    if (!currentUser) {
      navigate(`/login/${orgEventCode}`);
      return;
    }

    if (!orgCode || !eventCode) {
      setError('无效的活动代码');
      setLoading(false);
      return;
    }

    const roles = userProfile?.roles || [];
    if (!roles.includes('cashier')) {
      setError('您没有权限访问此页面');
      setLoading(false);
      return;
    }

    loadFinanceData();
  }, [authLoading, eventLoading, eventError, currentUser, userProfile, orgCode, eventCode, orgEventCode, navigate]);

  // ===== 2. 加载财务数据 =====
  const loadFinanceData = async () => {
    try {
      setLoading(true);
      await getFreshIdToken();

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        setError('无法获取活动信息，请重新登录');
        setLoading(false);
        return;
      }

      const result = await callOnCallWithAuthFallback(
        'getCashierStats',
        { orgId, eventId: evtId },
        12000
      );

      if (result.data.success) {
        const data = result.data.data;
        setFinanceData(data);
        setStatistics({
          cashStats: data.cashStats || {},
          pendingStats: data.pendingStats || {}
        });
      }

      setLoading(false);
    } catch (err) {
      console.error('加载财务数据失败:', err);
      console.log('使用模拟数据...');
      setFinanceData({
        basicInfo: {
          name: userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName || '财务经理'
        }
      });
      setLoading(false);
    }
  };

  // ===== 3. 实时监听用户身份标签（用于严格过滤提交者） =====
  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;

    if (!orgId || !evtId) return;

    const usersRef = collection(
      db,
      'organizations',
      orgId,
      'events',
      evtId,
      'users'
    );

    const unsubscribe = onSnapshot(usersRef, (snapshot) => {
      const identityMap = {};
      snapshot.forEach((doc) => {
        const user = doc.data();
        identityMap[doc.id] = user.identityTag || null;
      });
      setUsersIdentityMap(identityMap);
    }, (listenError) => {
      console.error('监听用户身份标签失败:', listenError);
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, organizationId, eventId]);

  // ===== 4. 实时监听待认领池子 =====
  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;

    if (!orgId || !evtId) return;

    const submissionsRef = collection(
      db,
      'organizations',
      orgId,
      'events',
      evtId,
      'cashSubmissions'
    );

    // 查询待认领池子（receivedBy=null）
    const q = query(
      submissionsRef,
      where('status', '==', 'pending'),
      where('receivedBy', '==', null),
      orderBy('submittedAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPendingSubmissions(submissions);

      // 更新待认领统计
      const pendingAmount = submissions.reduce((sum, s) => sum + (s.amount || 0), 0);
      setStatistics(prev => ({
        ...prev,
        pendingStats: {
          ...prev.pendingStats,
          pendingAmount,
          pendingCount: submissions.length
        }
      }));
    }, (error) => {
      console.error('监听待认领记录失败:', error);
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, organizationId, eventId]);

  // ===== 🆕 5. 实时监听所有收款记录（Tab 3用 - 所有FM可互相查看） =====
  useEffect(() => {
    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;

    if (!orgId || !evtId) return;

    const submissionsRef = collection(
      db,
      'organizations',
      orgId,
      'events',
      evtId,
      'cashSubmissions'
    );

    // 🔴 修改：查询所有收款记录（不限制receivedBy）
    // 所有FM都能看到所有记录，互相监督
    const q = query(
      submissionsRef,
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setAllSubmissions(submissions);
    }, (error) => {
      console.error('监听收款记录失败:', error);
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, organizationId, eventId]);

  // ===== 6. 接单确认收款 =====
  const handleClaimSubmission = async (submissionId, transactionPin, confirmationNote) => {
    try {
      await getFreshIdToken();

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        throw new Error('无法获取活动信息');
      }

      const result = await callOnCallWithAuthFallback(
        'claimAndConfirmCashSubmission',
        {
          orgId,
          eventId: evtId,
          submissionId,
          transactionPin,
          confirmationNote: confirmationNote || ''
        },
        15000
      );

      if (result.data.success) {
        await loadFinanceData();
        return true;
      }

      return false;
    } catch (err) {
      console.error('接单确认失败:', err);
      throw err;
    }
  };

  // ===== 7. 渲染 =====
  if (loading) {
    return (
      <div className="fm-loading-container">
        <div className="fm-spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fm-error-container">
        <p className="fm-error-message">{error}</p>
        <button className="fm-button" onClick={() => navigate(`/login/${orgEventCode}`)}>返回登录</button>
      </div>
    );
  }

  return (
    <div className="fm-container">
      {/* 🆕 共用 Header 组件（临时，如需自定义，稍后可修改参数） */}
      <DashboardHeader
        title="财务管理"
        subtitle="Cashier Dashboard"
        logoUrl={event?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName}
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.includes('cashier') ? 'cashier' : userProfile?.roles?.[0]}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 导航 */}
      <nav className="fm-tab-nav">
        <button
          className={`fm-tab-button ${activeTab === 'overview' ? 'fm-tab-button-active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="fm-tab-icon">📊</span>
          <span>收款概览</span>
        </button>
        
        <button
          className={`fm-tab-button ${activeTab === 'history' ? 'fm-tab-button-active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <span className="fm-tab-icon">📋</span>
          <span>收款记录</span>
          {eligibleAllSubmissions.length > 0 && (
            <span className="fm-badge">{eligibleAllSubmissions.length}</span>
          )}
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="fm-content">
        {activeTab === 'overview' && (
          <CollectionOverview
            pendingSubmissions={eligiblePendingSubmissions}
            statistics={{
              ...statistics,
              pendingStats: effectivePendingStats
            }}
            onClaim={handleClaimSubmission}
            onRefresh={loadFinanceData}
            currentUser={currentUser}
          />
        )}

        {activeTab === 'history' && (
          <CashierTransactions
            submissions={eligibleAllSubmissions}
            onRefresh={loadFinanceData}
          />
        )}
      </main>

      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter 
        event={event}
        eventCode={eventCode}
        showEventInfo={true}
      />
    </div>
  );
};

// // filepath: c:\mybazaar20\src\views\finance\CashierDashboard.jsx
// 内联样式定义 (参考 UserList.jsx 风格)
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f3f4f6',
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
  },
  header: {
    backgroundColor: 'white',
    padding: '1.5rem 2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  welcomeText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '1.5rem'
  },
  date: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  logoutButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  tabNav: {
    backgroundColor: 'white',
    padding: '0 2rem',
    display: 'flex',
    gap: '2rem',
    borderBottom: '1px solid #e5e7eb'
  },
  tabButton: {
    padding: '1rem 0.5rem',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: '#6b7280',
    fontSize: '0.95rem',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s'
  },
  tabButtonActive: {
    color: '#3b82f6',
    borderBottomColor: '#3b82f6'
  },
  tabIcon: {
    fontSize: '1.1rem'
  },
  badge: {
    backgroundColor: '#ef4444',
    color: 'white',
    fontSize: '0.75rem',
    padding: '0.1rem 0.4rem',
    borderRadius: '9999px',
    marginLeft: '0.25rem'
  },
  content: {
    flex: 1,
    padding: '2rem',
    width: '100%',
    maxWidth: '100%',
    overflowX: 'hidden'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#f3f4f6'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    marginBottom: '1rem'
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    padding: '2rem',
    backgroundColor: '#f3f4f6'
  },
  errorMessage: {
    color: '#dc2626',
    fontSize: '1.1rem',
    marginBottom: '1rem'
  },
  button: {
    padding: '0.5rem 1rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer'
  }
};

// 全局動畫已移至外部 CSS 檔案

export default CashierDashboard;


