import { useState } from 'react';
import { db } from '../../config/firebase';
import { getAuth } from 'firebase/auth';
import { collection, doc, setDoc, serverTimestamp, updateDoc, increment, getDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';

const BatchImportUser = ({ organizationId, eventId, onClose, onSuccess }) => {
  const [importMode, setImportMode] = useState('upload'); // 'upload' or 'manual'
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [manualData, setManualData] = useState(
    Array(5).fill().map(() => ({
      englishName: '',
      chineseName: '',
      identityId: '', // ✅ 手动输入，不自动生成
      phoneNumber: '',
      department: '',
      email: '',
      identityTag: 'student'
    }))
  );

  // ✅ 样式对象定义 - 使用内联样式替代 Tailwind CSS
  const styles = {
    // 模态框遮罩层
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
      zIndex: 9999, // ✅ 确保在最上层
      padding: '1rem'
    },
    // 模态框容器
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
    // 头部
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
    // 内容区域
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: '1.5rem'
    },
    // 模式选择按钮容器
    modeContainer: {
      display: 'flex',
      gap: '1rem',
      padding: '1rem',
      backgroundColor: '#f9fafb',
      borderRadius: '8px',
      marginBottom: '1.5rem'
    },
    // 按钮基础样式
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
    buttonSecondary: {
      backgroundColor: 'white',
      color: '#374151'
    },
    buttonSuccess: {
      backgroundColor: '#10b981',
      color: 'white'
    },
    buttonGray: {
      backgroundColor: '#6b7280',
      color: 'white'
    },
    // 说明框
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
    // 上传区域
    uploadArea: {
      border: '2px dashed #d1d5db',
      borderRadius: '8px',
      padding: '2rem',
      textAlign: 'center',
      cursor: 'pointer',
      transition: 'border-color 0.2s'
    },
    // 表格
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '0.875rem'
    },
    tableHeader: {
      backgroundColor: '#f3f4f6',
      borderBottom: '2px solid #e5e7eb'
    },
    tableHeaderCell: {
      padding: '0.75rem',
      textAlign: 'left',
      fontWeight: '600',
      color: '#374151'
    },
    tableCell: {
      padding: '0.75rem',
      borderBottom: '1px solid #e5e7eb'
    },
    // 输入框
    input: {
      width: '100%',
      padding: '0.5rem',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '0.875rem'
    },
    select: {
      width: '100%',
      padding: '0.5rem',
      border: '1px solid #d1d5db',
      borderRadius: '4px',
      fontSize: '0.875rem',
      backgroundColor: 'white'
    },
    // 错误样式
    errorRow: {
      backgroundColor: '#fef2f2'
    },
    errorText: {
      color: '#dc2626',
      fontSize: '0.75rem',
      marginTop: '0.25rem'
    },
    // 底部按钮容器
    footer: {
      display: 'flex',
      gap: '1rem',
      marginTop: '1.5rem',
      padding: '1.5rem',
      borderTop: '1px solid #e5e7eb',
      backgroundColor: '#f9fafb'
    }
  };

  // ✅ 下载 Excel 模板（包含 identityId 列，但不自动生成）
  const downloadTemplate = () => {
    // 使用说明工作表
    const instructionsData = [
      ['批量导入用户 - 使用说明'],
      [''],
      ['字段说明：'],
      ['字段名', '是否必填', '说明', '示例'],
      ['英文名*', '必填', '用户的英文姓名', 'John Doe'],
      ['中文名', '可选', '用户的中文姓名', '张三'],
      ['学号/工号', '可选', '组织发放的学号、工号或其他证号', '2024001 或 T2024001'],
      ['电话号码*', '必填', '10位数字，以0开头', '0123456789'],
      ['部门*', '必填', '用户所属部门', '1年A班'],
      ['邮箱', '可选', '用户的电子邮箱', 'user@example.com'],
      ['身份标签*', '必填', 'student/teacher/staff/parent', 'student'],
      [''],
      ['重要提示：'],
      ['1. 必填字段不能为空'],
      ['2. 电话号码必须是10位数字，以0开头'],
      ['3. 学号/工号是组织发放的证号，如果有请填写，没有可留空'],
      ['4. 身份标签只能是：student, teacher, staff, parent'],
      ['5. 部门名称请保持一致，避免重复创建'],
      ['6. 所有导入的用户自动获得 Seller + Customer 角色']
    ];

    const instructionsWS = XLSX.utils.aoa_to_sheet(instructionsData);
    instructionsWS['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 50 },
      { wch: 25 }
    ];

    // 用户数据工作表（横向格式）
    const userData = [
      ['英文名*', '中文名', '学号/工号', '电话号码*', '部门*', '邮箱', '身份标签*'],
      ['John Doe', '张三', '2024001', '0123456789', '1年A班', 'john@example.com', 'student'],
      ['Jane Smith', '李四', 'T2024001', '0987654321', '行政部', 'jane@example.com', 'teacher'],
      ['', '', '', '', '', '', ''],
    ];

    const dataWS = XLSX.utils.aoa_to_sheet(userData);
    dataWS['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 15 },
      { wch: 25 },
      { wch: 12 }
    ];

    // 创建工作簿
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, instructionsWS, '使用说明');
    XLSX.utils.book_append_sheet(wb, dataWS, '用户数据');

    // 下载
    XLSX.writeFile(wb, '用户批量导入模板.xlsx');
  };

  // 处理文件上传
  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // 读取"用户数据"工作表
        const sheetName = workbook.SheetNames.find(name => 
          name.includes('用户数据') || name.includes('数据') || workbook.SheetNames[workbook.SheetNames.length - 1]
        );
        
        if (!sheetName) {
          alert('未找到有效的工作表');
          return;
        }

        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        // 第一行表頭：建立動態映射（解決欄位順序錯位 / 舊模板差異）
        const headers = (jsonData[0] || []).map(h => (h || '').toString().trim());
        const headerMap = {};
        headers.forEach((h, i) => {
          if (/英文/.test(h)) headerMap.englishName = i;
          else if (/中文/.test(h)) headerMap.chineseName = i;
          else if (/(学号|工号)/.test(h)) headerMap.identityId = i;
          else if (/电话/.test(h)) headerMap.phoneNumber = i;
          else if (/部门/.test(h)) headerMap.department = i;
          else if (/邮箱|email/i.test(h)) headerMap.email = i;
          else if (/身份标签|身份|标签/.test(h)) headerMap.identityTag = i;
        });

        const userData = jsonData.slice(1)
          .filter(row => Array.isArray(row) && row.some(cell => cell))
          .map(rawRow => {
            const row = rawRow.map(c => (c === undefined || c === null) ? '' : String(c).trim());

            const get = (key) => {
              const idx = headerMap[key];
              return idx !== undefined ? row[idx] : '';
            };

            let user = {
              englishName: get('englishName'),
              chineseName: get('chineseName'),
              identityId: get('identityId'),
              phoneNumber: get('phoneNumber'),
              department: get('department'),
              email: get('email'),
              identityTag: get('identityTag') || 'student'
            };

            // 嘗試自動修正常見錯位：
            // 1. 若 englishName 看起來像部門（含“组”或全中文且 phoneNumber 欄位是中文姓名）
            const isChinese = (v) => /[\u4e00-\u9fa5]/.test(v);
            if (user.englishName && (/(组|部)$/.test(user.englishName) || (isChinese(user.englishName) && !/[A-Za-z]/.test(user.englishName))) && isChinese(user.phoneNumber) && !/^0\d{9}$/.test(user.phoneNumber)) {
              // 假設實際順序為：部門 -> 身份ID -> 英文名 -> 中文名 -> 電話號碼
              // 嘗試從原始 row 重新對齊（僅在行長度 >=5 且尚未有正確電話時）
              if (row.length >= 5) {
                user = {
                  department: row[0] || user.department,
                  identityId: row[1] || user.identityId,
                  englishName: row[2] || user.englishName,
                  chineseName: row[3] || user.chineseName,
                  phoneNumber: row[4] || user.phoneNumber,
                  email: user.email,
                  identityTag: user.identityTag
                };
              }
            }

            // 正規化電話：數字去除非數字，保留前導 0
            if (user.phoneNumber) {
              const digits = user.phoneNumber.replace(/[^0-9]/g, '');
              if (digits.startsWith('60') && digits.length === 11) {
                // 可能是 60 開頭未加 +，嘗試轉成本地 0XXXXXXXXX
                const local = '0' + digits.substring(2);
                user.phoneNumber = local;
              } else {
                user.phoneNumber = digits;
              }
            }

            // 驗證
            user.errors = [];
            if (!user.englishName) user.errors.push('缺少英文名');
            if (!user.phoneNumber) {
              user.errors.push('缺少电话号码');
            } else if (!/^0\d{9}$/.test(user.phoneNumber)) {
              user.errors.push('电话号码格式不正确');
            }
            if (!user.department) user.errors.push('缺少部门');
            if (!['student', 'teacher', 'staff', 'parent'].includes(user.identityTag)) {
              user.errors.push('身份标签不正确');
            }

            return user;
          });

        setFile(uploadedFile);
        setPreviewData(userData);
        setShowPreview(true);
        setErrors(userData.filter(u => u.errors.length > 0));

      } catch (error) {
        console.error('解析文件失败:', error);
        alert('文件解析失败，请确保使用正确的模板');
      }
    };

    reader.readAsArrayBuffer(uploadedFile);
  };

  // 处理手动输入的数据变更
  const handleManualDataChange = (index, field, value) => {
    const newData = [...manualData];
    newData[index] = {
      ...newData[index],
      [field]: value
    };
    setManualData(newData);
  };

  // 添加更多手动输入行
  const addManualRow = () => {
    setManualData([...manualData, {
      englishName: '',
      chineseName: '',
      identityId: '',
      phoneNumber: '',
      department: '',
      email: '',
      identityTag: 'student'
    }]);
  };

  // 提交手动输入的数据进行预览
  const handleManualSubmit = () => {
    // 过滤掉空行
    const validUsers = manualData.filter(user => 
      user.englishName || user.phoneNumber || user.department
    );
    
    if (validUsers.length === 0) {
      alert('请至少填写一位用户的信息');
      return;
    }

    // 验证数据
    const validatedUsers = validUsers.map(user => {
      const errors = [];
      if (!user.englishName) errors.push('缺少英文名');
      if (!user.phoneNumber) {
        errors.push('缺少电话号码');
      } else if (!/^0\d{9}$/.test(user.phoneNumber)) {
        errors.push('电话号码格式不正确');
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
  };

  // 执行批量导入
  const handleImportUsers = async () => {
    if (errors.length > 0) {
      alert('请先修正所有错误');
      return;
    }

    try {
      setImporting(true);

      const auth = getAuth();
      const idToken = await auth.currentUser.getIdToken();

      // 调用 Cloud Function
      const response = await fetch('/api/batchImportUsers', {
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
            department: user.department,
            email: user.email || '',
            identityTag: user.identityTag,
            roles: ['seller', 'customer']
          }))
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || '导入失败');
      }

      const result = await response.json();
      // 後端欄位為 imported (成功數) 與 errors
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
        {/* 头部 */}
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

        {/* 主体内容 */}
        <div style={styles.content}>
          {!showPreview ? (
            <div>
              {/* 上传文件模式 */}
              <div>
                  <div style={styles.infoBox}>
                    <h3 style={styles.infoTitle}>📋 使用说明</h3>
                    <ul style={styles.infoList}>
                      <li>下载 Excel 模板，按格式填写用户信息</li>
                      <li>必填字段：英文名、电话号码、部门、身份标签</li>
                      <li>电话号码必须是10位数字，以0开头</li>
                      <li>学号/工号是可选的，如果组织有发放请填写</li>
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
              )}
            </div>
          ) : (
            <div>
              {/* 预览数据 */}
              <div style={{ ...styles.infoBox, backgroundColor: errors.length > 0 ? '#fef2f2' : '#f0fdf4', borderColor: errors.length > 0 ? '#fecaca' : '#86efac' }}>
                <h3 style={{ ...styles.infoTitle, color: errors.length > 0 ? '#991b1b' : '#166534' }}>
                  {errors.length > 0 ? `⚠️ 发现 ${errors.length} 条错误记录` : '✅ 数据验证通过'}
                </h3>
                <p style={{ fontSize: '0.875rem', color: errors.length > 0 ? '#991b1b' : '#166534', margin: 0 }}>
                  {errors.length > 0 
                    ? '请修正下方标红的错误后再导入' 
                    : `准备导入 ${previewData.length} 位用户`}
                </p>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={styles.table}>
                  <thead style={styles.tableHeader}>
                    <tr>
                      <th style={styles.tableHeaderCell}>#</th>
                      <th style={styles.tableHeaderCell}>英文名</th>
                      <th style={styles.tableHeaderCell}>中文名</th>
                      <th style={styles.tableHeaderCell}>学号/工号</th>
                      <th style={styles.tableHeaderCell}>电话号码</th>
                      <th style={styles.tableHeaderCell}>部门</th>
                      <th style={styles.tableHeaderCell}>邮箱</th>
                      <th style={styles.tableHeaderCell}>身份标签</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((user, index) => (
                      <tr key={index} style={user.errors && user.errors.length > 0 ? styles.errorRow : {}}>
                        <td style={styles.tableCell}>{index + 1}</td>
                        <td style={styles.tableCell}>{user.englishName}</td>
                        <td style={styles.tableCell}>{user.chineseName || '-'}</td>
                        <td style={styles.tableCell}>{user.identityId || '-'}</td>
                        <td style={styles.tableCell}>{user.phoneNumber}</td>
                        <td style={styles.tableCell}>{user.department}</td>
                        <td style={styles.tableCell}>{user.email || '-'}</td>
                        <td style={styles.tableCell}>{user.identityTag}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={styles.footer}>
                <button
                  onClick={() => {
                    setShowPreview(false);
                    setErrors([]);
                  }}
                  style={{ ...styles.button, ...styles.buttonGray }}
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BatchImportUser;