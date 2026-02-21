import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../../config/firebase';
import {
  doc, getDoc, collection, getDocs, query, where, orderBy
} from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import DashboardHeader from '../../components/common/DashboardHeader';
import DashboardFooter from '../../components/common/DashboardFooter';
import AuditorIcon from '../../assets/auditor.svg?react';

// ============================================================
// 路由配置说明（需在 App.jsx / Router 中添加）：
//   <Route path="/:orgEventCode/auditor" element={<AuditorDashboard />} />
// ============================================================

// ────────────────────────────────────────────────────────────
// 工具函数
// ────────────────────────────────────────────────────────────
const fmt = (n, decimals = 2) =>
  typeof n === 'number' ? n.toFixed(decimals) : '—';

const fmtInt = (n) =>
  typeof n === 'number' ? n.toLocaleString() : '—';

const fmtPct = (n) =>
  typeof n === 'number' ? `${(n * 100).toFixed(1)}%` : '—';

const fmtDate = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const fmtDateTime = (ts) => {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
};

const maskPhone = (phone) => {
  if (!phone) return '—';
  if (phone.length < 6) return phone;
  return `${phone.substring(0, 3)}${'*'.repeat(phone.length - 6)}${phone.substring(phone.length - 3)}`;
};

// ────────────────────────────────────────────────────────────
// Excel 导出（SheetJS / xlsx）
// 懒加载：只有用户点击导出时才引入库
// ────────────────────────────────────────────────────────────
const loadXlsx = async () => {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs');
  return XLSX;
};

const exportToExcel = async (sheetsConfig, filename) => {
  try {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    sheetsConfig.forEach(({ name, headers, rows }) => {
      const data = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(data);
      // 列宽自适应
      ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 2, 12) }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    });
    XLSX.writeFile(wb, filename);
    return true;
  } catch (err) {
    console.error('Excel 导出失败:', err);
    window.mybazaarShowToast?.('导出失败，请稍后重试');
    return false;
  }
};

// ────────────────────────────────────────────────────────────
// Tab 配置
// ────────────────────────────────────────────────────────────
const TABS = [
  { id: 'overview',     label: '活动概览',    icon: '📊' },
  { id: 'department',   label: '部门汇总',    icon: '🏫' },
  { id: 'merchant',     label: '商家统计',    icon: '🏪' },
  { id: 'pointSeller',  label: '点数直售员',  icon: '🎫' },
  { id: 'cashier',      label: '现金收取',    icon: '💰' },
];

