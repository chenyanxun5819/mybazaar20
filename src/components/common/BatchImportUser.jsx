import { useState } from 'react';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import { collection, doc, setDoc, serverTimestamp, updateDoc, increment, getDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { safeFetch } from '../../services/safeFetch';

const BatchImportUser = ({ organizationId, eventId, onClose, onSuccess }) => {
  const [importMode, setImportMode] = useState('upload');
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState([]);

  const styles = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '1rem'
    },
    modalContainer: {
      backgroundColor: 'white',
      borderRadius: '12px',
      width: '100%',
      maxWidth: '1200px',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
    },
    header: {
      padding: '1.5rem',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    headerTitle: {
      fontSize: '1.25rem',
      fontWeight: 'bold',
      color: '#111827',
      margin: 0
    },
    closeButton: {
      background: 'none',
      border: 'none',
      fontSize: '1.5rem',
      color: '#6b7280',
      cursor: 'pointer',
      padding: '0.25rem',
      lineHeight: 1
    },
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: '1.5rem'
    },
    button: {
      flex: 1,
      padding: '0.75rem 1.5rem',
      borderRadius: '8px',
      fontWeight: '500',
      cursor: 'pointer',
      border: 'none',
      transition: 'all 0.2s'
    },
    buttonPrimary: {
      backgroundColor: '#3b82f6',
      color: 'white'
    },
    buttonSuccess: {
      backgroundColor: '#10b981',
      color: 'white'
    },
    buttonGray: {
      backgroundColor: '#6b7280',
      color: 'white'
    },
    infoBox: {
      backgroundColor: '#eff6ff',
      border: '1px solid #bfdbfe',
      borderRadius: '8px',
      padding: '1rem',
      marginBottom: '1.5rem'
    },
    infoTitle: {
      fontWeight: '500',
      color: '#1e3a8a',
      marginBottom: '0.5rem'
    },
    infoList: {
      fontSize: '0.875rem',
      color: '#1e40af',
      margin: 0,
      paddingLeft: '1.25rem'
    },
    uploadArea: {
      border: '2px dashed #d1d5db',
      borderRadius: '8px',
      padding: '2rem',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'border-color 0.2s'
    },
    topActions: {
      display: 'flex',
      gap: '1rem',
      padding: '1rem',
      backgroundColor: '#f9fafb',
      borderRadius: '8px',
      marginBottom: '1.5rem',
      position: 'sticky',
      top: 0,
      zIndex: 10
    },
    statsBox: {
      backgroundColor: '#f0fdf4',
      border: '1px solid #86efac',
      borderRadius: '8px',
      padding: '1rem',
      marginBottom: '1rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
    },
    statsText: {
      fontSize: '1rem',
      fontWeight: '600',
      color: '#166534'
    }
  };

  // ✅ 智能识别 Excel 列顺序
  const detectColumnMapping = (headers) => {
    console.log('[BatchImportUser] 检测到的表头:', headers);
    
    const mapping = {};
    
    // 标准化表头（去除空格、星号、转小写）
    const normalizeHeader = (h) => {
      if (!h) return '';
      return String(h).replace(/[*\s]/g, '').toLowerCase();
    };
    
    headers.forEach((header, index) => {
      const normalized = normalizeHeader(header);
      
      // 匹配各个字段
      if (normalized.includes('英文名') || normalized.includes('englishname')) {
        mapping.englishName = index;
      } else if (normalized.includes('中文名') || normalized.includes('chinesename')) {
        mapping.chineseName = index;
      } else if (normalized.includes('学号') || normalized.includes('工号') || normalized.includes('identityid')) {
        mapping.identityId = index;
      } else if (normalized.includes('电话') || normalized.includes('手机') || normalized.includes('phone')) {
        mapping.phoneNumber = index;
      } else if (normalized.includes('部门') || normalized.includes('department')) {
        mapping.department = index;
      } else if (normalized.includes('邮箱') || normalized.includes('email')) {
        mapping.email = index;
      } else if (normalized.includes('身份') || normalized.includes('标签') || normalized.includes('tag')) {
        mapping.identityTag = index;
      }
    });
    
    console.log('[BatchImportUser] 列映射:', mapping);
    return mapping;
  };

  // ✅ 电话号码规范化
  const normalizePhoneNumber = (phone) => {
    if (!phone) return '';
    let cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.startsWith('60')) cleaned = cleaned.substring(2);
    if (!cleaned.startsWith('0')) cleaned = '0' + cleaned;
    return cleaned;
  };

  // ✅ 电话号码验证
  const validatePhoneNumber = (phone) => {
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return { valid: false, error: '缺少电话号码' };
    if (!/^0\d{8,10}$/.test(normalized)) {
      return { 
        valid: false, 
        error: `电话号码格式不正确 (${normalized})` 
      };
    }
    return { valid: true, normalized };
  };

  const downloadTemplate = () => {
    const instructionsData = [
      ['批量导入用户 - 使用说明'],
      [''],
      ['字段说明：'],
      ['字段名', '是否必填', '说明', '示例'],
      ['部门*', '必填', '用户所属部门', '1年A班'],
      ['学号/工号', '可选', '组织发放的学号、工号', '2024001'],
      ['英文名*', '必填', '用户的英文姓名', 'John Doe'],
      ['中文名', '可选', '用户的中文姓名', '张三'],
      ['电话号码*', '必填', '马来西亚手机号码', '0123456789'],
      ['身份标签*', '必填', 'student/teacher/staff/parent', 'student'],
      [''],
      ['重要提示：'],
      ['1. 必填字段不能为空'],
      ['2. 电话号码支持多种格式'],
      ['3. 支持任意列顺序，自动识别']
    ];

    const instructionsWS = XLSX.utils.aoa_to_sheet(instructionsData);
    instructionsWS['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 50 },
      { wch: 25 }
    ];

    // ✅ 使用您的格式：部门、学号/工号、英文名、中文名、电话号码、身份标签
    const userData = [
      ['部门*', '学号/工号', '英文名*', '中文名', '电话号码*', '身份标签*'],
      ['1年A班', '2024001', 'John Doe', '张三', '0123456789', 'student'],
      ['行政部', 'T2024001', 'Jane Smith', '李四', '0198765432', 'teacher'],
      ['', '', '', '', '', ''],
    ];

    const dataWS = XLSX.utils.aoa_to_sheet(userData);
    dataWS['!cols'] = [
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 }
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, instructionsWS, '使用说明');
    XLSX.utils.book_append_sheet(wb, dataWS, '用户数据');
    XLSX.writeFile(wb, '批量导入用户模板.xlsx');
  };

  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheetName = workbook.SheetNames[0]; // ✅ 使用第一个工作表
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        if (jsonData.length < 2) {
          alert('Excel 文件格式不正确，至少需要表头和一行数据');
          return;
        }

        // ✅ 智能识别列顺序
        const headers = jsonData[0];
        const mapping = detectColumnMapping(headers);
        
        // 检查必填字段是否存在
        const requiredFields = ['englishName', 'phoneNumber', 'department', 'identityTag'];
        const missingFields = requiredFields.filter(field => mapping[field] === undefined);
        
        if (missingFields.length > 0) {
          alert(`Excel 文件缺少必填列: ${missingFields.join(', ')}\n请检查表头是否正确`);
          console.error('[BatchImportUser] 缺少字段:', missingFields);
          console.error('[BatchImportUser] 检测到的表头:', headers);
          return;
        }

        const rows = jsonData.slice(1);

        // ✅ 使用映射读取数据
        const users = rows
          .map(row => ({
            englishName: mapping.englishName !== undefined ? (row[mapping.englishName] || '') : '',
            chineseName: mapping.chineseName !== undefined ? (row[mapping.chineseName] || '') : '',
            identityId: mapping.identityId !== undefined ? (row[mapping.identityId] || '') : '',
            phoneNumber: mapping.phoneNumber !== undefined ? (row[mapping.phoneNumber] || '') : '',
            department: mapping.department !== undefined ? (row[mapping.department] || '') : '',
            email: mapping.email !== undefined ? (row[mapping.email] || '') : '',
            identityTag: mapping.identityTag !== undefined ? (row[mapping.identityTag] || 'student') : 'student'
          }))
          .filter(user => user.englishName || user.phoneNumber);

        console.log('[BatchImportUser] 解析的用户数据:', users.slice(0, 3));

        // ✅ 验证数据
        const validatedUsers = users.map(user => {
          const errors = [];
          
          if (!user.englishName) errors.push('缺少英文名');
          
          const phoneValidation = validatePhoneNumber(user.phoneNumber);
          if (!phoneValidation.valid) {
            errors.push(phoneValidation.error);
          } else {
            user.phoneNumber = phoneValidation.normalized;
          }
          
          if (!user.department) errors.push('缺少部门');
          if (!['student', 'teacher', 'staff', 'parent'].includes(user.identityTag)) {
            errors.push('身份标签不正确');
          }

          return { ...user, errors };
        });

        setPreviewData(validatedUsers);
        setShowPreview(true);
        setErrors(validatedUsers.filter(u => u.errors.length > 0));
      } catch (error) {
        console.error('文件解析失败:', error);
        alert('文件格式不正确，请使用提供的模板');
      }
    };

    reader.readAsArrayBuffer(uploadedFile);
  };

  const handleImportUsers = async () => {
    if (errors.length > 0) {
      alert('请先修正所有错误');
      return;
    }

    try {
      setImporting(true);

      const auth = getAuth();
      const idToken = await auth.currentUser.getIdToken();

      const orgDoc = await getDoc(doc(db, 'organizations', organizationId));
      const eventDoc = await getDoc(doc(db, 'organizations', organizationId, 'events', eventId));
      
      const orgCode = orgDoc.exists() ? (orgDoc.data().orgCode || orgDoc.data().organizationCode || organizationId) : organizationId;
      const eventCode = eventDoc.exists() ? (eventDoc.data().eventCode || eventDoc.data().code || eventId) : eventId;
      
      let defaultPassword = `${orgCode}${eventCode}`;
      if (defaultPassword.length < 8 || !(/[a-zA-Z]/.test(defaultPassword) && /\d/.test(defaultPassword))) {
        defaultPassword = `${defaultPassword}Ab12`;
      }

      console.log('[BatchImportUser] 默认密码:', defaultPassword);

      const response = await safeFetch('/api/batchImportUsersHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          users: previewData.map(user => ({
            englishName: user.englishName,
            chineseName: user.chineseName || '',
            identityId: user.identityId || '',
            phoneNumber: user.phoneNumber,
            password: defaultPassword,
            department: user.department,
            email: user.email || '',
            identityTag: user.identityTag,
            roles: ['seller', 'customer']
          }))
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '导入失败');
      }

      const result = await response.json();
      const imported = typeof result.imported === 'number' ? result.imported : (result.successCount || 0);
      alert(`成功导入 ${imported} 位用户`);
      
      if (onSuccess) {
        onSuccess();
      }
      
      onClose();

    } catch (error) {
      console.error('批量导入失败:', error);
      alert(`导入失败: ${error.message}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modalContainer}>
        <div style={styles.header}>
          <h2 style={styles.headerTitle}>批量导入用户</h2>
          <button
            onClick={onClose}
            style={styles.closeButton}
            onMouseEnter={(e) => e.target.style.color = '#111827'}
            onMouseLeave={(e) => e.target.style.color = '#6b7280'}
          >
            ✕
          </button>
        </div>

        <div style={styles.content}>
          {!showPreview ? (
            <div>
              <div style={styles.infoBox}>
                <h3 style={styles.infoTitle}>📋 使用说明</h3>
                <ul style={styles.infoList}>
                  <li>下载 Excel 模板，按格式填写用户信息</li>
                  <li>必填字段：部门、英文名、电话号码、身份标签</li>
                  <li>支持任意列顺序，系统会自动识别</li>
                  <li>电话号码支持多种格式</li>
                  <li>所有导入的用户将自动获得 Seller + Customer 角色</li>
                </ul>
              </div>

              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <button
                  onClick={downloadTemplate}
                  style={{ ...styles.button, ...styles.buttonSuccess }}
                >
                  📥 下载 Excel 模板
                </button>
              </div>

              <div style={styles.uploadArea}>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  style={{ display: 'none' }}
                  id="file-upload"
                />
                <label htmlFor="file-upload" style={{ cursor: 'pointer', display: 'block' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: '500', color: '#374151', marginBottom: '0.5rem' }}>
                    {file ? file.name : '点击选择 Excel 文件'}
                  </div>
                  <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    支持 .xlsx 和 .xls 格式
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div>
              <div style={styles.topActions}>
                <button
                  onClick={() => {
                    setShowPreview(false);
                    setErrors([]);
                  }}
                  style={{ ...styles.button, ...styles.buttonGray }}
                  disabled={importing}
                >
                  ⬅️ 返回修改
                </button>
                <button
                  onClick={handleImportUsers}
                  disabled={importing || errors.length > 0}
                  style={{
                    ...styles.button,
                    ...(importing || errors.length > 0 
                      ? { backgroundColor: '#d1d5db', color: '#6b7280', cursor: 'not-allowed' }
                      : styles.buttonPrimary)
                  }}
                >
                  {importing ? '⏳ 导入中...' : '✅ 确认导入'}
                </button>
              </div>

              <div style={errors.length > 0 ? { ...styles.statsBox, backgroundColor: '#fef2f2', borderColor: '#fecaca' } : styles.statsBox}>
                <div style={{ ...styles.statsText, color: errors.length > 0 ? '#991b1b' : '#166534' }}>
                  {errors.length > 0 
                    ? `⚠️ 发现 ${errors.length} 条错误记录，请修正后再导入` 
                    : `✅ 准备导入 ${previewData.length} 位用户`}
                </div>
              </div>

              <div style={{ backgroundColor: '#f9fafb', borderRadius: '8px', padding: '1.5rem' }}>
                <h3 style={{ marginTop: 0, color: '#374151' }}>导入摘要</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>总用户数</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#111827' }}>{previewData.length}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>错误数量</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: errors.length > 0 ? '#dc2626' : '#10b981' }}>
                      {errors.length}
                    </div>
                  </div>
                </div>

                {errors.length > 0 && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ color: '#dc2626', marginBottom: '0.5rem' }}>错误详情：</h4>
                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                      {errors.map((user, index) => (
                        <div key={index} style={{ padding: '0.5rem', backgroundColor: '#fee2e2', marginBottom: '0.5rem', borderRadius: '4px' }}>
                          <div style={{ fontWeight: '500' }}>{user.department} - {user.englishName || user.phoneNumber}</div>
                          <div style={{ fontSize: '0.75rem', color: '#991b1b' }}>
                            {user.errors.join(', ')}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#6b7280' }}>
                  💡 如需查看所有用户详情，请在导入完成后到用户管理界面查看
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchImportUser;
