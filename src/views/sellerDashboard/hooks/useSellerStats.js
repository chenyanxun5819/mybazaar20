import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';
import { useEvent } from '../../../contexts/EventContext';

/**
 * Hook: 获取 Seller 统计数据
 * 实时监听 users/{userId} 的 seller 对象
 */
export function useSellerStats() {
  const { currentUser, userProfile } = useAuth();
  const { organizationId, eventId } = useEvent();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const resolvedOrganizationId = organizationId || userProfile?.organizationId;
  const resolvedEventId = eventId || userProfile?.eventId;
  const resolvedUserId = userProfile?.userId || currentUser?.uid;

  const userRef = useMemo(() => {
    if (!resolvedOrganizationId || !resolvedEventId || !resolvedUserId) {
      return null;
    }

    return doc(
      db,
      `organizations/${resolvedOrganizationId}/events/${resolvedEventId}/users/${resolvedUserId}`
    );
  }, [resolvedOrganizationId, resolvedEventId, resolvedUserId]);

  // 提供一個主動重新抓取的函式，供使用者在必要時觸發一次性讀取
  const refresh = async () => {
    if (!userRef) {
      return;
    }

    try {
      setLoading(true);
      const snap = await getDoc(userRef);
      if (snap.exists()) {
        const data = snap.data();
        const sellerData = data.seller || null;
        setStats(sellerData);
        setError(null);
      } else {
        setStats(null);
        setError('用户数据不存在');
      }
    } catch (err) {
      console.error('[useSellerStats][refresh] 错误:', err);
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const applyLocalStatsUpdate = (updater) => {
    setStats((previousStats) => {
      const baseStats = previousStats || {};
      return typeof updater === 'function' ? updater(baseStats) : baseStats;
    });
  };

  useEffect(() => {
    console.log('=== useSellerStats Debug ===');
    console.log('1. userProfile:', userProfile);
    console.log('2. organizationId:', resolvedOrganizationId);
    console.log('3. eventId:', resolvedEventId);
    console.log('4. userId:', resolvedUserId);

    if (!userRef) {
      console.warn('[useSellerStats] ⚠️ 缺少必要字段，停止监听');
      console.warn('[useSellerStats] userProfile:', userProfile);
      setLoading(false);
      return;
    }

    console.log('5. Firestore 路径:', userRef.path);

    console.log('[useSellerStats] 🔥 开始监听 Firestore...');

    const unsubscribe = onSnapshot(
      userRef,
      (docSnap) => {
        console.log('=== Firestore Snapshot 收到 ===');
        console.log('6. Document exists:', docSnap.exists());
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log('7. 完整文档数据:', data);
          console.log('8. seller 对象:', data.seller);
          console.log('9. seller 字段列表:', data.seller ? Object.keys(data.seller) : 'N/A');
          
          // 使用架构要求的 seller 对象
          const sellerData = data.seller || null;
          
          console.log('10. 设置 stats 为:', sellerData);
          setStats(sellerData);
          setError(null);
        } else {
          console.error('[useSellerStats] ❌ 用户文档不存在！');
          setStats(null);
          setError('用户数据不存在');
        }
        
        console.log('11. 设置 loading = false');
        setLoading(false);
        console.log('================================');
      },
      (err) => {
        console.error('=== Firestore 错误 ===');
        console.error('Error:', err);
        console.error('Error message:', err.message);
        console.error('Error code:', err.code);
        console.error('======================');
        
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      console.log('[useSellerStats] 🔚 停止监听 Firestore');
      unsubscribe();
    };
  }, [userRef, resolvedOrganizationId, resolvedEventId, resolvedUserId, userProfile]);

  console.log('=== useSellerStats 返回值 ===');
  console.log('stats:', stats);
  console.log('loading:', loading);
  console.log('error:', error);
  console.log('============================');

  return { stats, loading, error, refresh, applyLocalStatsUpdate };
}

