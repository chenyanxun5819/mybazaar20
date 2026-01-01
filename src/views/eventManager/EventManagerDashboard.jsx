import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import AddUser from '../../components/common/AddUser'; // 🆕 通用组件
import BatchImportUser from '../../components/common/BatchImportUser'; // 🆕 批量导入
import UserList from '../../components/common/UserList';
import PointsManagement from '../../components/common/PointsManagement'; // 🔄 重命名：UserManagement → PointsManagement
import DepartmentManagement from '../../components/common/DepartmentManagement'; // 部门管理
import RoleSwitcher from '../../components/common/RoleSwitcher'; // 🆕 角色切换器
import { safeFetch } from '../../services/safeFetch'; // 🆕 用于调用 Cloud Functions

// 🆕 角色配置
const ROLE_CONFIG = {
  sellerManager: { label: 'SM', fullLabel: 'Seller Manager', color: '#f59e0b', icon: '🛍️', category: 'manager' },
  merchantManager: { label: 'MM', fullLabel: 'Merchant Manager', color: '#8b5cf6', icon: '🏪', category: 'manager' },
  customerManager: { label: 'CM', fullLabel: 'Customer Manager', color: '#10b981', icon: '🎫', category: 'manager' },
  financeManager: { label: 'FM', fullLabel: 'Finance Manager', color: '#3b82f6', icon: '💵', category: 'manager' },
  seller: { label: 'S', fullLabel: 'Seller', color: '#ec4899', icon: '🛒', category: 'user' },
  merchant: { label: 'M', fullLabel: 'Merchant', color: '#06b6d4', icon: '🏬', category: 'user' },
  customer: { label: 'C', fullLabel: 'Customer', color: '#84cc16', icon: '👤', category: 'user' }
};

const EventManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [eventData, setEventData] = useState(null);
  const [orgData, setOrgData] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  // 新增：为 UserList 传参准备独立的组织/活动 ID state
  const [organizationId, setOrganizationId] = useState('');
  const [eventId, setEventId] = useState('');
  const [showAddUser, setShowAddUser] = useState(false); // 🆕
  const [showBatchImport, setShowBatchImport] = useState(false); // 🆕 批量导入
  const [statistics, setStatistics] = useState({
    totalUsers: 0,
    totalEventManagers: 0,
    totalSellerManagers: 0,
    totalMerchantManagers: 0,
    totalCustomerManagers: 0,
    totalFinanceManagers: 0,
    totalSellers: 0,
    totalMerchants: 0,
    totalCustomers: 0,
    totalAllocatedPoints: 0  // 🆕 新增
  });
  const [showUserList, setShowUserList] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false); // 🆕 点数管理
  const [showDepartmentManagement, setShowDepartmentManagement] = useState(false); // 部门管理
  const [users, setUsers] = useState([]); // 用户列表（表格显示）
  const [showUserTable, setShowUserTable] = useState(true); // 默认显示用户表格
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' }); // 排序配置
  const [currentPage, setCurrentPage] = useState(1); // 当前页码
  const [pageSize, setPageSize] = useState(50); // 每页显示条数
  const [roleFilter, setRoleFilter] = useState('all'); // 角色过滤
  const [showColumnSelector, setShowColumnSelector] = useState(false); // 列显示选择器
  const [searchTerm, setSearchTerm] = useState(''); // 🆕 搜索词
  const [showEditModal, setShowEditModal] = useState(false); // 🆕 编辑模态框
  const [editingUser, setEditingUser] = useState(null); // 🆕 正在编辑的用户
  
  // 🔄 扩展 editForm，添加角色和部门字段
  const [editForm, setEditForm] = useState({ 
    chineseName: '',
    englishName: '',
    phoneNumber: '',
    identityId: '',
    department: '' // 🆕 部门
  });
  
  // 🆕 角色选择状态
  const [selectedRoles, setSelectedRoles] = useState({
    sellerManager: false,
    merchantManager: false,
    customerManager: false,
    financeManager: false,
    seller: false,
    merchant: false,
    customer: false
  });
  
  // 🆕 Seller Manager 管理部门
  const [managedDepartments, setManagedDepartments] = useState([]);
  
  // 🆕 部门列表
  const [departments, setDepartments] = useState([]);
  
  const [isSaving, setIsSaving] = useState(false); // 🆕 保存中状态
  const [visibleColumns, setVisibleColumns] = useState({
    序号: true,
    姓名: true,
    电话: true,
    身份标签: true,
    部门: true,
    身份ID: true,
    角色: true,
    现有点数: true,
    已销售点数: true
  });

  // 🆕 电话号码遮罩函数
  const maskPhone = (phone) => {
    if (!phone) return '-';
    if (phone.length < 6) return phone; // 号码太短，直接显示
    
    const first3 = phone.substring(0, 3);
    const last3 = phone.substring(phone.length - 3);
    const middle = '*'.repeat(phone.length - 6);
    
    return `${first3}${middle}${last3}`;
  };

  // 🔄 修改：打开编辑模态框，初始化角色和部门
  const openEditModal = (user) => {
    setEditingUser(user);
    setEditForm({
      chineseName: user.basicInfo?.chineseName || '',
      englishName: user.basicInfo?.englishName || '',
      phoneNumber: user.basicInfo?.phoneNumber || '',
      identityId: user.identityInfo?.identityId || '',
      department: user.identityInfo?.department || '' // 🆕 初始化部门
    });
    
    // 🆕 初始化角色选择
    setSelectedRoles({
      sellerManager: user.roles?.includes('sellerManager') || false,
      merchantManager: user.roles?.includes('merchantManager') || false,
      customerManager: user.roles?.includes('customerManager') || false,
      financeManager: user.roles?.includes('financeManager') || false,
      seller: user.roles?.includes('seller') || false,
      merchant: user.roles?.includes('merchant') || false,
      customer: user.roles?.includes('customer') || false
    });
    
    // 🆕 初始化管理部门
    setManagedDepartments(user.sellerManager?.managedDepartments || []);
    
    setShowEditModal(true);
  };

  // 🔄 修改：保存用户编辑（包含角色和部门）
  const handleSaveEdit = async () => {
    if (!editingUser) return;

    // 验证必填字段
    if (!editForm.chineseName.trim()) {
      alert('请输入中文姓名');
      return;
    }
    if (!editForm.englishName.trim()) {
      alert('请输入英文姓名');
      return;
    }
    if (!editForm.phoneNumber.trim()) {
      alert('请输入电话号码');
      return;
    }
    if (!editForm.identityId.trim()) {
      alert('请输入身份ID');
      return;
    }

    // 验证电话号码格式（马来西亚手机号）
    const phoneRegex = /^(01)[0-9]{8,9}$/;
    if (!phoneRegex.test(editForm.phoneNumber)) {
      alert('电话号码格式不正确\n马来西亚手机号应为: 01X-XXXXXXXX (10-11位数字)');
      return;
    }

    // 🆕 验证角色组合
    const hasEventManager = editingUser.roles?.includes('eventManager') || false;
    const hasOtherManagerRoles = selectedRoles.sellerManager ||
      selectedRoles.merchantManager ||
      selectedRoles.customerManager ||
      selectedRoles.financeManager;

    // 检查是否是当前用户在修改自己的角色
    const currentUserPhone = auth.currentUser?.phoneNumber?.replace(/^\+60/, '0') || '';
    const targetUserPhone = editForm.phoneNumber || '';
    const isModifyingSelf = currentUserPhone === targetUserPhone;

    // 🚫 禁止 Event Manager 修改自己的角色
    if (isModifyingSelf && hasEventManager) {
      alert('Event Manager 不能修改自己的角色');
      return;
    }

    // 🚫 Event Manager 不能同时拥有其他 manager 角色
    if (hasEventManager && hasOtherManagerRoles) {
      alert('Event Manager 不能同时拥有其他 manager 角色\n\n允许的角色组合：\n✅ Event Manager + Seller + Customer\n❌ Event Manager + Seller Manager\n❌ Event Manager + Finance Manager');
      return;
    }

    // 🆕 如果勾选了 sellerManager 但没有选择管理部门，提示用户
    if (selectedRoles.sellerManager && managedDepartments.length === 0) {
      if (!confirm('您勾选了 Seller Manager 角色但未选择管理部门。\n是否继续？（该用户将无法管理任何部门）')) {
        return;
      }
    }

    try {
      setIsSaving(true);

      // Step 1: 更新基本信息和部门
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', editingUser.id
      );

      await updateDoc(userRef, {
        'basicInfo.chineseName': editForm.chineseName.trim(),
        'basicInfo.englishName': editForm.englishName.trim(),
        'basicInfo.phoneNumber': editForm.phoneNumber.trim(),
        'identityInfo.identityId': editForm.identityId.trim(),
        'identityInfo.department': editForm.department || '', // 🆕 更新部门
        'accountStatus.lastModifiedAt': new Date()
      });

      // Step 2: 更新角色（调用 Cloud Function）
      const idToken = await auth.currentUser.getIdToken();
      
      const response = await safeFetch('/api/updateUserRoles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          userId: editingUser.id,
          roles: selectedRoles,
          managedDepartments: selectedRoles.sellerManager ? managedDepartments : [],
          previousRoles: editingUser.roles || [],
          idToken
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '角色更新失败');
      }

      alert('✅ 用户信息和角色更新成功!');
      setShowEditModal(false);
      setEditingUser(null);
      
      // 重新加载用户列表
      await loadDashboardData();
    } catch (error) {
      console.error('❌ 更新用户失败:', error);
      alert('更新失败: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 从 localStorage 获取用户信息（兼容两种 key）
      const storedInfo = localStorage.getItem('eventManagerInfo') || localStorage.getItem('eventManagerLogin');
      if (!storedInfo) {
        alert('请先登录');
        if (orgEventCode) {
          navigate(`/login/${orgEventCode}`);
        }
        return;
      }

      const info = JSON.parse(storedInfo);
      setUserInfo(info);
      // 同步设置 organizationId 和 eventId，以供 UserList 等组件使用
      if (info?.organizationId) setOrganizationId(info.organizationId);
      if (info?.eventId) setEventId(info.eventId);

      // 加载组织信息
      const orgDoc = await getDoc(doc(db, 'organizations', info.organizationId));
      if (orgDoc.exists()) {
        const orgInfo = orgDoc.data();
        setOrgData(orgInfo);
        
        // 🆕 提取部门列表
        if (orgInfo.departments) {
          const activeDepts = orgInfo.departments
            .filter(d => d.isActive !== false)
            .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
          setDepartments(activeDepts.map(d => d.name));
        }
      }

      // 加载活动信息（使用子集合）
      const eventDoc = await getDoc(
        doc(db, 'organizations', info.organizationId, 'events', info.eventId)
      );

      if (eventDoc.exists()) {
        const eventInfo = eventDoc.data();
        setEventData(eventInfo);

        // 加载用户统计（使用子集合）
        const usersSnapshot = await getDocs(
          collection(db, 'organizations', info.organizationId, 'events', info.eventId, 'users')
        );

        let stats = {
          totalUsers: usersSnapshot.size,
          totalEventManagers: 0,
          totalSellerManagers: 0,
          totalMerchantManagers: 0,
          totalCustomerManagers: 0,
          totalFinanceManagers: 0,
          totalSellers: 0,
          totalMerchants: 0,
          totalCustomers: 0,
          totalAllocatedPoints: 0  // 🆕 新增：已分配的总点数
        };

        // 加载用户列表数据（用于表格显示）
        const userList = [];
        let totalAllocated = 0;  // 🆕 累计已分配点数

        usersSnapshot.forEach(doc => {
          const userData = doc.data();
          userList.push({
            id: doc.id,
            ...userData
          });

          // ✅ 新架构：Event Manager 在 users 集合中，通过 roles 识别
          if (userData.roles?.includes('eventManager')) stats.totalEventManagers++;
          if (userData.roles?.includes('financeManager')) stats.totalFinanceManagers++;
          if (userData.roles?.includes('sellerManager')) stats.totalSellerManagers++;
          if (userData.roles?.includes('merchantManager')) stats.totalMerchantManagers++;
          if (userData.roles?.includes('customerManager')) stats.totalCustomerManagers++;
          if (userData.roles?.includes('seller')) stats.totalSellers++;
          if (userData.roles?.includes('merchant')) stats.totalMerchants++;
          if (userData.roles?.includes('customer')) stats.totalCustomers++;
          
          // 🆕 累加所有用户的可用点数（已分配但未使用）
          if (userData.seller?.availablePoints) totalAllocated += userData.seller.availablePoints;
          if (userData.merchant?.availablePoints) totalAllocated += userData.merchant.availablePoints;
          if (userData.customer?.availablePoints) totalAllocated += userData.customer.availablePoints;
          
          // 🆕 累加所有用户的已销售点数（已分配且已使用）
          if (userData.seller?.totalPointsSold) totalAllocated += userData.seller.totalPointsSold;
          if (userData.merchant?.totalPointsSold) totalAllocated += userData.merchant.totalPointsSold;
        });

        // ✅ 新架构：eventManager 是单个对象，不是数组
        // Event Manager 数量固定为 1（如果存在）或 0（如果不存在）
        stats.totalAllocatedPoints = totalAllocated;  // 🆕 设置已分配总点数

        setStatistics(stats);
        setUsers(userList); // 保存用户列表
      }
    } catch (error) {
      console.error('[EventManagerDashboard] 加载失败:', error);
      alert(`加载失败: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('eventManagerInfo');
      localStorage.removeItem('eventManagerLogin'); // 清除兼容 key
      navigate(`/login/${orgEventCode}`);
    } catch (error) {
      console.error('登出失败:', error);
      alert('登出失败');
    }
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (e) => {
    setPageSize(Number(e.target.value));
    setCurrentPage(1); // 重置到第一页
  };

  const toggleColumnVisibility = (column) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column]
    }));
  };

  // 🆕 过滤和排序用户数据
  const getFilteredAndSortedUsers = () => {
    let filtered = [...users];

    // 角色过滤
    if (roleFilter !== 'all') {
      filtered = filtered.filter(user => user.roles?.includes(roleFilter));
    }

    // 搜索过滤
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.basicInfo?.chineseName?.toLowerCase().includes(search) ||
        user.basicInfo?.englishName?.toLowerCase().includes(search) ||
        user.basicInfo?.phoneNumber?.includes(search) ||
        user.identityInfo?.identityId?.toLowerCase().includes(search) ||
        user.identityInfo?.department?.toLowerCase().includes(search)
      );
    }

    // 排序
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue, bValue;

        switch (sortConfig.key) {
          case 'chineseName':
            aValue = a.basicInfo?.chineseName || '';
            bValue = b.basicInfo?.chineseName || '';
            break;
          case 'phoneNumber':
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
          case 'availablePoints':
            aValue = a.seller?.availablePoints || 0;
            bValue = b.seller?.availablePoints || 0;
            break;
          case 'totalPointsSold':
            aValue = a.seller?.totalPointsSold || 0;
            bValue = b.seller?.totalPointsSold || 0;
            break;
          case 'createdAt':
            aValue = a.accountStatus?.createdAt?.toDate?.() || new Date(0);
            bValue = b.accountStatus?.createdAt?.toDate?.() || new Date(0);
            break;
          default:
            aValue = '';
            bValue = '';
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  };

  // 🆕 获取分页后的数据
  const getPaginatedUsers = () => {
    const filtered = getFilteredAndSortedUsers();
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return filtered.slice(startIndex, endIndex);
  };

  const totalPages = Math.ceil(getFilteredAndSortedUsers().length / pageSize);

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinner}></div>
        <p>加载中...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Event Manager Dashboard</h1>
          <p style={styles.subtitle}>
            {orgData?.basicInfo?.organizationName} - {eventData?.basicInfo?.eventName}
          </p>
          <p style={styles.userGreeting}>
            欢迎, {userInfo?.chineseName || userInfo?.englishName}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <RoleSwitcher currentRole="eventManager" orgEventCode={orgEventCode} />
          <button onClick={handleLogout} style={styles.logoutButton}>
            登出
          </button>
        </div>
      </div>

      {/* Statistics */}
      <div style={styles.statsGrid}>
        <StatCard
          title="总用户数"
          value={statistics.totalUsers}
          icon="👥"
          color="#667eea"
        />
        <StatCard
          title="Seller Managers"
          value={statistics.totalSellerManagers}
          icon="🛍️"
          color="#f59e0b"
        />
        <StatCard
          title="Finance Managers"
          value={statistics.totalFinanceManagers}
          icon="💵"
          color="#3b82f6"
        />
        <StatCard
          title="Sellers"
          value={statistics.totalSellers}
          icon="🛒"
          color="#ec4899"
        />
        <StatCard
          title="Merchants"
          value={statistics.totalMerchants}
          icon="🏬"
          color="#06b6d4"
        />
        <StatCard
          title="Customers"
          value={statistics.totalCustomers}
          icon="👤"
          color="#84cc16"
        />
        <StatCard
          title="已分配点数"
          value={statistics.totalAllocatedPoints.toLocaleString()}
          icon="💎"
          color="#10b981"
        />
      </div>

      {/* Action Buttons */}
      <div style={styles.actionButtons}>
        <button
          style={styles.primaryButton}
          onClick={() => setShowAddUser(true)}
        >
          ➕ 单个创建用户
        </button>
        <button
          style={{ ...styles.secondaryButton, backgroundColor: '#f59e0b', color: 'white', borderColor: '#f59e0b' }}
          onClick={() => setShowDepartmentManagement(true)}
        >
          🏢 部门管理
        </button>
        <button
          style={{ ...styles.secondaryButton, backgroundColor: '#10b981', color: 'white', borderColor: '#10b981' }}
          onClick={() => setShowUserManagement(true)}
        >
          📊 点数管理
        </button>
      </div>

      {/* 过滤和列显示控制栏 */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        padding: '1.5rem',
        marginBottom: '1.5rem'
      }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 角色过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              角色过滤:
            </label>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem',
                cursor: 'pointer'
              }}
            >
              <option value="all">全部角色</option>
              <option value="eventManager">Event Manager</option>
              <option value="sellerManager">Seller Manager</option>
              <option value="merchantManager">Merchant Manager</option>
              <option value="customerManager">Customer Manager</option>
              <option value="financeManager">Finance Manager</option>
              <option value="seller">Seller</option>
              <option value="merchant">Merchant</option>
              <option value="customer">Customer</option>
            </select>
          </div>

          {/* 搜索框 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              搜索:
            </label>
            <input
              type="text"
              placeholder="搜索姓名、电话、身份ID、部门..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              style={{
                flex: 1,
                padding: '0.5rem',
                border: '2px solid #e5e7eb',
                borderRadius: '6px',
                fontSize: '0.875rem'
              }}
            />
          </div>

          {/* 列显示选择器 */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowColumnSelector(!showColumnSelector)}
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: '600'
              }}
            >
              📋 列显示
            </button>
            {showColumnSelector && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '0.5rem',
                backgroundColor: 'white',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                padding: '1rem',
                minWidth: '200px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 10
              }}>
                {Object.keys(visibleColumns).map(column => (
                  <label key={column} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem'
                  }}>
                    <input
                      type="checkbox"
                      checked={visibleColumns[column]}
                      onChange={() => toggleColumnVisibility(column)}
                    />
                    {column}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 批量导入按钮 */}
          <button
            onClick={() => setShowBatchImport(true)}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#8b5cf6',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: '600'
            }}
          >
            📥 批量导入
          </button>
        </div>
      </div>

      {/* User Table */}
      {showUserTable && (
        <div style={styles.tableContainer}>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeaderRow}>
                  {visibleColumns.序号 && (
                    <th style={styles.tableHeaderCell}>序号</th>
                  )}
                  {visibleColumns.姓名 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('chineseName')}
                    >
                      姓名 {sortConfig.key === 'chineseName' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.电话 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('phoneNumber')}
                    >
                      电话 {sortConfig.key === 'phoneNumber' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.身份标签 && (
                    <th style={styles.tableHeaderCell}>身份标签</th>
                  )}
                  {visibleColumns.部门 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('department')}
                    >
                      部门 {sortConfig.key === 'department' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.身份ID && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('identityId')}
                    >
                      身份ID {sortConfig.key === 'identityId' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.角色 && (
                    <th style={styles.tableHeaderCell}>角色</th>
                  )}
                  {visibleColumns.现有点数 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('availablePoints')}
                    >
                      现有点数 {sortConfig.key === 'availablePoints' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  {visibleColumns.已销售点数 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('totalPointsSold')}
                    >
                      已销售点数 {sortConfig.key === 'totalPointsSold' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                    </th>
                  )}
                  <th style={styles.tableHeaderCell}>操作</th>
                </tr>
              </thead>
              <tbody>
                {getPaginatedUsers().map((user, index) => (
                  <tr
                    key={user.id}
                    style={styles.tableRow}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f9fafb'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    {visibleColumns.序号 && (
                      <td style={styles.tableCell}>{(currentPage - 1) * pageSize + index + 1}</td>
                    )}
                    {visibleColumns.姓名 && (
                      <td style={styles.tableCell}>
                        <div style={styles.nameCell}>
                          <div style={styles.chineseName}>{user.basicInfo?.chineseName}</div>
                          <div style={styles.englishName}>{user.basicInfo?.englishName}</div>
                        </div>
                      </td>
                    )}
                    {visibleColumns.电话 && (
                      <td style={styles.tableCell}>{maskPhone(user.basicInfo?.phoneNumber)}</td>
                    )}
                    {visibleColumns.身份标签 && (
                      <td style={styles.tableCell}>{user.identityInfo?.identityTag || '-'}</td>
                    )}
                    {visibleColumns.部门 && (
                      <td style={styles.tableCell}>{user.identityInfo?.department || '-'}</td>
                    )}
                    {visibleColumns.身份ID && (
                      <td style={styles.tableCell}>{user.identityInfo?.identityId || '-'}</td>
                    )}
                    {visibleColumns.角色 && (
                      <td style={styles.tableCell}>
                        <div style={styles.rolesCell}>
                          {user.roles?.map(role => {
                            const config = ROLE_CONFIG[role];
                            if (!config) return null;
                            return (
                              <div
                                key={role}
                                style={{
                                  ...styles.roleBadge,
                                  backgroundColor: config.color
                                }}
                                title={config.fullLabel}
                              >
                                {config.icon}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    )}
                    {visibleColumns.现有点数 && (
                      <td style={styles.tableCell}>
                        <span style={styles.pointsValue}>
                          {user.seller?.availablePoints || 0}
                        </span>
                      </td>
                    )}
                    {visibleColumns.已销售点数 && (
                      <td style={styles.tableCell}>
                        {user.seller?.totalPointsSold || 0}
                      </td>
                    )}
                    <td style={styles.tableCell}>
                      <button
                        onClick={() => openEditModal(user)}
                        style={styles.actionButton}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#667eea';
                          e.currentTarget.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'white';
                          e.currentTarget.style.color = '#374151';
                        }}
                      >
                        ✏️ 编辑
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={styles.pagination}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <label style={{ fontSize: '0.875rem', color: '#6b7280' }}>每页显示:</label>
              <select
                value={pageSize}
                onChange={handlePageSizeChange}
                style={{
                  padding: '0.25rem 0.5rem',
                  border: '1px solid #e5e7eb',
                  borderRadius: '4px',
                  fontSize: '0.875rem'
                }}
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                显示 {(currentPage - 1) * pageSize + 1} - {Math.min(currentPage * pageSize, getFilteredAndSortedUsers().length)} / 共 {getFilteredAndSortedUsers().length} 条
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                style={{
                  ...styles.paginationButton,
                  opacity: currentPage === 1 ? 0.5 : 1,
                  cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                }}
              >
                上一页
              </button>
              <span style={{ padding: '0.5rem 1rem', fontSize: '0.875rem', color: '#374151' }}>
                第 {currentPage} / {totalPages} 页
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                style={{
                  ...styles.paginationButton,
                  opacity: currentPage === totalPages ? 0.5 : 1,
                  cursor: currentPage === totalPages ? 'not-allowed' : 'pointer'
                }}
              >
                下一页
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🆕 AddUser 组件 */}
      {showAddUser && (
        <AddUser
          organizationId={organizationId}
          eventId={eventId}
          callerRole="eventManager"
          onClose={() => setShowAddUser(false)}
          onSuccess={loadDashboardData}
        />
      )}

      {/* 🆕 BatchImportUser 组件 */}
      {showBatchImport && (
        <BatchImportUser
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => setShowBatchImport(false)}
          onImportComplete={loadDashboardData}
        />
      )}

      {/* 🔄 重命名：UserManagement → PointsManagement */}
      {showUserManagement && (
        <PointsManagement
          organizationId={organizationId}
          eventId={eventId}
          onClose={() => setShowUserManagement(false)}
          onUpdate={loadDashboardData}
        />
      )}

      {/* 部门管理组件 */}
      {showDepartmentManagement && (
        <DepartmentManagement
          organizationId={organizationId}
          onClose={() => setShowDepartmentManagement(false)}
          onUpdate={loadDashboardData}
        />
      )}

      {/* 🔄 修改：扩展编辑模态框 - 添加角色和部门选择 */}
      {showEditModal && editingUser && (
        <div style={styles.modalOverlay} onClick={() => setShowEditModal(false)}>
          <div style={styles.editModalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>编辑用户信息</h3>
              <button
                onClick={() => setShowEditModal(false)}
                style={styles.closeButton}
              >
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* 基本信息 */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  中文姓名 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editForm.chineseName}
                  onChange={(e) => setEditForm({ ...editForm, chineseName: e.target.value })}
                  style={styles.formInput}
                  placeholder="请输入中文姓名"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  英文姓名 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editForm.englishName}
                  onChange={(e) => setEditForm({ ...editForm, englishName: e.target.value })}
                  style={styles.formInput}
                  placeholder="请输入英文姓名"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  电话号码 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="tel"
                  value={editForm.phoneNumber}
                  onChange={(e) => setEditForm({ ...editForm, phoneNumber: e.target.value })}
                  style={styles.formInput}
                  placeholder="例如: 0123456789"
                />
                <div style={styles.formHint}>
                  马来西亚手机号格式: 01X-XXXXXXXX (10-11位数字)
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  身份ID (学号/工号) <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editForm.identityId}
                  onChange={(e) => setEditForm({ ...editForm, identityId: e.target.value })}
                  style={styles.formInput}
                  placeholder="请输入学号或工号"
                />
              </div>

              {/* 🆕 部门选择 */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  部门
                </label>
                <select
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                  style={styles.formInput}
                >
                  <option value="">请选择部门</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {/* 🆕 角色分配 */}
              <div style={{ ...styles.formGroup, marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '2px solid #e5e7eb' }}>
                <label style={styles.formLabel}>
                  角色分配
                </label>
                <div style={styles.rolesGrid}>
                  {Object.entries(ROLE_CONFIG).map(([roleId, config]) => (
                    <div
                      key={roleId}
                      style={{
                        ...styles.roleCheckbox,
                        borderColor: selectedRoles[roleId] ? config.color : '#e5e7eb',
                        backgroundColor: selectedRoles[roleId] ? `${config.color}10` : 'white'
                      }}
                      onClick={() => setSelectedRoles({ ...selectedRoles, [roleId]: !selectedRoles[roleId] })}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles[roleId]}
                        onChange={() => {}}
                        style={styles.checkbox}
                      />
                      <div style={styles.roleInfo}>
                        <span style={styles.roleIcon}>{config.icon}</span>
                        <span style={styles.roleLabel}>{config.fullLabel}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 🆕 Seller Manager 管理部门 */}
              {selectedRoles.sellerManager && (
                <div style={styles.managedDepartmentsSection}>
                  <div style={styles.sectionTitle}>
                    🏢 管理的部门 (Seller Manager)
                  </div>
                  <div style={styles.departmentsGrid}>
                    {departments.map(dept => (
                      <div
                        key={dept}
                        style={styles.departmentCheckbox}
                        onClick={() => {
                          setManagedDepartments(prev =>
                            prev.includes(dept)
                              ? prev.filter(d => d !== dept)
                              : [...prev, dept]
                          );
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={managedDepartments.includes(dept)}
                          onChange={() => {}}
                          style={styles.checkbox}
                        />
                        {dept}
                      </div>
                    ))}
                  </div>
                  {managedDepartments.length === 0 && (
                    <div style={{ ...styles.formHint, color: '#f59e0b', marginTop: '0.5rem' }}>
                      ⚠️ 建议至少选择一个管理部门
                    </div>
                  )}
                </div>
              )}

              <div style={styles.infoBox}>
                💡 <strong>注意</strong>: 修改用户信息和角色后将立即生效,请仔细核对。
              </div>
            </div>

            <div style={styles.modalFooter}>
              <button
                onClick={() => setShowEditModal(false)}
                style={styles.cancelButton}
                disabled={isSaving}
              >
                取消
              </button>
              <button
                onClick={handleSaveEdit}
                style={styles.saveButton}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : '💾 保存修改'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Statistics Card Component
const StatCard = ({ title, value, icon, color }) => (
  <div style={{ ...styles.statCard, borderLeftColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statLabel}>{title}</div>
    </div>
  </div>
);

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '2rem'
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    gap: '1rem'
  },
  spinner: {
    width: '3rem',
    height: '3rem',
    border: '4px solid #e5e7eb',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '2rem',
    background: 'white',
    padding: '2rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '0.5rem'
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '1.125rem'
  },
  userGreeting: {
    color: '#667eea',
    fontSize: '0.875rem',
    marginTop: '0.5rem'
  },
  logoutButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'background-color 0.2s'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statCard: {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    borderLeft: '4px solid'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statLabel: {
    color: '#6b7280',
    fontSize: '0.875rem',
    marginTop: '0.25rem'
  },
  actionButtons: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap'
  },
  primaryButton: {
    padding: '0.875rem 1.5rem',
    backgroundColor: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '1rem',
    transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(102, 126, 234, 0.4)'
  },
  secondaryButton: {
    padding: '0.875rem 1.5rem',
    backgroundColor: 'white',
    color: '#374151',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '1rem',
    transition: 'all 0.2s'
  },
  tableContainer: {
    background: 'white',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    overflow: 'hidden'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  tableHeaderRow: {
    backgroundColor: '#f9fafb',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky',
    top: 0,
    zIndex: 10
  },
  tableHeaderCell: {
    padding: '1rem 0.75rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    whiteSpace: 'nowrap'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.2s'
  },
  tableCell: {
    padding: '1rem 0.75rem',
    color: '#374151',
    verticalAlign: 'middle'
  },
  nameCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  chineseName: {
    fontWeight: '600',
    color: '#1f2937'
  },
  englishName: {
    fontSize: '0.75rem',
    color: '#6b7280',
    textTransform: 'uppercase'
  },
  rolesCell: {
    display: 'flex',
    gap: '0.35rem',
    flexWrap: 'wrap'
  },
  roleBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: '6px',
    fontSize: '1rem',
    color: 'white',
    fontWeight: '600'
  },
  pointsValue: {
    fontWeight: '600',
    color: '#10b981'
  },
  actionButton: {
    padding: '0.5rem 0.75rem',
    fontSize: '1rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.5rem',
    borderTop: '1px solid #e5e7eb',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  paginationButton: {
    padding: '0.5rem 1rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600',
    transition: 'all 0.2s'
  },
  modalOverlay: {
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
  editModalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky',
    top: 0,
    backgroundColor: 'white',
    zIndex: 10
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  closeButton: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    fontSize: '1.25rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s'
  },
  modalBody: {
    padding: '1.5rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  formLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  formInput: {
    padding: '0.75rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  formHint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  rolesGrid: {
    display: 'grid',
    gap: '0.75rem'
  },
  roleCheckbox: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  checkbox: {
    width: '18px',
    height: '18px',
    marginRight: '0.75rem',
    cursor: 'pointer'
  },
  roleInfo: {
    display: 'flex',
    alignItems: 'center',
    flex: 1
  },
  roleIcon: {
    fontSize: '1.25rem',
    marginRight: '0.5rem'
  },
  roleLabel: {
    fontWeight: '500',
    color: '#374151'
  },
  managedDepartmentsSection: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '8px'
  },
  sectionTitle: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.75rem'
  },
  departmentsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '0.5rem'
  },
  departmentCheckbox: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.5rem',
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    transition: 'all 0.2s'
  },
  infoBox: {
    padding: '0.75rem 1rem',
    backgroundColor: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: '8px',
    fontSize: '0.875rem',
    color: '#166534',
    fontWeight: '500'
  },
  modalFooter: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem',
    borderTop: '1px solid #e5e7eb',
    position: 'sticky',
    bottom: 0,
    backgroundColor: 'white'
  },
  cancelButton: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280',
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  saveButton: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: 'white',
    backgroundColor: '#8b5cf6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  }
};

export default EventManagerDashboard;