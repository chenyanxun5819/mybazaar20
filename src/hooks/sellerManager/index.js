/**
 * Seller Manager Hooks 集中导出
 *
 * 使用方法：
 * import { useSellerManagerStats, useManagedDepartments, useManagedUsers } from '@/hooks/sellerManager';
 *
 * 或者单独导入：
 * import useSellerManagerStats from '@/hooks/sellerManager/useSellerManagerStats';
 */

import useSellerManagerStats from './useSellerManagerStats';
import useManagedDepartments from './useManagedDepartments';
import useManagedUsers from './useManagedUsers';

export { useSellerManagerStats, useManagedDepartments, useManagedUsers };

// 默认导出所有Hooks（避免引用未定义变量）
export default {
  useSellerManagerStats,
  useManagedDepartments,
  useManagedUsers
};

