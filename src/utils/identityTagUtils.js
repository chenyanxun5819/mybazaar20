/**
 * 身份标签工具函数 - 方案 B 实现
 * 支持多组织、动态身份标签配置
 */

/**
 * 从组织配置获取所有身份标签
 */
export const getIdentityTags = (organization) => {
  if (!organization?.identityTags) return [];
  return organization.identityTags;
};

/**
 * 获取所有「被管理」的身份标签（即 roleType === 'managed'）
 * 这些身份标签需要由某个角色（如 Seller Manager）管理
 * 
 * @param {Object} organization - 组织对象
 * @returns {Array} 被管理身份标签数组
 */
export const getManagedIdentityTags = (organization) => {
  if (!organization?.identityTags) return [];
  return organization.identityTags.filter(tag => tag.roleConfig?.roleType === 'managed');
};

/**
 * 获取所有「独立」的身份标签（即 roleType === 'independent'）
 * 这些身份标签不需要被管理，可以直接处理
 * 
 * @param {Object} organization - 组织对象
 * @returns {Array} 独立身份标签数组
 */
export const getIndependentIdentityTags = (organization) => {
  if (!organization?.identityTags) return [];
  return organization.identityTags.filter(tag => tag.roleConfig?.roleType === 'independent');
};

/**
 * 获取某个身份标签的完整配置
 */
export const getIdentityTagConfig = (identityTag, organization) => {
  if (!organization?.identityTags) return null;
  return organization.identityTags.find(tag => tag.id === identityTag);
};

/**
 * 获取某个身份标签的角色配置
 */
export const getIdentityRoleConfig = (identityTag, organization) => {
  const config = getIdentityTagConfig(identityTag, organization);
  return config?.roleConfig;
};

/**
 * 检查身份标签是否是「被管理」类型
 */
export const isIdentityManaged = (identityTag, organization) => {
  const roleConfig = getIdentityRoleConfig(identityTag, organization);
  return roleConfig?.roleType === 'managed';
};

/**
 * 检查身份标签是否是「独立」类型
 */
export const isIdentityIndependent = (identityTag, organization) => {
  const roleConfig = getIdentityRoleConfig(identityTag, organization);
  return roleConfig?.roleType === 'independent';
};

/**
 * 获取管理某个身份标签的角色
 * 例如：如果 'student' 是被管理身份，返回 'sellerManager'
 */
export const getManagerRoleForIdentity = (identityTag, organization) => {
  const config = getIdentityTagConfig(identityTag, organization);
  if (!config?.managedByRole) return null;
  return config.managedByRole.role;
};

/**
 * 检查某个角色是否管理某个身份标签
 */
export const doesRoleManageIdentity = (role, identityTag, organization) => {
  return getManagerRoleForIdentity(identityTag, organization) === role;
};

/**
 * 获取某个角色管理的所有身份标签
 * 例如：sellerManager 管理 ['student', 'apprentice']
 */
export const getIdentitiesForRole = (role, organization) => {
  if (!organization?.identityTags) return [];
  return organization.identityTags.filter(tag => {
    return tag.managedByRole?.role === role;
  });
};

/**
 * 获取某个身份标签的管理策略
 */
export const getIdentityPolicies = (identityTag, organization) => {
  const config = getIdentityTagConfig(identityTag, organization);
  return config?.managedByRole?.policies || {};
};

/**
 * 检查某个身份标签是否需要现金上交批准
 */
export const requiresApprovalForCash = (identityTag, organization) => {
  const policies = getIdentityPolicies(identityTag, organization);
  return policies.requiresApprovalForCash === true;
};

/**
 * 检查某个身份标签是否需要计算收款警示
 * （这是学生特有的功能）
 */
export const shouldCalculateCollectionWarning = (identityTag, organization) => {
  const policies = getIdentityPolicies(identityTag, organization);
  return policies.calculateCollectionWarning === true;
};

/**
 * 检查某个身份标签是否允许批量分配点数
 */
