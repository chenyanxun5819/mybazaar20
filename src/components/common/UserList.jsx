import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';

const UserList = ({ organizationId, eventId, onClose }) => {
  // 状态管理
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [activeFilter, setActiveFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  // 角色过滤器配置
  const roleFilters = [
    { id: 'all', label: '全部用户' },
    { id: 'sellerManager', label: 'Seller Manager' },
    { id: 'merchantManager', label: 'Merchant Manager' },
    { id: 'customerManager', label: 'Customer Manager' },
    { id: 'seller', label: 'Seller' },
    { id: 'merchant', label: 'Merchant' },
    { id: 'customer', label: 'Customer' }
  ];

  // 角色标签映射
  const roleLabels = {
    sellerManager: 'Seller Manager',
    merchantManager: 'Merchant Manager',
    customerManager: 'Customer Manager',
    seller: 'Seller',
    merchant: 'Merchant',
    customer: 'Customer'
  };

  // 角色颜色映射
  const roleColors = {
    sellerManager: '#f59e0b',
    merchantManager: '#8b5cf6',
    customerManager: '#10b981',
    seller: '#3b82f6',
    merchant: '#ec4899',
    customer: '#6366f1'
  };

  // 身份标签映射
  const identityLabels = {
    staff: { zh: '职员', en: 'Staff', color: '#6b7280' },
    teacher: { zh: '教师', en: 'Teacher', color: '#3b82f6' },
    student: { zh: '学生', en: 'Student', color: '#10b981' },
    parent: { zh: '家长', en: 'Parent', color: '#f59e0b' }
  };

  // 状态颜色映射
  const statusColors = {
    active: '#10b981',
    inactive: '#6b7280',
    suspended: '#ef4444'
  };

  const statusLabels = {
    active: '活跃',
    inactive: '未激活',
    suspended: '已停用'
  };

  // 📥 加载用户数据
  useEffect(() => {
    fetchUsers();
  }, [organizationId, eventId]);

  // 🔍 过滤和排序用户
  useEffect(() => {
    filterAndSortUsers();
  }, [users, activeFilter, searchTerm, sortField, sortOrder]);

  // 获取用户列表
  const fetchUsers = async () => {
    try {
      setLoading(true);
      setError(null);

      const usersRef = collection(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users'
      );

      const q = query(usersRef, orderBy('accountStatus.createdAt', 'desc'));
      const snapshot = await getDocs(q);

      const usersList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      console.log('📊 获取到的用户数量:', usersList.length);
      setUsers(usersList);
    } catch (err) {
      console.error('❌ 获取用户列表失败:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 过滤和排序用户
  const filterAndSortUsers = () => {
    let filtered = users;

    // 按角色过滤
    if (activeFilter !== 'all') {
      filtered = filtered.filter(user =>
        user.roles?.includes(activeFilter)
      );
    }

    // 按搜索词过滤
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.basicInfo?.englishName?.toLowerCase().includes(search) ||
        user.basicInfo?.chineseName?.toLowerCase().includes(search) ||
        user.basicInfo?.phoneNumber?.includes(search) ||
        user.basicInfo?.email?.toLowerCase().includes(search) ||
        user.identityInfo?.identityId?.toLowerCase().includes(search) ||
        user.identityInfo?.department?.toLowerCase().includes(search)
      );
    }

    // 排序
    filtered.sort((a, b) => {
      let aValue, bValue;

      switch (sortField) {
        case 'name':
          aValue = a.basicInfo?.englishName || '';
          bValue = b.basicInfo?.englishName || '';
          break;
        case 'phone':
          aValue = a.basicInfo?.phoneNumber || '';
          bValue = b.basicInfo?.phoneNumber || '';
          break;
        case 'department':
          aValue = a.identityInfo?.department || '';
          bValue = b.identityInfo?.department || '';
          break;
        case 'identityId':
          aValue = a.identityInfo?.identityId || '';
          bValue = b.identityInfo?.identityId || '';
          break;
        case 'createdAt':
        default:
          aValue = a.accountStatus?.createdAt?.toMillis() || 0;
          bValue = b.accountStatus?.createdAt?.toMillis() || 0;
          break;
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    setFilteredUsers(filtered);
  };

  // 格式化时间
  const formatDate = (timestamp) => {
    if (!timestamp) return '未知';
    
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (err) {
      return '未知';
    }
  };

  // 切换排序
  const toggleSort = (field) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // 📱 角色徽章组件
  const RoleBadge = ({ role }) => (
    <span style={{
      ...styles.roleBadge,
      backgroundColor: roleColors[role] || '#6b7280'
    }}>
      {roleLabels[role] || role}
    </span>
  );

  // 🏷️ 身份标签组件
  const IdentityBadge = ({ identityTag }) => {
    const identity = identityLabels[identityTag] || { zh: identityTag, en: '', color: '#6b7280' };
    return (
      <span style={{
        ...styles.identityBadge,
        backgroundColor: identity.color
      }}>
        {identity.zh}
      </span>
    );
  };

  // 📊 状态指示器
  const StatusDot = ({ status }) => (
    <span style={{
      ...styles.statusDot,
      backgroundColor: statusColors[status] || '#6b7280'
    }}></span>
  );

  // 排序图标
  const SortIcon = ({ field }) => {
    if (sortField !== field) return <span style={styles.sortIcon}>⇅</span>;
    return sortOrder === 'asc' ? 
      <span style={styles.sortIconActive}>▲</span> : 
      <span style={styles.sortIconActive}>▼</span>;
  };

  // 🎨 渲染主界面
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerLeft}>
            <h2 style={styles.title}>用户列表</h2>
            <span style={styles.userCount}>
              {filteredUsers.length} / {users.length} 位用户
            </span>
          </div>
          <div style={styles.headerRight}>
            <button
              onClick={fetchUsers}
              style={styles.refreshButton}
              disabled={loading}
            >
              🔄 刷新
            </button>
            <button onClick={onClose} style={styles.closeButton}>
              ✕
            </button>
          </div>
        </div>

        {/* 搜索框 */}
        <div style={styles.searchSection}>
          <input
            type="text"
            placeholder="搜索姓名、手机号、邮箱、学号、部门..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        {/* 过滤器 */}
        <div style={styles.filterBar}>
          {roleFilters.map(filter => (
            <button
              key={filter.id}
              onClick={() => setActiveFilter(filter.id)}
              style={{
                ...styles.filterButton,
                ...(activeFilter === filter.id ? styles.filterButtonActive : {})
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* 内容区域 */}
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingState}>
              <div style={styles.spinner}></div>
              <p style={styles.loadingText}>加载用户列表...</p>
            </div>
          ) : error ? (
            <div style={styles.errorState}>
              <p style={styles.errorText}>❌ {error}</p>
              <button onClick={fetchUsers} style={styles.retryButton}>
                重试
              </button>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={styles.emptyState}>
              <p style={styles.emptyText}>
                {searchTerm || activeFilter !== 'all'
                  ? '😕 没有找到符合条件的用户'
                  : '📝 还没有用户，点击"创建用户"开始添加'}
              </p>
            </div>
          ) : (
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead style={styles.thead}>
                  <tr>
                    <th style={styles.th} onClick={() => toggleSort('name')}>
                      姓名 <SortIcon field="name" />
                    </th>
                    <th style={styles.th} onClick={() => toggleSort('phone')}>
                      手机号 <SortIcon field="phone" />
                    </th>
                    <th style={styles.th}>邮箱</th>
                    <th style={styles.th} onClick={() => toggleSort('department')}>
                      部门 <SortIcon field="department" />
                    </th>
                    <th style={styles.th} onClick={() => toggleSort('identityId')}>
                      学号/工号 <SortIcon field="identityId" />
                    </th>
                    <th style={styles.th}>身份</th>
                    <th style={styles.th}>角色</th>
                    <th style={styles.th}>状态</th>
                    <th style={styles.th} onClick={() => toggleSort('createdAt')}>
                      创建时间 <SortIcon field="createdAt" />
                    </th>
                  </tr>
                </thead>
                <tbody style={styles.tbody}>
                  {filteredUsers.map(user => (
                    <tr key={user.id} style={styles.tr}>
                      {/* 姓名 */}
                      <td style={styles.td}>
                        <div style={styles.nameCell}>
                          <div style={styles.namePrimary}>
                            {user.basicInfo?.englishName || '未知'}
                          </div>
                          {user.basicInfo?.chineseName && (
                            <div style={styles.nameSecondary}>
                              {user.basicInfo.chineseName}
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 手机号 */}
                      <td style={styles.td}>
                        <span style={styles.phoneText}>
                          {user.basicInfo?.phoneNumber || '-'}
                        </span>
                      </td>

                      {/* 邮箱 */}
                      <td style={styles.td}>
                        <span style={styles.emailText}>
                          {user.basicInfo?.email || '-'}
                        </span>
                      </td>

                      {/* 部门 */}
                      <td style={styles.td}>
                        {user.identityInfo?.department || '-'}
                      </td>

                      {/* 学号/工号 */}
                      <td style={styles.td}>
                        <span style={styles.identityIdText}>
                          {user.identityInfo?.identityId || '-'}
                        </span>
                      </td>

                      {/* 身份 */}
                      <td style={styles.td}>
                        <IdentityBadge identityTag={user.identityTag || 'student'} />
                      </td>

                      {/* 角色 */}
                      <td style={styles.td}>
                        <div style={styles.rolesCell}>
                          {user.roles && user.roles.length > 0 ? (
                            user.roles.map(role => (
                              <RoleBadge key={role} role={role} />
                            ))
                          ) : (
                            <span style={styles.noRoles}>-</span>
                          )}
                        </div>
                      </td>

                      {/* 状态 */}
                      <td style={styles.td}>
                        <div style={styles.statusCell}>
                          <StatusDot status={user.accountStatus?.status || 'inactive'} />
                          <span style={styles.statusText}>
                            {statusLabels[user.accountStatus?.status] || '未知'}
                          </span>
                        </div>
                      </td>

                      {/* 创建时间 */}
                      <td style={styles.td}>
                        <span style={styles.dateText}>
                          {formatDate(user.accountStatus?.createdAt)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// 🎨 样式定义
const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '1600px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '1px solid #e5e7eb',
    flexShrink: 0
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem'
  },
  headerRight: {
    display: 'flex',
    gap: '0.75rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  userCount: {
    fontSize: '0.875rem',
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontWeight: '500'
  },
  refreshButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  closeButton: {
    padding: '0.5rem 1rem',
    backgroundColor: 'transparent',
    color: '#6b7280',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1.25rem',
    fontWeight: '600',
    cursor: 'pointer',
    lineHeight: 1
  },
  searchSection: {
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    flexShrink: 0
  },
  searchInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  filterBar: {
    display: 'flex',
    gap: '0.5rem',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    overflowX: 'auto',
    flexShrink: 0
  },
  filterButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.2s'
  },
  filterButtonActive: {
    backgroundColor: '#3b82f6',
    color: 'white'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '1.5rem'
  },
  tableContainer: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  thead: {
    backgroundColor: '#f9fafb',
    position: 'sticky',
    top: 0,
    zIndex: 10
  },
  th: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    borderBottom: '2px solid #e5e7eb',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none'
  },
  tbody: {
    backgroundColor: 'white'
  },
  tr: {
    borderBottom: '1px solid #f3f4f6',
    transition: 'background-color 0.2s'
  },
  td: {
    padding: '1rem',
    color: '#1f2937',
    verticalAlign: 'middle'
  },
  nameCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  namePrimary: {
    fontWeight: '500',
    color: '#1f2937'
  },
  nameSecondary: {
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  phoneText: {
    fontFamily: 'monospace',
    fontSize: '0.875rem'
  },
  emailText: {
    fontSize: '0.875rem',
    color: '#6b7280',
    wordBreak: 'break-all'
  },
  identityIdText: {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    color: '#6b7280'
  },
  rolesCell: {
    display: 'flex',
    gap: '0.25rem',
    flexWrap: 'wrap'
  },
  roleBadge: {
    padding: '0.125rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    color: 'white',
    fontWeight: '500',
    whiteSpace: 'nowrap'
  },
  identityBadge: {
    padding: '0.125rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    color: 'white',
    fontWeight: '500'
  },
  noRoles: {
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  statusCell: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%'
  },
  statusText: {
    fontSize: '0.875rem'
  },
  dateText: {
    fontSize: '0.75rem',
    color: '#6b7280',
    whiteSpace: 'nowrap'
  },
  sortIcon: {
    marginLeft: '0.25rem',
    fontSize: '0.75rem',
    color: '#9ca3af'
  },
  sortIconActive: {
    marginLeft: '0.25rem',
    fontSize: '0.75rem',
    color: '#3b82f6'
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    gap: '1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: {
    color: '#6b7280',
    fontSize: '0.875rem'
  },
  errorState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem',
    gap: '1rem'
  },
  errorText: {
    color: '#ef4444',
    fontSize: '0.875rem'
  },
  retryButton: {
    padding: '0.5rem 1.5rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer'
  },
  emptyState: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem 2rem'
  },
  emptyText: {
    color: '#6b7280',
    fontSize: '0.875rem',
    textAlign: 'center'
  }
};

// 添加动画和表格悬停效果
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  tbody tr:hover {
    background-color: #f9fafb;
  }
  
  th:hover {
    background-color: #f3f4f6;
  }
  
  /* 滚动条样式 */
  *::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }
  
  *::-webkit-scrollbar-track {
    background: #f3f4f6;
    border-radius: 4px;
  }
  
  *::-webkit-scrollbar-thumb {
    background: #d1d5db;
    border-radius: 4px;
  }
  
  *::-webkit-scrollbar-thumb:hover {
    background: #9ca3af;
  }
`;
document.head.appendChild(styleSheet);

export default UserList;