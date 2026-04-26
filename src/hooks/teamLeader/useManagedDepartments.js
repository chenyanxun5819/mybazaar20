/**
 * useManagedDepartments Hook
 * 
 * 功能：实时监听 Team Leader 管理的所有部门统计数据
 * 使用场景：DepartmentList.jsx
 * 
 * 优势：
 * - 🔄 实时监听多个部门：一次性监听所有管理的部门
 * - 📊 自动聚合数据：自动从 departmentStats 集合获取数据
 * - 🎯 智能更新：任何一个部门数据变化，立即更新
 * 
 * @author MyBazaar Team
 * @date 2025-01-09
 */

import { useState, useEffect } from 'react';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

/**
 * 监听多个部门的统计数据
 * 
 * @param {string} organizationId - 组织ID
 * @param {string} eventId - 活动ID
 * @param {string[]} managedDepartments - 管理的部门代码数组，例如：['6A', '6B', '6C']
 * @returns {Object} { departments, loading, error, refresh }
 * 
 * @example
 * const { departments, loading, error } = useManagedDepartments(
 *   'org123',
 *   'event456',
 *   ['6A', '6B', '6C']
 * );
 * 
 * if (loading) return <div>加载中...</div>;
 * 
 * return (
 *   <div>
 *     {departments.map(dept => (
 *       <DepartmentCard key={dept.departmentCode} dept={dept} />
 *     ))}
 *   </div>
 * );
 */
export function useManagedDepartments(organizationId, eventId, managedDepartments) {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // 🔍 验证参数
    if (!organizationId || !eventId) {
      console.warn('[useManagedDepartments] 缺少必填参数');
      setLoading(false);
      return;
    }

    if (!Array.isArray(managedDepartments) || managedDepartments.length === 0) {
      console.warn('[useManagedDepartments] 没有管理的部门');
      setDepartments([]);
      setLoading(false);
      return;
    }

    console.log('[useManagedDepartments] 开始监听部门', {
      organizationId,
      eventId,
      departments: managedDepartments
    });

    const db = getFirestore();
    const unsubscribers = [];
    const departmentsData = {};

    // 📊 为每个部门设置独立的监听器
    managedDepartments.forEach(deptCode => {
      const deptRef = doc(
        db,
        `organizations/${organizationId}/events/${eventId}/departmentStats/${deptCode}`
      );

      const unsubscribe = onSnapshot(
        deptRef,
        (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            console.log(`[useManagedDepartments] ✅ 部门 ${deptCode} 数据更新`, data);
            
            // 更新这个部门的数据
            departmentsData[deptCode] = {
              id: snapshot.id,
              departmentCode: deptCode,
              ...data
            };
          } else {
            console.warn(`[useManagedDepartments] ⚠️ 部门 ${deptCode} 统计不存在，创建默认数据`);
            
            // 如果部门统计文档不存在，创建默认结构
            departmentsData[deptCode] = {
              id: deptCode,
              departmentCode: deptCode,
              departmentName: `部门 ${deptCode}`,
              totalPointSellers: 0,
              activePointSellers: 0,
              membersStats: {
                totalCount: 0,
                activeCount: 0
              },
              pointsStats: {
                currentBalance: 0,
                totalRevenue: 0,
                totalCashCollected: 0,
                pendingCollection: 0,
                totalPointsSold: 0,
                collectionRate: 0
              },
              collectionAlerts: {
                usersWithWarnings: 0,
                highRiskUsers: []
              },
              allocationStats: {
                totalAllocations: 0,
                byEventManager: { count: 0, totalPoints: 0 },
                byteamLeader: { count: 0, totalPoints: 0 }
              }
            };
          }

          // 🔄 转换为数组并更新状态
          const deptsArray = Object.values(departmentsData);
          setDepartments(deptsArray);
          setLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useManagedDepartments] ❌ 部门 ${deptCode} 监听错误`, err);
          setError(err.message);
          setLoading(false);
        }
      );

      unsubscribers.push(unsubscribe);
    });

    // 🧹 清理函数：停止所有监听器
    return () => {
      console.log('[useManagedDepartments] 停止监听所有部门');
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [organizationId, eventId, JSON.stringify(managedDepartments)]);

  // 🔄 手动刷新
  const refresh = () => {
    setLoading(true);
    // onSnapshot会自动触发更新
  };

  return {
    departments,
    loading,
    error,
    refresh
  };
}

/**
 * 使用示例：替换 DepartmentList.jsx 中的 props
 * 
 * ❌ 旧代码：
 * const DepartmentList = ({ departmentStats, onSelectDepartment }) => {
 *   const safeDepartmentStats = Array.isArray(departmentStats) ? departmentStats : [];
 *   // ... 使用硬编码的 departmentStats
 * }
 * 
 * ✅ 新代码：
 * const DepartmentList = ({ 
 *   organizationId, 
 *   eventId, 
 *   managedDepartments, // ['6A', '6B', '6C']
 *   onSelectDepartment 
 * }) => {
 *   const { departments, loading, error } = useManagedDepartments(
 *     organizationId, 
 *     eventId, 
 *     managedDepartments
 *   );
 * 
 *   if (loading) return <LoadingSpinner />;
 *   if (error) return <ErrorMessage error={error} />;
 *   if (departments.length === 0) return <EmptyState />;
 * 
 *   // ... 使用 departments，它会自动实时更新！
 *   return (
 *     <div>
 *       {departments.map(dept => (
 *         <DepartmentCard key={dept.departmentCode} dept={dept} />
 *       ))}
 *     </div>
 *   );
 * }
 */

export default useManagedDepartments;

