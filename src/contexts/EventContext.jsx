// src/contexts/EventContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

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

  useEffect(() => {
    parseUrlAndLoadData();
  }, []);

  const parseUrlAndLoadData = async () => {
    try {
      setLoading(true);
      setError(null);

      // 🔥 改进的 URL 解析
      // 支持格式: /orgCode-eventCode/platform/page
      // 例如: /xhessbn-2025/desktop/login
      const urlPath = window.location.pathname;
      console.log('[EventContext] 解析 URL:', urlPath);

      // 🔥 更灵活的正则表达式
      // 匹配: /orgCode-eventCode/platform
      const match = urlPath.match(/\/([a-z0-9]+)-([a-z0-9\-]+)\/(phone|desktop)/i);

      if (!match) {
        console.warn('[EventContext] URL 格式无法识别:', urlPath);
        console.log('[EventContext] 预期格式: /orgCode-eventCode/platform');
        console.log('[EventContext] 例如: /xhessbn-2025/desktop/login');
        setError('URL 格式不正确，请使用正确的链接\n例如: /xhessbn-2025/desktop/login');
        setLoading(false);
        return;
      }

      const parsedOrgCode = match[1];
      const parsedEventCode = match[2];

      console.log('[EventContext] 从 URL 解析出:', {
        orgCode: parsedOrgCode,
        eventCode: parsedEventCode,
        platform: match[3]
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

      // 1. 🔥 查找组织（不区分大小写）
      const orgsSnapshot = await getDocs(collection(db, 'organizations'));
      
      console.log(`[EventContext] 找到 ${orgsSnapshot.size} 个组织`);

      let orgDoc = null;
      orgsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`[EventContext] 检查组织: ${data.orgCode}`);
        if (data.orgCode && data.orgCode.toLowerCase() === orgCode.toLowerCase()) {
          orgDoc = doc;
        }
      });

      if (!orgDoc) {
        // 🔥 提供更有帮助的错误信息
        const availableOrgs = [];
        orgsSnapshot.forEach(doc => {
          availableOrgs.push(doc.data().orgCode);
        });
        
        console.error('[EventContext] 可用的组织:', availableOrgs);
        throw new Error(
          `找不到组织代码: ${orgCode}\n` +
          `可用的组织: ${availableOrgs.join(', ')}\n` +
          `请检查 URL 是否正确`
        );
      }

      const orgId = orgDoc.id;
      const orgData = orgDoc.data();

      console.log('[EventContext] 找到组织:', {
        id: orgId,
        orgCode: orgData.orgCode
      });

      setOrganizationId(orgId);
      setOrganization({ id: orgId, ...orgData });

      // 2. 🔥 查找活动（不区分大小写）
      const eventsCollectionPath = `organizations/${orgId}/events`;
      console.log('[EventContext] 查询活动路径:', eventsCollectionPath);

      const eventsSnapshot = await getDocs(
        collection(db, 'organizations', orgId, 'events')
      );

      console.log(`[EventContext] 找到 ${eventsSnapshot.size} 个活动`);

      let eventDoc = null;
      eventsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`[EventContext] 检查活动: ${data.eventCode}`);
        if (data.eventCode && data.eventCode.toLowerCase() === eventCode.toLowerCase()) {
          eventDoc = doc;
        }
      });

      if (!eventDoc) {
        // 🔥 提供更有帮助的错误信息
        const availableEvents = [];
        eventsSnapshot.forEach(doc => {
          availableEvents.push(doc.data().eventCode);
        });

        console.error('[EventContext] 可用的活动:', availableEvents);
        throw new Error(
          `找不到活动代码: ${eventCode}\n` +
          `可用的活动: ${availableEvents.join(', ')}\n` +
          `请检查 URL 是否正确`
        );
      }

      const evtId = eventDoc.id;
      const evtData = eventDoc.data();

      console.log('[EventContext] 找到活动:', {
        id: evtId,
        eventCode: evtData.eventCode
      });

      setEventId(evtId);
      setEvent({ id: evtId, ...evtData });

      console.log('[EventContext] ✅ 载入成功:', {
        orgCode: orgData.orgCode,
        eventCode: evtData.eventCode,
        orgId,
        eventId: evtId
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

  // 🔥 添加错误显示
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
            <li>URL 格式是否正确</li>
            <li>组织和活动代码是否存在于 Firestore</li>
            <li>网络连接是否正常</li>
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