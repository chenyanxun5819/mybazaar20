import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useAuth } from '../../../contexts/AuthContext';

/**
 * Hook: 获取 Seller 统计数据
 * 实时监听 users/{userId} 的 seller 对象
 */
export function useSellerStats() {
  // 🔥 修复：使用 userProfile 而不是 currentUser
  const { userProfile } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log('=== useSellerStats Debug ===');
    console.log('1. userProfile:', userProfile);
    console.log('2. organizationId:', userProfile?.organizationId);
    console.log('3. eventId:', userProfile?.eventId);
    console.log('4. userId:', userProfile?.userId);

    // 🔥 修复：检查 userProfile 而不是 currentUser
    if (!userProfile?.organizationId || !userProfile?.eventId || !userProfile?.userId) {
      console.warn('[useSellerStats] ⚠️ 缺少必要字段，停止监听');
      console.warn('[useSellerStats] userProfile:', userProfile);
      setLoading(false);
      return;
    }

    // 监听当前用户的文档
    const userPath = `organizations/${userProfile.organizationId}/events/${userProfile.eventId}/users/${userProfile.userId}`;
    console.log('5. Firestore 路径:', userPath);

    const userRef = doc(db, userPath);

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
  }, [userProfile]); // 🔥 修复：依赖 userProfile

  console.log('=== useSellerStats 返回值 ===');
  console.log('stats:', stats);
  console.log('loading:', loading);
  console.log('error:', error);
  console.log('============================');

  return { stats, loading, error };
}
