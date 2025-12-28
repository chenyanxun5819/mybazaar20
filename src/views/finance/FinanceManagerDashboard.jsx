/**
 * Finance Manager Dashboard
 * 财务经理控制台 - 管理现金收款和财务统计
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { auth, db, functions, FIREBASE_PROJECT_ID, FUNCTIONS_REGION } from '../../config/firebase';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './FinanceManagerDashboard.css';

// 导入子组件
import CollectionOverview from './CollectionOverview';
import PendingSubmissions from './PendingSubmissions';

const FinanceManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { currentUser, userProfile, loading: authLoading } = useAuth();
  const { organizationId, eventId, loading: eventLoading, error: eventError } = useEvent();

  const withTimeout = (promise, ms, label) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`请求逾时（${ms}ms）：${label}`)), ms);
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

      // Fallback: 以 fetch 明確帶上 Authorization: Bearer <idToken>
      const idToken = await getFreshIdToken();
      const url = `https://${FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/${name}`;

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

      // 模擬 httpsCallable 的回傳形狀：{ data: ... }
      return { data: json?.result };
    }
  };

  // 状态管理
  const [activeTab, setActiveTab] = useState('overview'); // overview | pending
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 数据状态
  const [financeData, setFinanceData] = useState(null);
  const [pendingSubmissions, setPendingSubmissions] = useState([]);
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

  // ===== 1. 权限验证 =====
  useEffect(() => {
    // 等待 Context 初始化完成
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
    if (!roles.includes('financeManager')) {
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

      // 确保 Token 已可用（并在必要时用于 fetch fallback）
      await getFreshIdToken();

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        setError('无法获取活动信息，请重新登录');
        setLoading(false);
        return;
      }

      // 调用 Cloud Function 获取统计数据
      const result = await callOnCallWithAuthFallback(
        'getFinanceStats',
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
        setPendingSubmissions(data.pendingSubmissions || []);
      }

      setLoading(false);
    } catch (err) {
      console.error('加载财务数据失败:', err);
      // 如果 Cloud Function 不存在，使用模拟数据
      console.log('使用模拟数据...');
      setFinanceData({
        basicInfo: {
          name: userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName || '财务经理'
        }
      });
      setLoading(false);
    }
  };

  // ===== 3. 实时监听待确认记录 =====
  useEffect(() => {
    // 获取 organizationId 和 eventId
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

    const q = query(
      submissionsRef,
      where('status', '==', 'pending'),
      orderBy('submittedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const submissions = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setPendingSubmissions(submissions);

      // 更新待确认统计
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
      console.error('监听待确认记录失败:', error);
    });

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, organizationId, eventId]);

  // ===== 4. 确认收款 =====
  const handleConfirmSubmission = async (submissionId, note) => {
    try {
      // 确保 Token 已可用（并在必要时用于 fetch fallback）
      await getFreshIdToken();

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        throw new Error('无法获取活动信息');
      }

      const result = await callOnCallWithAuthFallback(
        'confirmCashSubmission',
        {
          orgId,
          eventId: evtId,
          submissionId,
          confirmationNote: note || ''
        },
        12000
      );

      if (result.data.success) {
        // 刷新数据
        await loadFinanceData();
        return true;
      }

      return false;
    } catch (err) {
      console.error('确认收款失败:', err);
      throw err;
    }
  };

  // ===== 5. 渲染 =====
  if (loading) {
    return (
      <div className="finance-dashboard">
        <div className="loading-container">
          <div className="spinner"></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="finance-dashboard">
        <div className="error-container">
          <p className="error-message">{error}</p>
          <button onClick={() => navigate(`/login/${orgEventCode}`)}>返回登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="finance-dashboard">
      {/* 头部 */}
      <header className="dashboard-header">
        <div className="header-content">
          <div className="header-left">
            <h1>💰 财务管理</h1>
            <p className="welcome-text">
              欢迎，{financeData?.basicInfo?.name || userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName || '财务经理'}
            </p>
          </div>
          <div className="header-right">
            <span className="date">{new Date().toLocaleDateString('zh-CN')}</span>
          </div>
        </div>
      </header>

      {/* Tab 导航 */}
      <nav className="tab-navigation">
        <button
          className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          <span className="tab-icon">📊</span>
          <span className="tab-label">收款概览</span>
        </button>
        <button
          className={`tab-button ${activeTab === 'pending' ? 'active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <span className="tab-icon">💵</span>
          <span className="tab-label">待确认</span>
          {statistics.pendingStats.pendingCount > 0 && (
            <span className="badge">{statistics.pendingStats.pendingCount}</span>
          )}
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="dashboard-content">
        {activeTab === 'overview' && (
          <CollectionOverview 
            statistics={statistics}
            onRefresh={loadFinanceData}
          />
        )}

        {activeTab === 'pending' && (
          <PendingSubmissions
            submissions={pendingSubmissions}
            onConfirm={handleConfirmSubmission}
            onRefresh={loadFinanceData}
          />
        )}
      </main>
    </div>
  );
};

export default FinanceManagerDashboard;