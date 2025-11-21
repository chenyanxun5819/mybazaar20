import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Table, Button, Modal, message, Card, Spin } from 'antd';
import { useParams } from 'react-router-dom';

const AssignEventManager = ({ onClose, onSuccess }) => {
  const { organizationId, eventId } = useParams();
  const [availableUsers, setAvailableUsers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);

  useEffect(() => {
    if (organizationId && eventId) {
      fetchAvailableUsers();
    }
  }, [organizationId, eventId]);

  // 根據 identityTag 獲取中文身份名稱
  const getIdentityName = (identityTag) => {
    const identityMap = {
      'staff': '教職工',
      'student': '學生',
      'teacher': '教師',
      'admin': '管理員',
      'parent': '家長',
      'board': '董事會',
    };
    return identityMap[identityTag] || identityTag;
  };

  // 根據 identityTag 獲取英文身份名稱
  const getIdentityNameEn = (identityTag) => {
    const identityMap = {
      'staff': 'Staff',
      'student': 'Student',
      'teacher': 'Teacher',
      'admin': 'Admin',
      'parent': 'Parent',
      'board': 'Board Member',
    };
    return identityMap[identityTag] || identityTag;
  };

  const fetchAvailableUsers = async () => {
    try {
      setIsLoading(true);
      
      // 查詢所有身份為 staff 或 teacher 的用戶（這些是可以成為 Manager 的身份）
      const usersRef = collection(db, 'organizations', organizationId, 'events', eventId, 'users');
      const q = query(usersRef, where('identityTag', 'in', ['staff', 'teacher']));
      const snapshot = await getDocs(q);
      
      const users = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          key: doc.id,
          id: doc.id,
          englishName: data.basicInfo?.englishName || '',
          chineseName: data.basicInfo?.chineseName || '',
          phoneNumber: data.basicInfo?.phoneNumber || '',
          identityTag: data.identityTag || '',
          identityId: data.identityInfo?.identityId || '',
          department: data.identityInfo?.department || '',
          identityName: data.identityInfo?.identityName || getIdentityName(data.identityTag),
          identityNameEn: data.identityInfo?.identityNameEn || getIdentityNameEn(data.identityTag),
          email: data.basicInfo?.email || '',
          ...data,
        };
      });

      setAvailableUsers(users);
    } catch (error) {
      console.error('獲取可用用戶失敗:', error);
      message.error('獲取可用用戶失敗');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!selectedUser) {
      message.error('請選擇要分配的用戶');
      return;
    }

    try {
      setIsLoading(true);
      
      // 更新用戶文檔，添加 identityInfo（確保完整）
      const userRef = doc(db, 'organizations', organizationId, 'events', eventId, 'users', selectedUser.id);
      
      await updateDoc(userRef, {
        identityInfo: {
          identityId: selectedUser.identityId || '',
          identityTag: selectedUser.identityTag || '',
          department: selectedUser.department || '',
          identityName: selectedUser.identityName || getIdentityName(selectedUser.identityTag),
          identityNameEn: selectedUser.identityNameEn || getIdentityNameEn(selectedUser.identityTag),
        },
        roles: ['eventManager'],
        updatedAt: serverTimestamp(),
      });

      message.success('分配成功');
      setIsModalVisible(false);
      setSelectedUser(null);
      
      if (onSuccess) {
        onSuccess();
      } else {
        fetchAvailableUsers();
      }
    } catch (error) {
      console.error('分配失敗:', error);
      message.error('分配失敗: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const columns = [
    {
      title: '姓名',
      dataIndex: 'chineseName',
      key: 'chineseName',
      render: (text, record) => (
        <div>
          <strong>{record.chineseName || '-'}</strong>
          <div style={{ fontSize: '0.85em', color: '#999' }}>
            {record.englishName}
          </div>
        </div>
      ),
    },
    {
      title: '手機號',
      dataIndex: 'phoneNumber',
      key: 'phoneNumber',
    },
    {
      title: '身份',
      dataIndex: 'identityName',
      key: 'identityName',
      render: (text, record) => record.identityName || record.identityTag || '-',
    },
    {
      title: '部門',
      dataIndex: 'department',
      key: 'department',
    },
    {
      title: '工號',
      dataIndex: 'identityId',
      key: 'identityId',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Button
          type="primary"
          onClick={() => {
            setSelectedUser(record);
            setIsModalVisible(true);
          }}
        >
          分配
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '20px' }}>
      <Card title="選擇用戶分配為 Event Manager">
        <Spin spinning={isLoading}>
          <Table
            columns={columns}
            dataSource={availableUsers}
            rowKey="id"
            pagination={{ pageSize: 10 }}
          />
        </Spin>
      </Card>

      <Modal
        title="確認分配"
        open={isModalVisible}
        onOk={handleAssign}
        onCancel={() => {
          setIsModalVisible(false);
          setSelectedUser(null);
        }}
        confirmLoading={isLoading}
      >
        {selectedUser && (
          <div>
            <p><strong>姓名：</strong>{selectedUser.chineseName || selectedUser.englishName}</p>
            <p><strong>手機號：</strong>{selectedUser.phoneNumber}</p>
            <p><strong>身份：</strong>{selectedUser.identityName}</p>
            <p><strong>部門：</strong>{selectedUser.department || '-'}</p>
            <p><strong>工號：</strong>{selectedUser.identityId || '-'}</p>
            <p style={{ color: 'red' }}>確定要將此用戶分配為 Event Manager 嗎？</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AssignEventManager;