export const canBatchAllocate = (identityTag, organization) => {
  const policies = getIdentityPolicies(identityTag, organization);
  return policies.canBatchAllocate === true;
};

/**
 * 获取身份标签的显示名称 (优先用中文)
 */
export const getIdentityDisplayName = (identityTag, organization, language = 'zh-CN') => {
  const config = getIdentityTagConfig(identityTag, organization);
  if (!config) return identityTag;
  
  const langKey = language === 'zh-CN' ? 'zh-CN' : 'en-US';
  return config.name?.[langKey] || identityTag;
};

/**
 * 为下拉菜单或选项列表生成身份标签选项
 */
export const getIdentityOptions = (organization, options = {}) => {
  const {
    includeAll = true,        // 是否包含所有身份标签
    onlyManaged = false,      // 仅被管理的身份标签
    onlyIndependent = false,  // 仅独立的身份标签
    language = 'zh-CN'        // 显示语言
  } = options;

  let tags = [];
  
  if (includeAll) {
    tags = getIdentityTags(organization);
  } else if (onlyManaged) {
    tags = getManagedIdentityTags(organization);
  } else if (onlyIndependent) {
    tags = getIndependentIdentityTags(organization);
  }

  return tags
    .filter(tag => tag.isActive)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
    .map(tag => ({
      id: tag.id,
      label: getIdentityDisplayName(tag.id, organization, language),
      roleType: tag.roleConfig?.roleType,
      managedByRole: tag.managedByRole?.role,
      value: tag.id
    }));
};

/**
 * 为批量导入验证生成允许的身份标签列表
 */
export const getAllowedIdentityTagsForImport = (organization) => {
  return getIdentityTags(organization)
    ?.filter(tag => tag.isActive)
    ?.map(tag => tag.id) || [];
};

/**
 * 迁移策略：生成身份标签配置（用于从旧系统升级）
 * 如果组织没有新的 roleConfig，生成默认配置
 */
export const generateDefaultIdentityTagConfig = () => {
  return [
    {
      id: 'student',
      name: { 'zh-CN': '学生', 'en-US': 'Student' },
      displayOrder: 1,
      isActive: true,
      roleConfig: {
        roleType: 'managed',
        description: '需要被 Seller Manager 管理的身份'
      },
      managedByRole: {
        role: 'sellerManager',
        policies: {
          requiresApprovalForCash: true,
          calculateCollectionWarning: true,
          canBatchAllocate: true,
          canExportData: true
        }
      }
    },
    {
      id: 'teacher',
      name: { 'zh-CN': '教师', 'en-US': 'Teacher' },
      displayOrder: 2,
      isActive: true,
      roleConfig: {
        roleType: 'independent',
        description: '独立身份，可直接交现金给 Cashier'
      }
    },
    {
      id: 'staff',
      name: { 'zh-CN': '职员', 'en-US': 'Staff' },
      displayOrder: 3,
      isActive: true,
      roleConfig: {
        roleType: 'independent',
        description: '独立身份，可直接交现金给 Cashier'
      }
    },
    {
      id: 'parent',
      name: { 'zh-CN': '家长', 'en-US': 'Parent' },
      displayOrder: 4,
      isActive: true,
      roleConfig: {
        roleType: 'independent',
        description: '独立身份，可直接交现金给 Cashier'
      }
    },
    {
      id: 'external',
      name: { 'zh-CN': '外部人员', 'en-US': 'External' },
      displayOrder: 5,
      isActive: true,
      roleConfig: {
        roleType: 'independent',
        description: '外部访客或临时人员'
      }
    }
  ];
};

/**
 * 获取身份标签的 emoji 图标（用于 UI 显示）
 */
export const getIdentityEmoji = (identityTag) => {
  const emojiMap = {
    'student': '👨‍🎓',
    'teacher': '👨‍🏫',
    'staff': '👔',
    'parent': '👨‍👩‍👧',
    'volunteer': '🙋',
    'external': '👤',
    'monk': '🧘',
    'abbot': '🏛️',
    'sponsor': '💰'
  };
  return emojiMap[identityTag] || '👤';
};
