import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, query, where, deleteDoc, getDoc } from 'firebase/firestore';
import { Table, Button, Space, Card, Modal, Form, Input, Select, message, Spin } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';

const { Option } = Select;

// 根據 identityTag 獲取中文身份名稱
const getIdentityName = (identityTag) => {
  const identityMap = {
    'staff': '教職工',
    'student': '學生',
    'teacher': '教師',
    'admin': '管理員',
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
  };
  return identityMap[identityTag] || identityTag;
};

function PlatformDashboard() {
  const { organizationId } = useParams();
  const navigate = useNavigate();

  const [organization, setOrganization] = useState(null);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();

  useEffect(() => {
    if (organizationId) {
      fetchOrganization();
      fetchEvents();
      fetchUsers();
    }
  }, [organizationId]);

  const fetchOrganization = async () => {
    try {
      const orgDoc = await getDoc(doc(db, 'organizations', organizationId));
      if (orgDoc.exists()) {
        setOrganization({ id: orgDoc.id, ...orgDoc.data() });
      }
    } catch (error) {
      console.error('獲取組織信息失敗:', error);
      message.error('獲取組織信息失敗');
    }
  };

  const fetchEvents = async () => {
    try {
      const eventsRef = collection(db, 'organizations', organizationId, 'events');
      const querySnapshot = await getDocs(eventsRef);
      const eventsData = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      setEvents(eventsData);
    } catch (error) {
      console.error('獲取活動列表失敗:', error);
      message.error('獲取活動列表失敗');
    }
  };

  const fetchUsers = async () => {
    try {
      setIsLoading(true);
      const usersRef = collection(db, 'organizations', organizationId, 'events');
      const eventsSnapshot = await getDocs(usersRef);
      
      let allUsers = [];
      for (const eventDoc of eventsSnapshot.docs) {
        const usersSnapshot = await getDocs(
          collection(db, 'organizations', organizationId, 'events', eventDoc.id, 'users')
        );
        usersSnapshot.docs.forEach((userDoc) => {
          allUsers.push({
            id: userDoc.id,
            eventId: eventDoc.id,
            ...userDoc.data(),
          });
        });
      }
      setUsers(allUsers);
    } catch (error) {
      console.error('獲取用戶列表失敗:', error);
      message.error('獲取用戶列表失敗');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddUser = async (values) => {
    try {
      const { identityId, identityTag, phoneNumber, englishName, chineseName, department, email } = values;

      // 檢查是否已存在
      const existingUsers = users.filter(u => u.identityInfo?.identityId === identityId);

      if (existingUsers.length > 0) {
        message.error('該身份證號已存在');
        return;
      }

      // 創建完整的用戶數據，包含 identityInfo 對象
      const newUser = {
        basicInfo: {
          phoneNumber,
          englishName,
          chineseName: chineseName || '',
          email: email || '',
        },
        identityTag,
        identityInfo: {
          identityId,
          identityTag,
          identityName: getIdentityName(identityTag),
          identityNameEn: getIdentityNameEn(identityTag),
          department: department || "",
        },
        roles: ['user'],
        status: 'active',
        createdAt: serverTimestamp(),
      };

      // 添加到第一個事件下（如果有的話）
      if (events.length > 0) {
        const eventId = events[0].id;
        await addDoc(
          collection(db, 'organizations', organizationId, 'events', eventId, 'users'),
          newUser
        );
      }

      message.success('用戶添加成功');
      setIsAddModalVisible(false);
      addForm.resetFields();
      fetchUsers();
    } catch (error) {
      console.error('添加用戶失敗:', error);
      message.error('添加用戶失敗');
    }
  };

  const handleEditUser = async (values) => {
    try {
      const { identityId, identityTag, phoneNumber, englishName, chineseName, department, email } = values;

      const updateData = {
        basicInfo: {
          phoneNumber,
          englishName,
          chineseName: chineseName || '',
          email: email || '',
        },
        identityTag,
        identityInfo: {
          identityId,
          identityTag,
          identityName: getIdentityName(identityTag),
          identityNameEn: getIdentityNameEn(identityTag),
          department: department || "",
        },
      };

      const userDocRef = doc(
        db,
        'organizations',
        organizationId,
        'events',
        editingUser.eventId,
        'users',
        editingUser.id
      );
      await updateDoc(userDocRef, updateData);

      message.success('用戶信息更新成功');
      setIsEditModalVisible(false);
      setEditingUser(null);
      editForm.resetFields();
      fetchUsers();
    } catch (error) {
      console.error('更新用戶失敗:', error);
      message.error('更新用戶失敗');
    }
  };

  const handleDeleteUser = async (userId, eventId) => {
    Modal.confirm({
      title: '確認刪除',
      content: '確定要刪除這個用戶嗎？此操作不可恢復。',
      okText: '確認',
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDoc(
            doc(
              db,
              'organizations',
              organizationId,
              'events',
              eventId,
              'users',
              userId
            )
          );
          message.success('用戶刪除成功');
          fetchUsers();
        } catch (error) {
          console.error('刪除用戶失敗:', error);
          message.error('刪除用戶失敗');
        }
      },
    });
  };

  const showEditModal = (user) => {
    setEditingUser(user);
    editForm.setFieldsValue({
      identityId: user.identityInfo?.identityId,
      identityTag: user.identityTag,
      phoneNumber: user.basicInfo?.phoneNumber,
      englishName: user.basicInfo?.englishName,
      chineseName: user.basicInfo?.chineseName,
      email: user.basicInfo?.email,
      department: user.identityInfo?.department,
    });
    setIsEditModalVisible(true);
  };

  const userColumns = [
    {
      title: '身份證號',
      dataIndex: ['identityInfo', 'identityId'],
      key: 'identityId',
    },
    {
      title: '身份標籤',
      dataIndex: 'identityTag',
      key: 'identityTag',
    },
    {
      title: '電話號碼',
      dataIndex: ['basicInfo', 'phoneNumber'],
      key: 'phoneNumber',
    },
    {
      title: '英文名稱',
      dataIndex: ['basicInfo', 'englishName'],
      key: 'englishName',
    },
    {
      title: '中文名稱',
      dataIndex: ['basicInfo', 'chineseName'],
      key: 'chineseName',
    },
    {
      title: '部門',
      dataIndex: ['identityInfo', 'department'],
      key: 'department',
      render: (text) => text || '-',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <Button type="link" onClick={() => showEditModal(record)}>
            編輯
          </Button>
          <Button type="link" danger onClick={() => handleDeleteUser(record.id, record.eventId)}>
            刪除
          </Button>
        </Space>
      ),
    },
  ];

  const eventColumns = [
    {
      title: '活動代碼',
      dataIndex: 'eventCode',
      key: 'eventCode',
    },
    {
      title: '活動名稱',
      dataIndex: ['eventName', 'zh-CN'],
      key: 'eventName',
    },
    {
      title: '活動名稱（英文）',
      dataIndex: ['eventName', 'en'],
      key: 'eventNameEn',
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <Button
            type="link"
            onClick={() => navigate(`/platform/${organizationId}/event/${record.id}`)}
          >
            管理
          </Button>
        </Space>
      ),
    },
  ];

  if (!organization) {
    return <Spin />;
  }

  return (
    <div style={{ padding: '24px' }}>
      <Card title={`平台管理 - ${organization?.orgName?.['zh-CN'] || '加載中...'}`}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 活動列表 */}
          <Card title="活動列表" type="inner">
            <Table columns={eventColumns} dataSource={events} rowKey="id" />
          </Card>

          {/* 用戶列表 */}
          <Card
            title="用戶列表"
            type="inner"
            extra={
              <Button type="primary" onClick={() => setIsAddModalVisible(true)}>
                添加用戶
              </Button>
            }
          >
            <Table
              columns={userColumns}
              dataSource={users}
              rowKey="id"
              loading={isLoading}
            />
          </Card>
        </Space>
      </Card>

      {/* 添加用戶模態框 */}
      <Modal
        title="添加用戶"
        open={isAddModalVisible}
        onCancel={() => {
          setIsAddModalVisible(false);
          addForm.resetFields();
        }}
        footer={null}
      >
        <Form form={addForm} onFinish={handleAddUser} layout="vertical">
          <Form.Item
            label="身份證號"
            name="identityId"
            rules={[{ required: true, message: '請輸入身份證號' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="身份標籤"
            name="identityTag"
            rules={[{ required: true, message: '請選擇身份標籤' }]}
          >
            <Select>
              <Option value="staff">教職工</Option>
              <Option value="student">學生</Option>
              <Option value="teacher">教師</Option>
              <Option value="admin">管理員</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="電話號碼"
            name="phoneNumber"
            rules={[{ required: true, message: '請輸入電話號碼' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="英文名稱"
            name="englishName"
            rules={[{ required: true, message: '請輸入英文名稱' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="中文名稱"
            name="chineseName"
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="電子郵箱"
            name="email"
          >
            <Input type="email" />
          </Form.Item>

          <Form.Item
            label="部門"
            name="department"
          >
            <Input />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                添加
              </Button>
              <Button
                onClick={() => {
                  setIsAddModalVisible(false);
                  addForm.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 編輯用戶模態框 */}
      <Modal
        title="編輯用戶"
        open={isEditModalVisible}
        onCancel={() => {
          setIsEditModalVisible(false);
          setEditingUser(null);
          editForm.resetFields();
        }}
        footer={null}
      >
        <Form form={editForm} onFinish={handleEditUser} layout="vertical">
          <Form.Item
            label="身份證號"
            name="identityId"
            rules={[{ required: true, message: '請輸入身份證號' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="身份標籤"
            name="identityTag"
            rules={[{ required: true, message: '請選擇身份標籤' }]}
          >
            <Select>
              <Option value="staff">教職工</Option>
              <Option value="student">學生</Option>
              <Option value="teacher">教師</Option>
              <Option value="admin">管理員</Option>
            </Select>
          </Form.Item>

          <Form.Item
            label="電話號碼"
            name="phoneNumber"
            rules={[{ required: true, message: '請輸入電話號碼' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="英文名稱"
            name="englishName"
            rules={[{ required: true, message: '請輸入英文名稱' }]}
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="中文名稱"
            name="chineseName"
          >
            <Input />
          </Form.Item>

          <Form.Item
            label="電子郵箱"
            name="email"
          >
            <Input type="email" />
          </Form.Item>

          <Form.Item
            label="部門"
            name="department"
          >
            <Input />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                保存
              </Button>
              <Button
                onClick={() => {
                  setIsEditModalVisible(false);
                  setEditingUser(null);
                  editForm.resetFields();
                }}
              >
                取消
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default PlatformDashboard;
