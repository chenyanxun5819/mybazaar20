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
  increment 
} from 'firebase/firestore';

const ALLOWED_IDENTITY_TAGS = new Set(['staff', 'teacher']);

const UserManagement = ({ organizationId, eventId, onClose, onUpdate }) => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUser, setSelectedUser] = useState(null);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [eventData, setEventData] = useState(null);
  const [deptOrderMaps, setDeptOrderMaps] = useState({ byId: {}, byName: {} });
  
  // 角色分配状态
  const [selectedRoles, setSelectedRoles] = useState({
    sellerManager: false,
    merchantManager: false,
    customerManager: false
  });
  
  // 点数分配状态
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsNote, setPointsNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 管理员角色配置
  const managerRoles = [
    { id: 'sellerManager', label: 'Seller Manager', color: '#f59e0b', icon: '💰' },
    { id: 'merchantManager', label: 'Merchant Manager', color: '#8b5cf6', icon: '🏪' },
    { id: 'customerManager', label: 'Customer Manager', color: '#10b981', icon: '🎫' }
  ];

  useEffect(() => {
    fetchData();
  }, [organizationId, eventId]);

  useEffect(() => {
    filterUsers();
  }, [users, searchTerm, deptOrderMaps]);

  // 获取活动数据和用户列表
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // 获取活动数据（包含总资本信息）
      const eventDoc = await getDoc(
        doc(db, 'organizations', organizationId, 'events', eventId)
      );
      
      if (eventDoc.exists()) {
        setEventData(eventDoc.data());
      }

      // 获取组织部门排序（用于用户排序）
      try {
        const orgRef = doc(db, 'organizations', organizationId);
        const orgSnap = await getDoc(orgRef);
        if (orgSnap.exists()) {
          const data = orgSnap.data();
          const depts = Array.isArray(data?.departments) ? data.departments : [];
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

      // 获取用户列表
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

    // 1) 先按身份过滤，只保留 staff / teacher
    const base = users.filter(u => {
      const tag = normalize(u.identityTag || u.identityInfo?.identityTag);
      return ALLOWED_IDENTITY_TAGS.has(tag);
    });

    // 2) 再做搜索过滤
    let filtered = base;
    const term = searchTerm.trim().toLowerCase();
    if (term) {
      filtered = base.filter(user =>
        user.basicInfo?.englishName?.toLowerCase().includes(term) ||
        user.basicInfo?.chineseName?.toLowerCase().includes(term) ||
        user.basicInfo?.phoneNumber?.includes(term) ||
        user.identityInfo?.identityId?.toLowerCase().includes(term)
      );
    }

    // 3) 按部门显示顺序 + 工号排序
    const getDeptOrder = (user) => {
      const deptId = user.identityInfo?.departmentId || user.department?.id;
      const deptName = user.identityInfo?.department || user.department?.name || user.departmentName;
      const byId = deptOrderMaps.byId || {};
      const byName = deptOrderMaps.byName || {};
      const orderFromId = deptId ? byId[deptId] : undefined;
      const orderFromName = deptName ? byName[normalize(deptName)] : undefined;
      const order = orderFromId ?? orderFromName;
      return typeof order === 'number' ? order : 999999; // 未分配部门排在最后
    };

    const getEmpNo = (user) => {
      const id = user.identityInfo?.identityId || '';
      // 若是纯数字则按数值，否则按字典序
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
      if (ae.num !== null) return -1; // 数字在前
      if (be.num !== null) return 1;
      return ae.str.localeCompare(be.str, 'zh');
    });

    setFilteredUsers(filtered);
  };

  // 打开角色分配模态框
  const openRoleModal = (user) => {
    setSelectedUser(user);
    
    // 预选当前用户已有的管理员角色
    const currentRoles = {
      sellerManager: user.roles?.includes('sellerManager') || false,
      merchantManager: user.roles?.includes('merchantManager') || false,
      customerManager: user.roles?.includes('customerManager') || false
    };
    
    setSelectedRoles(currentRoles);
    setShowRoleModal(true);
  };

  // 打开点数分配模态框
  const openPointsModal = (user) => {
    // 只允许为 Seller Manager 分配点数
    if (!user.roles?.includes('sellerManager')) {
      alert('只能为 Seller Manager 分配点数');
      return;
    }
    
    setSelectedUser(user);
    setPointsAmount('');
    setPointsNote('');
    setShowPointsModal(true);
  };

  // 保存角色分配
  const handleSaveRoles = async () => {
    if (!selectedUser) return;
    
    try {
      setIsProcessing(true);
      
      // 构建新的角色数组
      const newRoles = [...(selectedUser.roles || [])].filter(
        role => !['sellerManager', 'merchantManager', 'customerManager'].includes(role)
      );
      
      // 添加选中的管理员角色
      if (selectedRoles.sellerManager) newRoles.push('sellerManager');
      if (selectedRoles.merchantManager) newRoles.push('merchantManager');
      if (selectedRoles.customerManager) newRoles.push('customerManager');
      
      console.log('[UserManagement] 准备更新用户角色:', {
        userId: selectedUser.id,
        newRoles,
        organizationId,
        eventId
      });
      
      // 更新用户文档
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', selectedUser.id
      );
      
      await updateDoc(userRef, {
        roles: newRoles,
        'accountStatus.lastUpdated': new Date()
      });
      
      console.log('[UserManagement] 角色更新成功');
      
      // 如果添加了 sellerManager 角色，初始化点数账户
      if (selectedRoles.sellerManager && !selectedUser.roles?.includes('sellerManager')) {
        console.log('[UserManagement] 初始化 Seller Manager 点数账户');
        await updateDoc(userRef, {
          'sellerManager.totalPoints': 0,
          'sellerManager.allocatedPoints': 0,
          'sellerManager.returnedPoints': 0,
          'sellerManager.transactions': []
        });
      }
      
      alert('角色分配成功！');
      setShowRoleModal(false);
      fetchData(); // 刷新数据
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('[UserManagement] ❌ 角色分配失败:', error);
      console.error('[UserManagement] 错误代码:', error.code);
      console.error('[UserManagement] 错误信息:', error.message);
      console.error('[UserManagement] 完整错误:', JSON.stringify(error, null, 2));
      
      // 根据错误类型提供更详细的提示
      let errorMsg = error.message;
      if (error.code === 'permission-denied') {
        errorMsg = '权限不足：无法更新用户角色。请检查 Firestore 安全规则配置。';
      } else if (error.code === 'not-found') {
        errorMsg = '用户文档不存在：无法找到该用户。';
      } else if (error.code === 'invalid-argument') {
        errorMsg = '参数错误：请检查输入数据。';
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
    
    // 计算剩余总资本
    const totalCapital = eventData?.settings?.totalCapital || 0;
    const allocatedCapital = eventData?.settings?.allocatedCapital || 0;
    const remainingCapital = totalCapital - allocatedCapital;
    
    if (points > remainingCapital) {
      alert(`超出可分配资本！\n总资本: RM ${totalCapital.toLocaleString()}\n已分配: RM ${allocatedCapital.toLocaleString()}\n剩余: RM ${remainingCapital.toLocaleString()}`);
      return;
    }
    
    try {
      setIsProcessing(true);
      
      console.log('[UserManagement] 准备分配点数:', {
        userId: selectedUser.id,
        points,
        note: pointsNote,
        organizationId,
        eventId
      });
      
      // 创建交易记录
      const transaction = {
        type: 'allocation',
        amount: points,
        timestamp: new Date(),
        note: pointsNote || '资本分配',
        allocatedBy: 'Event Manager'
      };
      
      // 更新用户的点数
      const userRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users', selectedUser.id
      );
      
      const currentPoints = selectedUser.sellerManager?.totalPoints || 0;
      
      await updateDoc(userRef, {
        'sellerManager.totalPoints': currentPoints + points,
        'sellerManager.transactions': [...(selectedUser.sellerManager?.transactions || []), transaction],
        'accountStatus.lastUpdated': new Date()
      });
      
      console.log('[UserManagement] 用户点数更新成功');
      
      // 更新活动的已分配资本
      const eventRef = doc(db, 'organizations', organizationId, 'events', eventId);
      await updateDoc(eventRef, {
        'settings.allocatedCapital': increment(points)
      });
      
      console.log('[UserManagement] 活动已分配资本更新成功');
      
      alert(`成功分配 RM ${points.toLocaleString()} 给 ${selectedUser.basicInfo?.englishName}`);
      setShowPointsModal(false);
      setPointsAmount('');
      setPointsNote('');
      fetchData(); // 刷新数据
      if (onUpdate) onUpdate();
      
    } catch (error) {
      console.error('[UserManagement] ❌ 点数分配失败:', error);
      console.error('[UserManagement] 错误代码:', error.code);
      console.error('[UserManagement] 错误信息:', error.message);
      
      let errorMsg = error.message;
      if (error.code === 'permission-denied') {
        errorMsg = '权限不足：无法更新点数。请检查 Firestore 安全规则配置。';
      } else if (error.code === 'not-found') {
        errorMsg = '用户或活动文档不存在。';
      }
      
      alert('点数分配失败: ' + errorMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  // 检查用户是否有管理员角色
  const hasManagerRole = (user) => {
    return user.roles?.some(role => 
      ['sellerManager', 'merchantManager', 'customerManager'].includes(role)
    );
  };

  // 获取用户的管理员角色标签
  const getManagerRoleBadges = (user) => {
    const roles = user.roles || [];
    return managerRoles
      .filter(role => roles.includes(role.id))
      .map(role => (
        <span
          key={role.id}
          style={{
            ...styles.roleBadge,
            backgroundColor: role.color
          }}
        >
          {role.icon} {role.label}
        </span>
      ));
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
    } catch {
      return '未知';
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>用户管理</h2>
            <p style={styles.subtitle}>
              为用户指定管理员角色 & 为 Seller Manager 分配点数
            </p>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 资本信息栏 */}
        {eventData && (
          <div style={styles.capitalBar}>
            <div style={styles.capitalItem}>
              <span style={styles.capitalLabel}>💰 总资本</span>
              <span style={styles.capitalValue}>
                RM {(eventData.settings?.totalCapital || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.capitalItem}>
              <span style={styles.capitalLabel}>📤 已分配</span>
              <span style={styles.capitalValue}>
                RM {(eventData.settings?.allocatedCapital || 0).toLocaleString()}
              </span>
            </div>
            <div style={styles.capitalItem}>
              <span style={styles.capitalLabel}>💵 剩余可分配</span>
              <span style={{...styles.capitalValue, color: '#10b981'}}>
                RM {((eventData.settings?.totalCapital || 0) - (eventData.settings?.allocatedCapital || 0)).toLocaleString()}
              </span>
            </div>
          </div>
        )}

        {/* 搜索框 */}
        <div style={styles.searchSection}>
          <input
            type="text"
            placeholder="🔍 搜索用户姓名、手机号、学号..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
        </div>

        {/* 用户列表 */}
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loadingState}>
              <div style={styles.spinner}></div>
              <p>加载中...</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={styles.emptyState}>
              <p>😕 没有找到符合条件的用户</p>
            </div>
          ) : (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr style={styles.tableHeaderRow}>
                    <th style={styles.tableHeaderCell}>姓名</th>
                    <th style={styles.tableHeaderCell}>手机号</th>
                    <th style={styles.tableHeaderCell}>身份证/工号</th>
                    <th style={styles.tableHeaderCell}>部门</th>
                    <th style={styles.tableHeaderCell}>当前角色</th>
                    <th style={styles.tableHeaderCell}>Seller Manager 点数</th>
                    <th style={styles.tableHeaderCell}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((user, index) => (
                    <tr key={user.id} style={{...styles.tableRow, backgroundColor: index % 2 === 0 ? '#ffffff' : '#f9fafb'}}>
                      <td style={styles.tableCell}>
                        <strong>{user.basicInfo?.englishName || '未知'}</strong>
                        {user.basicInfo?.chineseName && (
                          <div style={{fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem'}}>
                            {user.basicInfo.chineseName}
                          </div>
                        )}
                      </td>
                      <td style={styles.tableCell}>{user.basicInfo?.phoneNumber || '-'}</td>
                      <td style={styles.tableCell}>{user.identityInfo?.identityId || '-'}</td>
                      <td style={styles.tableCell}>{user.identityInfo?.department || '-'}</td>
                      <td style={styles.tableCell}>
                        <div style={styles.rolesBadgeContainer}>
                          {hasManagerRole(user) ? getManagerRoleBadges(user) : <span style={{color: '#9ca3af'}}>-</span>}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        {user.roles?.includes('sellerManager') ? (
                          <div>
                            <div style={{fontWeight: '600', color: '#10b981'}}>
                              RM {(user.sellerManager?.totalPoints || 0).toLocaleString()}
                            </div>
                            {user.sellerManager?.transactions?.length > 0 && (
                              <div style={{fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem'}}>
                                {formatDate(user.sellerManager.transactions[user.sellerManager.transactions.length - 1].timestamp)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span style={{color: '#9ca3af'}}>-</span>
                        )}
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.actionButtonsContainer}>
                          <button
                            onClick={() => openRoleModal(user)}
                            style={styles.tableActionButton}
                          >
                            🎭 角色
                          </button>
                          {user.roles?.includes('sellerManager') && (
                            <button
                              onClick={() => openPointsModal(user)}
                              style={{...styles.tableActionButton, backgroundColor: '#10b981'}}
                            >
                              💰 点数
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 角色分配模态框 */}
        {showRoleModal && selectedUser && (
          <div style={styles.subModal} onClick={() => setShowRoleModal(false)}>
            <div style={styles.subModalContent} onClick={(e) => e.stopPropagation()}>
              <h3 style={styles.subModalTitle}>
                为 {selectedUser.basicInfo?.englishName} 分配管理员角色
              </h3>
              
              <div style={styles.roleOptions}>
                {managerRoles.map(role => (
                  <div
                    key={role.id}
                    style={{
                      ...styles.roleOption,
                      backgroundColor: selectedRoles[role.id] ? `${role.color}20` : '#f9fafb',
                      borderColor: selectedRoles[role.id] ? role.color : '#e5e7eb'
                    }}
                    onClick={() => setSelectedRoles(prev => ({
                      ...prev,
                      [role.id]: !prev[role.id]
                    }))}
                  >
                    <div style={styles.roleOptionLeft}>
                      <span style={styles.roleIcon}>{role.icon}</span>
                      <div>
                        <div style={styles.roleLabel}>{role.label}</div>
                        <div style={styles.roleDescription}>
                          {role.id === 'sellerManager' && '管理销售团队，分配和回收资本'}
                          {role.id === 'merchantManager' && '管理商家，印制 QR Code'}
                          {role.id === 'customerManager' && '义卖会当日销售和收款'}
                        </div>
                      </div>
                    </div>
                    <div style={{
                      ...styles.checkbox,
                      backgroundColor: selectedRoles[role.id] ? role.color : 'transparent',
                      borderColor: selectedRoles[role.id] ? role.color : '#d1d5db'
                    }}>
                      {selectedRoles[role.id] && '✓'}
                    </div>
                  </div>
                ))}
              </div>

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
                  {isProcessing ? '保存中...' : '保存角色'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 点数分配模态框 */}
        {showPointsModal && selectedUser && (
          <div style={styles.subModal} onClick={() => setShowPointsModal(false)}>
            <div style={styles.subModalContent} onClick={(e) => e.stopPropagation()}>
              <h3 style={styles.subModalTitle}>
                为 {selectedUser.basicInfo?.englishName} 分配点数
              </h3>
              
              <div style={styles.pointsForm}>
                <div style={styles.currentPointsDisplay}>
                  <div>当前总点数</div>
                  <div style={styles.currentPointsValue}>
                    RM {(selectedUser.sellerManager?.totalPoints || 0).toLocaleString()}
                  </div>
                </div>

                <div style={styles.availableCapital}>
                  <span>可分配资本: </span>
                  <span style={styles.availableCapitalValue}>
                    RM {((eventData?.settings?.totalCapital || 0) - (eventData?.settings?.allocatedCapital || 0)).toLocaleString()}
                  </span>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>分配点数 (RM)</label>
                  <input
                    type="number"
                    value={pointsAmount}
                    onChange={(e) => setPointsAmount(e.target.value)}
                    placeholder="输入要分配的点数"
                    style={styles.input}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>备注（可选）</label>
                  <textarea
                    value={pointsNote}
                    onChange={(e) => setPointsNote(e.target.value)}
                    placeholder="例如：初始资本分配、追加资本等"
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
                  {isProcessing ? '分配中...' : '确认分配'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '1400px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '2rem',
    borderBottom: '1px solid #e5e7eb'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: 0
  },
  closeButton: {
    padding: '0.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    color: '#6b7280',
    cursor: 'pointer',
    lineHeight: 1
  },
  capitalBar: {
    display: 'flex',
    gap: '2rem',
    padding: '1.5rem 2rem',
    backgroundColor: '#f9fafb',
    borderBottom: '1px solid #e5e7eb'
  },
  capitalItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  capitalLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '500'
  },
  capitalValue: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  searchSection: {
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #e5e7eb'
  },
  searchInput: {
    width: '100%',
    padding: '0.75rem 1rem',
    fontSize: '1rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    transition: 'border-color 0.2s'
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '2rem'
  },
  tableWrapper: {
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeaderRow: {
    background: '#f9fafb',
    borderBottom: '2px solid #e5e7eb'
  },
  tableHeaderCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    borderRight: '1px solid #e5e7eb'
  },
  tableRow: {
    borderBottom: '1px solid #e5e7eb',
    transition: 'background-color 0.2s'
  },
  tableCell: {
    padding: '1rem',
    textAlign: 'left',
    fontSize: '0.875rem',
    color: '#1f2937',
    borderRight: '1px solid #e5e7eb'
  },
  rolesBadgeContainer: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  actionButtonsContainer: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  tableActionButton: {
    padding: '0.5rem 0.75rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    whiteSpace: 'nowrap'
  },
  userGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
    gap: '1.5rem'
  },
  userCard: {
    backgroundColor: 'white',
    border: '2px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1.5rem',
    transition: 'all 0.2s',
    cursor: 'default'
  },
  userInfo: {
    marginBottom: '1rem'
  },
  userName: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.5rem'
  },
  userNameChinese: {
    fontSize: '0.875rem',
    fontWeight: '400',
    color: '#6b7280',
    marginLeft: '0.5rem'
  },
  userDetails: {
    fontSize: '0.875rem',
    color: '#6b7280',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    marginBottom: '0.75rem'
  },
  currentRoles: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    marginTop: '0.75rem'
  },
  roleBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    color: 'white',
    fontWeight: '600'
  },
  pointsInfo: {
    marginTop: '1rem',
    padding: '1rem',
    backgroundColor: '#f0fdf4',
    borderRadius: '8px',
    border: '1px solid #bbf7d0'
  },
  pointsItem: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.875rem',
    marginBottom: '0.5rem'
  },
  pointsValue: {
    fontWeight: '700',
    color: '#10b981',
    fontSize: '1rem'
  },
  lastTransaction: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.5rem'
  },
  userActions: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '1rem'
  },
  actionButton: {
    flex: 1,
    padding: '0.75rem',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  },
  pointsButton: {
    backgroundColor: '#10b981'
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
    fontSize: '2rem'
  },
  roleLabel: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '0.25rem'
  },
  roleDescription: {
    fontSize: '0.75rem',
    color: '#6b7280'
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
  }
};

// 添加动画
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  input:focus, textarea:focus {
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
`;
document.head.appendChild(styleSheet);

export default UserManagement;