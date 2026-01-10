/**
 * useManagedUsers Hook (修复版 v3.0)
 * 
 * 功能：实时监听 Seller Manager 管理的所有 Seller 用户数据
 * 
 * 🔧 修复 v3.0：
 * - 删除不存在的 managedBy 字段查询
 * - 改用 sellerManager.managedDepartments 匹配 identityInfo.department
 * - 先取 Seller Manager 本身的 managedDepartments，再查所有匹配部门的 seller
 * 
 * @author MyBazaar Team
 * @date 2026-01-10 (修复版 v3.0)
 */

import { useState, useEffect } from 'react';
import { getFirestore, collection, query, where, onSnapshot, doc, getDoc } from 'firebase/firestore';

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
    let unsubscribe = null;
    let sellerManagerUnsubscribe = null;

    // ===== 分两步：先取 SellerManager 的 managedDepartments，再查询对应部门的 seller =====

    // 📍 步骤1：先查 Seller Manager 本身的数据，获取 managedDepartments
    const sellerManagerRef = doc(
      db,
      `organizations/${organizationId}/events/${eventId}/users/${sellerManagerId}`
    );

    sellerManagerUnsubscribe = onSnapshot(
      sellerManagerRef,
      (smDoc) => {
        if (!smDoc.exists()) {
          console.warn('[useManagedUsers] Seller Manager 用户不存在', sellerManagerId);
          setLoading(false);
          setError('Seller Manager 用户不存在');
          return;
        }

        const smData = smDoc.data();
        const managedDepartments = smData.sellerManager?.managedDepartments || [];

        console.log('[useManagedUsers] ✅ 获取到 Seller Manager 管理的部门', {
          sellerManagerId,
          managedDepartments
        });

        if (managedDepartments.length === 0) {
          console.warn('[useManagedUsers] Seller Manager 没有管理任何部门');
          setUsers([]);
          setStats({
            totalCount: 0,
            activeCount: 0,
            totalPendingCollection: 0,
            totalRevenue: 0,
            usersWithWarnings: 0
          });
          setLoading(false);
          return;
        }

        // 📍 步骤2：查询所有 identityInfo.department 在 managedDepartments 中的 seller
        const usersRef = collection(
          db,
          `organizations/${organizationId}/events/${eventId}/users`
        );

        // ⚠️ Firestore 不支持 'in' 对嵌套字段的查询，所以要用多个 OR 查询
        // 但 Firestore 也不支持 OR，所以改用客户端过滤
        // 我们先查出所有用户，然后在客户端过滤
        
        let q = query(usersRef);
        if (!includeInactive) {
          q = query(usersRef, where('accountStatus.isActive', '==', true));
        }

        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            console.log(`[useManagedUsers] ✅ 查询到 ${snapshot.size} 个文档`);

            const usersList = [];
            let activeCount = 0;
            let totalPendingCollection = 0;
            let totalRevenue = 0;
            let usersWithWarnings = 0;

            snapshot.forEach(doc => {
              const data = doc.data();
              
              // ✅ 过滤条件1：必须有 'seller' 角色
              const roles = data.roles || [];
              if (!roles.includes('seller')) {
                return; // 跳过这个用户
              }

              // ✅ 过滤条件2：identityInfo.department 必须在 managedDepartments 中
              const userDept = data.identityInfo?.department || '';
              if (!managedDepartments.includes(userDept)) {
                return; // 跳过这个用户
              }

              const userData = {
                id: doc.id,
                ...data
              };

              usersList.push(userData);

              // 📊 计算统计数据
              const seller = data.seller || {};
              if (data.accountStatus?.isActive) activeCount++;
              
              totalPendingCollection += seller.pendingCollection || 0;
              totalRevenue += seller.totalRevenue || 0;
              
              if (seller.collectionAlert?.hasWarning) usersWithWarnings++;
            });

            console.log(`[useManagedUsers] 过滤后剩余 ${usersList.length} 个Seller`, {
              managedDepartments,
              matchingCount: usersList.length
            });

            // 🎯 按部门和姓名排序
            usersList.sort((a, b) => {
              const deptA = a.identityInfo?.department || '';
              const deptB = b.identityInfo?.department || '';
              
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
      },
      (err) => {
        console.error('[useManagedUsers] ❌ 获取 Seller Manager 信息失败', err);
        setError(err.message);
        setLoading(false);
      }
    );

    // 🧹 清理函数
    return () => {
      console.log('[useManagedUsers] 停止监听用户');
      if (unsubscribe) unsubscribe();
      if (sellerManagerUnsubscribe) sellerManagerUnsubscribe();
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

export default useManagedUsers;