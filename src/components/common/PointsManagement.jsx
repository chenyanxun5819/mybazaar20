import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import {
  collection,
  getDocs,
  doc,
  updateDoc,
  getDoc,
  query,
  orderBy,
  increment,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';

import { safeFetch } from '../../services/safeFetch';

// 统一的角色配置
const ROLE_CONFIG = {
  sellerManager: { label: 'SM', fullLabel: 'Seller Manager', color: '#f59e0b', icon: '🛍️', category: 'manager' },
  merchantManager: { label: 'MM', fullLabel: 'Merchant Manager', color: '#8b5cf6', icon: '🏪', category: 'manager' },
  customerManager: { label: 'CM', fullLabel: 'Customer Manager', color: '#10b981', icon: '🎫', category: 'manager' },
  cashier: { label: 'C', fullLabel: 'Cashier', color: '#3b82f6', icon: '💵', category: 'manager' },
  seller: { label: 'S', fullLabel: 'Seller', color: '#ec4899', icon: '🛒', category: 'user' },
  customer: { label: 'C', fullLabel: 'Customer', color: '#84cc16', icon: '👤', category: 'user' }
};

const PointsManagement = ({ organizationId, eventId, onClose, onUpdate }) => {
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [departments, setDepartments] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showPointsModal, setShowPointsModal] = useState(false);
  const [showRecallModal, setShowRecallModal] = useState(false);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [eventData, setEventData] = useState(null);
  const [deptOrderMaps, setDeptOrderMaps] = useState({ byId: {}, byName: {} });

  // 🆕 identityTags 相关状态
  const [identityTags, setIdentityTags] = useState([]);
  const [selectedIdentityTag, setSelectedIdentityTag] = useState([]); // 🔄 改为数组支持复选

  // 点数分配状态
  const [pointsAmount, setPointsAmount] = useState('');
  const [pointsNote, setPointsNote] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // 点数回收状态
  const [recallAmount, setRecallAmount] = useState('');
  const [recallNote, setRecallNote] = useState('');

  // 批量分配状态
  const [batchAmount, setBatchAmount] = useState('');
  const [batchNote, setBatchNote] = useState('');

  // 🆕 电话号码遮罩函数
  const maskPhone = (phone) => {
    if (!phone) return '-';
    if (phone.length < 6) return phone; // 号码太短，直接显示

    const first3 = phone.substring(0, 3);
    const last3 = phone.substring(phone.length - 3);
    const middle = '*'.repeat(phone.length - 6);

    return `${first3}${middle}${last3}`;
  };

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

      // 1. 🆕 获取组织数据（包含 identityTags）
      const orgRef = doc(db, 'organizations', organizationId);
      const orgSnap = await getDoc(orgRef);
      const orgData = orgSnap.data();

      if (orgData && orgData.identityTags) {
        // 过滤激活的标签并按 displayOrder 排序
        const activeIdentityTags = orgData.identityTags
          .filter(tag => tag.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        setIdentityTags(activeIdentityTags);
      }

      // 2. 获取活动数据
      const eventRef = doc(
        db,
        'organizations', organizationId,
        'events', eventId
      );
      const eventSnap = await getDoc(eventRef);

      if (!eventSnap.exists()) {
        console.error('活动不存在');
        return;
      }

      setEventData(eventSnap.data());

      // 3. 获取部门列表（从组织而不是活动）
      const orgDepts = orgData?.departments || [];
      const activeDepts = orgDepts
        .filter(d => d.isActive !== false)
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

      setDepartments(activeDepts.map(d => d.name));

      // 构建部门排序映射
      const byId = {};
      const byName = {};
      activeDepts.forEach(dept => {
        byId[dept.id] = dept.displayOrder || 999;
        byName[dept.name] = dept.displayOrder || 999;
      });
      setDeptOrderMaps({ byId, byName });

      // 4. 获取用户列表
      const usersRef = collection(
        db,
        'organizations', organizationId,
        'events', eventId,
        'users'
      );
      const usersSnap = await getDocs(query(usersRef, orderBy('accountStatus.createdAt', 'desc')));

      const usersList = usersSnap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      setUsers(usersList);

    } catch (error) {
      console.error('获取数据失败:', error);
      alert('获取数据失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // 过滤用户
  const filterUsers = () => {
    let filtered = [...users];

    // 搜索过滤
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(user =>
        user.basicInfo?.chineseName?.toLowerCase().includes(search) ||
        user.basicInfo?.englishName?.toLowerCase().includes(search) ||
        user.basicInfo?.phoneNumber?.includes(search) ||
        user.identityInfo?.identityId?.toLowerCase().includes(search)
      );
    }

    // 部门排序
    filtered.sort((a, b) => {
      const orderA = deptOrderMaps.byName[a.identityInfo?.department] ?? 999;
      const orderB = deptOrderMaps.byName[b.identityInfo?.department] ?? 999;
      return orderA - orderB;
    });

    setFilteredUsers(filtered);
  };

  // 打开点数分配模态框
  const openPointsModal = (user) => {
    setSelectedUser(user);
    setPointsAmount('');
    setPointsNote('');
    setShowPointsModal(true);
  };

  // 打开点数回收模态框
  const openRecallModal = (user) => {
    setSelectedUser(user);
    setRecallAmount('');
    setRecallNote('');
    setShowRecallModal(true);
  };

  // 🔧 打开批量分配模态框（清空状态）
  const openBatchModal = () => {
    setSelectedIdentityTag([]);
    setBatchAmount('');
    setBatchNote('');
    setShowBatchModal(true);
  };

  // 点数分配
  const handleAllocatePoints = async () => {
    if (!pointsAmount || !selectedUser) {
      alert('请输入分配点数');
      return;
    }

    const points = parseInt(pointsAmount, 10);

    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }

    try {
      setIsProcessing(true);

      let roleType = null;
      if (selectedUser.roles?.includes('seller')) roleType = 'seller';
      else if (selectedUser.roles?.includes('customer')) roleType = 'customer';

      if (!roleType) {
        alert('用户没有可分配点数的角色');
        return;
      }

      const auth = getAuth();
      const idToken = await auth.currentUser.getIdToken();

      const resp = await safeFetch('/api/allocatePointsHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          userId: selectedUser.id,
          roleType,
          amount: points,
          note: pointsNote || ''
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || '分配失败');

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
    if (!recallAmount || !selectedUser) {
      alert('请输入回收点数');
      return;
    }

    const points = parseInt(recallAmount, 10);

    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }

    try {
      setIsProcessing(true);

      let roleType = null;
      if (selectedUser.roles?.includes('seller')) roleType = 'seller';
      else if (selectedUser.roles?.includes('customer')) roleType = 'customer';

      if (!roleType) {
        alert('用户没有可回收点数的角色');
        return;
      }

      const auth = getAuth();
      const idToken = await auth.currentUser.getIdToken();

      const resp = await safeFetch('/api/recallPointsHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          userId: selectedUser.id,
          roleType,
          amount: points,
          note: recallNote || ''
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data?.error || '回收失败');

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

  // 🔧 批量点数分配（修改为按 identityTag 过滤）
  const handleBatchAllocate = async () => {
    if (!selectedIdentityTag || selectedIdentityTag.length === 0 || !batchAmount) {
      alert('请选择至少一个身份标签并输入分配点数');
      return;
    }

    const points = parseInt(batchAmount, 10);

    if (isNaN(points) || points <= 0) {
      alert('请输入有效的点数（大于0）');
      return;
    }

    // 🔧 根据选择的 identityTag 过滤用户
    let targetUsers = users.filter(user =>
      user.roles?.some(role => ['seller', 'merchant', 'customer'].includes(role))
    );

    // 过滤多个 identityTag
    targetUsers = targetUsers.filter(user =>
      selectedIdentityTag.includes(user.identityTag) || selectedIdentityTag.includes('all')
    );

    if (targetUsers.length === 0) {
      const selectedTags = selectedIdentityTag.map(tagId => getIdentityTagInfo(tagId).label).join('、');
      alert(`身份标签 "${selectedTags}" 中没有可分配点数的用户`);
      return;
    }

    const totalPoints = points * targetUsers.length;
    const selectedTags = selectedIdentityTag.includes('all') 
      ? '全部身份' 
      : selectedIdentityTag.map(tagId => getIdentityTagInfo(tagId).label).join('、');

    if (!confirm(`确认为 ${targetUsers.length} 个用户各分配 ${points.toLocaleString()} 点数？\n身份标签: ${selectedTags}\n总计: ${totalPoints.toLocaleString()} 点数`)) {
      return;
    }

    try {
      setIsProcessing(true);

      const batch = writeBatch(db);
      const baseTimestamp = Date.now();

      targetUsers.forEach((user, index) => {
        let roleType = null;
        if (user.roles?.includes('seller')) roleType = 'seller';
        else if (user.roles?.includes('customer')) roleType = 'customer';

        if (roleType) {
          const timestampKey = (baseTimestamp + index).toString();
          const transaction = {
            type: 'allocation',
            amount: points,
            timestamp: serverTimestamp(),
            allocatedBy: 'eventManager',
            note: batchNote || `批量分配 - ${selectedTags}`
          };

          const userRef = doc(
            db,
            'organizations', organizationId,
            'events', eventId,
            'users', user.id
          );

          batch.update(userRef, {
            [`${roleType}.availablePoints`]: increment(points),
            [`${roleType}.transactions.${timestampKey}`]: transaction,
            'accountStatus.lastUpdated': serverTimestamp()
          });
        }
      });

      await batch.commit();

      alert(`成功为 ${targetUsers.length} 个用户批量分配点数！\n每人: ${points.toLocaleString()}\n总计: ${totalPoints.toLocaleString()}`);
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

  // 🆕 获取用户的点数信息
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

  // 🆕 根据 identityTag 获取用户数量
  const getUserCountByIdentityTag = (tagId) => {
    if (tagId === 'all') {
      return users.filter(user =>
        user.roles?.some(role => ['seller', 'customer'].includes(role))
      ).length;
    }

    return users.filter(user =>
      user.identityTag === tagId &&
      user.roles?.some(role => ['seller', 'customer'].includes(role))
    ).length;
  };

  // 🆕 获取 identityTag 的显示信息
  const getIdentityTagInfo = (tagId) => {
    if (tagId === 'all') {
      return { label: '全部身份', count: getUserCountByIdentityTag('all') };
    }

    const tag = identityTags.find(t => t.id === tagId);
    if (!tag) {
      return { label: tagId, count: 0 };
    }

    const zhName = tag.name['zh-CN'] || '';
    const enName = tag.name['en'] || tag.name['en-US'] || '';
    const label = `${zhName} (${enName})`;
    const count = getUserCountByIdentityTag(tagId);

    return { label, count };
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
          <h2 style={styles.title}>📊 点数管理</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 工具栏 */}
        <div style={styles.toolbar}>
          <input
            type="text"
            placeholder="搜索用户（姓名/电话/身份ID）..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={styles.searchInput}
          />
          <button onClick={openBatchModal} style={styles.batchButton}>
            💰 批量分配点数
          </button>
        </div>

        {/* 用户列表 */}
        <div style={styles.tableWrapper}>
          {filteredUsers.length === 0 ? (
            <div style={styles.emptyState}>
              {searchTerm ? '未找到匹配的用户' : '暂无用户数据'}
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
                  <th style={styles.tableHeaderCell}>现有点数</th>
                  <th style={styles.tableHeaderCell}>已销售点数</th>
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
                        {maskPhone(user.basicInfo?.phoneNumber)}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityTag || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityInfo?.department || '-'}
                      </td>
                      <td style={styles.tableCell}>
                        {user.identityInfo?.identityId || '-'}
                      </td>
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
                                {config.label}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td style={styles.tableCell}>
                        <span style={styles.pointsValue}>
                          {pointsInfo.availablePoints.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.tableCell}>
                        <span style={styles.pointsValue}>
                          {pointsInfo.totalPointsSold.toLocaleString()}
                        </span>
                      </td>
                      <td style={styles.tableCell}>
                        <div style={styles.actionButtons}>
                          <button
                            onClick={() => openPointsModal(user)}
                            style={styles.actionButton}
                            title="分配点数"
                          >
                            ➕
                          </button>
                          <button
                            onClick={() => openRecallModal(user)}
                            style={styles.actionButton}
                            title="回收点数"
                          >
                            ↩️
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

      {/* 点数分配模态框 */}
      {showPointsModal && selectedUser && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              分配点数 - {selectedUser.basicInfo?.chineseName}
            </h3>

            <div style={styles.pointsForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>分配点数 *</label>
                <input
                  type="number"
                  value={pointsAmount}
                  onChange={(e) => setPointsAmount(e.target.value)}
                  placeholder="输入分配点数"
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
              回收点数 - {selectedUser.basicInfo?.chineseName}
            </h3>

            <div style={styles.pointsForm}>
              <div style={styles.formGroup}>
                <label style={styles.label}>回收点数 *</label>
                <input
                  type="number"
                  value={recallAmount}
                  onChange={(e) => setRecallAmount(e.target.value)}
                  placeholder="输入回收点数"
                  style={styles.input}
                  min="0"
                  step="1"
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>备注</label>
                <textarea
                  value={recallNote}
                  onChange={(e) => setRecallNote(e.target.value)}
                  placeholder="输入回收备注（可选）"
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
                style={styles.saveButton}
                disabled={isProcessing}
              >
                {isProcessing ? '处理中...' : '确认回收'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🔧 批量分配模态框（修改为按 identityTag） */}
      {showBatchModal && (
        <div style={styles.subModal}>
          <div style={styles.subModalContent}>
            <h3 style={styles.subModalTitle}>
              批量分配点数
            </h3>

            <div style={styles.pointsForm}>
              {/* 🆕 身份标签选择 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>选择身份标签 *</label>
                <div style={styles.identityTagsContainer}>
                  {/* 全部身份选项 */}
                  <label style={styles.identityTagOption}>
                    <input
                      type="checkbox"
                      name="identityTag"
                      value="all"
                      checked={selectedIdentityTag.includes('all')}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIdentityTag(['all']);
                        } else {
                          setSelectedIdentityTag([]);
                        }
                      }}
                      style={styles.radio}
                    />
                    <div style={styles.identityTagLabel}>
                      <span style={styles.identityTagName}>全部身份</span>
                      <span style={styles.identityTagCount}>
                        ({getUserCountByIdentityTag('all')} 人)
                      </span>
                    </div>
                  </label>

                  {/* 动态 identityTags */}
                  {identityTags.map(tag => (
                    <label key={tag.id} style={styles.identityTagOption}>
                      <input
                        type="checkbox"
                        name="identityTag"
                        value={tag.id}
                        checked={selectedIdentityTag.includes(tag.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIdentityTag(prev => [...prev, tag.id]);
                          } else {
                            setSelectedIdentityTag(prev => prev.filter(id => id !== tag.id));
                          }
                        }}
                        style={styles.radio}
                      />
                      <div style={styles.identityTagLabel}>
                        <span style={styles.identityTagName}>
                          {tag.name['zh-CN'] || ''} ({tag.name['en'] || tag.name['en-US'] || ''})
                        </span>
                        <span style={styles.identityTagCount}>
                          ({getUserCountByIdentityTag(tag.id)} 人)
                        </span>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>分配点数 *</label>
                <input
                  type="number"
                  value={batchAmount}
                  onChange={(e) => setBatchAmount(e.target.value)}
                  placeholder="输入分配点数"
                  style={styles.input}
                  min="0"
                  step="1"
                />
              </div>

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

              <div style={styles.infoBox}>
                💡 将为选定身份标签的所有用户分配相同点数
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
    borderRadius: '12px',
    width: '95%',
    maxWidth: '1400px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
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
    justifyContent: 'center'
  },
  toolbar: {
    display: 'flex',
    gap: '1rem',
    padding: '1rem 1.5rem',
    borderBottom: '1px solid #e5e7eb',
    alignItems: 'center'
  },
  searchInput: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none'
  },
  batchButton: {
    padding: '0.75rem 1.5rem',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: 'white',
    backgroundColor: '#10b981',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  tableWrapper: {
    flex: 1,
    overflow: 'auto',
    padding: '1.5rem'
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
    fontSize: '1rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: 'white',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  emptyState: {
    textAlign: 'center',
    padding: '3rem',
    color: '#6b7280'
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #e5e7eb',
    borderTop: '4px solid #8b5cf6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  subModal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1100,
    padding: '1rem'
  },
  subModalContent: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    overflow: 'auto',
    padding: '2rem'
  },
  subModalTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: '1.5rem',
    paddingBottom: '1rem',
    borderBottom: '2px solid #e5e7eb'
  },
  pointsForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  input: {
    padding: '0.75rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none'
  },
  textarea: {
    padding: '0.75rem',
    fontSize: '0.875rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit'
  },
  radio: {
    width: '18px',
    height: '18px',
    marginRight: '0.75rem',
    cursor: 'pointer'
  },
  identityTagsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    maxHeight: '300px',
    overflowY: 'auto',
    padding: '0.5rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px'
  },
  identityTagOption: {
    display: 'flex',
    alignItems: 'center',
    padding: '0.75rem',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: 'white'
  },
  identityTagLabel: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    gap: '0.5rem'
  },
  identityTagName: {
    fontWeight: '500',
    color: '#374151',
    flex: 1
  },
  identityTagCount: {
    fontSize: '0.875rem',
    color: '#6b7280',
    fontWeight: '600'
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
  modalActions: {
    display: 'flex',
    gap: '1rem',
    marginTop: '1.5rem',
    paddingTop: '1.5rem',
    borderTop: '1px solid #e5e7eb'
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

export default PointsManagement;