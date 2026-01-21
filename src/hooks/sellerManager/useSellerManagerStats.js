/**
 * useSellerManagerStats Hook
 * 
 * 功能：实时监听 Seller Manager 的统计数据
 * 使用场景：OverviewStats.jsx
 * 
 * 优势：
 * - 🔄 自动实时更新：数据库变化立即反映到UI
 * - 📊 自动处理加载和错误状态
 * - ♻️ 自动清理监听器，防止内存泄漏
 * 
 * @author MyBazaar Team
 * @date 2025-01-09
 */

import { useState, useEffect } from 'react';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

/**
 * 监听 Seller Manager 的统计数据
 * 
 * @param {string} organizationId - 组织ID
 * @param {string} eventId - 活动ID
 * @param {string} sellerManagerId - Seller Manager用户ID
 * @returns {Object} { smStats, loading, error, refresh }
 * 
 * @example
 * const { smStats, loading, error } = useSellerManagerStats(orgId, eventId, smId);
 * 
 * if (loading) return <div>加载中...</div>;
 * if (error) return <div>错误: {error}</div>;
 * 
 * return (
 *   <div>
 *     <p>累计分配次数: {smStats.allocationStats?.totalAllocations}</p>
 *     <p>管理用户数: {smStats.managedUsersStats?.totalUsers}</p>
 *   </div>
 * );
 */
export function useSellerManagerStats(organizationId, eventId, sellerManagerId) {
  const [smStats, setSmStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 🔍 验证必填参数
    if (!organizationId || !eventId || !sellerManagerId) {
      console.warn('[useSellerManagerStats] 缺少必填参数', {
        organizationId,
        eventId,
        sellerManagerId
      });
      setLoading(false);
      return;
    }

    console.log('[useSellerManagerStats] 开始监听统计数据', {
      organizationId,
      eventId,
      sellerManagerId
    });

    const db = getFirestore();
    
    // 📍 Firestore路径
    const statsRef = doc(
      db,
      `organizations/${organizationId}/events/${eventId}/sellerManagerStats/${sellerManagerId}`
    );

    // 🎣 设置实时监听器
    const unsubscribe = onSnapshot(
      statsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          console.log('[useSellerManagerStats] ✅ 统计数据更新', data);
          
          setSmStats(data);
          setError(null);
        } else {
          console.warn('[useSellerManagerStats] ⚠️ 统计文档不存在');
          
          // 设置默认空数据结构
          setSmStats({
            sellerManagerId: sellerManagerId,
            managedUsersStats: {
              totalUsers: 0,
              activeUsers: 0,
              currentBalance: 0,
              totalRevenue: 0,
              totalCashCollected: 0,
              pendingCollection: 0,
              collectionRate: 0
            },
            allocationStats: {
              totalAllocations: 0,
              totalPointsAllocated: 0,
              averagePerAllocation: 0,
              lastAllocationAt: null
            },
            collectionManagement: {
              usersWithWarnings: 0,
              highRiskUsers: 0,
              totalCashHolding: 0
            }
          });
        }
        
        setLoading(false);
      },
      (err) => {
        console.error('[useSellerManagerStats] ❌ 监听错误', err);
        setError(err.message);
        setLoading(false);
      }
    );

    // 🧹 清理函数：组件卸载时停止监听
    return () => {
      console.log('[useSellerManagerStats] 停止监听');
      unsubscribe();
    };
  }, [organizationId, eventId, sellerManagerId]);

  // 🔄 手动刷新函数（可选使用）
  const refresh = () => {
    setLoading(true);
    // onSnapshot会自动触发更新
  };

  return {
    smStats,
    loading,
    error,
    refresh
  };
}

/**
 * 使用示例：替换 OverviewStats.jsx 中的 props
 * 
 * ❌ 旧代码：
 * const OverviewStats = ({ smStats, departmentStats, eventData }) => {
 *   const safeSmStats = (smStats && typeof smStats === 'object') ? smStats : null;
 *   // ... 使用 safeSmStats
 * }
 * 
 * ✅ 新代码：
 * const OverviewStats = ({ organizationId, eventId, sellerManagerId, eventData }) => {
 *   const { smStats, loading, error } = useSellerManagerStats(
 *     organizationId, 
 *     eventId, 
 *     sellerManagerId
 *   );
 * 
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (!smStats) return <div>暂无统计数据</div>;
 * 
 *   // ... 直接使用 smStats，它会自动实时更新！
 * }
 */

export default useSellerManagerStats;

