import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { 
  collection, 
  getDocs, 
  doc, 
  updateDoc, 
  getDoc,
  query, 
  orderBy,
  increment,
  arrayUnion,
  writeBatch
} from 'firebase/firestore';

// 统一的角色配置
const ROLE_CONFIG = {
  sellerManager: { label: 'SM', fullLabel: 'Seller Manager', color: '#f59e0b', icon: '🛍️', category: 'manager' },
  merchantManager: { label: 'MM', fullLabel: 'Merchant Manager', color: '#8b5cf6', icon: '🏪', category: 'manager' },
  customerManager: { label: 'CM', fullLabel: 'Customer Manager', color: '#10b981', icon: '🎫', category: 'manager' },
  financeManager: { label: 'FM', fullLabel: 'Finance Manager', color: '#3b82f6', icon: '💵', category: 'manager' },
  seller: { label: 'S', fullLabel: 'Seller', color: '#ec4899', icon: '🛒', category: 'user' },
  merchant: { label: 'M', fullLabel: 'Merchant', color: '#06b6d4', icon: '🏬', category: 'user' },
  customer: { label: 'C', fullLabel: 'Customer', color: '#84cc16', icon: '👤', category: 'user' }
};

const UserManagement = ({ organizationId, eventId, onClose, onUpdate }) => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [departments, setDepartments] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [eventData, setEventData] = useState(null);
  const [deptOrderMaps, setDeptOrderMaps] = useState({ byId: {}, byName: {} });
  
  // 角色分配状态
  const [selectedRoles, setSelectedRoles] = useState({
    sellerManager: false,
    merchantManager: false,
    customerManager: false,
    financeManager: false,
    seller: false,
    merchant: false,
    customer: false
  });
  
  // 点数分配状态
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsNote, setPointsNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  
  // 点数回收状态
  const [recallAmount, setRecallAmount] = useState('');
  const [recallNote, setRecallNote] = useState('');
  
  // 批量分配状态
  const [batchDepartment, setBatchDepartment] = useState('');
  const [batchAmount, setBatchAmount] = useState('');
  const [batchNote, setBatchNote] = useState('');
  
  // Seller Manager 管理部门状态
  const [managedDepartments, setManagedDepartments] = useState([]);

  const allRoles = Object.entries(ROLE_CONFIG).map(([id, config]) => ({
    id,
    ...config
  }));

  useEffect(() => {
    fetchData();
  }, [organizationId, eventId]);

  useEffect(() => {
    filterUsers();
  }, [users, searchTerm, departmentFilter, deptOrderMaps]);

  // 获取活动数据和用户列表
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 获取活动数据
      const eventDoc = await getDoc(
        doc(db, 'organizations', organizationId, 'events', eventId)
      );
      
      if (eventDoc.exists()) {
        setEventData(eventDoc.data());
      }

      // 获取组织部门排序和部门列表
      try {
        const orgRef = doc(db, 'organizations', organizationId);
        const orgSnap = await getDoc(orgRef);
        if (orgSnap.exists()) {
          const data = orgSnap.data();
          const depts = Array.isArray(data?.departments) ? data.departments : [];
          
          // 设置部门列表（用于过滤）
          setDepartments(depts.map(d => d.name).sort());
          
          const byId = {};
          const byName = {};
          const normalize = (s) => (s || '').toString().trim().toLowerCase();
          depts.forEach(d => {
            const order = typeof d.displayOrder === 'number' ? d.displayOrder : Number(d.displayOrder) || 999999;
            if (d.id) byId[d.id] = order;
            if (d.name) byName[normalize(d.name)] = order;
          });
          setDeptOrderMaps({ byId, byName });
        }
      } catch (e) {
        console.warn('部门排序读取失败，将按名称/工号排序:', e);
      }

      // 获取所有用户列表
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
      
      setUsers(usersList);
    } catch (error) {
      console.error('❌ 获取数据失败:', error);
      alert('获取数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 过滤与排序用户
  const filterUsers = () => {
    const normalize = (s) => (s || '').toString().trim().toLowerCase();

    let filtered = [...users];

    // 搜索过滤
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      filtered = filtered.filter(user =>
        user.basicInfo?.englishName?.toLowerCase().includes(term) ||
        user.basicInfo?.chineseName?.toLowerCase().includes(term) ||
        user.basicInfo?.phoneNumber?.includes(term) ||
        user.identityInfo?.identityId?.toLowerCase().includes(term)
      );
    }

    // 部门过滤
    if (departmentFilter !== 'all') {
      filtered = filtered.filter(user => 
        user.identityInfo?.department === departmentFilter
      );
    }

    // 按部门显示顺序 + 工号排序
    const getDeptOrder = (user) => {
      const deptId = user.identityInfo?.departmentId || user.department?.id;
      const deptName = user.identityInfo?.department || user.department?.name || user.departmentName;
      const byId = deptOrderMaps.byId || {};
      const byName = deptOrderMaps.byName || {};
      const orderFromId = deptId ? byId[deptId] : undefined;
      const orderFromName = deptName ? byName[normalize(deptName)] : undefined;
      const order = orderFromId ?? orderFromName;
      return typeof order === 'number' ? order : 999999;
    };

    const getEmpNo = (user) => {
      const id = user.identityInfo?.identityId || '';
      if (/^\d+$/.test(id)) return { num: parseInt(id, 10), str: '' };
      return { num: null, str: id.toString() };
    };

    filtered.sort((a, b) => {
      const ao = getDeptOrder(a);
      const bo = getDeptOrder(b);
      if (ao !== bo) return ao - bo;

      const ae = getEmpNo(a);
      const be = getEmpNo(b);
      if (ae.num !== null && be.num !== null) return ae.num - be.num;
      if (ae.num !== null) return -1;
      if (be.num !== null) return 1;
      return ae.str.localeCompare(be.str, 'zh');
    });

    setFilteredUsers(filtered);
  };

  // 打开角色分配模态框
  const openRoleModal = (user) => {
    setSelectedUser(user);
    
    const currentRoles = {
      sellerManager: user.roles?.includes('sellerManager') || false,
      merchantManager: user.roles?.includes('merchantManager') || false,
      customerManager: user.roles?.includes('customerManager') || false,
      financeManager: user.roles?.includes('financeManager') || false,
      seller: user.roles?.includes('seller') || false,
      merchant: user.roles?.includes('merchant') || false,
      customer: user.roles?.includes('customer') || false
    };
    
    setSelectedRoles(currentRoles);
    
    // 加载 Seller Manager 的管理部门
    if (user.sellerManager?.managedDepartments) {
      setManagedDepartments(user.sellerManager.managedDepartments);
    } else {
      setManagedDepartments([]);
    }
    
    setShowRoleModal(true);
  };

  // 打开点数分配模态框
  const openPointsModal = (user) => {
    const hasPointsRole = user.roles?.some(role => 
      ['sellerManager', 'seller', 'merchantManager', 'merchant', 'customerManager', 'customer'].includes(role)
    );
    
    if (!hasPointsRole) {
      alert('该用户没有可分配点数的角色');
      return;
    }
    
    setSelectedUser(user);
    setPointsAmount('');
    setPointsNote('');
    setShowPointsModal(true);
  };

  // 打开点数回收模态框
  const openRecallModal = (user) => {
    const pointsInfo = getUserPointsInfo(user);
    
    if (pointsInfo.availablePoints <= 0) {
      alert('该用户没有可回收的点数');
      return;
    }
    
    setSelectedUser(user);
    setRecallAmount('');
    setRecallNote('');
    setShowRecallModal(true);
  };

  // 打开批量分配模态框
  const openBatchModal = () => {
    setBatchDepartment('');
    setBatchAmount('');
    setBatchNote('');
    setShowBatchModal(true);
  };

  // 保存角色分配
  const handleSaveRoles = async () => {
    if (!selectedUser) return;
    
    // 如果勾选了 sellerManager 但没有选择管理部门，提示用户
    if (selectedRoles.sellerManager && managedDepartments.length === 0) {
      if (!confirm('您勾选了 Seller Manager 角色但未选择管理部门。\n是否继续？（该用户将无法管理任何部门）')) {
        return;
      }
    }
    
    try {
      setIsProcessing(true);
      
      const newRoles = [];
      if (selectedRoles.sellerManager) newRoles.push('sellerManager');
      if (selectedRoles.merchantManager) newRoles.push('merchantManager');
      if (selectedRoles.customerManager) newRoles.push('customerManager');
      if (selectedRoles.financeManager) newRoles.push('financeManager');
      if (selectedRoles.seller) newRoles.push('seller');
      if (selectedRoles.merchant) newRoles.push('merchant');
      if (selectedRoles.customer) newRoles.push('customer');
      
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', selectedUser.id
      );
      
      const updateData = {
        roles: newRoles,
        'accountStatus.lastUpdated': new Date()
      };
      
      // 如果勾选了 sellerManager，保存管理部门
      if (selectedRoles.sellerManager) {
        updateData['sellerManager.managedDepartments'] = managedDepartments;
        
        // 如果是新添加的 sellerManager，初始化其他字段
        if (!selectedUser.roles?.includes('sellerManager')) {
          updateData['sellerManager.allocatedPoints'] = 0;
          updateData['sellerManager.returnedPoints'] = 0;
          updateData['sellerManager.totalPoints'] = 0;
          updateData['sellerManager.transactions'] = [];
        }
      }
      
      await updateDoc(userRef, updateData);
      
      // 初始化点数账户
      const additionalUpdateData = {};
      
      if (selectedRoles.seller && !selectedUser.roles?.includes('seller')) {
        additionalUpdateData['seller.availablePoints'] = 0;
        additionalUpdateData['seller.totalPointsSold'] = 0;
        additionalUpdateData['seller.transactions'] = [];
      }
      
      if (selectedRoles.merchant && !selectedUser.roles?.includes('merchant')) {
        additionalUpdateData['merchant.availablePoints'] = 0;
        additionalUpdateData['merchant.totalPointsSold'] = 0;
        additionalUpdateData['merchant.transactions'] = [];
      }
      
      if (selectedRoles.customer && !selectedUser.roles?.includes('customer')) {
        additionalUpdateData['customer.availablePoints'] = 0;
        additionalUpdateData['customer.totalPointsSpent'] = 0;
        additionalUpdateData['customer.transactions'] = [];
      }
      
      if (Object.keys(additionalUpdateData).length > 0) {
        await updateDoc(userRef, additionalUpdateData);
      }
      
      alert('角色分配成功！');
      setShowRoleModal(false);
      fetchData();
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('[UserManagement] ❌ 角色分配失败:', error);
      
      let errorMsg = error.message;
      if (error.code === 'permission-denied') {
        errorMsg = '权限不足：无法更新用户角色。';
      } else if (error.code === 'not-found') {
        errorMsg = '用户文档不存在。';
      }
      
      alert('角色分配失败: ' + errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  // 保存点数分配
  const handleAllocatePoints = async () => {
    if (!selectedUser || !pointsAmount) {
      alert('请输入分配点数');
      return;
    }
    
    const points = parseFloat(pointsAmount);
    
    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }
    
    const totalCapital = eventData?.settings?.totalCapital || 0;
    const allocatedCapital = eventData?.settings?.allocatedCapital || 0;
    const remainingCapital = totalCapital - allocatedCapital;
    
    if (points > remainingCapital) {
      alert(`超出可分配资本！\n总资本: RM ${totalCapital.toLocaleString()}\n已分配: RM ${allocatedCapital.toLocaleString()}\n剩余: RM ${remainingCapital.toLocaleString()}`);
      return;
    }
    
    try {
      setIsProcessing(true);
      
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', selectedUser.id
      );
      
      const eventRef = doc(db, 'organizations', organizationId, 'events', eventId);
      
      let roleType = null;
      if (selectedUser.roles?.includes('seller')) roleType = 'seller';
      else if (selectedUser.roles?.includes('merchant')) roleType = 'merchant';
      else if (selectedUser.roles?.includes('customer')) roleType = 'customer';
      
      if (!roleType) {
        alert('用户没有可分配点数的角色');
        return;
      }
      
      const transaction = {
        type: 'allocation',
        amount: points,
        timestamp: new Date(),
        allocatedBy: 'eventManager',
        note: pointsNote || '点数分配'
      };
      
      await updateDoc(userRef, {
        [`${roleType}.availablePoints`]: increment(points),
        [`${roleType}.transactions`]: arrayUnion(transaction),
        'accountStatus.lastUpdated': new Date()
      });
      
      await updateDoc(eventRef, {
        'settings.allocatedCapital': increment(points)
      });
      
      alert(`成功分配 ${points.toLocaleString()} 点数！`);
      setShowPointsModal(false);
      fetchData();
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('❌ 点数分配失败:', error);
      alert('点数分配失败: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 点数回收
  const handleRecallPoints = async () => {
    if (!selectedUser || !recallAmount) {
      alert('请输入回收点数');
      return;
    }
    
    const points = parseFloat(recallAmount);
    
    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }
    
    const pointsInfo = getUserPointsInfo(selectedUser);
    
    if (points > pointsInfo.availablePoints) {
      alert(`回收点数不能超过现有点数！\n现有点数: ${pointsInfo.availablePoints.toLocaleString()}`);
      return;
    }
    
    try {
      setIsProcessing(true);
      
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', selectedUser.id
      );
      
      const eventRef = doc(db, 'organizations', organizationId, 'events', eventId);
      
      let roleType = null;
      if (selectedUser.roles?.includes('seller')) roleType = 'seller';
      else if (selectedUser.roles?.includes('merchant')) roleType = 'merchant';
      else if (selectedUser.roles?.includes('customer')) roleType = 'customer';
      
      if (!roleType) {
        alert('用户没有可回收点数的角色');
        return;
      }
      
      const transaction = {
        type: 'recall',
        amount: -points,
        timestamp: new Date(),
        recalledBy: 'eventManager',
        note: recallNote || '点数回收'
      };
      
      await updateDoc(userRef, {
        [`${roleType}.availablePoints`]: increment(-points),
        [`${roleType}.transactions`]: arrayUnion(transaction),
        'accountStatus.lastUpdated': new Date()
      });
      
      await updateDoc(eventRef, {
        'settings.allocatedCapital': increment(-points)
      });
      
      alert(`成功回收 ${points.toLocaleString()} 点数！`);
      setShowRecallModal(false);
      fetchData();
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('❌ 点数回收失败:', error);
      alert('点数回收失败: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 批量点数分配
  const handleBatchAllocate = async () => {
    if (!batchDepartment || !batchAmount) {
      alert('请选择部门并输入分配点数');
      return;
    }
    
    const points = parseFloat(batchAmount);
    
    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }
    
    // 筛选该部门的用户
    const deptUsers = users.filter(user => 
      user.identityInfo?.department === batchDepartment &&
      user.roles?.some(role => ['seller', 'merchant', 'customer'].includes(role))
    );
    
    if (deptUsers.length === 0) {
      alert(`部门 "${batchDepartment}" 中没有可分配点数的用户`);
      return;
    }
    
    const totalPoints = points * deptUsers.length;
    const totalCapital = eventData?.settings?.totalCapital || 0;
    const allocatedCapital = eventData?.settings?.allocatedCapital || 0;
    const remainingCapital = totalCapital - allocatedCapital;
    
    if (totalPoints > remainingCapital) {
      alert(`超出可分配资本！\n需要总点数: RM ${totalPoints.toLocaleString()}\n剩余资本: RM ${remainingCapital.toLocaleString()}`);
      return;
    }
    
    if (!confirm(`确认为 ${deptUsers.length} 个用户各分配 ${points.toLocaleString()} 点数？\n总计: ${totalPoints.toLocaleString()} 点数`)) {
      return;
    }
    
    try {
      setIsProcessing(true);
      
      const batch = writeBatch(db);
      const transaction = {
        type: 'allocation',
        amount: points,
        timestamp: new Date(),
        allocatedBy: 'eventManager',
        note: batchNote || `批量分配 - ${batchDepartment}`
      };
      
      deptUsers.forEach(user => {
        let roleType = null;
        if (user.roles?.includes('seller')) roleType = 'seller';
        else if (user.roles?.includes('merchant')) roleType = 'merchant';
        else if (user.roles?.includes('customer')) roleType = 'customer';
        
        if (roleType) {
          const userRef = doc(
            db,
            'organizations', organizationId,
            'events', eventId,
            'users', user.id
          );
          
          batch.update(userRef, {
            [`${roleType}.availablePoints`]: increment(points),
            [`${roleType}.transactions`]: arrayUnion(transaction),
            'accountStatus.lastUpdated': new Date()
          });
        }
      });
      
      // 更新活动已分配资本
      const eventRef = doc(db, 'organizations', organizationId, 'events', eventId);
      batch.update(eventRef, {
        'settings.allocatedCapital': increment(totalPoints)
      });
      
      await batch.commit();
      
      alert(`成功为 ${deptUsers.length} 个用户批量分配点数！\n每人: ${points.toLocaleString()}\n总计: ${totalPoints.toLocaleString()}`);
      setShowBatchModal(false);
      fetchData();
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('❌ 批量分配失败:', error);
      alert('批量分配失败: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 获取用户的点数信息
  const getUserPointsInfo = (user) => {
    let availablePoints = 0;
    let totalPointsSold = 0;
    
    if (user.seller) {
      availablePoints += user.seller.availablePoints || 0;
      totalPointsSold += user.seller.totalPointsSold || 0;
    }
    if (user.merchant) {
      availablePoints += user.merchant.availablePoints || 0;
      totalPointsSold += user.merchant.totalPointsSold || 0;
    }
    if (user.customer) {
      availablePoints += user.customer.availablePoints || 0;
    }
    
    return { availablePoints, totalPointsSold };
  };

  if (loading) {
    return (
      <div style={styles.modal}>
        <div style={styles.modalContent}>
          <div style={styles.loadingState}>
            <div style={styles.spinner}></div>
            <p>加载用户数据中...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.modal}>
      <div style={styles.modalContent}>
        {/* 标题栏 */}
        <div style={styles.header}>
          <h2 style={styles.title}>👥 用户管理</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 工具栏 */}
        <div style={styles.toolbar}>
          <input
            type="text"
            placeholder="🔍 搜索用户（姓名、电话、工号）"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          
          {/* 部门过滤 */}
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            style={styles.filterSelect}
          >
            <option value="all">全部部门</option>
            {departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
          
          {/* 批量分配按钮 */}
          <button
            onClick={openBatchModal}
            style={styles.batchButton}
          >
            📦 批量分配点数
          </button>
        </div>

        {/* 统计信息 */}
        <div style={styles.statsBar}>
          <div style={styles.statItem}>
            <span>总用户数: </span>
            <strong>{users.length}</strong>
          </div>
          <div style={styles.statItem}>
            <span>筛选结果: </span>
            <strong>{filteredUsers.length}</strong>
          </div>
          {eventData && (
            <div style={styles.statItem}>
              <span>剩余资本: </span>
              <strong style={{ color: '#f59e0b' }}>
                RM {((eventData.settings?.totalCapital || 0) - (eventData.settings?.allocatedCapital || 0)).toLocaleString()}
              </strong>
            </div>
          )}
        </div>

        {/* 用户表格 */}
        <div style={styles.tableContainer}>
          {filteredUsers.length === 0 ? (
            <div style={styles.emptyState}>
              <p>😕 没有找到符合条件的用户</p>
            </div>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr style={styles.tableHeaderRow}>
                  <th style={styles.tableHeaderCell}>序号</th>
                  <th style={styles.tableHeaderCell}>姓名</th>
                  <th style={styles.tableHeaderCell}>电话</th>
                  <th style={styles.tableHeaderCell}>身份标签</th>
                  <th style={styles.tableHeaderCell}>部门</th>
                  <th style={styles.tableHeaderCell}>身份ID</th>
                  <th style={styles.tableHeaderCell}>角色</th>
                  <th style={styles.tableHeaderCell}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user, index) => {
                  const pointsInfo = getUserPointsInfo(user);
                  
                  return (
                    <tr key={user.id} style={styles.tableRow}>
                      <td style={styles.tableCell}>{index + 1}</td>
                      <td style={styles.tableCell}>
                        <div style={styles.nameCell}>
                          <div style={styles.chineseName}>
                            {user.basicInfo?.chineseName || '-'}
                          </div>
                          <div style={styles.englishName}>
                            {user.basicInfo?.englishName || '-'}
                          </div>
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        {user.basicInfo?.phoneNumber || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityTag || user.identityInfo?.identityTag || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityInfo?.department || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityInfo?.identityId || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.rolesCell}>
                          {user.roles && user.roles.length > 0 ? (
                            user.roles.map(role => {
                              const roleConfig = ROLE_CONFIG[role];
                              if (!roleConfig) return null;
                              
                              return (
                                <span
                                  key={role}
                                  style={{
                                    ...styles.roleBadge,
                                    backgroundColor: roleConfig.color
                                  }}
                                  title={roleConfig.fullLabel}
                                >
                                  {roleConfig.icon}
                                </span>
                              );
                            })
                          ) : (
                            <span style={{ color: '#9ca3af' }}>-</span>
                          )}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.actionButtons}>
                          <button
                            onClick={() => openRoleModal(user)}
                            style={styles.actionButton}
                            title="角色设定"
                          >
                            👤
                          </button>
                          <button
                            onClick={() => openPointsModal(user)}
                            style={{ ...styles.actionButton, backgroundColor: '#10b981' }}
                            title="分配点数"
                          >
                            ➕
                          </button>
                          <button
                            onClick={() => openRecallModal(user)}
                            style={{ ...styles.actionButton, backgroundColor: '#ef4444' }}
                            title="回收点数"
                          >
                            ➖
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 角色分配模态框 */}
      {showRoleModal && selectedUser && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              设定角色 - {selectedUser.basicInfo?.chineseName} ({selectedUser.basicInfo?.englishName})
            </h3>

            <div style={styles.roleOptions}>
              <div style={styles.categoryTitle}>管理员角色:</div>
              {allRoles.filter(r => r.category === 'manager').map(role => (
                <div
                  key={role.id}
                  onClick={() => setSelectedRoles(prev => ({
                    ...prev,
                    [role.id]: !prev[role.id]
                  }))}
                  style={{
                    ...styles.roleOption,
                    borderColor: selectedRoles[role.id] ? role.color : '#e5e7eb',
                    backgroundColor: selectedRoles[role.id] ? `${role.color}15` : 'white'
                  }}
                >
                  <div style={styles.roleOptionLeft}>
                    <span style={styles.roleIcon}>{role.icon}</span>
                    <div style={styles.roleLabel}>{role.fullLabel}</div>
                  </div>
                  <div
                    style={{
                      ...styles.checkbox,
                      borderColor: role.color,
                      backgroundColor: selectedRoles[role.id] ? role.color : 'white'
                    }}
                  >
                    {selectedRoles[role.id] && '✓'}
                  </div>
                </div>
              ))}

              <div style={{ ...styles.categoryTitle, marginTop: '1.5rem' }}>用户角色:</div>
              {allRoles.filter(r => r.category === 'user').map(role => (
                <div
                  key={role.id}
                  onClick={() => setSelectedRoles(prev => ({
                    ...prev,
                    [role.id]: !prev[role.id]
                  }))}
                  style={{
                    ...styles.roleOption,
                    borderColor: selectedRoles[role.id] ? role.color : '#e5e7eb',
                    backgroundColor: selectedRoles[role.id] ? `${role.color}15` : 'white'
                  }}
                >
                  <div style={styles.roleOptionLeft}>
                    <span style={styles.roleIcon}>{role.icon}</span>
                    <div style={styles.roleLabel}>{role.fullLabel}</div>
                  </div>
                  <div
                    style={{
                      ...styles.checkbox,
                      borderColor: role.color,
                      backgroundColor: selectedRoles[role.id] ? role.color : 'white'
                    }}
                  >
                    {selectedRoles[role.id] && '✓'}
                  </div>
                </div>
              ))}
            </div>

            {/* Seller Manager 部门选择器 */}
            {selectedRoles.sellerManager && (
              <div style={styles.departmentSelector}>
                <div style={styles.departmentSelectorTitle}>
                  <span style={styles.roleIcon}>🏢</span>
                  选择管理部门 <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>(可多选)</span>
                </div>
                <div style={styles.departmentList}>
                  {departments.length === 0 ? (
                    <div style={styles.emptyDepartment}>
                      暂无部门，请先在部门管理中添加部门
                    </div>
                  ) : (
                    departments.map(dept => (
                      <label
                        key={dept}
                        style={styles.departmentOption}
                      >
                        <input
                          type="checkbox"
                          checked={managedDepartments.includes(dept)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setManagedDepartments(prev => [...prev, dept]);
                            } else {
                              setManagedDepartments(prev => prev.filter(d => d !== dept));
                            }
                          }}
                          style={styles.departmentCheckbox}
                        />
                        <span>{dept}</span>
                      </label>
                    ))
                  )}
                </div>
                {managedDepartments.length > 0 && (
                  <div style={styles.selectedDepartments}>
                    已选择 {managedDepartments.length} 个部门: {managedDepartments.join(', ')}
                  </div>
                )}
              </div>
            )}

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowRoleModal(false)}
                style={styles.cancelButton}
                disabled={isProcessing}
              >
                取消
              </button>
              <button
                onClick={handleSaveRoles}
                style={styles.saveButton}
                disabled={isProcessing}
              >
                {isProcessing ? '处理中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 点数分配模态框 */}
      {showPointsModal && selectedUser && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              分配点数 - {selectedUser.basicInfo?.chineseName} ({selectedUser.basicInfo?.englishName})
            </h3>

            <div style={styles.pointsForm}>
              <div style={styles.currentPointsDisplay}>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>当前点数</div>
                <div style={styles.currentPointsValue}>
                  {getUserPointsInfo(selectedUser).availablePoints.toLocaleString()}
                </div>
              </div>

              {eventData && (
                <div style={styles.availableCapital}>
                  可分配资本: <span style={styles.availableCapitalValue}>
                    RM {((eventData.settings?.totalCapital || 0) - (eventData.settings?.allocatedCapital || 0)).toLocaleString()}
                  </span>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>分配点数 *</label>
                <input
                  type="number"
                  value={pointsAmount}
                  onChange={(e) => setPointsAmount(e.target.value)}
                  placeholder="输入要分配的点数"
                  style={styles.input}
                  min="0"
                  step="1"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>备注</label>
                <textarea
                  value={pointsNote}
                  onChange={(e) => setPointsNote(e.target.value)}
                  placeholder="输入分配备注（可选）"
                  style={styles.textarea}
                  rows="3"
                />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowPointsModal(false)}
                style={styles.cancelButton}
                disabled={isProcessing}
              >
                取消
              </button>
              <button
                onClick={handleAllocatePoints}
                style={styles.saveButton}
                disabled={isProcessing}
              >
                {isProcessing ? '处理中...' : '确认分配'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 点数回收模态框 */}
      {showRecallModal && selectedUser && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              回收点数 - {selectedUser.basicInfo?.chineseName} ({selectedUser.basicInfo?.englishName})
            </h3>

            <div style={styles.pointsForm}>
              <div style={styles.currentPointsDisplay}>
                <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>当前可回收点数</div>
                <div style={styles.currentPointsValue}>
                  {getUserPointsInfo(selectedUser).availablePoints.toLocaleString()}
                </div>
              </div>

              <div style={styles.warningBox}>
                ⚠️ 注意：只能回收现有点数，已销售的点数不可回收
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>回收点数 *</label>
                <input
                  type="number"
                  value={recallAmount}
                  onChange={(e) => setRecallAmount(e.target.value)}
                  placeholder="输入要回收的点数"
                  style={styles.input}
                  min="0"
                  max={getUserPointsInfo(selectedUser).availablePoints}
                  step="1"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>备注</label>
                <textarea
                  value={recallNote}
                  onChange={(e) => setRecallNote(e.target.value)}
                  placeholder="输入回收原因（可选）"
                  style={styles.textarea}
                  rows="3"
                />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowRecallModal(false)}
                style={styles.cancelButton}
                disabled={isProcessing}
              >
                取消
              </button>
              <button
                onClick={handleRecallPoints}
                style={{ ...styles.saveButton, backgroundColor: '#ef4444' }}
                disabled={isProcessing}
              >
                {isProcessing ? '处理中...' : '确认回收'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量分配模态框 */}
      {showBatchModal && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              批量分配点数
            </h3>

            <div style={styles.pointsForm}>
              {eventData && (
                <div style={styles.availableCapital}>
                  可分配资本: <span style={styles.availableCapitalValue}>
                    RM {((eventData.settings?.totalCapital || 0) - (eventData.settings?.allocatedCapital || 0)).toLocaleString()}
                  </span>
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>选择部门 *</label>
                <select
                  value={batchDepartment}
                  onChange={(e) => setBatchDepartment(e.target.value)}
                  style={styles.input}
                >
                  <option value="">请选择部门</option>
                  {departments.map(dept => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              {batchDepartment && (
                <div style={styles.infoBox}>
                  该部门有 {users.filter(u => 
                    u.identityInfo?.department === batchDepartment &&
                    u.roles?.some(role => ['seller', 'merchant', 'customer'].includes(role))
                  ).length} 个可分配点数的用户
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>每人分配点数 *</label>
                <input
                  type="number"
                  value={batchAmount}
                  onChange={(e) => setBatchAmount(e.target.value)}
                  placeholder="输入每人分配的点数"
                  style={styles.input}
                  min="0"
                  step="1"
                />
              </div>

              {batchDepartment && batchAmount && (
                <div style={styles.infoBox}>
                  总计需要: {(parseFloat(batchAmount) * users.filter(u => 
                    u.identityInfo?.department === batchDepartment &&
                    u.roles?.some(role => ['seller', 'merchant', 'customer'].includes(role))
                  ).length).toLocaleString()} 点数
                </div>
              )}

              <div style={styles.formGroup}>
                <label style={styles.label}>备注</label>
                <textarea
                  value={batchNote}
                  onChange={(e) => setBatchNote(e.target.value)}
                  placeholder="输入分配备注（可选）"
                  style={styles.textarea}
                  rows="3"
                />
              </div>
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setShowBatchModal(false)}
                style={styles.cancelButton}
                disabled={isProcessing}
              >
                取消
              </button>
              <button
                onClick={handleBatchAllocate}
                style={styles.saveButton}
                disabled={isProcessing}
              >
                {isProcessing ? '处理中...' : '确认批量分配'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// 样式定义
const styles = {
  modal: {
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
  modalContent: {
    backgroundColor: 'white',
    borderRadius: '16px',
    width: '95%',
    maxWidth: '1600px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem 2rem',
    borderBottom: '2px solid #e5e7eb'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    fontSize: '1.5rem',
    color: '#6b7280',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0.5rem',
    lineHeight: 1
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem 2rem',
    borderBottom: '1px solid #e5e7eb',
    flexWrap: 'wrap'
  },
  searchInput: {
    flex: '1 1 300px',
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none'
  },
  filterSelect: {
    padding: '0.75rem 1rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    minWidth: '150px'
  },
  batchButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  statsBar: {
    display: 'flex',
    gap: '2rem',
    padding: '1rem 2rem',
    backgroundColor: '#f9fafb',
    borderBottom: '1px solid #e5e7eb',
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  statItem: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'center'
  },
  tableContainer: {
    flex: 1,
    overflow: 'auto',
    padding: '1rem 2rem'
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
  actionButtons: {
    display: 'flex',
    gap: '0.5rem'
  },
  actionButton: {
    padding: '0.5rem 0.75rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '1rem',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  subModal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100
  },
  subModalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '2rem',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  subModalTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '1.5rem'
  },
  roleOptions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginBottom: '2rem'
  },
  categoryTitle: {
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  roleOption: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem',
    borderRadius: '8px',
    border: '2px solid',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  roleOptionLeft: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center'
  },
  roleIcon: {
    fontSize: '1.5rem'
  },
  roleLabel: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937'
  },
  checkbox: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    border: '2px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 'bold',
    fontSize: '0.875rem'
  },
  pointsForm: {
    marginBottom: '2rem'
  },
  currentPointsDisplay: {
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    marginBottom: '1rem',
    textAlign: 'center'
  },
  currentPointsValue: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#10b981',
    marginTop: '0.5rem'
  },
  availableCapital: {
    padding: '0.75rem 1rem',
    backgroundColor: '#fef3c7',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#78350f'
  },
  availableCapitalValue: {
    fontWeight: '700',
    color: '#f59e0b'
  },
  warningBox: {
    padding: '0.75rem 1rem',
    backgroundColor: '#fef2f2',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#991b1b',
    border: '1px solid #fecaca'
  },
  infoBox: {
    padding: '0.75rem 1rem',
    backgroundColor: '#eff6ff',
    borderRadius: '8px',
    marginBottom: '1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#1e40af',
    border: '1px solid #bfdbfe'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    fontSize: '1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    boxSizing: 'border-box'
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    resize: 'vertical',
    boxSizing: 'border-box',
    fontFamily: 'inherit'
  },
  modalActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  saveButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '4rem',
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
  emptyState: {
    textAlign: 'center',
    padding: '4rem',
    color: '#6b7280'
  },
  departmentSelector: {
    marginTop: '1.5rem',
    padding: '1.5rem',
    backgroundColor: '#fef3c7',
    borderRadius: '12px',
    border: '2px solid #fbbf24'
  },
  departmentSelectorTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#92400e',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  departmentList: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '0.75rem',
    marginBottom: '1rem'
  },
  departmentOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    color: '#374151',
    transition: 'all 0.2s'
  },
  departmentCheckbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  selectedDepartments: {
    padding: '0.75rem',
    backgroundColor: '#fffbeb',
    borderRadius: '6px',
    fontSize: '0.875rem',
    color: '#78350f',
    fontWeight: '500'
  },
  emptyDepartment: {
    padding: '1rem',
    textAlign: 'center',
    color: '#92400e',
    fontSize: '0.875rem',
    backgroundColor: 'white',
    borderRadius: '6px'
  }
};

// 添加动画和hover效果
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  input:focus, textarea:focus, select:focus {
    border-color: #3b82f6 !important;
  }
  
  button:hover:not(:disabled) {
    opacity: 0.9;
    transform: translateY(-1px);
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  tr:hover {
    background-color: #f9fafb !important;
  }
  
  label:has(input[type="checkbox"]):hover {
    background-color: #fef3c7 !important;
  }
`;
document.head.appendChild(styleSheet);

export default UserManagement;