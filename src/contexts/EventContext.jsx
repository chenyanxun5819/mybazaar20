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

  // 從 URL 解析組織和活動代碼
  // URL 格式: /fch-2025/phone 或 /fch-2025/desktop
  const urlPath = window.location.pathname;
  const match = urlPath.match(/\/([a-z]+)-(\d+)\/(phone|desktop)/);
  
  const orgCode = match ? match[1] : null;
  const eventCode = match ? match[2] : null;

  useEffect(() => {
    if (!orgCode || !eventCode) {
      setLoading(false);
      return;
    }

    loadEventData();
  }, [orgCode, eventCode]);

  const loadEventData = async () => {
    try {
      setLoading(true);
      setError(null);

      // 1. 根據 orgCode 查找組織
      const orgsSnapshot = await getDocs(
        query(collection(db, 'organizations'), where('orgCode', '==', orgCode))
      );

      if (orgsSnapshot.empty) {
        throw new Error(`找不到組織代碼: ${orgCode}`);
      }

      const orgDoc = orgsSnapshot.docs[0];
      const orgId = orgDoc.id;
      const orgData = orgDoc.data();

      setOrganizationId(orgId);
      setOrganization({ id: orgId, ...orgData });

      // 2. 根據 eventCode 查找活動
      const eventsSnapshot = await getDocs(
        query(
          collection(db, 'organizations', orgId, 'events'),
          where('eventCode', '==', eventCode)
        )
      );

      if (eventsSnapshot.empty) {
        throw new Error(`找不到活動代碼: ${eventCode}`);
      }

      const eventDoc = eventsSnapshot.docs[0];
      const evtId = eventDoc.id;
      const evtData = eventDoc.data();

      setEventId(evtId);
      setEvent({ id: evtId, ...evtData });

      console.log('[EventContext] Loaded:', {
        orgCode,
        eventCode,
        orgId,
        eventId: evtId
      });
    } catch (err) {
      console.error('[EventContext] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 獲取集合路徑（自動加上 org 和 event 前綴）
  const getCollectionPath = (collectionName) => {
    if (!organizationId || !eventId) {
      throw new Error('Organization or Event not loaded');
    }
    return `organizations/${organizationId}/events/${eventId}/${collectionName}`;
  };

  // 獲取 Firestore 集合引用
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
    reload: loadEventData
  };

  return (
    <EventContext.Provider value={value}>
      {children}
    </EventContext.Provider>
  );
};