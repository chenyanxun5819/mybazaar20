import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db, functions as fbFunctions, FUNCTIONS_REGION, FIREBASE_PROJECT_ID } from '../../config/firebase';
import { collection, getDocs, query, orderBy, where, doc, getDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import { fetchDoc, fetchCollectionWithOrder, fetchCollectionDocs } from '../../utils/firestoreHelpers';
import CreateMerchantModal from './components/CreateMerchantModal.jsx';
import EditMerchantModal from './components/EditMerchantModal.jsx';
import MerchantDetailsModal from './components/MerchantDetailsModal.jsx';

// 將可能的本地化物件/數字轉為字串（優先 zh-TW/zh-CN，其次 en-US）
const getLocalizedText = (val) => {
  if (val == null) return '';
  if (typeof val === 'string' || typeof val === 'number') return String(val);
  if (typeof val === 'object') {
    return val['zh-TW'] || val['zh-CN'] || val['en-US'] || val['en'] || val['zh'] || '';
  }
  return '';
};

// 將 Firestore Timestamp / Date / number / string 轉為可顯示日期字串
const formatDateText = (val) => {
  if (val == null) return '';
  try {
    if (typeof val === 'string') return val;
    if (typeof val === 'number') return new Date(val).toLocaleDateString('zh-TW');
    if (val instanceof Date) return val.toLocaleDateString('zh-TW');
    // Firestore Timestamp (has toDate)
    if (typeof val === 'object' && typeof val.toDate === 'function') {
      return val.toDate().toLocaleDateString('zh-TW');
    }
  } catch {
    // ignore
  }
  return '';
};

const MerchantManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { userProfile, isAuthenticated: authReady, loading: authLoading } = useAuth();
  const { organizationId: ctxOrganizationId, eventId: ctxEventId, event: ctxEvent, loading: eventLoading } = useEvent();
  const functions = fbFunctions;

  const redirectToLogin = (reason = '') => {
    if (reason) console.warn('[MerchantManager] redirectToLogin:', reason);
    if (orgEventCode) {
      navigate(`/login/${orgEventCode}`, { replace: true });
    } else {
      navigate('/platform/login', { replace: true });
    }
  };

  const isUnauthOrPermError = (err) => {
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || '').toLowerCase();
    return (
      code.includes('unauth') ||
      code.includes('permission') ||
      msg.includes('用户未登录') ||
      msg.includes('未登录') ||
      msg.includes('missing or insufficient permissions')
    );
  };

  const decodeJwtPayload = (jwt) => {
    try {
      const parts = String(jwt || '').split('.');
      if (parts.length < 2) return null;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const jsonStr = decodeURIComponent(
        Array.prototype.map
          .call(atob(padded), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonStr);
    } catch {
      return null;
    }
  };

  const ensureAuthToken = async (forceRefresh = false) => {
    if (!auth.currentUser) {
      throw new Error('用户未登录');
    }
    // 取得（或強制刷新）ID token，確保 callable 帶上 Authorization
    return await auth.currentUser.getIdToken(!!forceRefresh);
  };

  const callCallableViaFetch = async (name, payload, idToken) => {
    // Callable protocol: POST { data: ... } with Bearer token
    const url = `https://${FUNCTIONS_REGION}-${FIREBASE_PROJECT_ID}.cloudfunctions.net/${name}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`
      },
      body: JSON.stringify({ data: payload })
    });

    let json;
    try {
      json = await resp.json();
    } catch {
      json = null;
    }

    if (!resp.ok) {
      const msg =
        json?.error?.message ||
        json?.error?.status ||
        `HTTP ${resp.status}`;
      const err = new Error(msg);
      err.httpStatus = resp.status;
      err.details = json;
      throw err;
    }

    // Most callable responses are { result: ... } (legacy) or { data: ... } depending on runtime.
    const data = json?.result ?? json?.data ?? json;
    return { data };
  };

  const callFunction = async (name, payload) => {
    if (authLoading) {
      throw new Error('登录状态初始化中，请稍后再试');
    }
    if (!authReady) {
      throw new Error('用户未登录');
    }

    // 在部分瀏覽器/重導後，token 可能尚未 ready，先強制刷新一次
    let idToken = await ensureAuthToken(true);
    const payloadWithToken = { ...(payload || {}), idToken };

    // Lightweight diagnostics (helps confirm project/audience mismatch)
    try {
      const jwtPayload = decodeJwtPayload(idToken);
      console.groupCollapsed(`[MerchantManager] callFunction ${name} auth debug`);
      console.log('project/region', { FIREBASE_PROJECT_ID, FUNCTIONS_REGION });
      console.log('currentUser', { uid: auth.currentUser?.uid, email: auth.currentUser?.email || null });
      console.log('token.aud/token.iss', { aud: jwtPayload?.aud, iss: jwtPayload?.iss });
      console.groupEnd();
    } catch {
      // ignore
    }

    const fn = httpsCallable(functions, name);
    try {
      return await fn(payloadWithToken);
    } catch (err) {
      // 若仍回 unauthenticated，等待一個 tick 再刷新重試一次
      if (isUnauthOrPermError(err)) {
        try {
          await new Promise(r => setTimeout(r, 250));
          idToken = await ensureAuthToken(true);
          return await fn({ ...(payload || {}), idToken });
        } catch (retryErr) {
          // Final fallback: send Authorization header explicitly (some environments fail to attach it)
          try {
            idToken = await ensureAuthToken(true);
            return await callCallableViaFetch(name, { ...(payload || {}), idToken }, idToken);
          } catch (fetchErr) {
            throw fetchErr;
          }
        }
      }
      throw err;
    }
  };

  // 状态管理
  const [loading, setLoading] = useState(true);
  const [merchants, setMerchants] = useState([]);
  const [filteredMerchants, setFilteredMerchants] = useState([]);
  const [eventData, setEventData] = useState(null);
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');

  // 筛选和搜索
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, active, inactive
  const [ownerFilter, setOwnerFilter] = useState('all'); // all, assigned, unassigned

  // 模态框
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState(null);

  // 统计数据
  const [statistics, setStatistics] = useState({
    totalMerchants: 0,
    activeMerchants: 0,
    totalRevenue: 0,
    todayRevenue: 0,
    withAsists: 0,
    totalAsists: 0
  });

  // 可用的 merchantOwners 和 merchantAsists
  const [availableOwners, setAvailableOwners] = useState([]);
  const [ownerDirectory, setOwnerDirectory] = useState([]);
  const [asistDirectory, setAsistDirectory] = useState([]);
  const [availableAsists, setAvailableAsists] = useState([]);

  // 加载数据（使用 EventContext 已解析出的 Firestore 文档 ID）
  useEffect(() => {
    if (ctxOrganizationId && ctxEventId) {
      setOrganizationId(ctxOrganizationId);
      setEventId(ctxEventId);
      setEventData(ctxEvent || null);
      loadMerchants(ctxOrganizationId, ctxEventId);
      loadAvailableUsers(ctxOrganizationId, ctxEventId);
    }
  }, [ctxOrganizationId, ctxEventId, ctxEvent]);

  // 筛选摊位
  useEffect(() => {
    filterMerchants();
  }, [merchants, searchTerm, statusFilter, ownerFilter]);

  // ============================================
  // 加载摊位列表
  // ============================================
  const loadMerchants = async (orgId = organizationId, evtId = eventId) => {
    try {
      // 防禦性檢查
      if (!orgId || !evtId) {
        console.warn('缺少必要参数:', { organizationId: orgId, eventId: evtId });
        return;
      }

      // 使用安全助手加载摊位列表
      const merchantsList = await fetchCollectionWithOrder(
        { field: 'metadata.createdAt', direction: 'desc' },
        'organizations',
        orgId,
        'events',
        evtId,
        'merchants'
      );

      setMerchants(merchantsList);
      calculateStatistics(merchantsList);
    } catch (error) {
      console.error('加载摊位列表失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('loadMerchants unauth/perm');
        return;
      }
      window.mybazaarShowToast('加载摊位列表失败: ' + (error?.message || String(error)));
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // 加载可用的 owners 和 asists
  // ============================================
  const loadAvailableUsers = async (orgId = organizationId, evtId = eventId) => {
    try {
      // 防禦性檢查
      if (!orgId || !evtId) {
        console.warn('缺少必要参数:', { organizationId: orgId, eventId: evtId });
        return;
      }

      // 使用安全助手加载用户列表
      const users = await fetchCollectionDocs(
        'organizations',
        orgId,
        'events',
        evtId,
        'users'
      );

      // Debug：協助排查為何 select 沒出現 merchantOwner
      console.groupCollapsed('[MerchantManager] loadAvailableUsers debug');
      console.log('path', { organizationId: orgId, eventId: evtId, collection: 'users' });
      console.log('total users fetched', users.length);
      const merchantOwnerRoleUsers = users
        .filter(u => Array.isArray(u.roles) && u.roles.includes('merchantOwner'))
        .map(u => ({
          id: u.id,
          roles: u.roles,
          merchantOwnerMerchantId: u.merchantOwner?.merchantId ?? null
        }));
      console.log('users with roles includes "merchantOwner"', merchantOwnerRoleUsers.length);
      if (merchantOwnerRoleUsers.length > 0) {
        console.table(merchantOwnerRoleUsers.slice(0, 50));
        if (merchantOwnerRoleUsers.length > 50) {
          console.log(`(truncated) showing first 50 of ${merchantOwnerRoleUsers.length}`);
        }
      }

      const allMerchantOwners = users.filter(user =>
        user.roles?.includes('merchantOwner')
      );

      // 筛选 merchantOwner（未被分配的）
      const owners = users.filter(user =>
        user.roles?.includes('merchantOwner') &&
        !user.merchantOwner?.merchantId
      );

      const excludedMerchantOwners = users
        .filter(u => Array.isArray(u.roles) && u.roles.includes('merchantOwner'))
        .filter(u => !!u.merchantOwner?.merchantId)
        .map(u => ({ id: u.id, merchantOwnerMerchantId: u.merchantOwner?.merchantId ?? null }));
      console.log('availableOwners count (after unassigned filter)', owners.length);
      if (excludedMerchantOwners.length > 0) {
        console.log('excluded merchantOwner users because merchantOwner.merchantId is set', excludedMerchantOwners.length);
        console.table(excludedMerchantOwners.slice(0, 50));
      }
      console.groupEnd();


      // 筛选 merchantAsist（未被分配的）
      const asists = users.filter(user =>
        user.roles?.includes('merchantAsist') &&
        !user.merchantAsist?.merchantId  // 👈 关键修复
      );

      const allMerchantAsists = users.filter(user =>
        user.roles?.includes('merchantAsist')
      );

      // Debug 信息（可选）
      const excludedMerchantAsists = users
        .filter(u => Array.isArray(u.roles) && u.roles.includes('merchantAsist'))
        .filter(u => !!u.merchantAsist?.merchantId)
        .map(u => ({ id: u.id, merchantAsistMerchantId: u.merchantAsist?.merchantId ?? null }));
      console.log('availableAsists count (after unassigned filter)', asists.length);
      if (excludedMerchantAsists.length > 0) {
        console.log('excluded merchantAsist users because merchantAsist.merchantId is set', excludedMerchantAsists.length);
        console.table(excludedMerchantAsists.slice(0, 50));
      }
      console.groupEnd();

      setAvailableOwners(owners);
      setOwnerDirectory(allMerchantOwners);
      setAsistDirectory(allMerchantAsists);
      setAvailableAsists(asists);

    } catch (error) {
      console.error('加载用户列表失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('loadAvailableUsers unauth/perm');
        return;
      }
    }
  };

  // ============================================
  // 计算统计数据
  // ============================================
  const calculateStatistics = (merchantsList) => {
    const stats = {
      totalMerchants: merchantsList.length,
      activeMerchants: merchantsList.filter(m => m.operationStatus?.isActive).length,
      totalRevenue: merchantsList.reduce((sum, m) => sum + (m.revenueStats?.totalRevenue || 0), 0),
      todayRevenue: merchantsList.reduce((sum, m) => sum + (m.dailyRevenue?.today || 0), 0),
      withAsists: merchantsList.filter(m => (m.merchantAsistsCount || 0) > 0).length,
      totalAsists: merchantsList.reduce((sum, m) => sum + (m.merchantAsistsCount || 0), 0)
    };
    setStatistics(stats);
  };

  // ============================================
  // 筛选摊位
  // ============================================
  const filterMerchants = () => {
    let filtered = [...merchants];

    // 搜索
    if (searchTerm) {
      filtered = filtered.filter(m =>
        m.stallName?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // 营业状态筛选
    if (statusFilter !== 'all') {
      filtered = filtered.filter(m => {
        if (statusFilter === 'active') return m.operationStatus?.isActive === true;
        if (statusFilter === 'inactive') return m.operationStatus?.isActive === false;
        return true;
      });
    }

    // 摊主筛选
    if (ownerFilter !== 'all') {
      filtered = filtered.filter(m => {
        if (ownerFilter === 'assigned') return m.merchantOwnerId != null;
        if (ownerFilter === 'unassigned') return m.merchantOwnerId == null;
        return true;
      });
    }

    setFilteredMerchants(filtered);
  };

  // ============================================
  // 创建摊位
  // ============================================
  const handleCreateMerchant = async (merchantData) => {
    try {
      if (authLoading || !authReady) {
        window.mybazaarShowToast('登录状态尚未就绪，请稍后再试');
        redirectToLogin('createMerchant auth not ready');
        return;
      }

      const result = await callFunction('createMerchantHttp', {
        organizationId,
        eventId,
        ...merchantData
      });

      console.log('创建摊位成功:', result.data);
      window.mybazaarShowToast('摊位创建成功！');
      setShowCreateModal(false);
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('创建摊位失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('createMerchant unauth/perm');
        return;
      }
      window.mybazaarShowToast('创建摊位失败: ' + (error?.message || String(error)));
    }
  };

  // ============================================
  // 更新摊位
  // ============================================
  const handleUpdateMerchant = async (merchantId, updates) => {
    try {
      if (authLoading || !authReady) {
        window.mybazaarShowToast('登录状态尚未就绪，请稍后再试');
        redirectToLogin('updateMerchant auth not ready');
        return;
      }

      const result = await callFunction('updateMerchantHttp', {
        organizationId,
        eventId,
        merchantId,
        updates
      });

      console.log('更新摊位成功:', result.data);
      window.mybazaarShowToast('摊位更新成功！');
      setShowEditModal(false);
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('更新摊位失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('updateMerchant unauth/perm');
        return;
      }
      window.mybazaarShowToast('更新摊位失败: ' + (error?.message || String(error)));
    }
  };

  // ============================================
  // 切换营业状态
  // ============================================
  const handleToggleStatus = async (merchantId, isActive, pauseReason = '') => {
    try {
      if (authLoading || !authReady) {
        window.mybazaarShowToast('登录状态尚未就绪，请稍后再试');
        redirectToLogin('toggleStatus auth not ready');
        return;
      }

      const result = await callFunction('toggleMerchantStatusHttp', {
        organizationId,
        eventId,
        merchantId,
        isActive,
        pauseReason
      });

      console.log('状态切换成功:', result.data);
      window.mybazaarShowToast(result.data.message);
      loadMerchants(); // 刷新列表
    } catch (error) {
      console.error('状态切换失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('toggleStatus unauth/perm');
        return;
      }
      window.mybazaarShowToast('状态切换失败: ' + (error?.message || String(error)));
    }
  };

  // ============================================
  // 删除摊位
  // ============================================
  const handleDeleteMerchant = async (merchantId) => {
    if (!confirm('确定要删除这个摊位吗？\n\n这将是软删除，数据会保留。')) {
      return;
    }

    try {
      if (authLoading || !authReady) {
        window.mybazaarShowToast('登录状态尚未就绪，请稍后再试');
        redirectToLogin('deleteMerchant auth not ready');
        return;
      }

      const result = await callFunction('deleteMerchantHttp', {
        organizationId,
        eventId,
        merchantId,
        hardDelete: false,
        deleteReason: '管理员删除'
      });

      console.log('删除摊位成功:', result.data);
      window.mybazaarShowToast('摊位已删除！');
      loadMerchants(); // 刷新列表
      loadAvailableUsers(); // 刷新可用用户
    } catch (error) {
      console.error('删除摊位失败:', error);
      if (isUnauthOrPermError(error)) {
        window.mybazaarShowToast('登录状态已失效，请重新登录');
        redirectToLogin('deleteMerchant unauth/perm');
        return;
      }
      window.mybazaarShowToast('删除摊位失败: ' + (error?.message || String(error)));
    }
  };

  // ============================================
  // 打开编辑模态框
  // ============================================
  const handleEditClick = (merchant) => {
    setSelectedMerchant(merchant);
    setShowEditModal(true);
  };

  // ============================================
  // 打开详情模态框
  // ============================================
  const handleDetailsClick = (merchant) => {
    setSelectedMerchant(merchant);
    setShowDetailsModal(true);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('merchantManagerInfo');
      localStorage.removeItem('currentUser');
      navigate(`/login/${orgEventCode}`, { replace: true });
    } catch (error) {
      console.error('[MerchantManager] 登出失败:', error);
      window.mybazaarShowToast('登出失败，请重试');
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  // ============================================
  // 渲染
  // ============================================
  if (loading || eventLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 🆕 共用 Header 组件（临时，如需自定义，稍后可修改参数） */}
      <DashboardHeader
        title="摊位管理"
        subtitle="Merchant Manager Dashboard"
        logoUrl={eventData?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName}
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.includes('merchantManager') ? 'merchantManager' : userProfile?.roles?.[0]}
        orgEventCode={orgEventCode}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* 统计面板 */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={styles.statIcon}>🏪</div>
          <div>
            <div style={styles.statValue}>{statistics.totalMerchants}</div>
            <div style={styles.statLabel}>摊位总数</div>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statIcon}>✅</div>
          <div>
            <div style={styles.statValue}>{statistics.activeMerchants}</div>
            <div style={styles.statLabel}>营业中</div>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statIcon}>💰</div>
          <div>
            <div style={styles.statValue}>{statistics.totalRevenue.toLocaleString()}</div>
            <div style={styles.statLabel}>总收入</div>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statIcon}>📈</div>
          <div>
            <div style={styles.statValue}>{statistics.todayRevenue.toLocaleString()}</div>
            <div style={styles.statLabel}>今日收入</div>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statIcon}>👥</div>
          <div>
            <div style={styles.statValue}>{statistics.totalAsists}</div>
            <div style={styles.statLabel}>助理总数</div>
          </div>
        </div>

        <div style={styles.statCard}>
          <div style={styles.statIcon}>🤝</div>
          <div>
            <div style={styles.statValue}>{statistics.withAsists}</div>
            <div style={styles.statLabel}>配有助理</div>
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div style={styles.toolbar}>
        <button
          onClick={() => setShowCreateModal(true)}
          style={styles.createButton}
        >
          ➕ 创建摊位
        </button>

        <div style={styles.filters}>
          {/* 搜索 */}
          <input
            type="text"
            placeholder="搜索摊位名称..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />

          {/* 营业状态筛选 */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部状态</option>
            <option value="active">营业中</option>
            <option value="inactive">已暂停</option>
          </select>

          {/* 摊主筛选 */}
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部摊位</option>
            <option value="assigned">已指定摊主</option>
            <option value="unassigned">未指定摊主</option>
          </select>

          {/* 刷新按钮 */}
          <button
            onClick={loadMerchants}
            style={styles.refreshButton}
          >
            🔄 刷新
          </button>
        </div>
      </div>

      {/* 摊位列表 */}
      <div style={styles.tableContainer}>
        <table style={styles.table}>
          <thead>
            <tr style={styles.tableHeader}>
              <th style={styles.th}>#</th>
              <th style={styles.th}>摊位名称</th>
              <th style={styles.th}>摊主</th>
              <th style={styles.th}>助理数</th>
              <th style={styles.th}>状态</th>
              <th style={styles.th}>总收入</th>
              <th style={styles.th}>今日收入</th>
              <th style={styles.th}>交易数</th>
              <th style={styles.th}>联系电话</th>
              <th style={styles.th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredMerchants.length === 0 ? (
              <tr>
                <td colSpan="10" style={styles.emptyCell}>
                  {searchTerm || statusFilter !== 'all' || ownerFilter !== 'all'
                    ? '没有符合条件的摊位'
                    : '还没有摊位，点击"创建摊位"开始'}
                </td>
              </tr>
            ) : (
              filteredMerchants.map((merchant, index) => (
                <tr key={merchant.id} style={styles.tableRow}>
                  <td style={styles.td}>{index + 1}</td>
                  <td style={styles.td}>
                    <strong>{merchant.stallName}</strong>
                    {merchant.description && (
                      <div style={styles.description}>{merchant.description}</div>
                    )}
                  </td>
                  <td style={styles.td}>
                    {merchant.merchantOwnerId ? (
                      <span style={styles.ownerBadge}>已分配</span>
                    ) : (
                      <span style={styles.unassignedBadge}>未分配</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={styles.asistCount}>
                      {merchant.merchantAsistsCount || 0} / 5
                    </span>
                  </td>
                  <td style={styles.td}>
                    {merchant.operationStatus?.isActive ? (
                      <span style={styles.activeBadge}>营业中</span>
                    ) : (
                      <span style={styles.inactiveBadge}>已暂停</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    {(merchant.revenueStats?.totalRevenue || 0).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    {(merchant.dailyRevenue?.today || 0).toLocaleString()}
                  </td>
                  <td style={styles.td}>
                    {merchant.revenueStats?.transactionCount || 0}
                  </td>
                  <td style={styles.td}>
                    {merchant.contactInfo?.phone || '-'}
                  </td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      <button
                        onClick={() => handleDetailsClick(merchant)}
                        style={styles.actionButton}
                        title="查看详情"
                      >
                        👁️
                      </button>
                      <button
                        onClick={() => handleEditClick(merchant)}
                        style={styles.actionButton}
                        title="编辑"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleToggleStatus(
                          merchant.id,
                          !merchant.operationStatus?.isActive,
                          merchant.operationStatus?.isActive ? '临时休息' : ''
                        )}
                        style={styles.actionButton}
                        title={merchant.operationStatus?.isActive ? '暂停营业' : '恢复营业'}
                      >
                        {merchant.operationStatus?.isActive ? '⏸️' : '▶️'}
                      </button>
                      <button
                        onClick={() => handleDeleteMerchant(merchant.id)}
                        style={styles.deleteButton}
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建摊位模态框 */}
      {showCreateModal && (
        <CreateMerchantModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateMerchant}
          availableOwners={availableOwners}
          availableAsists={availableAsists}
        />
      )}

      {/* 编辑摊位模态框 */}
      {showEditModal && selectedMerchant && (
        <EditMerchantModal
          merchant={selectedMerchant}
          onClose={() => {
            setShowEditModal(false);
            setSelectedMerchant(null);
          }}
          onSubmit={handleUpdateMerchant}
          availableOwners={availableOwners}
          ownerDirectory={ownerDirectory}
          asistDirectory={asistDirectory}
          availableAsists={availableAsists}
        />
      )}

      {/* 摊位详情模态框 */}
      {showDetailsModal && selectedMerchant && (
        <MerchantDetailsModal
          merchant={selectedMerchant}
          onClose={() => {
            setShowDetailsModal(false);
            setSelectedMerchant(null);
          }}
        />
      )}

      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter
        event={ctxEvent}
        eventCode={orgEventCode}
        showEventInfo={true}
      />
    </div>
  );
};

// ============================================
// 样式
// ============================================
const styles = {
  container: {
    padding: '2rem',
    maxWidth: '1600px',
    margin: '0 auto',
    backgroundColor: '#f5f5f5',
    minHeight: '100vh'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    gap: '1rem'
  },
  spinner: {
    width: '50px',
    height: '50px',
    border: '5px solid #f3f3f3',
    borderTop: '5px solid #8b5cf6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem',
    backgroundColor: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '2rem',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  subtitle: {
    fontSize: '1rem',
    color: '#6b7280',
    margin: '0.5rem 0 0 0'
  },
  backButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statCard: {
    backgroundColor: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  createButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(139,92,246,0.3)'
  },
  filters: {
    display: 'flex',
    gap: '1rem',
    flexWrap: 'wrap'
  },
  searchInput: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    minWidth: '250px'
  },
  filterSelect: {
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: 'white',
    cursor: 'pointer'
  },
  refreshButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500'
  },
  tableContainer: {
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    overflow: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeader: {
    backgroundColor: '#f9fafb'
  },
  th: {
    padding: '1rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb'
  },
  td: {
    padding: '1rem',
    color: '#1f2937'
  },
  emptyCell: {
    padding: '3rem',
    textAlign: 'center',
    color: '#9ca3af',
    fontSize: '1.125rem'
  },
  description: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  ownerBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  unassignedBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  asistCount: {
    fontWeight: '500'
  },
  activeBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  inactiveBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#f3f4f6',
    color: '#4b5563',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  actions: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionButton: {
    padding: '0.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1.125rem'
  },
  deleteButton: {
    padding: '0.5rem',
    backgroundColor: '#fee2e2',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '1.125rem'
  }
};

export default MerchantManagerDashboard;

