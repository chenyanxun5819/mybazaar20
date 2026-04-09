/**
 * PointSeller Dashboard
 * 点数卡销售员控制台
 * 
 * 角色特性：
 * - 只在义卖会当日6:00-18:00有效
 * - 两种销售方式：1) 发行点数卡  2) 直接销售点数
 * - 需要交易密码验证
 * - 现金需要上交给Cashier
 * 
 * Tabs:
 * 1. 发行点数卡 - 生成QR Code
 * 2. 销售点数 - 直接转账给Customer
 * 3. 发行记录 - 统计和历史
 * 4. 现金上交 - 批量上交现金
 */

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import { auth, db, functions } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import { collection, query, where, orderBy, onSnapshot, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import './PointSellerDashboard.css';
import ChartHistogramIcon from '../../assets/chart-histogram.svg?react';
import PointsCardIcon from '../../assets/pointsCard.svg?react';
import PointsToPhoneIcon from '../../assets/pointsToPhone.svg?react';
import PersonalFinanceIcon from '../../assets/personal-finance.svg?react';

// 导入子组件
import IssuePointCard from './components/IssuePointCard';
import DirectSale from './components/DirectSale';
import PointSellerTransactions from './components/PointSellerTransactions';
import CashSubmission from './components/CashSubmission';

const PointSellerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { currentUser, userProfile, loading: authLoading, logout } = useAuth();
  const { orgCode, eventCode, event, loading: eventLoading, error: eventError } = useEvent(); // 🆕 从 EventContext 获取完整 event + loading + error
  const [activeTab, setActiveTab] = useState('issue-card'); // issue-card | direct-sale | history | cash-submission
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isActiveHours, setIsActiveHours] = useState(true);

  // 数据状态
  const [pointSellerData, setPointSellerData] = useState(null);
  const [statistics, setStatistics] = useState({
    todayStats: {
      cardCount: 0,
      cardPoints: 0,
      cardCash: 0,
      mobileCount: 0,
      mobilePoints: 0,
      mobileCash: 0,
      totalPoints: 0,
      totalCash: 0
    },
    totalStats: {
      totalCardCount: 0,
      totalCardPoints: 0,
      totalCardCash: 0,
      totalMobileCount: 0,
      totalMobilePoints: 0,
      totalMobileCash: 0,
      totalPoints: 0,
      totalCash: 0
    }
  });
  const [issuanceRecords, setIssuanceRecords] = useState([]);

  // 🆕 inline styles（参考 SellerDashboard）
  const styles = {
    tabButton: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.25rem',
      padding: '1rem 0.5rem',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      cursor: 'pointer',
      color: '#757575',
      transition: 'all 0.2s',
      borderBottom: '3px solid transparent'
    },
    tabButtonActive: {
      color: '#2196F3',
      borderBottomColor: '#2196F3'
    },
    tabLabel: {
      fontSize: '0.85rem',
      fontWeight: 500
    }
  };

  // ===== 工具函数 =====
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

  // ===== 检查时效性（6:00-18:00）=====
  // ⚠️ 测试阶段：时间限制已禁用
  const checkActiveHours = () => {
    // 🔴 测试阶段：始终返回 true（禁用时间限制）
    setIsActiveHours(true);
    return true;
    
    // 📝 生产环境代码（已注释）：
    // const now = new Date();
    // const hour = now.getHours();
    // const isActive = hour >= 6 && hour < 18;
    // setIsActiveHours(isActive);
    // return isActive;
  };

  // 定时检查时效性
  // ⚠️ 测试阶段：保留检查机制但始终返回 true
  useEffect(() => {
    checkActiveHours();
    const interval = setInterval(checkActiveHours, 60000); // 每分钟检查一次
    return () => clearInterval(interval);
  }, []);

  // 登出处理（與 SellerManager 相同的行為）
  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('pointSellerInfo');
      localStorage.removeItem('currentUser');
      console.log('[PointSeller] 用户已登出');
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('退出登录失败:', error);
      window.mybazaarShowToast('退出登录失败: ' + (error?.message || '請重試'));
    }
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
    if (!roles.includes('pointSeller')) {
      setError('您没有权限访问此页面');
      setLoading(false);
      return;
    }

    loadPointSellerData();
  }, [authLoading, eventLoading, eventError, currentUser, userProfile, orgCode, eventCode, orgEventCode, navigate]);

  // ===== 2. 加载PointSeller数据 =====
  const loadPointSellerData = async () => {
    try {
      setLoading(true);

      const orgId = userProfile?.organizationId || orgCode;
      const evtId = userProfile?.eventId || eventCode;

      if (!orgId || !evtId) {
        setError('无法获取活动信息，请重新登录');
        setLoading(false);
        return;
      }

      // 从userProfile读取pointSeller数据
      if (userProfile?.pointSeller) {
        setPointSellerData(userProfile);
        setStatistics({
          todayStats: userProfile.pointSeller.todayStats || {},
          totalStats: userProfile.pointSeller.totalStats || {}
        });
      } else {
        setPointSellerData({
          basicInfo: userProfile?.basicInfo || {}
        });
      }

      setLoading(false);
    } catch (err) {
      console.error('加载PointSeller数据失败:', err);
      setError('加载数据失败: ' + err.message);
      setLoading(false);
    }
  };

  // ===== 2.5. 实时监听 PointSeller 统计数据 =====
  // ⭐ 新增：监听用户文档中的 pointSeller 字段，确保统计数据实时更新
  useEffect(() => {
    const orgId = userProfile?.organizationId || orgCode;
    const evtId = userProfile?.eventId || eventCode;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    // 直接监听用户文档（使用 userId 作为文档 ID）
    const userDocRef = doc(db, 'organizations', orgId, 'events', evtId, 'users', userId);
    const unsubscribe = onSnapshot(
      userDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const userData = docSnap.data();
          if (userData.pointSeller) {
            console.log('[PointSeller] 🔄 统计数据已实时更新:', userData.pointSeller);
            setStatistics({
              todayStats: userData.pointSeller.todayStats || {},
              totalStats: userData.pointSeller.totalStats || {}
            });
          }
        }
      },
      (error) => {
        console.error('[PointSeller] ❌ 监听统计数据失败:', error.message);
      }
    );

    return () => unsubscribe();
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, orgCode, eventCode]);

  // ===== 3. 实时监听发行记录 =====
  useEffect(() => {
    const orgId = userProfile?.organizationId || orgCode;
    const evtId = userProfile?.eventId || eventCode;
    const userId = userProfile?.userId;

    if (!orgId || !evtId || !userId) return;

    // ✅ v5.1：统一从 transactions 集合查询两种销售类型（已删除废弃的 pointCards 查询）
    const transactionsRef = collection(db, 'organizations', orgId, 'events', evtId, 'transactions');
    
    // ✅ v5.0：查询直接销售交易（pointseller_to_customer）
    const qDirectSales = query(
      transactionsRef,
      where('sellerId', '==', userId),
      where('transactionType', '==', 'pointseller_to_customer'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribeDirectSales = onSnapshot(qDirectSales, (snapshot) => {
      const sales = snapshot.docs.map(doc => ({
        id: doc.id,
        type: 'direct_sale',
        ...doc.data()
      }));

      // 合并到发行记录中
      setIssuanceRecords(prev => {
        const cards = prev.filter(r => r.type === 'point_card');
        return [...cards, ...sales].sort((a, b) => {
          const aTime = a.metadata?.createdAt || a.timestamp;
          const bTime = b.metadata?.createdAt || b.timestamp;
          return bTime - aTime;
        });
      });
    }, (error) => {
      console.error('监听直接销售记录失败:', error);
    });

    // ✅ v5.0：查询点数卡发行交易（pointseller_card_issuance）
    const qCardIssuances = query(
      transactionsRef,
      where('sellerId', '==', userId),
      where('transactionType', '==', 'pointseller_card_issuance'),
      orderBy('timestamp', 'desc')
    );

    const unsubscribeCardIssuances = onSnapshot(qCardIssuances, (snapshot) => {
      // 📌 将 transactions 中的卡片发行记录转换为前端显示格式
      const issuances = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          type: 'point_card',  // ✅ 统一为 point_card 类型用于前端显示
          transactionType: 'pointseller_card_issuance',  // 保留原始交易类型供参考
          
          // 📌 v5.1 字段映射：将 Cloud Function 的字段转换为前端期望的格式
          points: data.pointAmount || 0,  // 映射：pointAmount → points
          amount: data.cashAmount || 0,   // 映射：cashAmount → amount（现金）
          timestamp: data.metadata?.createdAt || data.timestamp,  // 映射：metadata.createdAt → timestamp
          
          // 保持原始数据用于备用
          ...data
        };
      });

      // 合并所有发行记录（来自两种交易类型）
      setIssuanceRecords(prev => {
        const sales = prev.filter(r => r.type === 'direct_sale');
        return [...issuances, ...sales].sort((a, b) => {
          const aTime = a.metadata?.createdAt || a.timestamp;
          const bTime = b.metadata?.createdAt || b.timestamp;
          return bTime - aTime;
        });
      });
    }, (error) => {
      console.error('监听点数卡发行记录失败:', error);
    });

    return () => {
      unsubscribeDirectSales();
      unsubscribeCardIssuances();
    };
  }, [userProfile?.organizationId, userProfile?.eventId, userProfile?.userId, orgCode, eventCode]);

  // ===== 4. 刷新数据 =====
  // ⭐ 改进：触发重新加载（统计数据现在通过实时监听自动更新）
  const handleRefresh = () => {
    console.log('[PointSeller] 手动刷新触发');
    loadPointSellerData();
  };

  // ===== 5. 渲染 =====
  if (loading) {
    return (
      <div className="ps-loading-container">
        <div className="ps-spinner"></div>
        <p>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ps-error-container">
        <p className="ps-error-message">{error}</p>
        <button className="ps-button" onClick={() => navigate(`/login/${orgEventCode}`)}>
          返回登录
        </button>
      </div>
    );
  }

  return (
    <div className="ps-container">
      {/* 🆕 共用 Header 组件（包含角色切换器和登出按钮） */}
      <DashboardHeader
        title="点数卡销售"
        subtitle="Point Card Sales"
        logoUrl={event?.logoUrl}
        userName={pointSellerData?.basicInfo?.chineseName || pointSellerData?.basicInfo?.englishName}
        userPhone={pointSellerData?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.includes('pointSeller') ? 'pointSeller' : userProfile?.roles?.[0]}
        orgEventCode={orgCode && eventCode ? `${orgCode}-${eventCode}` : orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Tab 导航 */}
      <nav className="tab-navigation">
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'issue-card' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('issue-card')}
        >
          <PointsCardIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>发行点数卡</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'direct-sale' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('direct-sale')}
        >
          <PointsToPhoneIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>销售点数</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'history' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('history')}
        >
          <ChartHistogramIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>发行记录</span>
        </button>
        <button
          style={{
            ...styles.tabButton,
            ...(activeTab === 'cash-submission' ? styles.tabButtonActive : {})
          }}
          onClick={() => setActiveTab('cash-submission')}
        >
          <PersonalFinanceIcon style={{ width: '1.5rem', height: '1.5rem' }} />
          <span style={styles.tabLabel}>现金上交</span>
        </button>
      </nav>

      {/* Tab 内容 */}
      <main className="dashboard-content">
        {activeTab === 'issue-card' && (
          <IssuePointCard
            isActiveHours={isActiveHours}
            statistics={statistics}
            onRefresh={handleRefresh}
            currentUser={currentUser}
            userProfile={userProfile}
            organizationId={orgCode}
            eventId={eventCode}
            callFunction={callOnCallWithAuthFallback}
          />
        )}

        {activeTab === 'direct-sale' && (
          <DirectSale
            isActiveHours={isActiveHours}
            statistics={statistics}
            onRefresh={handleRefresh}
            currentUser={currentUser}
            userProfile={userProfile}
            organizationId={orgCode}
            eventId={eventCode}
            callFunction={callOnCallWithAuthFallback}
          />
        )}

        {activeTab === 'history' && (
          <PointSellerTransactions
            statistics={statistics}
            records={issuanceRecords}
            onRefresh={handleRefresh}
          />
        )}

        {activeTab === 'cash-submission' && (
          <CashSubmission
            statistics={statistics}
            records={issuanceRecords}
            onRefresh={handleRefresh}
            currentUser={currentUser}
            userProfile={userProfile}
            organizationId={orgCode}
            eventId={eventCode}
            callFunction={callOnCallWithAuthFallback}
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

export default PointSellerDashboard;