// ────────────────────────────────────────────────────────────
// 子组件：统计卡片
// ────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = '#6366f1' }) => (
  <div style={{
    background: 'white',
    borderRadius: '10px',
    padding: '1.25rem 1.5rem',
    boxShadow: '0 1px 6px rgba(0,0,0,0.08)',
    borderLeft: `4px solid ${color}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  }}>
    <div style={{ fontSize: '0.8rem', color: '#6b7280', fontWeight: '500' }}>{label}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: '700', color: '#111827' }}>{value}</div>
    {sub && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{sub}</div>}
  </div>
);

// ────────────────────────────────────────────────────────────
// 子组件：通用数据表格
// ────────────────────────────────────────────────────────────
const DataTable = ({ columns, rows, emptyText = '暂无数据' }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
      <thead>
        <tr style={{ background: '#f8fafc' }}>
          {columns.map((col, i) => (
            <th key={i} style={{
              padding: '0.75rem 1rem',
              textAlign: col.align || 'left',
              fontWeight: '600',
              color: '#374151',
              borderBottom: '2px solid #e5e7eb',
              whiteSpace: 'nowrap'
            }}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} style={{
              padding: '2rem', textAlign: 'center', color: '#9ca3af'
            }}>
              {emptyText}
            </td>
          </tr>
        ) : (
          rows.map((row, ri) => (
            <tr key={ri} style={{
              borderBottom: '1px solid #f3f4f6',
              background: ri % 2 === 0 ? 'white' : '#fafafa'
            }}>
              {columns.map((col, ci) => (
                <td key={ci} style={{
                  padding: '0.75rem 1rem',
                  textAlign: col.align || 'left',
                  color: '#374151'
                }}>
                  {col.render ? col.render(row) : row[col.key] ?? '—'}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>
);

// ────────────────────────────────────────────────────────────
// 子组件：模块容器（标题 + 导出按钮 + 内容）
// ────────────────────────────────────────────────────────────
const ModuleCard = ({ title, subtitle, onExport, exporting, children }) => (
  <div style={{
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    marginBottom: '1.5rem',
    overflow: 'hidden'
  }}>
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '1.25rem 1.5rem',
      borderBottom: '1px solid #f3f4f6',
      background: '#f9fafb'
    }}>
      <div>
        <div style={{ fontWeight: '700', color: '#111827', fontSize: '1rem' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.2rem' }}>{subtitle}</div>}
      </div>
      {onExport && (
        <button
          onClick={onExport}
          disabled={exporting}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.5rem 1rem',
            background: exporting ? '#e5e7eb' : '#10b981',
            color: exporting ? '#9ca3af' : 'white',
            border: 'none',
            borderRadius: '7px',
            fontSize: '0.8rem',
            fontWeight: '600',
            cursor: exporting ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s'
          }}
        >
          {exporting ? '导出中...' : '📥 导出 Excel'}
        </button>
      )}
    </div>
    <div style={{ padding: '1.5rem' }}>
      {children}
    </div>
  </div>
);

// ────────────────────────────────────────────────────────────
// 状态徽章
// ────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const map = {
    confirmed: { label: '已确认', color: '#10b981', bg: '#d1fae5' },
    pending:   { label: '待确认', color: '#f59e0b', bg: '#fef3c7' },
    disputed:  { label: '有争议', color: '#ef4444', bg: '#fee2e2' },
    rejected:  { label: '已拒绝', color: '#6b7280', bg: '#f3f4f6' },
  };
  const s = map[status] || { label: status || '—', color: '#6b7280', bg: '#f3f4f6' };
  return (
    <span style={{
      padding: '0.2rem 0.6rem',
      background: s.bg,
      color: s.color,
      borderRadius: '999px',
      fontSize: '0.75rem',
      fontWeight: '600'
    }}>
      {s.label}
    </span>
  );
};

// ════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════
const AuditorDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { userProfile, loading: authLoading } = useAuth();

  // ── 基础状态 ──
  const [loading, setLoading]           = useState(true);
  const [activeTab, setActiveTab]       = useState('overview');
  const [exporting, setExporting]       = useState(false);
  const [lastRefresh, setLastRefresh]   = useState(null);
  const [eventData, setEventData]       = useState(null);
  const [orgData, setOrgData]           = useState(null);
  const [orgId, setOrgId]               = useState('');
  const [eventId, setEventId]           = useState('');

  // ── 各模块数据 ──
  const [overviewData, setOverviewData]         = useState(null);
  const [deptRows, setDeptRows]                 = useState([]);      // 部门汇总（按SM分组）
  const [merchantRows, setMerchantRows]         = useState([]);
  const [pointSellerRows, setPointSellerRows]   = useState([]);
  const [cashierSellerRows, setCashierSellerRows]     = useState([]); // 非学生seller现金
  const [cashierSmRows, setCashierSmRows]               = useState([]); // sellerManager现金

  // ────────────────────────────────────────────────────────
  // 鉴权检查
  // ────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!userProfile) {
      navigate(`/login/${orgEventCode}`);
      return;
    }
    if (!userProfile.roles?.includes('auditor')) {
      console.warn('[AuditorDashboard] 权限不足，当前角色:', userProfile.roles);
      navigate(`/login/${orgEventCode}`);
      return;
    }
  }, [authLoading, userProfile, orgEventCode, navigate]);

  // ────────────────────────────────────────────────────────
  // 数据加载
  // ────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!userProfile) return;
    try {
      setLoading(true);

      const currentOrgId   = userProfile.organizationId;
      const currentEventId = userProfile.eventId;
      if (!currentOrgId || !currentEventId) {
        console.error('[AuditorDashboard] 缺少 organizationId / eventId');
        return;
      }
      setOrgId(currentOrgId);
      setEventId(currentEventId);

      // ── 并行加载基础文档 ──
      const [orgSnap, eventSnap] = await Promise.all([
        getDoc(doc(db, 'organizations', currentOrgId)),
        getDoc(doc(db, 'organizations', currentOrgId, 'events', currentEventId)),
      ]);

      const org   = orgSnap.exists()   ? orgSnap.data()   : {};
      const event = eventSnap.exists() ? eventSnap.data() : {};
      setOrgData(org);
      setEventData(event);

      // ── 并行加载各集合 ──
      const basePath = ['organizations', currentOrgId, 'events', currentEventId];

      const [
        usersSnap,
        merchantsSnap,
        smStatsSnap,
        deptStatsSnap,
        cashSubSnap,
      ] = await Promise.all([
        getDocs(collection(db, ...basePath, 'users')),
        getDocs(collection(db, ...basePath, 'merchants')),
        getDocs(collection(db, ...basePath, 'sellerManagerStats')),
        getDocs(collection(db, ...basePath, 'departmentStats')),
        getDocs(query(
          collection(db, ...basePath, 'cashSubmissions'),
          orderBy('submittedAt', 'desc')
        )),
      ]);

      const users        = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const merchants    = merchantsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const smStats      = smStatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const deptStats    = deptStatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const cashSubs     = cashSubSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // ── 处理各模块数据 ──
      buildOverview(event, users);
      buildDeptModule(users, smStats, deptStats);
      buildMerchantModule(merchants);
      buildPointSellerModule(users, event);
      buildCashierModule(users, cashSubs);

      setLastRefresh(new Date());
    } catch (err) {
      console.error('[AuditorDashboard] 数据加载失败:', err);
      window.mybazaarShowToast?.('数据加载失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, [userProfile]);

  useEffect(() => {
    if (!authLoading) loadAll();
  }, [authLoading, loadAll]);

  // ────────────────────────────────────────────────────────
  // 模块数据处理函数
  // ────────────────────────────────────────────────────────

  // ── 1. 活动概览 ──
  const buildOverview = (event, users) => {
    const rs  = event.roleStats         || {};
    const gps = event.globalPointsStats  || {};
    const fs  = event.financeSummary    || {};
    const dp  = event.departmentOverview || {};
    const ei  = event.eventInfo          || {};
    const em  = event.eventManager       || {};
    const cc  = event.cashCollections    || {}; // 现金收款统计
    const st  = event.statistics         || {};

    const countRole = (role) => users.filter(u => u.roles?.includes(role)).length;

    // ── 点数流通 ──
    const pts = fs.points || {};
    const totalAllocated   = gps.totalAllocated   ?? pts.totalAllocated   ?? 0;
    const totalSold        = gps.totalSold         ?? pts.totalSold         ?? 0;
    const totalSpent       = pts.totalSpent                                 ?? 0;
    const totalFromCards   = pts.totalFromPointCards                        ?? 0;
    const remainingSystem  = pts.remainingInSystem ?? (totalAllocated - totalSold) ?? 0;

    // ── 现金来源分解 ──
    const cash = fs.cash || {};
    const collectedFromSellers      = cash.collectedFromSellers      ?? 0;
    const collectedFromSMs          = cash.collectedFromSellerManagers ?? 0;
    const collectedFromPointSellers = cash.collectedFromPointSellers  ?? 0;
    const totalCollected            = cash.totalCollected             ?? gps.totalCollected ?? 0;
    const pendingFromSellers        = cash.pendingFromSellers         ?? 0;
    const pendingFromSMs            = cash.pendingFromSellerManagers  ?? 0;
    const pendingFromPointSellers   = cash.pendingFromPointSellers    ?? 0;
    const totalPending              = cash.totalPending               ?? gps.pendingCollection ?? 0;
    const expectedFromSales         = cash.expectedFromSales          ?? totalSold;
    const expectedFromCards         = cash.expectedFromPointCards     ?? totalFromCards;
    const totalExpected             = cash.totalExpected              ?? (expectedFromSales + expectedFromCards);
    const outstandingCash           = cash.outstandingCash            ?? (totalExpected - totalCollected - totalPending);

    // ── 对账 ──
    const rec = fs.reconciliation || {};
    const collectionRate      = rec.collectionRate      ?? gps.collectionRate ?? 0;
    const salesCollectionRate = rec.salesCollectionRate ?? 0;
    const cardCollectionRate  = rec.pointCardCollectionRate ?? 0;
    const isBalanced          = rec.isBalanced          ?? false;
    const discrepancy         = rec.discrepancy         ?? 0;

    // ── 点数卡 ──
    const pcs = fs.pointCardSummary || {};
    const cardsIssued    = pcs.totalCardsIssued  ?? rs.pointSellers?.totalCardsIssued ?? 0;
    const pointsFromCards= pcs.totalPointsIssued ?? rs.pointSellers?.totalPointsIssued ?? 0;
    const cashFromCards  = pcs.totalCashFromCards ?? 0;
    const activeCards    = pcs.activeCards   ?? 0;
    const usedCards      = pcs.usedCards     ?? 0;
    const expiredCards   = pcs.expiredCards  ?? 0;
    const destroyedCards = pcs.destroyedCards ?? 0;
    const unusedBalance  = pcs.unusedBalance  ?? 0;

    // ── Cashier 分布 ──
    const cbyCashier = fs.collectionsByCashier || {};
    const cashierBreakdown = Object.entries(cbyCashier).map(([cid, c]) => ({
      cashierId:    cid,
      name:         c.managerName      || '—',
      totalCollected: c.totalCollected ?? 0,
      count:        c.collectionsCount ?? 0,
      fromSellers:  c.cashSources?.fromSellers        ?? 0,
      fromSMs:      c.cashSources?.fromSellerManagers ?? 0,
      fromPS:       c.cashSources?.fromPointSellers   ?? 0,
      lastCollection: c.lastCollection,
    })).sort((a, b) => b.totalCollected - a.totalCollected);

    // ── 部门绩效 ──
    const topDepts    = dp.topPerformers        || [];
    const lowestDept  = dp.lowestCollectionRate || null;
    const totalDepts  = dp.totalDepartments     ?? 0;

    // ── 活动状态 ──
    const fairDate    = ei.fairDate;
    const periodStart = ei.consumptionPeriod?.startDate;
    const periodEnd   = ei.consumptionPeriod?.endDate;
    const eventStatus = event.status || '—';

    setOverviewData({
      // 活动基本
      eventStatus, fairDate, periodStart, periodEnd,
      emName:    em.chineseName || em.englishName || '—',
      emPhone:   em.phoneNumber || '—',
      totalUsers: st.totalUsers ?? users.length,

      // 人员
      sellerCount:         rs.sellers?.count          ?? countRole('seller'),
      sellerActiveCount:   rs.sellers?.activeCount    ?? 0,
      customerCount:       rs.customers?.count        ?? countRole('customer'),
      customerActiveCount: rs.customers?.activeCount  ?? 0,
      merchantCount:       rs.merchants?.count        ?? countRole('merchantOwner'),
      merchantActiveCount: rs.merchants?.activeCount  ?? 0,
      merchantAsistCount:  rs.merchantAsists?.count   ?? countRole('merchantAsist'),
      sellerManagerCount:  rs.sellerManagers?.count   ?? countRole('sellerManager'),
      cashierCount:        rs.cashiers?.count         ?? countRole('cashier'),
      pointSellerCount:    rs.pointSellers?.count     ?? countRole('pointSeller'),

      // 点数流通
      totalAllocated, totalSold, totalSpent, totalFromCards,
      remainingSystem,
      currentCirculation: gps.currentCirculation ?? 0,
      totalRevenue: gps.totalRevenue ?? totalSold,

      // 现金来源分解
      expectedFromSales, expectedFromCards, totalExpected,
      collectedFromSellers, collectedFromSMs, collectedFromPointSellers, totalCollected,
      pendingFromSellers, pendingFromSMs, pendingFromPointSellers, totalPending,
      outstandingCash,

      // 对账
      collectionRate, salesCollectionRate, cardCollectionRate,
      isBalanced, discrepancy,
      lastReconciled: rec.lastReconciled,

      // 点数卡
      cardsIssued, pointsFromCards, cashFromCards,
      activeCards, usedCards, expiredCards, destroyedCards, unusedBalance,

      // Cashier 分布
      cashierBreakdown,

      // 部门绩效
      topDepts, lowestDept, totalDepts,
    });
  };

  // ── 2. 班导师部门汇总（按班导师分组，含旗下学生销售员明细）──
  const buildDeptModule = (users, smStats, deptStats) => {
    const sellers        = users.filter(u => u.roles?.includes('seller'));
    const sellerManagers = users.filter(u => u.roles?.includes('sellerManager'));

    // 建立 sellerManagerStats 映射
    const smStatMap = {};
    smStats.forEach(s => { smStatMap[s.id] = s; });

    // 组装行：每个班导师一行
    const rows = sellerManagers.map(sm => {
      const smStat        = smStatMap[sm.id] || {};
      const smData        = sm.sellerManager  || {};
      const managedDepts  = smData.managedDepartments || [];
      const ps            = smStat.managedPointsStats || {};
      const cashStats     = smData.cashStats           || {};
      const alerts        = smStat.alerts              || {};
      const deptBreakdown = smStat.departmentBreakdown || [];

      // 旗下学生销售员明细（展开用）
      const sellerDetail = sellers
        .filter(s => managedDepts.includes(s.identityInfo?.department))
        .map(s => ({
          sellerId:          s.id,
          sellerName:        s.basicInfo?.chineseName || s.basicInfo?.englishName || '—',
          department:        s.identityInfo?.department || '—',
          identityId:        s.identityInfo?.identityId || '—',
          currentBalance:    s.pointsStats?.currentBalance  ?? s.seller?.availablePoints  ?? 0,
          totalSold:         s.pointsStats?.totalSold        ?? s.seller?.totalPointsSold  ?? 0,
          totalRevenue:      s.pointsStats?.totalRevenue     ?? s.seller?.totalRevenue     ?? 0,
          totalCollected:    s.pointsStats?.totalCollected   ?? s.seller?.totalCashCollected ?? 0,
          pendingCollection: s.pointsStats?.pendingCollection ?? s.seller?.pendingCollection ?? 0,
          collectionRate:    s.pointsStats?.collectionRate   ?? 0,
        }));

      // 低收款率预警名单（来自 sellerManagerStats.alerts）
      const alertUsers = alerts.lowCollectionRateUsers || [];

      return {
        smId:                sm.id,
        smName:              sm.basicInfo?.chineseName || sm.basicInfo?.englishName || '—',
        smPhone:             maskPhone(sm.basicInfo?.phoneNumber),
        managedDepts:        managedDepts,
        managedCount:        smStat.managedUsersCount ?? sellerDetail.length,
        // 点数分配
        totalAllocations:    smStat.totalAllocations       ?? smData.totalAllocations       ?? 0,
        totalPointsAllocated: smStat.totalPointsAllocated  ?? smData.totalPointsAllocated   ?? 0,
        // 销售汇总（来自 sellerManagerStats.managedPointsStats）
        totalSold:           ps.totalSold        ?? 0,
        totalRevenue:        ps.totalRevenue     ?? 0,
        totalCollected:      ps.totalCollected   ?? 0,
        pendingCollection:   ps.pendingCollection ?? 0,
        collectionRate:      ps.collectionRate   ?? 0,
        currentBalance:      ps.currentBalance   ?? 0,
        // 现金流（来自 users/{id}/sellerManager/cashStats）
        receivedFromSellers: cashStats.totalReceivedFromSellers ?? 0,
        confirmedFromSellers: cashStats.confirmedFromSellers    ?? 0,
        pendingFromSellers:  cashStats.pendingFromSellers       ?? 0,
        cashOnHand:          cashStats.cashOnHand               ?? 0,
        totalSubmitted:      cashStats.totalSubmitted           ?? 0,
        pendingSubmission:   cashStats.pendingSubmission        ?? 0,
        lastSubmittedAt:     cashStats.lastSubmittedAt,
        // 预警
        alertCount:          alerts.lowCollectionRateCount ?? alertUsers.length,
        alertUsers,
        // 班级分解
        deptBreakdown,
        // 学生明细
        sellerDetail,
      };
    });

    // 按销售总额降序
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);
    setDeptRows(rows);
  };

  // ── 3. 商家销售统计 ──
  const buildMerchantModule = (merchants) => {
    const rows = merchants.map(m => ({
      merchantId:       m.id,
      stallName:        m.stallName || '—',
      ownerPhone:       maskPhone(m.contactInfo?.phone),
      totalRevenue:     m.revenueStats?.totalRevenue             ?? 0,
      transactionCount: m.revenueStats?.transactionCount         ?? 0,
      avgTransaction:   m.revenueStats?.averageTransactionAmount ?? 0,
      isActive:         m.operationStatus?.isActive ? '营业中' : '暂停',
      lastTransaction:  m.revenueStats?.lastTransactionAt,
      asistsCount:      m.merchantAsistsCount ?? 0,
    }));
    // 按总收入降序
    rows.sort((a, b) => b.totalRevenue - a.totalRevenue);
    setMerchantRows(rows);
  };

  // ── 4. Point Seller 统计 ──
  const buildPointSellerModule = (users, event) => {
    const ps = event.roleStats?.pointSellers || {};
    const pointSellers = users.filter(u => u.roles?.includes('pointSeller'));

    const rows = pointSellers.map(u => {
      const ts  = u.pointSeller?.totalStats      || {};
      const cm  = u.pointSeller?.cashManagement  || {};
      return {
        userId:            u.id,
        name:              u.basicInfo?.chineseName || u.basicInfo?.englishName || '—',
        phone:             maskPhone(u.basicInfo?.phoneNumber),
        identityId:        u.identityInfo?.identityId || '—',
        totalCardsIssued:  ts.totalCardsIssued  ?? 0,
        totalPointsIssued: ts.totalPointsIssued ?? 0,
        totalCashReceived: ts.totalCashReceived  ?? 0,
        totalSubmitted:    cm.totalSubmitted     ?? 0,
        pendingSubmission: cm.pendingSubmission  ?? 0,
        submissionCount:   cm.submissionCount    ?? 0,
      };
    });

    rows.sort((a, b) => b.totalCashReceived - a.totalCashReceived);
    setPointSellerRows(rows);
  };

  // ── 5. Cashier 现金收取（两张独立表）──
  const buildCashierModule = (users, cashSubs) => {
    // 建立 userId → identityTag 映射
    const userTagMap = {};
    users.forEach(u => { userTagMap[u.id] = u.identityTag; });

    // 表1：非学生 seller 的现金上交记录
    // submitterRole === 'seller' 且 submitter 的 identityTag !== 'student'
    const nonStudentSubs = cashSubs.filter(sub =>
      sub.submitterRole === 'seller' &&
      userTagMap[sub.submittedBy] !== 'student'
    );

    const sellerRows = nonStudentSubs.map(sub => ({
      submissionId:   sub.submissionNumber || sub.id,
      submitterName:  sub.submitterName   || '—',
      submitterPhone: maskPhone(sub.submitterPhone),
      department:     sub.submitterDepartment || '—',
      amount:         sub.amount ?? 0,
      receiverName:   sub.receiverName    || '—',
      receiverRole:   sub.receiverRole    || '—',
      status:         sub.status,
      submittedAt:    sub.submittedAt,
      confirmedAt:    sub.confirmedAt,
      note:           sub.note || '—',
    }));

    // 表2：sellerManager 的现金上交记录
    const smSubs = cashSubs.filter(sub => sub.submitterRole === 'sellerManager');

    const smRows = smSubs.map(sub => ({
      submissionId:   sub.submissionNumber || sub.id,
      submitterName:  sub.submitterName   || '—',
      submitterPhone: maskPhone(sub.submitterPhone),
      department:     sub.submitterDepartment || '—',
      amount:         sub.amount ?? 0,
      breakdown: {
        cash:     sub.breakdown?.cash     ?? 0,
        transfer: sub.breakdown?.transfer ?? 0,
        check:    sub.breakdown?.check    ?? 0,
      },
      receiverName:   sub.receiverName    || '—',
      status:         sub.status,
      submittedAt:    sub.submittedAt,
      confirmedAt:    sub.confirmedAt,
      note:           sub.note            || '—',
    }));

    setCashierSellerRows(sellerRows);
    setCashierSmRows(smRows);
  };

  // ────────────────────────────────────────────────────────
  // 导出函数
  // ────────────────────────────────────────────────────────
  const handleExport = async (tab) => {
    setExporting(true);
    const eventName = eventData?.eventName?.['zh-CN'] || 'MyBazaar';
    const dateStr   = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');

    try {
      if (tab === 'overview') {
        const od = overviewData;
        await exportToExcel([
          {
            name: '人员统计',
            headers: ['角色', '总人数', '活跃人数'],
            rows: [
              ['点数销售员',   od.sellerCount,        od.sellerActiveCount],
              ['消费者',       od.customerCount,      od.customerActiveCount],
              ['商家（摊主）', od.merchantCount,      od.merchantActiveCount],
              ['摊位助手',     od.merchantAsistCount, '—'],
              ['班导师',       od.sellerManagerCount, '—'],
              ['收银员',       od.cashierCount,       '—'],
              ['点数直售员',   od.pointSellerCount,   '—'],
              ['总用户数',     od.totalUsers,         '—'],
              ['部门总数',     od.totalDepts,         '—'],
            ]
          },
          {
            name: '点数流通',
            headers: ['项目', '数值'],
            rows: [
              ['总分配点数',       od.totalAllocated],
              ['已售出点数（Seller→Customer）', od.totalSold],
              ['已消费点数（Customer→Merchant）', od.totalSpent],
              ['点数卡发行点数',   od.pointsFromCards],
              ['系统剩余点数',     od.remainingSystem],
              ['当前流通点数',     od.currentCirculation],
              ['累计销售额 RM',    fmt(od.totalRevenue)],
            ]
          },
          {
            name: '现金收取',
            headers: ['项目', '预期 RM', '已收 RM', '待收 RM'],
            rows: [
              ['Seller 销售',      fmt(od.expectedFromSales),  fmt(od.collectedFromSellers), fmt(od.pendingFromSellers)],
              ['点数卡',           fmt(od.expectedFromCards),  fmt(od.cashFromCards),        fmt(od.pendingFromPointSellers)],
              ['班导师汇总',       '—',                        fmt(od.collectedFromSMs),     fmt(od.pendingFromSMs)],
              ['合计',             fmt(od.totalExpected),      fmt(od.totalCollected),       fmt(od.totalPending)],
              ['未收款（差额）',   '—',                        '—',                          fmt(od.outstandingCash)],
              ['整体收款率',       '—',                        fmtPct(od.collectionRate),    '—'],
              ['销售收款率',       '—',                        fmtPct(od.salesCollectionRate), '—'],
              ['点数卡收款率',     '—',                        fmtPct(od.cardCollectionRate), '—'],
              ['对账差异 RM',      '—',                        fmt(od.discrepancy),          '—'],
              ['是否平衡',         '—',                        od.isBalanced ? '✅ 是' : '❌ 否', '—'],
            ]
          },
          {
            name: '点数卡汇总',
            headers: ['项目', '数值'],
            rows: [
              ['总发行卡数',   od.cardsIssued],
              ['总发行点数',   od.pointsFromCards],
              ['收到现金 RM',  fmt(od.cashFromCards)],
              ['有效卡片数',   od.activeCards],
              ['已使用卡片数', od.usedCards],
              ['已过期卡片数', od.expiredCards],
              ['已销毁卡片数', od.destroyedCards],
              ['未使用余额',   od.unusedBalance],
            ]
          },
          {
            name: 'Cashier收款分布',
            headers: ['收银员', '总收款 RM', '收款笔数', '来自Seller RM', '来自班导师 RM', '来自点数直售员 RM'],
            rows: od.cashierBreakdown.map(c => [
              c.name, fmt(c.totalCollected), c.count,
              fmt(c.fromSellers), fmt(c.fromSMs), fmt(c.fromPS)
            ])
          },
          {
            name: '部门绩效',
            headers: ['排名', '部门', '销售额 RM', '收款率'],
            rows: od.topDepts.map((d, i) => [
              i + 1, d.departmentName || d.departmentCode, fmt(d.totalRevenue), fmtPct(d.collectionRate)
            ])
          },
        ], `${eventName}-活动概览-${dateStr}.xlsx`);
      }

      if (tab === 'department') {
        // Sheet 1：班导师汇总
        const smSheet = {
          name: '班导师汇总',
          headers: [
            '班导师姓名', '电话', '管理班级', '学生人数',
            '分配点数', '销售额 RM', '已收款 RM', '待收款 RM', '收款率',
            '持有现金 RM', '已上交财务 RM', '待确认 RM', '低收款率预警人数'
          ],
          rows: deptRows.map(r => [
            r.smName, r.smPhone, r.managedDepts.join('、'), r.managedCount,
            r.totalPointsAllocated,
            fmt(r.totalRevenue), fmt(r.totalCollected), fmt(r.pendingCollection), fmtPct(r.collectionRate),
            fmt(r.cashOnHand), fmt(r.totalSubmitted), fmt(r.pendingSubmission), r.alertCount
          ])
        };
        // Sheet 2：学生销售员明细
        const sellerDetailSheet = {
          name: '学生销售员明细',
          headers: ['班导师', '班级', '姓名', '学号', '持有点数', '售出点数', '销售额 RM', '已收款 RM', '待收款 RM', '收款率'],
          rows: deptRows.flatMap(r =>
            r.sellerDetail.map(s => [
              r.smName, s.department, s.sellerName, s.identityId,
              s.currentBalance, s.totalSold,
              fmt(s.totalRevenue), fmt(s.totalCollected), fmt(s.pendingCollection), fmtPct(s.collectionRate)
            ])
          )
        };
        // Sheet 3：低收款率预警
        const alertSheet = {
          name: '低收款率预警',
          headers: ['班导师', '学生姓名', '班级', '收款率', '待收款 RM'],
          rows: deptRows.flatMap(r =>
            r.alertUsers.map(u => [
              r.smName, u.displayName || '—', u.department || '—',
              fmtPct(u.collectionRate), fmt(u.pendingCollection)
            ])
          )
        };
        await exportToExcel([smSheet, sellerDetailSheet, alertSheet], `${eventName}-班导师汇总-${dateStr}.xlsx`);
      }

      if (tab === 'merchant') {
        await exportToExcel([{
          name: '商家统计',
          headers: ['摊位名称', '联络电话', '销售总额 RM', '成交次数', '平均成交额 RM', '助理人数', '状态', '最后交易时间'],
          rows: merchantRows.map(r => [
            r.stallName, r.ownerPhone, fmt(r.totalRevenue), r.transactionCount,
            fmt(r.avgTransaction), r.asistsCount, r.isActive, fmtDateTime(r.lastTransaction)
          ])
        }], `${eventName}-商家统计-${dateStr}.xlsx`);
      }

      if (tab === 'pointSeller') {
        await exportToExcel([{
          name: '点数直售员统计',
          headers: ['姓名', '电话', '身份ID', '发行卡数', '发行点数', '收到现金 RM', '已上交 RM', '待上交 RM', '上交次数'],
          rows: pointSellerRows.map(r => [
            r.name, r.phone, r.identityId,
            r.totalCardsIssued, r.totalPointsIssued, fmt(r.totalCashReceived),
            fmt(r.totalSubmitted), fmt(r.pendingSubmission), r.submissionCount
          ])
        }], `${eventName}-点数直售员-${dateStr}.xlsx`);
      }

      if (tab === 'cashier') {
        const sheetSeller = {
          name: '非学生Seller现金',
          headers: ['流水号', '姓名', '电话', '部门', '上交金额 RM', '接收人', '接收角色', '状态', '上交时间', '确认时间', '备注'],
          rows: cashierSellerRows.map(r => [
            r.submissionId, r.submitterName, r.submitterPhone, r.department,
            fmt(r.amount), r.receiverName, r.receiverRole,
            r.status, fmtDateTime(r.submittedAt), fmtDateTime(r.confirmedAt), r.note
          ])
        };
        const sheetSm = {
          name: '班导师现金',
          headers: ['流水号', '班导师姓名', '电话', '班级', '上交金额 RM', '现金 RM', '转账 RM', '支票 RM', '接收人', '状态', '上交时间', '确认时间', '备注'],
          rows: cashierSmRows.map(r => [
            r.submissionId, r.submitterName, r.submitterPhone, r.department,
            fmt(r.amount), fmt(r.breakdown.cash), fmt(r.breakdown.transfer), fmt(r.breakdown.check),
            r.receiverName, r.status,
            fmtDateTime(r.submittedAt), fmtDateTime(r.confirmedAt), r.note
          ])
        };
        await exportToExcel([sheetSeller, sheetSm], `${eventName}-现金收取-${dateStr}.xlsx`);
      }
    } finally {
      setExporting(false);
    }
  };

  const handleLogout  = () => navigate(`/login/${orgEventCode}`);
  const handleRefresh = () => loadAll();

  // ────────────────────────────────────────────────────────
  // 渲染各 Tab 内容
  // ────────────────────────────────────────────────────────

  // ── Tab 1：活动概览 ──
  const renderOverview = () => {
    if (!overviewData) return null;
    const od = overviewData;

    // ── 进度条组件（内联）──
    const ProgressBar = ({ value, max, color = '#6366f1' }) => {
      const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
      return (
        <div style={{ background: '#e5e7eb', borderRadius: '999px', height: '8px', marginTop: '0.4rem' }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: color, borderRadius: '999px',
            transition: 'width 0.6s ease'
          }} />
        </div>
      );
    };

    // ── 收款率颜色 ──
    const rateColor = (r) => r >= 0.9 ? '#10b981' : r >= 0.7 ? '#f59e0b' : '#ef4444';

    // ── 分隔线 ──
    const Divider = () => (
      <div style={{ borderTop: '1px solid #f3f4f6', margin: '1.25rem 0' }} />
    );

    // ── 标签值对 ──
    const Row = ({ label, value, valueColor, bold }) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.35rem 0' }}>
        <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>{label}</span>
        <span style={{
          fontSize: '0.9rem',
          fontWeight: bold ? '700' : '500',
          color: valueColor || '#111827'
        }}>{value}</span>
      </div>
    );

    return (
      <>
        {/* ══════════════ 1. 活动信息横幅 ══════════════ */}
        <div style={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          borderRadius: '12px',
          padding: '1.5rem',
          color: 'white',
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem'
        }}>
          <div>
            <div style={{ fontSize: '1.1rem', fontWeight: '700', marginBottom: '0.5rem' }}>
              {eventData?.eventName?.['zh-CN'] || eventData?.eventName?.['en-US'] || '义卖活动'}
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem', opacity: 0.9 }}>
              {od.fairDate && (
                <span>📅 义卖日：{fmtDate(od.fairDate)}</span>
              )}
              {od.periodStart && od.periodEnd && (
                <span>🗓 消费期：{fmtDate(od.periodStart)} ~ {fmtDate(od.periodEnd)}</span>
              )}
              <span>
                状态：
                <span style={{
                  marginLeft: '0.3rem',
                  padding: '0.15rem 0.6rem',
                  background: 'rgba(255,255,255,0.25)',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: '600'
                }}>
                  {{
                    active: '进行中', planning: '筹备中',
                    completed: '已结束', cancelled: '已取消'
                  }[od.eventStatus] || od.eventStatus}
                </span>
              </span>
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '0.85rem', opacity: 0.9 }}>
            <div style={{ fontWeight: '600', marginBottom: '0.2rem' }}>📋 活动负责人</div>
            <div>{od.emName}</div>
            <div>{od.emPhone}</div>
          </div>
        </div>

        {/* ══════════════ 2. 人员分布 ══════════════ */}
        <ModuleCard
          title="人员分布"
          subtitle={`总用户数 ${fmtInt(od.totalUsers)} 人 · ${od.totalDepts} 个部门`}
          onExport={() => handleExport('overview')}
          exporting={exporting}
        >
          <div style={styles.statsGrid}>
            <StatCard
              label="点数销售员"
              value={fmtInt(od.sellerCount)}
              sub={od.sellerActiveCount > 0 ? `活跃 ${od.sellerActiveCount} 人` : undefined}
              color="#ec4899"
            />
            <StatCard
              label="消费者"
              value={fmtInt(od.customerCount)}
              sub={od.customerActiveCount > 0 ? `活跃 ${od.customerActiveCount} 人` : undefined}
              color="#84cc16"
            />
            <StatCard
              label="商家（摊主）"
              value={fmtInt(od.merchantCount)}
              sub={`含助手 ${od.merchantAsistCount} 人`}
              color="#06b6d4"
            />
            <StatCard label="班导师"     value={fmtInt(od.sellerManagerCount)} color="#f59e0b" />
            <StatCard label="收银员"     value={fmtInt(od.cashierCount)}       color="#3b82f6" />
            <StatCard label="点数直售员" value={fmtInt(od.pointSellerCount)}   color="#f97316" />
          </div>
        </ModuleCard>

        {/* ══════════════ 3. 点数流通 ══════════════ */}
        <ModuleCard title="点数流通" subtitle="全局点数分配与消费链路">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>

            {/* 左：流通漏斗 */}
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                点数流向
              </div>
              {[
                { label: '① 总分配点数',                value: od.totalAllocated,  color: '#6366f1', max: od.totalAllocated },
                { label: '② 已售出（Seller → Customer）', value: od.totalSold,       color: '#10b981', max: od.totalAllocated },
                { label: '③ 已消费（Customer → 商家）',  value: od.totalSpent,      color: '#8b5cf6', max: od.totalAllocated },
                { label: '④ 点数卡发行',                value: od.pointsFromCards, color: '#f59e0b', max: od.totalAllocated },
              ].map((item, i) => (
                <div key={i} style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.82rem', color: '#374151' }}>{item.label}</span>
                    <span style={{ fontWeight: '700', color: item.color, fontSize: '0.95rem' }}>
                      {fmtInt(item.value)}
                    </span>
                  </div>
                  <ProgressBar value={item.value} max={item.max} color={item.color} />
                </div>
              ))}
            </div>

            {/* 右：余额状况 */}
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                余额状况
              </div>
              <Row label="系统剩余点数"   value={fmtInt(od.remainingSystem)}    bold />
              <Row label="当前流通点数"   value={fmtInt(od.currentCirculation)} />
              <Divider />
              <Row label="累计销售额"     value={`RM ${fmt(od.totalRevenue)}`}  bold valueColor="#10b981" />
              <Row label="发行卡数"       value={`${fmtInt(od.cardsIssued)} 张`} />
              <Row label="点数卡发行点数" value={fmtInt(od.pointsFromCards)} />
            </div>
          </div>
        </ModuleCard>

        {/* ══════════════ 4. 现金收取 ══════════════ */}
        <ModuleCard title="现金收取" subtitle="按来源分解的收款状况">
          {/* 4a. 整体进度 */}
          <div style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
              <span style={{ fontWeight: '700', fontSize: '1rem', color: '#111827' }}>整体收款进度</span>
              <span style={{
                fontSize: '1.25rem', fontWeight: '800',
                color: rateColor(od.collectionRate)
              }}>
                {fmtPct(od.collectionRate)}
              </span>
            </div>
            <ProgressBar value={od.totalCollected} max={od.totalExpected} color={rateColor(od.collectionRate)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.3rem' }}>
              <span>RM 0</span>
              <span>预期 RM {fmt(od.totalExpected)}</span>
            </div>
          </div>

          {/* 4b. 来源分解表 */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['来源', '预期 RM', '已收 RM', '待收 RM', '未收 RM'].map((h, i) => (
                    <th key={i} style={{
                      padding: '0.6rem 1rem', textAlign: i === 0 ? 'left' : 'right',
                      fontWeight: '600', color: '#374151', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap'
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: '🎫 Seller 销售',
                    expected: od.expectedFromSales,
                    collected: od.collectedFromSellers,
                    pending: od.pendingFromSellers,
                    outstanding: od.expectedFromSales - od.collectedFromSellers - od.pendingFromSellers
                  },
                  {
                    label: '🏫 班导师汇总',
                    expected: 0,
                    collected: od.collectedFromSMs,
                    pending: od.pendingFromSMs,
                    outstanding: -od.collectedFromSMs - od.pendingFromSMs
                  },
                  {
                    label: '🎟 点数卡',
                    expected: od.expectedFromCards,
                    collected: od.collectedFromPointSellers,
                    pending: od.pendingFromPointSellers,
                    outstanding: od.expectedFromCards - od.collectedFromPointSellers - od.pendingFromPointSellers
                  },
                ].map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '0.6rem 1rem', fontWeight: '500' }}>{row.label}</td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#6b7280' }}>
                      {row.expected > 0 ? `RM ${fmt(row.expected)}` : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: '#10b981', fontWeight: '600' }}>
                      RM {fmt(row.collected)}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: row.pending > 0 ? '#f59e0b' : '#6b7280' }}>
                      {row.pending > 0 ? `RM ${fmt(row.pending)}` : '—'}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', color: row.outstanding > 0 ? '#ef4444' : '#6b7280' }}>
                      {row.outstanding > 0 ? `RM ${fmt(row.outstanding)}` : '—'}
                    </td>
                  </tr>
                ))}
                {/* 合计行 */}
                <tr style={{ background: '#f0fdf4', borderTop: '2px solid #10b981' }}>
                  <td style={{ padding: '0.75rem 1rem', fontWeight: '700' }}>合计</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700' }}>RM {fmt(od.totalExpected)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#10b981' }}>RM {fmt(od.totalCollected)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: '#f59e0b' }}>RM {fmt(od.totalPending)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: '700', color: od.outstandingCash > 0 ? '#ef4444' : '#6b7280' }}>
                    {od.outstandingCash > 0 ? `RM ${fmt(od.outstandingCash)}` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 4c. 对账状态 */}
          <div style={{
            marginTop: '1rem',
            padding: '0.75rem 1rem',
            background: od.isBalanced ? '#f0fdf4' : '#fff7ed',
            border: `1px solid ${od.isBalanced ? '#86efac' : '#fcd34d'}`,
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem'
          }}>
            <span style={{ fontWeight: '600', color: od.isBalanced ? '#15803d' : '#92400e' }}>
              {od.isBalanced ? '✅ 账目平衡' : '⚠️ 账目存在差异'}
            </span>
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
              <span>销售收款率：<strong style={{ color: rateColor(od.salesCollectionRate) }}>{fmtPct(od.salesCollectionRate)}</strong></span>
              <span>点数卡收款率：<strong style={{ color: rateColor(od.cardCollectionRate) }}>{fmtPct(od.cardCollectionRate)}</strong></span>
              {od.discrepancy !== 0 && (
                <span>差异：<strong style={{ color: '#ef4444' }}>RM {fmt(Math.abs(od.discrepancy))}</strong></span>
              )}
            </div>
          </div>
        </ModuleCard>

        {/* ══════════════ 5. 点数卡汇总 ══════════════ */}
        <ModuleCard title="点数卡汇总">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
            <div style={styles.statsGrid}>
              <StatCard label="总发行卡数"   value={fmtInt(od.cardsIssued)}    color="#f97316" />
              <StatCard label="总发行点数"   value={fmtInt(od.pointsFromCards)} color="#8b5cf6" />
              <StatCard label="收到现金 RM"  value={`RM ${fmt(od.cashFromCards)}`} color="#10b981" />
              <StatCard label="未使用余额"   value={fmtInt(od.unusedBalance)}   color="#6b7280" />
            </div>
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '1rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#6b7280', marginBottom: '0.75rem' }}>卡片状态分布</div>
              {[
                { label: '有效',   value: od.activeCards,    color: '#10b981' },
                { label: '已使用', value: od.usedCards,      color: '#6366f1' },
                { label: '已销毁', value: od.destroyedCards, color: '#8b5cf6' },
                { label: '已过期', value: od.expiredCards,   color: '#ef4444' },
              ].map((item, i) => (
                <div key={i} style={{ marginBottom: '0.6rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                    <span style={{ color: '#374151' }}>{item.label}</span>
                    <span style={{ fontWeight: '600', color: item.color }}>{fmtInt(item.value)} 张</span>
                  </div>
                  <ProgressBar value={item.value} max={od.cardsIssued} color={item.color} />
                </div>
              ))}
            </div>
          </div>
        </ModuleCard>

        {/* ══════════════ 6. Cashier 收款分布 ══════════════ */}
        {od.cashierBreakdown.length > 0 && (
          <ModuleCard title="收银员收款分布" subtitle="各收银员的收款情况">
            <DataTable
              columns={[
                { key: 'name',           label: '收银员' },
                { key: 'totalCollected', label: '总收款 RM', align: 'right',
                  render: r => <span style={{ fontWeight: '700', color: '#10b981' }}>RM {fmt(r.totalCollected)}</span> },
                { key: 'count',          label: '收款笔数', align: 'right' },
                { key: 'fromSellers',    label: '来自Seller RM', align: 'right',
                  render: r => `RM ${fmt(r.fromSellers)}` },
                { key: 'fromSMs',        label: '来自班导师 RM', align: 'right',
                  render: r => `RM ${fmt(r.fromSMs)}` },
                { key: 'fromPS',         label: '来自点数直售员 RM', align: 'right',
                  render: r => `RM ${fmt(r.fromPS)}` },
                { key: 'lastCollection', label: '最后收款时间',
                  render: r => fmtDateTime(r.lastCollection) },
              ]}
              rows={od.cashierBreakdown}
            />
          </ModuleCard>
        )}

        {/* ══════════════ 7. 部门绩效 ══════════════ */}
        {od.topDepts.length > 0 && (
          <ModuleCard title="部门绩效排行" subtitle="来自 Event 文档 departmentOverview 快照">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {/* 绩效前排 */}
              <div>
                <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#10b981', marginBottom: '0.75rem' }}>
                  🏆 销售额前排
                </div>
                {od.topDepts.slice(0, 5).map((d, i) => (
                  <div key={i} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.5rem 0.75rem', marginBottom: '0.4rem',
                    background: i === 0 ? '#fef9c3' : '#f8fafc',
                    borderRadius: '8px', fontSize: '0.85rem'
                  }}>
                    <span style={{ color: '#374151' }}>
                      {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`}
                      <span style={{ marginLeft: '0.4rem' }}>{d.departmentName || d.departmentCode}</span>
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: '700', color: '#10b981' }}>RM {fmt(d.totalRevenue)}</div>
                      <div style={{ fontSize: '0.75rem', color: rateColor(d.collectionRate) }}>
                        收款率 {fmtPct(d.collectionRate)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {/* 最低收款率 */}
              {od.lowestDept && (
                <div>
                  <div style={{ fontSize: '0.8rem', fontWeight: '600', color: '#ef4444', marginBottom: '0.75rem' }}>
                    ⚠️ 收款率最低部门
                  </div>
                  <div style={{
                    padding: '1rem',
                    background: '#fff1f2',
                    border: '1px solid #fecdd3',
                    borderRadius: '8px'
                  }}>
                    <div style={{ fontWeight: '700', fontSize: '1rem', color: '#111827', marginBottom: '0.5rem' }}>
                      {od.lowestDept.departmentName || od.lowestDept.departmentCode}
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: '800', color: '#ef4444' }}>
                      {fmtPct(od.lowestDept.collectionRate)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: '0.2rem' }}>
                      需要关注收款进度
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ModuleCard>
        )}
      </>
    );
  };

  // ── Tab 2：部门汇总 ──
  // 主表：SM 汇总行；每行可展开查看旗下 seller 明细
  const [expandedSm, setExpandedSm] = useState(new Set());
  const toggleExpand = (smId) => {
    setExpandedSm(prev => {
      const next = new Set(prev);
      next.has(smId) ? next.delete(smId) : next.add(smId);
      return next;
    });
  };

  const renderDept = () => {
    // 汇总卡片数据
    const totals = deptRows.reduce((acc, r) => ({
      teachers:      acc.teachers + 1,
      students:      acc.students + r.managedCount,
      allocated:     acc.allocated + r.totalPointsAllocated,
      revenue:       acc.revenue + r.totalRevenue,
      collected:     acc.collected + r.totalCollected,
      pending:       acc.pending + r.pendingCollection,
      cashOnHand:    acc.cashOnHand + r.cashOnHand,
      submitted:     acc.submitted + r.totalSubmitted,
      alertCount:    acc.alertCount + r.alertCount,
    }), { teachers: 0, students: 0, allocated: 0, revenue: 0, collected: 0, pending: 0, cashOnHand: 0, submitted: 0, alertCount: 0 });

    const rateColor = (r) => r >= 0.9 ? '#10b981' : r >= 0.7 ? '#f59e0b' : '#ef4444';

    // 表头定义
    const headers = ['', '班导师', '电话', '管理班级', '学生人数', '分配点数', '销售额 RM', '已收款 RM', '待收款 RM', '收款率', '持有现金 RM', '已上交 RM', '待确认 RM'];
    const rightCols = new Set([4, 5, 6, 7, 8, 9, 10, 11, 12]);

    return (
      <>
        {/* ══ 汇总卡片 ══ */}
        <ModuleCard
          title="班导师汇总"
          subtitle={`共 ${deptRows.length} 位班导师 · ${totals.students} 位学生销售员`}
          onExport={() => handleExport('department')}
          exporting={exporting}
        >
          <div style={styles.statsGrid}>
            <StatCard label="班导师人数"   value={fmtInt(totals.teachers)}             color="#f59e0b" />
            <StatCard label="管辖学生人数" value={fmtInt(totals.students)}             color="#ec4899" />
            <StatCard label="累计分配点数" value={fmtInt(totals.allocated)}            color="#6366f1" />
            <StatCard label="累计销售额"   value={`RM ${fmt(totals.revenue)}`}         color="#10b981" />
            <StatCard label="已收款"       value={`RM ${fmt(totals.collected)}`}       color="#3b82f6" />
            <StatCard label="待收款"       value={`RM ${fmt(totals.pending)}`}         color="#f59e0b" />
            <StatCard label="班导师持有现金" value={`RM ${fmt(totals.cashOnHand)}`}    color="#8b5cf6" />
            <StatCard label="已上交财务"   value={`RM ${fmt(totals.submitted)}`}       color="#06b6d4" />
            {totals.alertCount > 0 && (
              <StatCard label="低收款率预警" value={`${totals.alertCount} 人`}         color="#ef4444" />
            )}
          </div>
        </ModuleCard>

        {/* ══ 低收款率预警汇总 ══ */}
        {totals.alertCount > 0 && (
          <ModuleCard title="⚠️ 低收款率预警" subtitle="收款率低于阈值的学生销售员">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ background: '#fff1f2' }}>
                    {['班导师', '学生姓名', '班级', '收款率', '待收款 RM'].map((h, i) => (
                      <th key={i} style={{
                        padding: '0.6rem 1rem', textAlign: i >= 3 ? 'right' : 'left',
                        fontWeight: '600', color: '#be123c', borderBottom: '2px solid #fecdd3', whiteSpace: 'nowrap'
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptRows.flatMap(row =>
                    row.alertUsers.map((u, i) => (
                      <tr key={`alert-${u.userId}-${i}`} style={{
                        borderBottom: '1px solid #fff1f2', background: 'white'
                      }}>
                        <td style={{ padding: '0.5rem 1rem', color: '#f59e0b', fontWeight: '500' }}>{row.smName}</td>
                        <td style={{ padding: '0.5rem 1rem', fontWeight: '500' }}>{u.displayName || '—'}</td>
                        <td style={{ padding: '0.5rem 1rem', color: '#6b7280' }}>{u.department || '—'}</td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'right' }}>
                          <span style={{ color: rateColor(u.collectionRate), fontWeight: '600' }}>
                            {fmtPct(u.collectionRate)}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem 1rem', textAlign: 'right', color: '#ef4444', fontWeight: '600' }}>
                          RM {fmt(u.pendingCollection)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </ModuleCard>
        )}

        {/* ══ 班导师明细主表（可展开） ══ */}
        <ModuleCard title="班导师明细" subtitle="点击行展开查看旗下学生销售员">
          {deptRows.length === 0 ? (
            <p style={{ color: '#9ca3af', textAlign: 'center', padding: '2rem' }}>暂无数据</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '1000px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {headers.map((h, i) => (
                      <th key={i} style={{
                        padding: '0.65rem 0.85rem',
                        textAlign: rightCols.has(i) ? 'right' : 'left',
                        fontWeight: '600', color: '#374151',
                        borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap',
                        fontSize: '0.8rem'
                      }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {deptRows.map((row, ri) => (
                    <>
                      {/* 班导师汇总行 */}
                      <tr
                        key={`sm-${row.smId}`}
                        onClick={() => toggleExpand(row.smId)}
                        style={{
                          borderBottom: expandedSm.has(row.smId) ? 'none' : '1px solid #f3f4f6',
                          background: expandedSm.has(row.smId) ? '#ede9fe' : (ri % 2 === 0 ? 'white' : '#fafafa'),
                          cursor: 'pointer'
                        }}
                      >
                        <td style={{ padding: '0.75rem 0.85rem', color: '#6366f1', fontSize: '1rem', width: '32px' }}>
                          {expandedSm.has(row.smId) ? '▼' : '▶'}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', fontWeight: '600', color: '#111827', whiteSpace: 'nowrap' }}>
                          {row.smName}
                          {row.alertCount > 0 && (
                            <span style={{
                              marginLeft: '0.4rem', padding: '0.1rem 0.4rem',
                              background: '#fee2e2', color: '#ef4444',
                              borderRadius: '999px', fontSize: '0.72rem', fontWeight: '700'
                            }}>⚠️ {row.alertCount}</span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', color: '#6b7280', fontSize: '0.8rem' }}>{row.smPhone}</td>
                        <td style={{ padding: '0.75rem 0.85rem', color: '#374151', fontSize: '0.8rem' }}>
                          {row.managedDepts.join('、') || '—'}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right' }}>{row.managedCount}</td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#6366f1' }}>
                          {fmtInt(row.totalPointsAllocated)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                          {fmt(row.totalRevenue)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#3b82f6' }}>
                          {fmt(row.totalCollected)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: row.pendingCollection > 0 ? '#f59e0b' : '#6b7280' }}>
                          {fmt(row.pendingCollection)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right' }}>
                          <span style={{ color: rateColor(row.collectionRate), fontWeight: '600' }}>
                            {fmtPct(row.collectionRate)}
                          </span>
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: row.cashOnHand > 0 ? '#8b5cf6' : '#6b7280' }}>
                          {fmt(row.cashOnHand)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: '#06b6d4' }}>
                          {fmt(row.totalSubmitted)}
                        </td>
                        <td style={{ padding: '0.75rem 0.85rem', textAlign: 'right', color: row.pendingSubmission > 0 ? '#f97316' : '#6b7280' }}>
                          {fmt(row.pendingSubmission)}
                        </td>
                      </tr>

                      {/* 展开：学生销售员明细 */}
                      {expandedSm.has(row.smId) && (
                        <>
                          {/* 次标题行 */}
                          <tr style={{ background: '#f5f3ff' }}>
                            <td colSpan={2} style={{ padding: '0.4rem 1.5rem', fontSize: '0.75rem', color: '#7c3aed', fontWeight: '600' }}>
                              学生销售员明细（{row.sellerDetail.length} 人）
                            </td>
                            <td colSpan={11} style={{ padding: '0.4rem 0.85rem', fontSize: '0.75rem', color: '#9ca3af' }}>
                              学号 · 班级 · 持有点数 · 售出点数 · 销售额 · 已收款 · 待收款 · 收款率
                            </td>
                          </tr>
                          {row.sellerDetail.length === 0 ? (
                            <tr style={{ background: '#f5f3ff' }}>
                              <td colSpan={13} style={{ padding: '0.5rem 1.5rem', color: '#9ca3af', fontSize: '0.82rem' }}>
                                暂无学生销售员
                              </td>
                            </tr>
                          ) : (
                            row.sellerDetail.map((s) => (
                              <tr key={`s-${s.sellerId}`} style={{
                                background: '#f5f3ff',
                                borderBottom: '1px solid #ede9fe',
                                fontSize: '0.82rem'
                              }}>
                                <td style={{ padding: '0.5rem 0.85rem', color: '#a78bfa' }}>└</td>
                                <td style={{ padding: '0.5rem 0.85rem', color: '#374151', whiteSpace: 'nowrap' }}>
                                  {s.sellerName}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', color: '#9ca3af', fontSize: '0.78rem' }}>
                                  {s.identityId}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', color: '#6b7280' }}>{s.department}</td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right', color: '#6b7280' }}>—</td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right', color: '#6366f1' }}>
                                  {fmtInt(s.currentBalance)}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right', color: '#10b981' }}>
                                  {fmt(s.totalRevenue)}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right', color: '#3b82f6' }}>
                                  {fmt(s.totalCollected)}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right', color: s.pendingCollection > 0 ? '#f59e0b' : '#6b7280' }}>
                                  {fmt(s.pendingCollection)}
                                </td>
                                <td style={{ padding: '0.5rem 0.85rem', textAlign: 'right' }}>
                                  <span style={{ color: rateColor(s.collectionRate) }}>
                                    {fmtPct(s.collectionRate)}
                                  </span>
                                </td>
                                <td colSpan={3} style={{ padding: '0.5rem 0.85rem', color: '#9ca3af' }}>—</td>
                              </tr>
                            ))
                          )}
                          {/* 展开底部分隔 */}
                          <tr style={{ background: '#ede9fe', borderBottom: '2px solid #c4b5fd' }}>
                            <td colSpan={13} style={{ height: '4px' }} />
                          </tr>
                        </>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ModuleCard>
      </>
    );
  };

  // ── Tab 3：商家统计 ──
  const renderMerchant = () => (
    <ModuleCard
      title="商家销售统计"
      subtitle={`共 ${merchantRows.length} 个摊位，按销售总额排序`}
      onExport={() => handleExport('merchant')}
      exporting={exporting}
    >
      <DataTable
        columns={[
          { key: 'stallName',        label: '摊位名称' },
          { key: 'ownerPhone',       label: '联络电话' },
          { key: 'totalRevenue',     label: '销售总额 RM', align: 'right',
            render: r => <span style={{ fontWeight: '600', color: '#10b981' }}>RM {fmt(r.totalRevenue)}</span> },
          { key: 'transactionCount', label: '成交次数', align: 'right' },
          { key: 'avgTransaction',   label: '平均成交 RM', align: 'right',
            render: r => `RM ${fmt(r.avgTransaction)}` },
          { key: 'asistsCount',      label: '助理人数', align: 'center' },
          { key: 'isActive',         label: '状态',
            render: r => (
              <span style={{
                padding: '0.2rem 0.6rem',
                background: r.isActive === '营业中' ? '#d1fae5' : '#f3f4f6',
                color: r.isActive === '营业中' ? '#10b981' : '#6b7280',
                borderRadius: '999px', fontSize: '0.75rem', fontWeight: '600'
              }}>{r.isActive}</span>
            )},
          { key: 'lastTransaction',  label: '最后交易时间',
            render: r => fmtDateTime(r.lastTransaction) },
        ]}
        rows={merchantRows}
      />
    </ModuleCard>
  );

  // ── Tab 4：Point Seller 统计 ──
  const renderPointSeller = () => {
    const totals = pointSellerRows.reduce((acc, r) => ({
      cards:    acc.cards    + r.totalCardsIssued,
      points:   acc.points   + r.totalPointsIssued,
      received: acc.received + r.totalCashReceived,
      submitted:acc.submitted + r.totalSubmitted,
      pending:  acc.pending  + r.pendingSubmission,
    }), { cards: 0, points: 0, received: 0, submitted: 0, pending: 0 });

    return (
      <>
        <ModuleCard title="点数直售员汇总">
          <div style={styles.statsGrid}>
            <StatCard label="发行总卡数"     value={fmtInt(totals.cards)}              color="#f97316" />
            <StatCard label="发行总点数"     value={fmtInt(totals.points)}             color="#8b5cf6" />
            <StatCard label="收到现金 RM"    value={`RM ${fmt(totals.received)}`}     color="#10b981" />
            <StatCard label="已上交 RM"      value={`RM ${fmt(totals.submitted)}`}    color="#3b82f6" />
            <StatCard label="待上交 RM"      value={`RM ${fmt(totals.pending)}`}      color={totals.pending > 0 ? '#f59e0b' : '#10b981'} />
          </div>
        </ModuleCard>

        <ModuleCard
          title="点数直售员个人统计"
          subtitle="按收到现金排序"
          onExport={() => handleExport('pointSeller')}
          exporting={exporting}
        >
          <DataTable
            columns={[
              { key: 'name',              label: '姓名' },
              { key: 'phone',             label: '电话' },
              { key: 'identityId',        label: '身份ID' },
              { key: 'totalCardsIssued',  label: '发行卡数', align: 'right' },
              { key: 'totalPointsIssued', label: '发行点数', align: 'right' },
              { key: 'totalCashReceived', label: '收到现金 RM', align: 'right',
                render: r => <span style={{ fontWeight: '600', color: '#10b981' }}>RM {fmt(r.totalCashReceived)}</span> },
              { key: 'totalSubmitted',    label: '已上交 RM', align: 'right',
                render: r => `RM ${fmt(r.totalSubmitted)}` },
              { key: 'pendingSubmission', label: '待上交 RM', align: 'right',
                render: r => (
                  <span style={{ color: r.pendingSubmission > 0 ? '#f59e0b' : '#6b7280' }}>
                    RM {fmt(r.pendingSubmission)}
                  </span>
                )},
              { key: 'submissionCount',   label: '上交次数', align: 'center' },
            ]}
            rows={pointSellerRows}
          />
        </ModuleCard>
      </>
    );
  };

  // ── Tab 5：Cashier 现金收取（两张独立表）──
  const renderCashier = () => {
    const sellerTotal = cashierSellerRows.reduce((s, r) => s + r.amount, 0);
    const smTotal     = cashierSmRows.reduce((s, r) => s + r.amount, 0);

    const sellerConfirmed = cashierSellerRows.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);
    const smConfirmed     = cashierSmRows.filter(r => r.status === 'confirmed').reduce((s, r) => s + r.amount, 0);

    const cashierCols = [
      { key: 'submissionId',   label: '流水号' },
      { key: 'submitterName',  label: '姓名' },
      { key: 'submitterPhone', label: '电话' },
      { key: 'department',     label: '部门' },
      { key: 'amount',         label: '上交金额 RM', align: 'right',
        render: r => <span style={{ fontWeight: '600', color: '#10b981' }}>RM {fmt(r.amount)}</span> },
      { key: 'receiverName',   label: '接收人' },
      { key: 'status',         label: '状态',
        render: r => <StatusBadge status={r.status} /> },
      { key: 'submittedAt',    label: '上交时间',
        render: r => fmtDateTime(r.submittedAt) },
      { key: 'confirmedAt',    label: '确认时间',
        render: r => fmtDateTime(r.confirmedAt) },
    ];

    const smCols = [
      { key: 'submissionId',   label: '流水号' },
      { key: 'submitterName',  label: '班导师' },
      { key: 'submitterPhone', label: '电话' },
      { key: 'department',     label: '班级' },
      { key: 'amount',         label: '上交金额 RM', align: 'right',
        render: r => <span style={{ fontWeight: '600', color: '#10b981' }}>RM {fmt(r.amount)}</span> },
      { label: '构成（现金/转账/支票）', key: 'breakdown', align: 'right',
        render: r => `${fmt(r.breakdown.cash)} / ${fmt(r.breakdown.transfer)} / ${fmt(r.breakdown.check)}` },
      { key: 'receiverName',   label: '接收人（收银员）' },
      { key: 'status',         label: '状态',
        render: r => <StatusBadge status={r.status} /> },
      { key: 'submittedAt',    label: '上交时间',
        render: r => fmtDateTime(r.submittedAt) },
    ];

    return (
      <>
        {/* 汇总 */}
        <ModuleCard title="现金收取汇总">
          <div style={styles.statsGrid}>
            <StatCard label="非学生Seller 上交合计"   value={`RM ${fmt(sellerTotal)}`}   color="#ec4899"
              sub={`已确认 RM ${fmt(sellerConfirmed)} / ${cashierSellerRows.length} 笔`} />
            <StatCard label="班导师 上交合计"          value={`RM ${fmt(smTotal)}`}        color="#f59e0b"
              sub={`已确认 RM ${fmt(smConfirmed)} / ${cashierSmRows.length} 笔`} />
            <StatCard label="合计上交"                 value={`RM ${fmt(sellerTotal + smTotal)}`} color="#6366f1" />
          </div>
        </ModuleCard>

        {/* 表1：非学生 seller */}
        <ModuleCard
          title="非学生 Seller 现金上交记录"
          subtitle={`共 ${cashierSellerRows.length} 笔，identityTag ≠ student 的 Seller`}
          onExport={() => handleExport('cashier')}
          exporting={exporting}
        >
          <DataTable columns={cashierCols} rows={cashierSellerRows} />
        </ModuleCard>

        {/* 表2：sellerManager */}
        <ModuleCard
          title="班导师（SellerManager）现金上交记录"
          subtitle={`共 ${cashierSmRows.length} 笔，包含班导师汇总上交给收银员的现金`}
        >
          <DataTable columns={smCols} rows={cashierSmRows} />
        </ModuleCard>
      </>
    );
  };

  // ────────────────────────────────────────────────────────
  // 渲染主体
  // ────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '1rem' }}>
        <div style={styles.spinner} />
        <p style={{ color: '#6b7280' }}>稽核数据加载中...</p>
      </div>
    );
  }

  const eventName = eventData?.eventName?.['zh-CN']
    || eventData?.eventName?.['zh-TW']
    || eventData?.eventName?.['en-US']
    || '活动';

  return (
    <div style={styles.container}>
      <DashboardHeader
        title={`${eventName} 稽核报告`}
        subtitle="Auditor Dashboard"
        logoUrl={eventData?.logoUrl || orgData?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName}
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRefreshButton={true}
        currentRole="auditor"
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* 最后刷新时间 */}
      {lastRefresh && (
        <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#9ca3af', padding: '0.5rem 1.5rem 0' }}>
          最后更新：{lastRefresh.toLocaleString('zh-CN')}
        </div>
      )}

      {/* Tab 导航 */}
      <div style={styles.tabBar}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : {})
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div style={styles.content}>
        {activeTab === 'overview'    && renderOverview()}
        {activeTab === 'department'  && renderDept()}
        {activeTab === 'merchant'    && renderMerchant()}
        {activeTab === 'pointSeller' && renderPointSeller()}
        {activeTab === 'cashier'     && renderCashier()}
      </div>

      <DashboardFooter />
    </div>
  );
};

// ────────────────────────────────────────────────────────────
// 样式
// ────────────────────────────────────────────────────────────
const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f1f5f9',
    display: 'flex',
    flexDirection: 'column'
  },
  tabBar: {
    display: 'flex',
    gap: '0.5rem',
    padding: '1rem 1.5rem 0',
    overflowX: 'auto',
    flexShrink: 0,
  },
  tabBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.6rem 1.2rem',
    border: 'none',
    borderRadius: '8px 8px 0 0',
    background: '#e2e8f0',
    color: '#64748b',
    fontWeight: '600',
    fontSize: '0.875rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  tabBtnActive: {
    background: '#6366f1',
    color: 'white',
    boxShadow: '0 -2px 8px rgba(99,102,241,0.25)',
  },
  content: {
    flex: 1,
    padding: '1.5rem',
    overflowY: 'auto',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '1rem',
    marginBottom: '0.5rem',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #e5e7eb',
    borderTop: '3px solid #6366f1',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
};

export default AuditorDashboard;