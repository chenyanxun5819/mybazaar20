import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../../config/firebase';
import { doc, getDoc, collection, getDocs, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { useAuth } from '../../contexts/AuthContext'; // 🆕 導入 AuthContext
import { useEvent } from '../../contexts/EventContext'; // 🆕 導入 EventContext
import AddUser from '../../components/common/AddUser'; // 🆕 通用组件
import BatchImportUser from '../../components/common/BatchImportUser'; // 🆕 批量导入
import UserList from '../../components/common/UserList';
import PointsManagement from '../../components/common/PointsManagement'; // 🔄 重命名：UserManagement → PointsManagement
import DepartmentManagement from '../../components/common/DepartmentManagement'; // 部门管理
import RoleSwitcher from '../../components/common/RoleSwitcher'; // 🆕 角色切换器
import DashboardHeader from '../../components/common/DashboardHeader'; // 🆕 导入共用 header
import DashboardFooter from '../../components/common/DashboardFooter'; // 🆕 导入共用 footer
import { safeFetch } from '../../services/safeFetch'; // 🆕 用于调用 Cloud Functions
import UsersIcon from '../../assets/users.svg?react';
import ChalkboardUserIcon from '../../assets/chalkboard-user.svg?react';
import SellerFiveIcon from '../../assets/seller (5).svg?react';
import UsersGearIcon from '../../assets/users-gear.svg?react';
import UserSalaryIcon from '../../assets/user-salary.svg?react';
import EmployeeManIcon from '../../assets/employee-man.svg?react';
import StoreBuyerIcon from '../../assets/store-buyer.svg?react';
import SellerFourIcon from '../../assets/seller (4).svg?react';
import MoneyCheckEditIcon from '../../assets/money-check-edit (1).svg?react';
import UserBagIcon from '../../assets/user-bag.svg?react';
import leaveIcon from '../../assets/leave.svg';
import PosBillIcon from '../../assets/point-of-sale-bill.svg?react';
import UserAddIcon from '../../assets/user-add (1).svg?react';
import DepartmentStructureIcon from '../../assets/department-structure.svg?react';
import PointOfSaleMobileIcon from '../../assets/point-of-sale-mobile.svg?react';
import FreeIcon from '../../assets/free.svg?react';
import ObjectsColumnIcon from '../../assets/objects-column.svg?react';
import UsersMedicalIcon from '../../assets/users-medical (3).svg?react';

// 🆕 角色配置
const ROLE_CONFIG = {
  sellerManager: { label: 'SM', fullLabel: 'Seller Manager', chineseLabel: '班导师', color: '#f59e0b', icon: ChalkboardUserIcon, category: 'manager' },
  merchantManager: { label: 'MM', fullLabel: 'Merchant Manager', chineseLabel: '商家管理员', color: '#8b5cf6', icon: SellerFiveIcon, category: 'manager' },
  customerManager: { label: 'CM', fullLabel: 'Customer Manager', chineseLabel: '消费者管理员', color: '#10b981', icon: UsersGearIcon, category: 'manager' },
  cashier: { label: 'C', fullLabel: 'Cashier', chineseLabel: '收银员', color: '#3b82f6', icon: UserSalaryIcon, category: 'manager' },
  seller: { label: 'S', fullLabel: 'Seller', chineseLabel: '点数销售员', color: '#ec4899', icon: EmployeeManIcon, category: 'user' },
  merchantOwner: { label: 'MO', fullLabel: 'Merchant Owner', chineseLabel: '摊主', color: '#84cc16', icon: StoreBuyerIcon, category: 'user' },
  merchantAsist: { label: 'MA', fullLabel: 'Merchant Assistant', chineseLabel: '摊位助手', color: '#a3e635', icon: SellerFourIcon, category: 'user' },
  pointSeller: { label: 'PS', fullLabel: 'Point Seller', chineseLabel: '点数直售员', color: '#f97316', icon: MoneyCheckEditIcon, category: 'user' }
};

const STAT_ICONS = {
  totalUsers: UsersIcon,
  totalSellerManagers: ChalkboardUserIcon,
  totalCashiers: UserSalaryIcon,
  totalSellers: EmployeeManIcon,
  totalMerchants: StoreBuyerIcon,
  totalCustomers: UserBagIcon,
  totalAllocatedPoints: PosBillIcon
};

const renderIcon = (icon, { alt, size = 20, color, style } = {}) => {
  if (!icon) return null;

  if (typeof icon === 'string') {
    return (
      <img
        src={icon}
        alt={alt || ''}
        style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, ...style }}
      />
    );
  }

  if (typeof icon === 'function') {
    const IconComp = icon;
    return (
      <IconComp
        aria-label={alt || ''}
        role="img"
        style={{ width: size, height: size, color, flexShrink: 0, ...style }}
      />
    );
  }

  return icon;
};

