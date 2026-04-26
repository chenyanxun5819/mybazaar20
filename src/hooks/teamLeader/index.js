/**
 * Team Leader Hooks 集中导出
 *
 * 使用方法：
 * import { useTeamLeaderStats, useManagedDepartments, useManagedUsers } from '@/hooks/teamLeader';
 *
 * 或者单独导入：
 * import useTeamLeaderStats from '@/hooks/teamLeader/useTeamLeaderStats';
 */

import useTeamLeaderStats from './useTeamLeaderStats';
import useManagedDepartments from './useManagedDepartments';
import useManagedUsers from './useManagedUsers';

export { useTeamLeaderStats, useManagedDepartments, useManagedUsers };

// 默认导出所有Hooks（避免引用未定义变量）
export default {
  useTeamLeaderStats,
  useManagedDepartments,
  useManagedUsers
};

