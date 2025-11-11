import React, { useState, useEffect } from 'react';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

const DepartmentManagement = ({ organizationId, eventId }) => {
  const [departments, setDepartments] = useState([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [draggedItem, setDraggedItem] = useState(null);

  const auth = getAuth();
  const db = getFirestore();

  // 实时监听部门数据
  useEffect(() => {
    if (!organizationId) return;

    const orgRef = doc(db, 'organizations', organizationId);
    const unsubscribe = onSnapshot(orgRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const depts = data.departments || [];
        setDepartments(depts.sort((a, b) => a.displayOrder - b.displayOrder));
      }
    });

    return () => unsubscribe();
  }, [organizationId, db]);

  const showMessage = (text, type = 'info') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3000);
  };

  const handleAddDepartment = async () => {
    if (!newDeptName.trim()) {
      showMessage('请输入部门名称', 'error');
      return;
    }

    setLoading(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          organizationId,
          departmentName: newDeptName.trim(),
          idToken
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        showMessage(result.message || '部门添加成功', 'success');
        setNewDeptName('');
      } else {
        showMessage(result.error || '添加失败', 'error');
      }
    } catch (error) {
      console.error('添加部门失败:', error);
      showMessage('添加部门失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleRecount = async () => {
    setLoading(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recount',
          organizationId,
          eventId, // 可選：若提供則只重算該活動
          idToken
        })
      });
      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || '部门人数已重新统计', 'success');
      } else {
        showMessage(result.error || '重新统计失败', 'error');
      }
    } catch (e) {
      console.error('重新统计失败:', e);
      showMessage('重新统计失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDepartment = async (deptId, deptName, userCount) => {
    const confirmMsg = userCount > 0
      ? `部门"${deptName}"还有 ${userCount} 位用户，确定要删除吗？\n删除后这些用户的部门信息将被清空。`
      : `确定要删除部门"${deptName}"吗？`;

    if (!window.confirm(confirmMsg)) return;

    setLoading(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          organizationId,
          departmentId: deptId,
          idToken
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        showMessage(result.message || '部门删除成功', 'success');
      } else {
        showMessage(result.error || '删除失败', 'error');
      }
    } catch (error) {
      console.error('删除部门失败:', error);
      showMessage('删除部门失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedItem(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedItem === null || draggedItem === index) return;

    const newDepts = [...departments];
    const draggedDept = newDepts[draggedItem];
    
    // 移除拖拽项
    newDepts.splice(draggedItem, 1);
    // 插入到新位置
    newDepts.splice(index, 0, draggedDept);
    
    // 更新 displayOrder
    const updatedDepts = newDepts.map((dept, idx) => ({
      ...dept,
      displayOrder: idx + 1
    }));
    
    setDepartments(updatedDepts);
    setDraggedItem(index);
  };

  const handleDragEnd = async () => {
    if (draggedItem === null) return;

    setLoading(true);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder',
          organizationId,
          reorderedDepartments: departments,
          idToken
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        showMessage(result.message || '排序更新成功', 'success');
      } else {
        showMessage(result.error || '排序更新失败', 'error');
      }
    } catch (error) {
      console.error('更新排序失败:', error);
      showMessage('更新排序失败', 'error');
    } finally {
      setLoading(false);
      setDraggedItem(null);
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2>部门管理</h2>

      {/* 消息提示 */}
      {message.text && (
        <div
          style={{
            padding: '10px',
            marginBottom: '15px',
            borderRadius: '4px',
            backgroundColor: message.type === 'error' ? '#ffebee' : message.type === 'success' ? '#e8f5e9' : '#e3f2fd',
            color: message.type === 'error' ? '#c62828' : message.type === 'success' ? '#2e7d32' : '#1565c0',
            border: `1px solid ${message.type === 'error' ? '#ef5350' : message.type === 'success' ? '#66bb6a' : '#42a5f5'}`
          }}
        >
          {message.text}
        </div>
      )}

      {/* 添加新部门 */}
      <div style={{ marginBottom: '30px', display: 'flex', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          value={newDeptName}
          onChange={(e) => setNewDeptName(e.target.value)}
          placeholder="输入新部门名称"
          disabled={loading}
          onKeyPress={(e) => e.key === 'Enter' && handleAddDepartment()}
          style={{
            padding: '8px 12px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            fontSize: '14px',
            flex: 1,
            maxWidth: '300px'
          }}
        />
        <button
          onClick={handleAddDepartment}
          disabled={loading || !newDeptName.trim()}
          style={{
            padding: '8px 20px',
            backgroundColor: '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading || !newDeptName.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            opacity: loading || !newDeptName.trim() ? 0.6 : 1
          }}
        >
          {loading ? '添加中...' : '添加部门'}
        </button>
        <button
          onClick={handleRecount}
          disabled={loading}
          title="根据用户资料重新统计部门人数"
          style={{
            padding: '8px 20px',
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            opacity: loading ? 0.6 : 1
          }}
        >
          {loading ? '处理中...' : '重新统计'}
        </button>
      </div>

      {/* 部门列表 */}
      <div style={{ fontSize: '13px', color: '#666', marginBottom: '10px' }}>
        💡 提示：拖动行可以调整部门显示顺序
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd' }}>
        <thead>
          <tr style={{ backgroundColor: '#f5f5f5' }}>
            <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd', width: '60px' }}>排序</th>
            <th style={{ padding: '12px', textAlign: 'left', border: '1px solid #ddd' }}>部门名称</th>
            <th style={{ padding: '12px', textAlign: 'center', border: '1px solid #ddd', width: '100px' }}>用户数</th>
            <th style={{ padding: '12px', textAlign: 'center', border: '1px solid #ddd', width: '100px' }}>创建方式</th>
            <th style={{ padding: '12px', textAlign: 'center', border: '1px solid #ddd', width: '100px' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {departments.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ padding: '20px', textAlign: 'center', color: '#999' }}>
                暂无部门数据，请添加新部门
              </td>
            </tr>
          ) : (
            departments.map((dept, index) => (
              <tr
                key={dept.id}
                draggable={!loading}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                style={{
                  backgroundColor: draggedItem === index ? '#e3f2fd' : 'white',
                  cursor: loading ? 'not-allowed' : 'move',
                  opacity: draggedItem === index ? 0.5 : 1
                }}
              >
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  {dept.displayOrder}
                </td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>
                  {dept.name}
                </td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  {dept.userCount || 0}
                </td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  {dept.createdBy === 'system' ? '自动' : '手动'}
                </td>
                <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                  <button
                    onClick={() => handleDeleteDepartment(dept.id, dept.name, dept.userCount)}
                    disabled={loading}
                    style={{
                      padding: '5px 15px',
                      backgroundColor: '#d32f2f',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      fontSize: '13px',
                      opacity: loading ? 0.6 : 1
                    }}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <div style={{ marginTop: '15px', fontSize: '13px', color: '#666' }}>
        <p>说明：</p>
        <ul style={{ paddingLeft: '20px', margin: '5px 0' }}>
          <li>自动创建：在新增或批量导入用户时，系统自动提取的部门</li>
          <li>手动创建：由管理员手动添加的部门</li>
          <li>删除部门时，该部门下所有用户的部门信息将被清空</li>
        </ul>
      </div>
    </div>
  );
};

export default DepartmentManagement;