// 列表角色图标排序：customer → seller → manager → 其他
const sortRolesForDisplay = (roles, roleConfig = ROLE_CONFIG) => {
  const safeRoles = Array.isArray(roles) ? roles.filter(Boolean) : [];

  const roleKey = (role) => {
    if (role === 'customer') return 0;
    if (role === 'seller') return 1;
    const cfg = roleConfig?.[role];
    if (cfg?.category === 'manager') return 2;
    return 3;
  };

  return [...safeRoles].sort((a, b) => {
    const ka = roleKey(a);
    const kb = roleKey(b);
    if (ka !== kb) return ka - kb;
    return String(a).localeCompare(String(b));
  });
};

const EventManagerDashboard = () => {
  const { orgEventCode } = useParams();
  const navigate = useNavigate();
  const { userProfile, loading: authLoading, isAuthenticated } = useAuth(); // 🆕 使用 AuthContext
  const { eventCode } = useEvent(); // 🆕 从 EventContext 获取 eventCode
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
    totalCashiers: 0,
    totalSellers: 0,
    totalMerchants: 0,
    totalCustomers: 0,
    totalAllocatedPoints: 0  // 🆕 新增
  });
  const [showUserList, setShowUserList] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false); // 🆕 点数管理
  const [showDepartmentManagement, setShowDepartmentManagement] = useState(false); // 部门管理
  const [showGrantPointsModal, setShowGrantPointsModal] = useState(false); // 🆕 赠送点数模态框
  const [grantIdentityTag, setGrantIdentityTag] = useState([]); // 🆕 赠送目标身份标签（支持复选）
  const [grantAmount, setGrantAmount] = useState(''); // 🆕 赠送点数
  const [grantNote, setGrantNote] = useState(''); // 🆕 赠送备注
  const [isGranting, setIsGranting] = useState(false); // 🆕 正在赠送
  const [identityTags, setIdentityTags] = useState([]); // 🆕 身份标签列表
  const [users, setUsers] = useState([]); // 用户列表（表格显示）
  const [showUserTable, setShowUserTable] = useState(true); // 默认显示用户表格
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' }); // 排序配置
  const [currentPage, setCurrentPage] = useState(1); // 当前页码
  const [pageSize, setPageSize] = useState(50); // 每页显示条数
  const [roleFilter, setRoleFilter] = useState('all');
  const [identityTagFilter, setIdentityTagFilter] = useState('all'); // 角色过滤
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
    cashier: false,
    seller: false,
    merchantOwner: false,
    merchantAsist: false,
    customer: false,
    pointSeller: false
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
    可消费点数: true,
    可销售点数: true,
    已销售点数: true
  });

  // 🆕 計算已被其他 Seller Manager 佔用的部門
  const takenDepartments = useMemo(() => {
    const taken = {};
    users.forEach(u => {
      // 跳過正在編輯的本人
      if (u.id === editingUser?.id) return;

      // 檢查該用戶是否為 Seller Manager 且有管理的部門
      if (u.roles?.includes('sellerManager') && u.sellerManager?.managedDepartments) {
        u.sellerManager.managedDepartments.forEach(dept => {
          taken[dept] = u.basicInfo?.chineseName || u.basicInfo?.englishName || '其他管理员';
        });
      }
    });
    return taken;
  }, [users, editingUser]);

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
      cashier: user.roles?.includes('cashier') || false,
      seller: user.roles?.includes('seller') || false,
      merchantOwner: user.roles?.includes('merchantOwner') || false,
      merchantAsist: user.roles?.includes('merchantAsist') || false,
      customer: user.roles?.includes('customer') || false,
      pointSeller: user.roles?.includes('pointSeller') || false
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
      window.mybazaarShowToast('请输入中文姓名');
      return;
    }
    if (!editForm.englishName.trim()) {
      window.mybazaarShowToast('请输入英文姓名');
      return;
    }
    if (!editForm.phoneNumber.trim()) {
      window.mybazaarShowToast('请输入电话号码');
      return;
    }
    if (!editForm.identityId.trim()) {
      window.mybazaarShowToast('请输入身份ID');
      return;
    }

    // 验证电话号码格式（马来西亚手机号）
    const phoneRegex = /^(01)[0-9]{8,9}$/;
    if (!phoneRegex.test(editForm.phoneNumber)) {
      window.mybazaarShowToast('电话号码格式不正确\n马来西亚手机号应为: 01X-XXXXXXXX (10-11位数字)');
      return;
    }

    // 🆕 验证角色组合
    const hasEventManager = editingUser.roles?.includes('eventManager') || false;
    const hasOtherManagerRoles = selectedRoles.sellerManager ||
      selectedRoles.merchantManager ||
      selectedRoles.customerManager ||
      selectedRoles.cashier;

    // 检查是否是当前用户在修改自己的角色
    const currentUserPhone = auth.currentUser?.phoneNumber?.replace(/^\+60/, '0') || '';
    const targetUserPhone = editForm.phoneNumber || '';
    const isModifyingSelf = currentUserPhone === targetUserPhone;

    // 🚫 禁止 Event Manager 修改自己的角色
    if (isModifyingSelf && hasEventManager) {
      window.mybazaarShowToast('Event Manager 不能修改自己的角色');
      return;
    }

    // 🚫 Event Manager 不能同时拥有其他 manager 角色
    if (hasEventManager && hasOtherManagerRoles) {
      window.mybazaarShowToast('Event Manager 不能同时拥有其他 manager 角色\n\n允许的角色组合：\n✅ Event Manager + Seller + Customer\n❌ Event Manager + Seller Manager\n❌ Event Manager + Cashier');
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

      window.mybazaarShowToast('✅ 用户信息和角色更新成功!');
      setShowEditModal(false);
      setEditingUser(null);

      // 重新加载用户列表
      await loadDashboardData();
    } catch (error) {
      console.error('❌ 更新用户失败:', error);
      window.mybazaarShowToast('更新失败: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  // 🆕 处理打开赠送点数Modal
  const handleOpenGrantPoints = () => {
    setGrantIdentityTag([]);
    setGrantAmount('');
    setGrantNote('');
    setShowGrantPointsModal(true);
  };

  // 🆕 处理赠送点数
  const handleGrantPoints = async () => {
    try {
      // 验证输入
      if (!grantIdentityTag || grantIdentityTag.length === 0) {
        window.mybazaarShowToast('请选择至少一个目标身份标签');
        return;
      }

      if (!grantAmount || isNaN(grantAmount) || Number(grantAmount) <= 0) {
        window.mybazaarShowToast('请输入有效的赠送点数（必须大于0）');
        return;
      }

      const pointsToGrant = Number(grantAmount);

      // 确认操作
      const selectedTagNames = grantIdentityTag
        .map(tagId => {
          const tag = identityTags.find(t => t.id === tagId);
          return tag ? (tag.name['zh-CN'] || tag.name['en-US'] || tagId) : tagId;
        })
        .join('、');

      const confirmMessage = `确认要赠送 ${pointsToGrant} 点数给所有 "${selectedTagNames}" 身份的 Customer 吗？`;
      if (!window.confirm(confirmMessage)) {
        return;
      }

      setIsGranting(true);

      // 获取 ID Token
      const idToken = await auth.currentUser.getIdToken();

      // 为每个选中的 identityTag 分别赠送
      let totalGranted = 0;
      for (const tagId of grantIdentityTag) {
        const response = await safeFetch('/api/grantPointsByEventManagerHttp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            organizationId,
            eventId,
            identityTag: tagId,
            points: pointsToGrant,
            note: grantNote || '组织赠送'
          })
        });

        if (!response.ok) {
          let errorMessage = '赠送点数失败';
          try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorData.error || errorMessage;
          } catch (parseError) {
            console.error('❌ 错误响应解析失败:', parseError);
            errorMessage = `${response.status} ${response.statusText}`;
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        totalGranted += result.grantedCount || 0;
      }

      window.mybazaarShowToast(`✅ 赠送成功！\n已赠送给 ${totalGranted} 个用户\n每人 ${pointsToGrant} 点数`);

      // 关闭Modal
      setShowGrantPointsModal(false);
      setGrantIdentityTag([]);
      setGrantAmount('');
      setGrantNote('');

      // 刷新数据
      await loadDashboardData();

    } catch (error) {
      console.error('❌ 赠送点数失败:', error);
      window.mybazaarShowToast('赠送失败: ' + error.message);
    } finally {
      setIsGranting(false);
    }
  };

  useEffect(() => {
    if (!authLoading) {
      loadDashboardData();
    }
  }, [authLoading, userProfile, orgEventCode]);

  const loadDashboardData = async () => {
    try {
      setLoading(true);

      // 設置一個超時保護，防止無限加載
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('加載超時')), 20000)
      );

      const dataPromise = (async () => {
        // 🆕 優先使用 AuthContext 的數據
        let info = userProfile;
        console.log('[EventManagerDashboard] loadDashboardData - userProfile:', info);

        // 如果 AuthContext 還在加載，先不報錯，等待 useEffect 觸發
        if (authLoading) {
          return;
        }

        // 如果 AuthContext 加載完成但沒有用戶，嘗試從 localStorage 恢復（兼容舊邏輯）
        if (!info) {
          const storedInfo = localStorage.getItem('eventManagerInfo') || localStorage.getItem('eventManagerLogin');
          if (storedInfo) {
            try {
              info = JSON.parse(storedInfo);
            } catch (e) {
              console.error('[EventManagerDashboard] localStorage 解析失敗:', e);
              info = null;
            }
          }
        }

        if (!info) {
          // 只有在確定沒有登入狀態時才報錯
          if (!authLoading) {
            console.warn('[EventManagerDashboard] 未找到用戶資訊');
            if (orgEventCode) navigate(`/login/${orgEventCode}`);
          }
          return;
        }

        setUserInfo(info);
        // 同步设置 organizationId 和 eventId，以供 UserList 等组件使用
        const currentOrgId = info.organizationId || organizationId;
        const currentEventId = info.eventId || eventId;

        if (currentOrgId) setOrganizationId(currentOrgId);
        if (currentEventId) setEventId(currentEventId);

        if (!currentOrgId || !currentEventId) {
          return;
        }

        // 加载组织信息
        const orgDoc = await getDoc(doc(db, 'organizations', currentOrgId));
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

          // 🆕 提取身份标签列表（用于赠送点数）
          if (orgInfo.identityTags) {
            const activeTags = orgInfo.identityTags
              .filter(tag => tag.isActive)
              .sort((a, b) => a.displayOrder - b.displayOrder);
            setIdentityTags(activeTags);
            console.log('[EventManagerDashboard] 加载身份标签:', activeTags);
          }
        }

        // 加载活动信息（使用子集合）
        const eventDoc = await getDoc(
          doc(db, 'organizations', currentOrgId, 'events', currentEventId)
        );

        if (eventDoc.exists()) {
          const eventInfo = eventDoc.data();
          setEventData(eventInfo);

          // 加载用户统计（使用子集合）
          const usersSnapshot = await getDocs(
            collection(db, 'organizations', currentOrgId, 'events', currentEventId, 'users')
          );

          let stats = {
            totalUsers: usersSnapshot.size,
            totalEventManagers: 0,
            totalSellerManagers: 0,
            totalMerchantManagers: 0,
            totalCustomerManagers: 0,
            totalCashiers: 0,
            totalSellers: 0,
            totalMerchants: 0,
            totalCustomers: 0,
            totalAllocatedPoints: 0
          };

          const userList = [];
          let totalAllocated = 0;

          usersSnapshot.forEach(doc => {
            const userData = doc.data();
            userList.push({ id: doc.id, ...userData });

            if (userData.roles?.includes('eventManager')) stats.totalEventManagers++;
            if (userData.roles?.includes('cashier')) stats.totalCashiers++;
            if (userData.roles?.includes('sellerManager')) stats.totalSellerManagers++;
            if (userData.roles?.includes('merchantManager')) stats.totalMerchantManagers++;
            if (userData.roles?.includes('customerManager')) stats.totalCustomerManagers++;
            if (userData.roles?.includes('seller')) stats.totalSellers++;
            if (userData.roles?.includes('customer')) stats.totalCustomers++;

            if (userData.seller?.availablePoints) totalAllocated += userData.seller.availablePoints;
            if (userData.customer?.availablePoints) totalAllocated += userData.customer.availablePoints;
            if (userData.seller?.totalPointsSold) totalAllocated += userData.seller.totalPointsSold;
            if (userData.merchant?.totalPointsSold) totalAllocated += userData.merchant.totalPointsSold;
          });

          stats.totalAllocatedPoints = totalAllocated;
          setStatistics(stats);
          setUsers(userList);
        }
      })();

      await Promise.race([dataPromise, timeoutPromise]);
    } catch (error) {
      console.error('[EventManagerDashboard] 加载失败:', error);
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
      // 🔧 修复：使用 userProfile 中的 organizationCode 和 eventCode
      const orgCode = userProfile?.organizationCode || '';
      const evtCode = userProfile?.eventCode || '';
      const orgEventCodeRoute = `${orgCode}-${evtCode}`;
      navigate(`/login/${orgEventCodeRoute}`);
    } catch (error) {
      console.error('登出失败:', error);
      window.mybazaarShowToast('登出失败');
    }
  };

  const handleRefresh = () => {
    window.location.reload();
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

    // 身份标签过滤
    if (identityTagFilter !== 'all') {
      filtered = filtered.filter(user => user.identityTag === identityTagFilter);
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
      {/* 🆕 共用 Header 组件（临时，如需自定义，稍后可修改参数） */}
      <DashboardHeader
        title={eventData ? `${(eventData.eventName?.['zh-CN'] || eventData.eventName?.['zh-TW'] || eventData.eventName?.['en-US'] || (typeof eventData.eventName === 'string' ? eventData.eventName : ''))} 活动管理` : "活动管理"}
        subtitle="Event Manager Dashboard"
        logoUrl={eventData?.logoUrl || orgData?.logoUrl}
        userName={userProfile?.basicInfo?.chineseName || userProfile?.basicInfo?.englishName}
        userPhone={userProfile?.basicInfo?.phoneNumber}
        onLogout={handleLogout}
        onRefresh={handleRefresh}
        showRoleSwitcher={true}
        showRefreshButton={true}
        currentRole={userProfile?.roles?.[0] || 'eventManager'}
        orgEventCode={undefined}
        availableRoles={userProfile?.roles || []}
        userInfo={userProfile}
      />

      {/* Statistics */}
      <div style={styles.statsGrid}>
        <StatCard
          title="总用户数"
          value={statistics.totalUsers}
          icon={STAT_ICONS.totalUsers}
          color="#667eea"
        />
        <StatCard
          title="班导师"
          value={statistics.totalSellerManagers}
          icon={STAT_ICONS.totalSellerManagers}
          color="#f59e0b"
        />
        <StatCard
          title="收银员"
          value={statistics.totalCashiers}
          icon={STAT_ICONS.totalCashiers}
          color="#3b82f6"
        />
        <StatCard
          title="点数销售员"
          value={statistics.totalSellers}
          icon={STAT_ICONS.totalSellers}
          color="#ec4899"
        />
        <StatCard
          title="商家"
          value={statistics.totalMerchants}
          icon={STAT_ICONS.totalMerchants}
          color="#06b6d4"
        />
        <StatCard
          title="消费者"
          value={statistics.totalCustomers}
          icon={STAT_ICONS.totalCustomers}
          color="#84cc16"
        />
        <StatCard
          title="已分配点数"
          value={statistics.totalAllocatedPoints.toLocaleString()}
          icon={STAT_ICONS.totalAllocatedPoints}
          color="#10b981"
        />
      </div>

      {/* Action Buttons */}
      <div style={styles.actionButtons}>
        <button
          style={styles.primaryButton}
          onClick={() => setShowAddUser(true)}
          title="创建单个用户"
        >
          <UserAddIcon style={{ width: '20px', height: '20px', marginRight: '0.5rem' }} />
          创建单个用户
        </button>
        {/* 批量导入按钮 */}
        <button
          style={styles.primaryButton}
          onClick={() => setShowBatchImport(true)}
          title="批量导入"
        >
          <UsersMedicalIcon style={{ width: '20px', height: '20px', marginRight: '0.5rem' }} />
          批量导入用户
        </button>
        <button
          style={styles.primaryButton}
          onClick={() => setShowDepartmentManagement(true)}
          title="部门管理"
        >
          <DepartmentStructureIcon style={{ width: '20px', height: '20px', marginRight: '0.5rem' }} />
          部门管理
        </button>
        <button
          style={styles.primaryButton}
          onClick={() => setShowUserManagement(true)}
          title="点数管理"
        >
          <PointOfSaleMobileIcon style={{ width: '20px', height: '20px', marginRight: '0.5rem' }} />
          点数管理
        </button>
        <button
          style={styles.primaryButton}
          onClick={handleOpenGrantPoints}
          title="赠送点数"
        >
          <FreeIcon style={{ width: '20px', height: '20px', marginRight: '0.5rem' }} />
          赠送点数
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
          {/* 身份标签过滤 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.875rem', fontWeight: '600', color: '#374151' }}>
              身份标签:
            </label>
            <select
              value={identityTagFilter}
              onChange={(e) => {
                setIdentityTagFilter(e.target.value);
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
              <option value="all">全部标签</option>
              <option value="staff">职员</option>
              <option value="teacher">教师</option>
              <option value="student">学生</option>
            </select>
          </div>

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
              <option value="sellerManager">班导师</option>
              <option value="merchantManager">商家管理员</option>
              <option value="customerManager">消费者管理员</option>
              <option value="cashier">收银员</option>
              <option value="seller">点数销售员</option>
              <option value="merchantOwner">摊主</option>
              <option value="merchantAsist">摊位助手</option>
              <option value="pointSeller">点数直售员</option>
              <option value="customer">消费者</option>
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
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}
            >
              <ObjectsColumnIcon style={{ width: '18px', height: '18px', color: 'white' }} />
              列显示
            </button>
            {showColumnSelector && (
              <div style={{
                position: 'absolute',
                right: 0,
                top: '100%',
                marginTop: '0.5rem',
                backgroundColor: '#667eea',
                border: 'none',
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
                  {visibleColumns.可销售点数 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('availablePoints')}
                    >
                      可销售点数 {sortConfig.key === 'availablePoints' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
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
                  {visibleColumns.可消费点数 && (
                    <th
                      style={{ ...styles.tableHeaderCell, cursor: 'pointer' }}
                      onClick={() => handleSort('customerAvailablePoints')}
                    >
                      可消费点数 {sortConfig.key === 'customerAvailablePoints' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
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
                      <td style={styles.tableCell}>{user.identityTag || '-'}</td>
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
                          {sortRolesForDisplay(user.roles).map(role => {
                            const config = ROLE_CONFIG[role];
                            if (!config) return null;
                            return (
                              <div
                                key={role}
                                style={{
                                  ...styles.roleBadge,
                                  backgroundColor: config.color
                                }}
                                title={config.chineseLabel}
                              >
                                {renderIcon(config.icon, { alt: role, size: 20, color: 'white' })}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    )}
                    {visibleColumns.可销售点数 && (
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
                    {visibleColumns.可消费点数 && (
                      <td style={styles.tableCell}>
                        <span style={styles.pointsValue}>
                          {user.customer?.pointsAccount?.availablePoints || 0}
                        </span>
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
          onSuccess={loadDashboardData}
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

      {/* 🆕 赠送点数 Modal */}
      {showGrantPointsModal && (
        <div style={styles.modalOverlay} onClick={() => setShowGrantPointsModal(false)}>
          <div style={styles.editModalContent} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>🎁 赠送点数给Customer</h3>
              <button
                onClick={() => setShowGrantPointsModal(false)}
                style={styles.closeButton}
              >
                ✕
              </button>
            </div>

            <div style={styles.modalBody}>
              {/* 说明文字 */}
              <div style={{
                padding: '1rem',
                backgroundColor: '#fef3c7',
                borderRadius: '8px',
                border: '1px solid #fbbf24'
              }}>
                <p style={{ fontSize: '0.875rem', color: '#92400e', margin: 0 }}>
                  💡 此功能将赠送指定点数给所有符合选定身份标签的Customer用户。赠送的点数将直接添加到用户的可用余额中，无需现金对冲。
                </p>
              </div>

              {/* 选择身份标签 */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  目标身份标签 <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem' }}>
                  {identityTags.map(tag => (
                    <label key={tag.id} style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0.75rem',
                      border: grantIdentityTag.includes(tag.id) ? '2px solid #667eea' : '2px solid #e5e7eb',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      backgroundColor: grantIdentityTag.includes(tag.id) ? '#f0f4ff' : 'white',
                      transition: 'all 0.2s'
                    }}>
                      <input
                        type="checkbox"
                        checked={grantIdentityTag.includes(tag.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setGrantIdentityTag([...grantIdentityTag, tag.id]);
                          } else {
                            setGrantIdentityTag(grantIdentityTag.filter(id => id !== tag.id));
                          }
                        }}
                        style={{ marginRight: '0.5rem', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '0.875rem', fontWeight: '500' }}>
                        {tag.name['zh-CN'] || tag.name['en-US'] || tag.id}
                      </span>
                    </label>
                  ))}
                </div>
                <div style={styles.formHint}>
                  可以选择多个身份标签，将分别为每个标签的 Customer 用户赠送点数
                </div>
              </div>

              {/* 赠送点数 */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  赠送点数（每人） <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="number"
                  value={grantAmount}
                  onChange={(e) => setGrantAmount(e.target.value)}
                  style={styles.formInput}
                  placeholder="请输入赠送点数"
                  min="1"
                />
                <div style={styles.formHint}>
                  每个符合条件的用户将获得此数量的点数
                </div>
              </div>

              {/* 备注 */}
              <div style={styles.formGroup}>
                <label style={styles.formLabel}>
                  备注（可选）
                </label>
                <textarea
                  value={grantNote}
                  onChange={(e) => setGrantNote(e.target.value)}
                  style={{ ...styles.formInput, minHeight: '80px', resize: 'vertical' }}
                  placeholder="例如：新年礼物、活动奖励等"
                />
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  onClick={() => setShowGrantPointsModal(false)}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: '#374151',
                    backgroundColor: 'white',
                    border: '2px solid #e5e7eb',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}
                  disabled={isGranting}
                >
                  取消
                </button>
                <button
                  onClick={handleGrantPoints}
                  style={{
                    flex: 1,
                    padding: '0.75rem',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    color: 'white',
                    backgroundColor: isGranting ? '#9ca3af' : '#8b5cf6',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: isGranting ? 'not-allowed' : 'pointer'
                  }}
                  disabled={isGranting}
                >
                  {isGranting ? '赠送中...' : '确认赠送'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
                      // ✅ 新代码（添加互斥逻辑）
                      onClick={() => {
                        const newRoles = {
                          ...selectedRoles,
                          [roleId]: !selectedRoles[roleId]
                        };

                        // merchantOwner 和 merchantAsist 互斥
                        if (newRoles[roleId]) {
                          if (roleId === 'merchantOwner') {
                            newRoles.merchantAsist = false;
                          } else if (roleId === 'merchantAsist') {
                            newRoles.merchantOwner = false;
                          }
                        }

                        setSelectedRoles(newRoles);
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedRoles[roleId]}
                        onChange={() => { }}
                        style={styles.checkbox}
                      />
                      <div style={styles.roleInfo}>
                        {renderIcon(config.icon, { alt: roleId, size: 24, color: config.color })}
                        <span style={styles.roleLabel}>{config.chineseLabel}</span>
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
                    {departments.map(dept => {
                      const managerName = takenDepartments[dept];
                      const isTaken = !!managerName;

                      return (
                        <div
                          key={dept}
                          style={{
                            ...styles.departmentCheckbox,
                            opacity: isTaken ? 0.6 : 1,
                            backgroundColor: isTaken ? '#f3f4f6' : 'white',
                            cursor: isTaken ? 'not-allowed' : 'pointer',
                            borderColor: isTaken ? '#e5e7eb' : (managedDepartments.includes(dept) ? '#8b5cf6' : '#e5e7eb'),
                            position: 'relative'
                          }}
                          onClick={() => {
                            if (isTaken) return;
                            setManagedDepartments(prev =>
                              prev.includes(dept)
                                ? prev.filter(d => d !== dept)
                                : [...prev, dept]
                            );
                          }}
                          title={isTaken ? `该部门已由 ${managerName} 管理` : ''}
                        >
                          <input
                            type="checkbox"
                            checked={managedDepartments.includes(dept)}
                            onChange={() => { }}
                            disabled={isTaken}
                            style={{
                              ...styles.checkbox,
                              cursor: isTaken ? 'not-allowed' : 'pointer'
                            }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{
                              fontWeight: managedDepartments.includes(dept) ? '600' : '400',
                              color: isTaken ? '#9ca3af' : '#374151'
                            }}>
                              {dept}
                            </span>
                            {isTaken && (
                              <span style={{ fontSize: '0.65rem', color: '#ef4444' }}>
                                👤 {managerName}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
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

      {/* 🆕 共用 Footer 组件 */}
      <DashboardFooter 
        event={eventData}
        eventCode={eventCode}
        showEventInfo={true}
      />
    </div>
  );
};

// Statistics Card Component
const StatCard = ({ title, value, icon, color }) => {
  return (
    <div style={{ ...styles.statCard, borderLeftColor: color }}>
      <div style={styles.statIcon}>
        {renderIcon(icon, { alt: title, size: '100%', color })}
      </div>
      <div>
        <div style={styles.statValue}>{value}</div>
        <div style={styles.statLabel}>{title}</div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f3f4f6',
    padding: '0 2rem 2rem 2rem', /* 移除 top padding */
    paddingTop: 0 /* 确保 header 有空间 */
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
    marginBottom: '1rem',
    background: 'white',
    padding: '1rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '1.5rem',
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
    fontSize: '1rem',
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
    gridTemplateColumns: 'repeat(auto-fit, minmax(60px, 0.5fr))',
    gap: '1rem',
    marginTop: '1rem',
    marginBottom: '1.5rem'
  },
  statCard: {
    background: 'white',
    padding: '1rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    borderLeft: '4px solid'
  },
  statIcon: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    fontSize: '1.8rem'
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statLabel: {
    color: '#6b7280',
    fontSize: '0.75rem',
    marginTop: '0.25rem'
  },
  actionButtons: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    flexWrap: 'wrap'
  },
  primaryButton: {
    padding: '0.8rem 1rem',
    backgroundColor: '#667eea',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '400',
    fontSize: '1rem',
    transition: 'all 0.2s',
    boxShadow: '0 2px 4px rgba(102, 126, 234, 0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  secondaryButton: {
    padding: '0.875rem 1.5rem',
    backgroundColor: '#667eea',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '1rem',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
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
