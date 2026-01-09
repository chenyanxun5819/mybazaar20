/**
 * useManagedUsers Hook
 * 
 * 功能：实时监听 Seller Manager 管理的所有 Seller 用户数据
 * 使用场景：SellerList.jsx, CollectCash.jsx, 其他需要Seller列表的组件
 * 
 * 优势：
 * - 🔄 统一数据源：所有组件共用同一个Hook
 * - 🎯 智能查询：自动查询 managedBy 包含当前SM的所有Seller
 * - 📊 实时更新：任何Seller数据变化立即反映
 * - ♻️ 可复用：避免重复的Firestore查询代码
 * 
 * @author MyBazaar Team
 * @date 2025-01-09
 */

import { useState, useEffect } from 'react';
import { getFirestore, collection, query, where, onSnapshot } from 'firebase/firestore';

/**
 * 监听 Seller Manager 管理的所有 Seller 用户
 * 
 * @param {string} organizationId - 组织ID
 * @param {string} eventId - 活动ID
 * @param {string} sellerManagerId - Seller Manager用户ID
 * @param {Object} options - 可选配置
 * @param {boolean} options.includeInactive - 是否包含非活跃用户，默认true
 * @returns {Object} { users, loading, error, refresh, stats }
 * 
 * @example
 * // 基本使用
 * const { users, loading, error } = useManagedUsers(orgId, eventId, smId);
 * 
 * // 只查询活跃用户
 * const { users } = useManagedUsers(orgId, eventId, smId, { 
 *   includeInactive: false 
 * });
 * 
 * if (loading) return <div>加载中...</div>;
 * 
 * return (
 *   <div>
 *     {users.map(user => (
 *       <SellerRow key={user.id} seller={user} />
 *     ))}
 *   </div>
 * );
 */
export function useManagedUsers(
  organizationId, 
  eventId, 
  sellerManagerId,
  options = {}
) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState({
    totalCount: 0,
    activeCount: 0,
    totalPendingCollection: 0,
    totalRevenue: 0,
    usersWithWarnings: 0
  });

  const { includeInactive = true } = options;

  useEffect(() => {
    // 🔍 验证参数
    if (!organizationId || !eventId || !sellerManagerId) {
      console.warn('[useManagedUsers] 缺少必填参数', {
        organizationId,
        eventId,
        sellerManagerId
      });
      setLoading(false);
      return;
    }

    console.log('[useManagedUsers] 开始监听用户', {
      organizationId,
      eventId,
      sellerManagerId,
      includeInactive
    });

    const db = getFirestore();
    
    // 📍 Firestore查询
    const usersRef = collection(
      db,
      `organizations/${organizationId}/events/${eventId}/users`
    );

    // 🔍 构建查询条件
    let q = query(
      usersRef,
      where('managedBy', 'array-contains', sellerManagerId),
      where('roles', 'array-contains', 'seller')
    );

    // 如果只要活跃用户
    if (!includeInactive) {
      q = query(q, where('status', '==', 'active'));
    }

    // 🎣 设置实时监听
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        console.log(`[useManagedUsers] ✅ 查询到 ${snapshot.size} 个用户`);

        const usersList = [];
        let activeCount = 0;
        let totalPendingCollection = 0;
        let totalRevenue = 0;
        let usersWithWarnings = 0;

        snapshot.forEach(doc => {
          const data = doc.data();
          const userData = {
            id: doc.id,
            ...data
          };

          usersList.push(userData);

          // 📊 计算统计数据
          const seller = data.seller || {};
          if (data.status === 'active') activeCount++;
          
          totalPendingCollection += seller.pendingCollection || 0;
          totalRevenue += seller.totalRevenue || 0;
          
          if (seller.collectionAlert?.hasWarning) usersWithWarnings++;
        });

        // 🎯 按部门和姓名排序
        usersList.sort((a, b) => {
          const deptA = a.identityInfo?.department || a.department || '';
          const deptB = b.identityInfo?.department || b.department || '';
          
          if (deptA !== deptB) {
            return deptA.localeCompare(deptB);
          }
          
          const nameA = a.basicInfo?.chineseName || a.basicInfo?.englishName || '';
          const nameB = b.basicInfo?.chineseName || b.basicInfo?.englishName || '';
          return nameA.localeCompare(nameB);
        });

        setUsers(usersList);
        setStats({
          totalCount: usersList.length,
          activeCount,
          totalPendingCollection,
          totalRevenue,
          usersWithWarnings
        });
        setLoading(false);
        setError(null);

        console.log('[useManagedUsers] 统计数据', {
          totalCount: usersList.length,
          activeCount,
          totalPendingCollection,
          usersWithWarnings
        });
      },
      (err) => {
        console.error('[useManagedUsers] ❌ 查询错误', err);
        setError(err.message);
        setLoading(false);
      }
    );

    // 🧹 清理函数
    return () => {
      console.log('[useManagedUsers] 停止监听用户');
      unsubscribe();
    };
  }, [organizationId, eventId, sellerManagerId, includeInactive]);

  // 🔄 手动刷新
  const refresh = () => {
    setLoading(true);
  };

  return {
    users,
    loading,
    error,
    refresh,
    stats
  };
}

/**
 * 使用示例1：SellerList.jsx
 * 
 * ❌ 旧代码：
 * const SellerList = ({ sellers }) => {
 *   // sellers 来自 props，不会自动更新
 * }
 * 
 * ✅ 新代码：
 * const SellerList = ({ organizationId, eventId, sellerManagerId }) => {
 *   const { users, loading, error, stats } = useManagedUsers(
 *     organizationId, 
 *     eventId, 
 *     sellerManagerId
 *   );
 * 
 *   if (loading) return <LoadingSpinner />;
 *   
 *   return (
 *     <div>
 *       <StatsBar stats={stats} />
 *       <UserTable users={users} />
 *     </div>
 *   );
 * }
 */

/**
 * 使用示例2：CollectCash.jsx
 * 
 * const CollectCash = ({ orgId, eventId, smId }) => {
 *   // 只查询有待收款的用户
 *   const { users, stats } = useManagedUsers(orgId, eventId, smId);
 *   
 *   const usersWithPending = users.filter(user => 
 *     (user.seller?.pendingCollection || 0) > 0
 *   );
 *   
 *   return (
 *     <div>
 *       <h3>待收款总额: RM {stats.totalPendingCollection}</h3>
 *       <h3>有警示的用户: {stats.usersWithWarnings}</h3>
 *       {usersWithPending.map(user => (
 *         <CollectionCard key={user.id} user={user} />
 *       ))}
 *     </div>
 *   );
 * }
 */

/**
 * 使用示例3：在多个组件间共享数据
 * 
 * 如果多个子组件都需要同样的用户数据，可以在父组件调用一次Hook，
 * 然后通过props传递给子组件，避免重复查询：
 * 
 * const ParentComponent = ({ orgId, eventId, smId }) => {
 *   const { users, loading, stats } = useManagedUsers(orgId, eventId, smId);
 *   
 *   return (
 *     <div>
 *       <Overview stats={stats} />
 *       <SellerTable users={users} />
 *       <CollectionPanel users={users} />
 *     </div>
 *   );
 * }
 */

export default useManagedUsers;
