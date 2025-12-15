import { useEffect, useState } from 'react';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';

/**
 * Hook: 获取 Seller 的交易记录
 * 实时监听 transactions collection，筛选 sellerId
 */
export function useTransactions(maxRecords = 50) {
  // 🔥 修复：使用 userProfile 而不是 currentUser
  const { userProfile } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('[useTransactions] userProfile:', userProfile);
    
    // 🔥 修复：检查 userProfile 而不是 currentUser
    if (!userProfile?.organizationId || !userProfile?.eventId || !userProfile?.userId) {
      console.warn('[useTransactions] 缺少必要字段');
      setLoading(false);
      return;
    }

    // 构建查询：sellerId == userProfile.userId，按时间倒序
    const transactionsRef = collection(
      db,
      `organizations/${userProfile.organizationId}/events/${userProfile.eventId}/transactions`
    );

    const q = query(
      transactionsRef,
      where('sellerId', '==', userProfile.userId),
      orderBy('timestamp', 'desc'),
      limit(maxRecords)
    );

    console.log('[useTransactions] 开始监听交易记录...');

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        
        console.log('[useTransactions] 收到', data.length, '条交易记录');
        setTransactions(data);
        setError(null);
        setLoading(false);
      },
      (err) => {
        console.error('[useTransactions] 获取交易记录失败:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => {
      console.log('[useTransactions] 停止监听交易记录');
      unsubscribe();
    };
  }, [userProfile, maxRecords]); // 🔥 修复：依赖 userProfile

  return { transactions, loading, error };
}