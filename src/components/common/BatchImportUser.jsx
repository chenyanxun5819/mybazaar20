import { useState } from 'react';
import { db } from '../../config/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
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
      ['学号/工号', '可选', '组织发放的学号、工号或其他证号', '2024001 或 T2024001'], // ✅ 说明这是组织证号
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
      ['英文名*', '中文名', '学号/工号', '电话号码*', '部门*', '邮箱', '身份标签*'], // ✅ 第3列：学号/工号
      ['John Doe', '张三', '2024001', '0123456789', '1年A班', 'john@example.com', 'student'],
      ['Jane Smith', '李四', 'T2024001', '0987654321', '行政部', 'jane@example.com', 'teacher'],
      ['', '', '', '', '', '', ''],
    ];

    const dataWS = XLSX.utils.aoa_to_sheet(userData);
    dataWS['!cols'] = [
      { wch: 15 },
      { wch: 12 },
      { wch: 15 }, // ✅ 学号/工号列
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
        
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // 解析数据
        const parsedData = jsonData.map(row => ({
          englishName: row['英文名*'] || row['英文名'] || '',
          chineseName: row['中文名'] || '',
          identityId: row['学号/工号'] || '', // ✅ 直接读取，不自动生成
          phoneNumber: String(row['电话号码*'] || '').replace(/\s/g, ''),
          department: row['部门*'] || row['部门'] || '',
          email: row['邮箱'] || '',
          identityTag: row['身份标签*'] || 'student'
        }));

        setPreviewData(parsedData);
        setFile(uploadedFile);
        setShowPreview(true);
        setErrors([]);
      } catch (error) {
        console.error('[BatchImport] 文件解析失败:', error);
        alert('文件解析失败：' + error.message);
      }
    };

    reader.readAsArrayBuffer(uploadedFile);
  };

  // 处理手动输入
  const handleManualInputChange = (index, field, value) => {
    const newData = [...manualData];
    newData[index][field] = value;
    setManualData(newData);
  };

  const addMoreRows = () => {
    setManualData([
      ...manualData,
      ...Array(5).fill().map(() => ({
        englishName: '',
        chineseName: '',
        identityId: '', // ✅ 空字符串，等待手动输入
        phoneNumber: '',
        department: '',
        email: '',
        identityTag: 'student'
      }))
    ]);
  };

  const handleManualPreview = () => {
    const filteredData = manualData.filter(row => 
      row.englishName.trim() || row.phoneNumber.trim()
    );
    
    if (filteredData.length === 0) {
      alert('请至少填写一行数据');
      return;
    }

    setPreviewData(filteredData);
    setShowPreview(true);
    setErrors([]);
  };

  // 验证数据
  const validateData = () => {
    const newErrors = [];
    const phoneSet = new Set();

    previewData.forEach((user, index) => {
      const rowErrors = [];

      // 必填字段验证
      if (!user.englishName?.trim()) {
        rowErrors.push('英文名为必填');
      }
      if (!user.phoneNumber?.trim()) {
        rowErrors.push('电话号码为必填');
      }
      if (!user.department?.trim()) {
        rowErrors.push('部门为必填');
      }
      if (!user.identityTag?.trim()) {
        rowErrors.push('身份标签为必填');
      }

      // 电话号码格式验证
      if (user.phoneNumber && !/^0\d{9}$/.test(user.phoneNumber)) {
        rowErrors.push('电话号码格式错误（需要10位，以0开头）');
      }

      // 重复电话检查
      if (user.phoneNumber && phoneSet.has(user.phoneNumber)) {
        rowErrors.push('电话号码重复');
      }
      phoneSet.add(user.phoneNumber);

      // 身份标签验证
      const validTags = ['student', 'teacher', 'staff', 'parent'];
      if (user.identityTag && !validTags.includes(user.identityTag)) {
        rowErrors.push(`身份标签无效（只能是：${validTags.join(', ')}）`);
      }

      // ✅ identityId 不验证（可选字段）

      if (rowErrors.length > 0) {
        newErrors.push({
          row: index + 1,
          errors: rowErrors
        });
      }
    });

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  // 批量导入用户
  const handleImportUsers = async () => {
    if (!validateData()) {
      alert('请修正数据错误后再导入');
      return;
    }

    if (!confirm(`确定要导入 ${previewData.length} 位用户吗？\n所有用户将自动获得 Seller + Customer 角色。`)) {
      return;
    }

    try {
      setImporting(true);

      let successCount = 0;
      let failCount = 0;
      const failedUsers = [];

      // 提取所有部门
      const departments = [...new Set(
        previewData.map(u => u.department.trim()).filter(d => d)
      )];

      for (const user of previewData) {
        try {
          // 生成用户 ID
          const timestamp = Date.now();
          const randomStr = Math.random().toString(36).substring(2, 8);
          const userId = `usr_${timestamp}_${randomStr}`;

          // 标准化电话号码
          const phone = user.phoneNumber.trim();
          const authUid = `phone_60${phone}`;

          // 用户文档数据
          const userData = {
            userId,
            authUid,
            roles: ['seller', 'customer'], // 预设角色
            identityTag: user.identityTag || 'student',
            basicInfo: {
              phoneNumber: phone,
              englishName: user.englishName.trim(),
              chineseName: user.chineseName?.trim() || '',
              email: user.email?.trim() || '',
              isPhoneVerified: false
            },
            identityInfo: {
              identityId: user.identityId?.trim() || '', // ✅ 使用用户填写的，没填就是空字符串
              department: user.department.trim()
            },
            roleSpecificData: {
              seller: {},
              customer: {}
            },
            accountStatus: {
              status: 'active',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              createdBy: 'event_manager',
              createdByUserId: 'batch_import'
            }
          };

          // 保存到 Firestore
          const userRef = doc(
            db,
            'organizations',
            organizationId,
            'events',
            eventId,
            'users',
            userId
          );

          await setDoc(userRef, userData);
          successCount++;

        } catch (err) {
          console.error('[BatchImport] 创建用户失败:', err);
          failCount++;
          failedUsers.push({
            name: user.englishName,
            phone: user.phoneNumber,
            error: err.message
          });
        }
      }

      // 保存部门列表到 metadata
      if (departments.length > 0) {
        const metadataRef = doc(
          db,
          'organizations',
          organizationId,
          'events',
          eventId,
          'metadata',
          'departments'
        );

        await setDoc(metadataRef, {
          departmentList: departments,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      // 显示结果
      let message = `导入完成！\n\n`;
      message += `✅ 成功: ${successCount} 位用户\n`;
      if (failCount > 0) {
        message += `❌ 失败: ${failCount} 位用户\n\n`;
        message += `失败用户:\n`;
        failedUsers.forEach(u => {
          message += `- ${u.name} (${u.phone}): ${u.error}\n`;
        });
      }

      alert(message);

      if (successCount > 0 && onSuccess) {
        onSuccess();
      }

    } catch (error) {
      console.error('[BatchImport] 批量导入失败:', error);
      alert('批量导入失败：' + error.message);
    } finally {
      setImporting(false);
    }
  };

  // 预览界面
  if (showPreview) {
    return (
      <div style={styles.modalOverlay} onClick={onClose}>
        <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
          <div style={styles.modalHeader}>
            <h2 style={styles.modalTitle}>📋 预览导入数据</h2>
            <button style={styles.closeButton} onClick={onClose}>✕</button>
          </div>

          {errors.length > 0 && (
            <div style={styles.errorBox}>
              <strong>⚠️ 发现 {errors.length} 个错误：</strong>
              {errors.map((err, i) => (
                <div key={i} style={styles.errorItem}>
                  第 {err.row} 行: {err.errors.join(', ')}
                </div>
              ))}
            </div>
          )}

          <div style={styles.infoBox}>
            <strong>📊 数据统计：</strong>
            <div>总计: {previewData.length} 位用户</div>
            <div>预设角色: Seller + Customer</div>
            <div>有学号/工号: {previewData.filter(u => u.identityId?.trim()).length} 位</div>
          </div>

          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>英文名</th>
                  <th style={styles.th}>中文名</th>
                  <th style={styles.th}>学号/工号</th>
                  <th style={styles.th}>电话</th>
                  <th style={styles.th}>部门</th>
                  <th style={styles.th}>邮箱</th>
                  <th style={styles.th}>身份标签</th>
                </tr>
              </thead>
              <tbody>
                {previewData.map((user, index) => (
                  <tr key={index}>
                    <td style={styles.td}>{index + 1}</td>
                    <td style={styles.td}>{user.englishName}</td>
                    <td style={styles.td}>{user.chineseName || '-'}</td>
                    <td style={styles.td}>{user.identityId || '-'}</td>
                    <td style={styles.td}>{user.phoneNumber}</td>
                    <td style={styles.td}>{user.department}</td>
                    <td style={styles.td}>{user.email || '-'}</td>
                    <td style={styles.td}>{user.identityTag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.modalActions}>
            <button
              style={styles.cancelButton}
              onClick={() => setShowPreview(false)}
              disabled={importing}
            >
              ← 返回修改
            </button>
            <button
              style={{
                ...styles.submitButton,
                ...(importing || errors.length > 0 ? styles.submitButtonDisabled : {})
              }}
              onClick={handleImportUsers}
              disabled={importing || errors.length > 0}
            >
              {importing ? '导入中...' : `✅ 确认导入 ${previewData.length} 位用户`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 主界面
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>📥 批量导入用户</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        {/* 导入方式选择 */}
        <div style={styles.modeSelection}>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              value="upload"
              checked={importMode === 'upload'}
              onChange={() => setImportMode('upload')}
            />
            <span>📤 上传 Excel/CSV 文件</span>
          </label>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="mode"
              value="manual"
              checked={importMode === 'manual'}
              onChange={() => setImportMode('manual')}
            />
            <span>✍️ 手动输入</span>
          </label>
        </div>

        {/* 上传模式 */}
        {importMode === 'upload' && (
          <>
            <div style={styles.infoBox}>
              <strong>📋 首次使用？请先下载模板文件</strong>
              <button
                style={styles.downloadButton}
                onClick={downloadTemplate}
              >
                📥 下载 Excel 模板
              </button>
            </div>

            <div style={styles.uploadArea}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
                id="fileInput"
              />
              <label htmlFor="fileInput" style={styles.uploadLabel}>
                <div style={styles.uploadIcon}>📄</div>
                <div style={styles.uploadText}>
                  {file ? file.name : '拖拽文件到这里或点击选择文件'}
                </div>
                <div style={styles.uploadHint}>
                  支持格式：.xlsx, .xls, .csv
                </div>
              </label>
            </div>
          </>
        )}

        {/* 手动输入模式 */}
        {importMode === 'manual' && (
          <>
            <div style={styles.tableContainer}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>英文名*</th>
                    <th style={styles.th}>中文名</th>
                    <th style={styles.th}>学号/工号</th>
                    <th style={styles.th}>电话号码*</th>
                    <th style={styles.th}>部门*</th>
                    <th style={styles.th}>邮箱</th>
                    <th style={styles.th}>身份标签*</th>
                  </tr>
                </thead>
                <tbody>
                  {manualData.map((row, index) => (
                    <tr key={index}>
                      <td style={styles.td}>{index + 1}</td>
                      <td style={styles.td}>
                        <input
                          type="text"
                          value={row.englishName}
                          onChange={(e) => handleManualInputChange(index, 'englishName', e.target.value)}
                          style={styles.input}
                          placeholder="John Doe"
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="text"
                          value={row.chineseName}
                          onChange={(e) => handleManualInputChange(index, 'chineseName', e.target.value)}
                          style={styles.input}
                          placeholder="张三"
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="text"
                          value={row.identityId}
                          onChange={(e) => handleManualInputChange(index, 'identityId', e.target.value)}
                          style={styles.input}
                          placeholder="2024001"
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="tel"
                          value={row.phoneNumber}
                          onChange={(e) => handleManualInputChange(index, 'phoneNumber', e.target.value)}
                          style={styles.input}
                          placeholder="0123456789"
                          maxLength="10"
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="text"
                          value={row.department}
                          onChange={(e) => handleManualInputChange(index, 'department', e.target.value)}
                          style={styles.input}
                          placeholder="1年A班"
                        />
                      </td>
                      <td style={styles.td}>
                        <input
                          type="email"
                          value={row.email}
                          onChange={(e) => handleManualInputChange(index, 'email', e.target.value)}
                          style={styles.input}
                          placeholder="user@email.com"
                        />
                      </td>
                      <td style={styles.td}>
                        <select
                          value={row.identityTag}
                          onChange={(e) => handleManualInputChange(index, 'identityTag', e.target.value)}
                          style={styles.select}
                        >
                          <option value="student">Student</option>
                          <option value="teacher">Teacher</option>
                          <option value="staff">Staff</option>
                          <option value="parent">Parent</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={styles.manualActions}>
              <button
                style={styles.addRowButton}
                onClick={addMoreRows}
              >
                ➕ 添加更多行
              </button>
              <button
                style={styles.previewButton}
                onClick={handleManualPreview}
              >
                👁️ 预览数据
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const styles = {
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modalContent: {
    background: 'white',
    borderRadius: '16px',
    padding: '2rem',
    maxWidth: '1200px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto'
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem'
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: '#6b7280',
    cursor: 'pointer',
    padding: '0.25rem',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px'
  },
  modeSelection: {
    display: 'flex',
    gap: '2rem',
    marginBottom: '1.5rem',
    padding: '1rem',
    background: '#f9fafb',
    borderRadius: '8px'
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: 'pointer',
    fontSize: '1rem'
  },
  infoBox: {
    background: '#eff6ff',
    border: '1px solid #3b82f6',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  downloadButton: {
    padding: '0.5rem 1rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    fontSize: '0.875rem'
  },
  uploadArea: {
    border: '2px dashed #d1d5db',
    borderRadius: '12px',
    padding: '3rem',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: '#f9fafb'
  },
  uploadLabel: {
    cursor: 'pointer',
    display: 'block'
  },
  uploadIcon: {
    fontSize: '3rem',
    marginBottom: '1rem'
  },
  uploadText: {
    fontSize: '1rem',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  uploadHint: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  tableContainer: {
    overflowX: 'auto',
    maxHeight: '500px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  th: {
    background: '#f3f4f6',
    padding: '0.75rem',
    textAlign: 'left',
    fontWeight: '600',
    color: '#374151',
    borderBottom: '2px solid #e5e7eb',
    position: 'sticky',
    top: 0,
    zIndex: 1
  },
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #e5e7eb'
  },
  input: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.875rem',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.875rem',
    boxSizing: 'border-box',
    background: 'white'
  },
  manualActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end'
  },
  addRowButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500'
  },
  previewButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  errorBox: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1rem'
  },
  errorItem: {
    marginTop: '0.5rem',
    fontSize: '0.875rem'
  },
  modalActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    marginTop: '1.5rem'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '500'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontWeight: '600'
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  }
};

export default BatchImportUser;