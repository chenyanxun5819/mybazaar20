// src/contexts/EventContext.jsx
// ✅ 已更新：添加对 Manager 路由和 Login 路由的支持
import { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { safeFetch } from '../services/safeFetch';

const EventContext = createContext();

export const useEvent = () => {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEvent must be used within EventProvider');
  }
  return context;
};

export const EventProvider = ({ children }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [organizationId, setOrganizationId] = useState(null);
  const [eventId, setEventId] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [event, setEvent] = useState(null);
  const [orgCode, setOrgCode] = useState(null);
  const [eventCode, setEventCode] = useState(null);

  const withTimeout = (promise, ms, label) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          new Error(
            `[EventContext] 载入逾时（${ms}ms）：${label}\n` +
              `可能原因：\n` +
              `• 网路阻挡 Google/Firebase 域名或防火墙拦截\n` +
              `• 浏览器/外挂阻挡第三方请求\n` +
              `• Firestore 规则拒绝读取（应会报错，但某些网路环境会卡住）\n` +
              `建议：改用手机热点重试、停用拦截外挂、或稍后再试。`
          )
        );
      }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
  };

  useEffect(() => {
    parseUrlAndLoadData();
  }, []);

  const parseUrlAndLoadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // URL 解析：支持多种格式
      const urlPath = decodeURIComponent(window.location.pathname || '/').replace(/\/+$/, '');
      console.log('[EventContext] 解析 URL:', urlPath);

      const segments = urlPath.split('/').filter(Boolean); // 移除空段
      let parsedOrgCode = null;
      let parsedEventCode = null;
      let platform = null;

      if (segments.length >= 2) {
        const first = segments[0].toLowerCase();
        
        // ⭐ 新增：支持 Login 路由
        // 格式: /login/:orgEventCode
        if (first === 'login') {
          const orgEvent = segments[1];
          if (orgEvent) {
            const idx = orgEvent.indexOf('-');
            if (idx > 0) {
              parsedOrgCode = orgEvent.substring(0, idx);
              parsedEventCode = orgEvent.substring(idx + 1);
              platform = 'universal'; // 统一登录页面
              console.log('[EventContext] ✅ 识别为 Login 路由');
            }
          }
        }
        
        // ✅ 支持普通用户路由: seller, merchant, customer, pointseller
        if (['seller','merchant','customer','pointseller'].includes(first)) {
          const orgEvent = segments[1];
          const third = segments[2]?.toLowerCase();
          // 支持 /customer/:orgEventCode/dashboard, /customer/:orgEventCode/register, 等
          if (orgEvent && third && ['dashboard','register','payment','transfer','topup','transactions'].includes(third)) {
            const idx = orgEvent.indexOf('-');
            if (idx > 0) {
              parsedOrgCode = orgEvent.substring(0, idx);
              parsedEventCode = orgEvent.substring(idx + 1);
              platform = 'phone';
            }
          }
        }
        
        // ✅ 支持 Manager 路由
        // 格式: /seller-manager/:orgEventCode/dashboard
        //       /cashier/:orgEventCode/dashboard
        //       /merchant-manager/:orgEventCode/dashboard
        //       /customer-manager/:orgEventCode/dashboard
        //       /event-manager/:orgEventCode/dashboard
        if (['seller-manager', 'cashier', 'merchant-manager', 'customer-manager', 'event-manager'].includes(first)) {
          const orgEvent = segments[1];
          const third = segments[2]?.toLowerCase();
          if (orgEvent && third === 'dashboard') {
            const idx = orgEvent.indexOf('-');
            if (idx > 0) {
              parsedOrgCode = orgEvent.substring(0, idx);
              parsedEventCode = orgEvent.substring(idx + 1);
              platform = 'desktop'; // Manager 通常使用桌面版
              console.log('[EventContext] ✅ 识别为 Manager 路由:', first);
            }
          }
        }
      }

      if (!parsedOrgCode || !parsedEventCode) {
        // 通用格式：/orgCode-eventCode/platform
        if (segments.length >= 2) {
          const combined = segments[0];
          const idx = combined.indexOf('-');
          const plat = segments[1]?.toLowerCase();
          if (idx > 0 && ['phone','desktop'].includes(plat)) {
            parsedOrgCode = combined.substring(0, idx);
            parsedEventCode = combined.substring(idx + 1);
            platform = plat;
          }
        }
      }

      if (!parsedOrgCode || !parsedEventCode) {
        console.warn('[EventContext] URL 格式无法识别！: ' + urlPath);
        console.log('[EventContext] 预期格式: /login/:orgEventCode 或 /orgCode-eventCode/platform 或 /(seller|merchant|customer)/:orgEventCode/(dashboard|register|payment|...) 或 /(manager-type)/:orgEventCode/dashboard');
        const hints = [
          'URL 格式不正确，请使用正确的链接',
          '例如: /login/xhessbn-2025 或 /seller/xhessbn-2025/dashboard 或 /customer/xhessbn-2025/register',
          '或 /cashier/xhessbn-2025/dashboard',
          '',
          '可能原因：',
          '• 复制的链接缺少组织或活动代号（orgCode-eventCode）',
          '• 访问路径与设备不匹配（phone/desktop）',
          '• 浏览器缓存导致旧链接，尝试刷新或清除缓存',
        ].join('\n');
        setError(hints);
        setLoading(false);
        return;
      }

      console.log('[EventContext] 从 URL 解析出:', {
        orgCode: parsedOrgCode,
        eventCode: parsedEventCode,
        platform: platform || '(unknown)'
      });

      setOrgCode(parsedOrgCode);
      setEventCode(parsedEventCode);

      // 载入数据
      await loadEventData(parsedOrgCode, parsedEventCode);

    } catch (err) {
      console.error('[EventContext] 解析错误:', err);
      setError(err.message);
      setLoading(false);
    }
  };

  const loadEventData = async (orgCode, eventCode) => {
    try {
      console.log('[EventContext] 载入数据:', { orgCode, eventCode });

      const FIRESTORE_TIMEOUT_MS = 12000;

      let resolvedOrgId = null;
      let resolvedEventId = null;
      let resolvedOrgCode = orgCode;
      let resolvedEventCode = eventCode;

      const resolveViaHttp = async () => {
        console.warn('[EventContext] Firestore 读取被拒绝，改用 /api/resolveOrgEventHttp 解析 org/event');

        const resp = await withTimeout(
          safeFetch('/api/resolveOrgEventHttp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orgCode: String(orgCode || '').trim().toLowerCase(),
              eventCode: String(eventCode || '').trim()
            })
          }),
          FIRESTORE_TIMEOUT_MS,
          'resolveOrgEventHttp'
        );

        const text = await resp.text();
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (_) {
          json = null;
        }

        if (!resp.ok || !json?.success) {
          const serverMsg = json?.error?.message || text || `HTTP ${resp.status}`;
          throw new Error(serverMsg);
        }

        const orgId = json.organizationId;
        const evtId = json.eventId;
        if (!orgId || !evtId) {
          throw new Error('解析组织/活动失败（缺少 organizationId/eventId）');
        }

        setOrganizationId(orgId);
        setEventId(evtId);
        // 最小化对象，避免未登入时被 Firestore rules 卡住
        setOrganization({ id: orgId, orgCode: String(orgCode || '').trim().toLowerCase() });
        setEvent({ id: evtId, eventCode: String(eventCode || '').trim() });

        console.log('[EventContext] ✅ 透过 HTTP 解析成功:', { orgId, evtId });
      };

      // 1. 查找组织（优先走 Firestore；若 rules 拒绝则 fallback HTTP）
      let orgId = null;
      let orgData = null;
      try {
        const orgsQ = query(
          collection(db, 'organizations'),
          where('orgCode', '==', String(orgCode || '').trim().toLowerCase())
        );
        const orgsSnapshot = await withTimeout(
          getDocs(orgsQ),
          FIRESTORE_TIMEOUT_MS,
          '查询 organizations(orgCode)'
        );

        if (orgsSnapshot.empty) {
          throw new Error(`找不到组织代码: ${orgCode}`);
        }

        const doc0 = orgsSnapshot.docs[0];
        orgId = doc0.id;
        orgData = doc0.data();
        setOrganizationId(orgId);
        setOrganization({ id: orgId, ...orgData });
        console.log('[EventContext] 找到组织:', { id: orgId, orgCode: orgData?.orgCode });

        resolvedOrgId = orgId;
        resolvedOrgCode = orgData?.orgCode || orgCode;
      } catch (e) {
        const msg = e?.message || '';
        const code = e?.code || '';
        const isPerm =
          code === 'permission-denied' ||
          code === 'failed-precondition' ||
          /Missing or insufficient permissions/i.test(msg);
        const isTimeout = /载入逾时|載入逾時/i.test(msg);

        if (isPerm || isTimeout) {
          await resolveViaHttp();
          setLoading(false);
          return;
        }
        throw e;
      }

      // 2. 查找活动（优先走 Firestore；若 rules 拒绝则 fallback HTTP）
      const eventsCollectionPath = `organizations/${orgId}/events`;
      console.log('[EventContext] 查询活动路径:', eventsCollectionPath);

      try {
        const eventsQ = query(
          collection(db, 'organizations', orgId, 'events'),
          where('eventCode', '==', String(eventCode || '').trim())
        );

        const eventsSnapshot = await withTimeout(
          getDocs(eventsQ),
          FIRESTORE_TIMEOUT_MS,
          `查询 events(eventCode)（orgId=${orgId}）`
        );

        if (eventsSnapshot.empty) {
          throw new Error(`找不到活动代码: ${eventCode}`);
        }

        const doc0 = eventsSnapshot.docs[0];
        const evtId = doc0.id;
        const evtData = doc0.data();
        setEventId(evtId);
        setEvent({ id: evtId, ...evtData });
        console.log('[EventContext] 找到活动:', { id: evtId, eventCode: evtData?.eventCode });

        resolvedEventId = evtId;
        resolvedEventCode = evtData?.eventCode || eventCode;
      } catch (e) {
        const msg = e?.message || '';
        const code = e?.code || '';
        const isPerm =
          code === 'permission-denied' ||
          code === 'failed-precondition' ||
          /Missing or insufficient permissions/i.test(msg);
        const isTimeout = /载入逾时|載入逾時/i.test(msg);

        if (isPerm || isTimeout) {
          await resolveViaHttp();
          setLoading(false);
          return;
        }
        throw e;
      }

      console.log('[EventContext] ✅ 载入成功:', {
        orgCode: resolvedOrgCode,
        eventCode: resolvedEventCode,
        orgId: resolvedOrgId || orgId,
        eventId: resolvedEventId
      });

      setLoading(false);

    } catch (err) {
      console.error('[EventContext] 载入错误:', err);
      setError(err.message);
      setLoading(false);
      throw err;
    }
  };

  // 获取集合路径（自动加上 org 和 event 前缀）
  const getCollectionPath = (collectionName) => {
    if (!organizationId || !eventId) {
      throw new Error('组织或活动尚未载入');
    }
    return `organizations/${organizationId}/events/${eventId}/${collectionName}`;
  };

  // 获取 Firestore 集合引用
  const getCollection = (collectionName) => {
    return collection(db, getCollectionPath(collectionName));
  };

  const value = {
    loading,
    error,
    organizationId,
    eventId,
    organization,
    event,
    orgCode,
    eventCode,
    getCollectionPath,
    getCollection,
    reload: parseUrlAndLoadData
  };

  // 添加错误显示
  if (error) {
    return (
      <EventContext.Provider value={value}>
        <div style={{
          padding: '2rem',
          maxWidth: '600px',
          margin: '2rem auto',
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '8px',
          color: '#991b1b'
        }}>
          <h2 style={{ margin: '0 0 1rem 0' }}>❌ 载入失败</h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: '1rem 0',
            padding: '1rem',
            background: 'white',
            borderRadius: '4px'
          }}>
            {error}
          </pre>
          <p>请检查：</p>
          <ul>
            <li>URL 格式是否正确（如 /login/orgCode-eventCode）</li>
            <li>组织和活动代码是否存在于 Firestore</li>
            <li>网络连接是否正常（若使用公司网路，可能阻挡 Google 域名）</li>
          </ul>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1rem',
              background: '#991b1b',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              marginTop: '1rem'
            }}
          >
            重新载入
          </button>
          <div style={{ marginTop: '0.75rem', color: '#6b7280' }}>
            <small>
              提示：若看到 apis.google.com 載入逾時，請嘗試更換網路、停用阻擋外部腳本的外掛，或改用 Firebase 測試電話登入。
            </small>
          </div>
        </div>
      </EventContext.Provider>
    );
  }

  if (loading) {
    return (
      <EventContext.Provider value={value}>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh'
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '50px',
              height: '50px',
              border: '4px solid #f3f4f6',
              borderTopColor: '#667eea',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 1rem'
            }} />
            <p style={{ color: '#6b7280' }}>载入中...</p>
          </div>
        </div>
      </EventContext.Provider>
    );
  }

  return (
    <EventContext.Provider value={value}>
      {children}
    </EventContext.Provider>
  );
};

// 添加旋转动画
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
