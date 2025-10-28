import { useState } from 'react';
import { db } from '../../config/firebase';
import { doc, setDoc, updateDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';
import * as XLSX from 'xlsx';

const BatchImportUser = ({ organizationId, eventId, onClose, onSuccess }) => {
  const [importMode, setImportMode] = useState('upload'); // 'upload' or 'manual'
  const [file, setFile] = useState(null);
  const [manualData, setManualData] = useState([
    { englishName: '', chineseName: '', phoneNumber: '', department: '', email: '', identityTag: 'student' }
  ]);
  const [previewData, setPreviewData] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState([]);

  // 📥 下载 Excel 模板
  const downloadTemplate = () => {
    // 创建工作簿
    const wb = XLSX.utils.book_new();

    // ========== 工作表 1: 使用说明 ==========
    const instructionsData = [
      { '字段名': '英文名*', '是否必填': '✅ 必填', '说明': '用户的英文姓名', '示例': 'John Doe' },
      { '字段名': '中文名', '是否必填': '可选', '说明': '用户的中文姓名', '示例': '张三' },
      { '字段名': '电话号码*', '是否必填': '✅ 必填', '说明': '10位数字，以0开头', '示例': '0123456789' },
      { '字段名': '部门*', '是否必填': '✅ 必填', '说明': '用户所属部门', '示例': '1年A班' },
      { '字段名': '邮箱', '是否必填': '可选', '说明': '用户的电子邮箱', '示例': 'user@example.com' },
      { '字段名': '身份标签*', '是否必填': '✅ 必填', '说明': 'student/teacher/staff/parent', '示例': 'student' }
    ];
    
    const wsInstructions = XLSX.utils.json_to_sheet(instructionsData);
    XLSX.utils.book_append_sheet(wb, wsInstructions, '使用说明');

    // ========== 工作表 2: 用户数据 ==========
    // 使用 aoa_to_sheet 创建，精确控制每一行
    const wsData = XLSX.utils.aoa_to_sheet([
      // 第1行：标题行（横式排列）
      ['英文名*', '中文名', '电话号码*', '部门*', '邮箱', '身份标签*'],
      
      // 第2-3行：示例数据
      ['John Doe', '张三', '0123456789', '1年A班', 'john@example.com', 'student'],
      ['Jane Smith', '李四', '0234567890', '行政部', 'jane@example.com', 'teacher'],
      
      // 第4行：提示（跨列合并的提示文字）
      ['⚠️ 上面2行是示例，导入前请删除！从第6行开始填写真实数据'],
      
      // 第5行：空行（分隔）
      [],
      
      // 第6-8行：空行供用户填写（预设身份标签为 student）
      ['', '', '', '', '', 'student'],
      ['', '', '', '', '', 'student'],
      ['', '', '', '', '', 'student']
    ]);

    XLSX.utils.book_append_sheet(wb, wsData, '用户数据');

    // 下载文件
    XLSX.writeFile(wb, '用户批量导入模板.xlsx');
  };

  // 📤 处理文件上传
  const handleFileUpload = (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        
        // 读取第一个工作表（或"用户数据"工作表）
        const sheetName = workbook.SheetNames.includes('用户数据') 
          ? '用户数据' 
          : workbook.SheetNames[0];
        
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);

        // 转换为标准格式
        const parsedData = jsonData.map(row => ({
          englishName: row['英文名*'] || row['英文名'] || '',
          chineseName: row['中文名'] || '',
          phoneNumber: String(row['电话号码*'] || row['电话号码'] || '').replace(/\s/g, ''),
          department: row['部门*'] || row['部门'] || '',
          email: row['邮箱'] || '',
          identityTag: row['身份标签*'] || row['身份标签'] || 'student'
        }));

        setFile(uploadedFile);
        setPreviewData(parsedData);
        setShowPreview(true);
        setErrors([]);
      } catch (error) {
        console.error('文件解析错误:', error);
        alert('文件格式错误，请使用提供的模板');
      }
    };

    reader.readAsArrayBuffer(uploadedFile);
  };

  // ➕ 添加手动输入行
  const addManualRow = () => {
    setManualData([
      ...manualData,
      { englishName: '', chineseName: '', phoneNumber: '', department: '', email: '', identityTag: 'student' }
    ]);
  };

  // 📝 更新手动输入数据
  const updateManualData = (index, field, value) => {
    const updated = [...manualData];
    updated[index][field] = value;
    setManualData(updated);
  };

  // 🗑️ 删除手动输入行
  const removeManualRow = (index) => {
    if (manualData.length === 1) return; // 至少保留一行
    setManualData(manualData.filter((_, i) => i !== index));
  };

  // ✅ 预览手动输入数据
  const previewManualData = () => {
    // 过滤掉空行
    const validData = manualData.filter(row => 
      row.englishName.trim() && row.phoneNumber.trim() && row.department.trim()
    );

    if (validData.length === 0) {
      alert('请至少填写一行完整数据（英文名、电话、部门为必填项）');
      return;
    }

    setPreviewData(validData);
    setShowPreview(true);
    setErrors([]);
  };

  // 🔍 验证数据
  const validateData = (data) => {
    const validationErrors = [];
    const phoneNumbers = new Set();

    data.forEach((user, index) => {
      const rowErrors = [];

      // 验证必填字段
      if (!user.englishName?.trim()) {
        rowErrors.push('英文名不能为空');
      }
      if (!user.phoneNumber?.trim()) {
        rowErrors.push('电话号码不能为空');
      }
      if (!user.department?.trim()) {
        rowErrors.push('部门不能为空');
      }

      // 验证电话号码格式
      const phone = user.phoneNumber?.replace(/\s/g, '');
      if (phone && !/^0\d{9}$/.test(phone)) {
        rowErrors.push('电话号码格式错误（应为10位数字，以0开头）');
      }

      // 检查重复电话
      if (phone) {
        if (phoneNumbers.has(phone)) {
          rowErrors.push('电话号码重复');
        }
        phoneNumbers.add(phone);
      }

      // 验证身份标签
      const validTags = ['student', 'teacher', 'staff', 'parent'];
      if (user.identityTag && !validTags.includes(user.identityTag)) {
        rowErrors.push(`身份标签无效（应为：${validTags.join(', ')}）`);
      }

      if (rowErrors.length > 0) {
        validationErrors.push({
          row: index + 1,
          user: user.englishName || '未命名',
          errors: rowErrors
        });
      }
    });

    return validationErrors;
  };

  // 💾 执行批量导入
  const handleBatchImport = async () => {
    if (previewData.length === 0) {
      alert('没有可导入的数据');
      return;
    }

    // 验证数据
    const validationErrors = validateData(previewData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    if (!confirm(`确定要导入 ${previewData.length} 位用户吗？\n\n所有用户将自动获得 Seller 和 Customer 角色。`)) {
      return;
    }

    setLoading(true);

    try {
      // 1. 提取所有部门
      const departments = [...new Set(previewData.map(u => u.department.trim()))];

      // 2. 更新 metadata/departments
      const metadataRef = doc(db, 'organizations', organizationId, 'events', eventId, 'metadata', 'departments');
      
      try {
        await setDoc(metadataRef, {
          departmentList: departments,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.log('创建 metadata/departments:', error);
      }

      // 3. 批量创建用户
      let successCount = 0;
      let failCount = 0;
      const failedUsers = [];

      for (const user of previewData) {
        try {
          const userId = `usr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const phone = user.phoneNumber.replace(/\s/g, '');
          
          const userData = {
            userId,
            authUid: `phone_60${phone}`,
            roles: ['seller', 'customer'], // 🎯 预设角色
            identityTag: user.identityTag || 'student',
            basicInfo: {
              phoneNumber: phone,
              englishName: user.englishName.trim(),
              chineseName: user.chineseName?.trim() || '',
              email: user.email?.trim() || '',
              isPhoneVerified: false
            },
            identityInfo: {
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
          const userRef = doc(db, 'organizations', organizationId, 'events', eventId, 'users', userId);
          await setDoc(userRef, userData);

          successCount++;
        } catch (error) {
          console.error(`创建用户失败 (${user.englishName}):`, error);
          failCount++;
          failedUsers.push(user.englishName);
        }
      }

      // 4. 显示结果
      alert(
        `批量导入完成！\n\n` +
        `✅ 成功: ${successCount} 位用户\n` +
        `❌ 失败: ${failCount} 位用户` +
        (failedUsers.length > 0 ? `\n\n失败用户：${failedUsers.join(', ')}` : '')
      );

      if (successCount > 0) {
        onSuccess?.();
        onClose();
      }

    } catch (error) {
      console.error('批量导入错误:', error);
      alert('批量导入失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>📥 批量导入用户</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        {!showPreview ? (
          <>
            {/* 导入模式选择 */}
            <div style={styles.modeSelector}>
              <label style={styles.modeOption}>
                <input
                  type="radio"
                  value="upload"
                  checked={importMode === 'upload'}
                  onChange={(e) => setImportMode(e.target.value)}
                />
                <span>📤 上传 Excel/CSV 文件</span>
              </label>
              <label style={styles.modeOption}>
                <input
                  type="radio"
                  value="manual"
                  checked={importMode === 'manual'}
                  onChange={(e) => setImportMode(e.target.value)}
                />
                <span>✍️ 手动输入</span>
              </label>
            </div>

            {/* 模式 1: 上传文件 */}
            {importMode === 'upload' && (
              <div style={styles.uploadSection}>
                {/* 下载模板按钮 */}
                <div style={styles.templateSection}>
                  <p style={styles.templateText}>
                    📋 首次使用？请先下载模板文件，填写后上传
                  </p>
                  <button style={styles.downloadButton} onClick={downloadTemplate}>
                    📥 下载 Excel 模板
                  </button>
                </div>

                {/* 文件上传区域 */}
                <div style={styles.uploadArea}>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileUpload}
                    style={styles.fileInput}
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" style={styles.uploadLabel}>
                    <div style={styles.uploadIcon}>📄</div>
                    <div style={styles.uploadText}>
                      {file ? file.name : '点击选择文件或拖拽到这里'}
                    </div>
                    <div style={styles.uploadHint}>
                      支持格式：.xlsx, .xls, .csv
                    </div>
                  </label>
                </div>

                {/* 格式说明 */}
                <div style={styles.formatInfo}>
                  <h4 style={styles.formatTitle}>📖 文件格式要求：</h4>
                  <table style={styles.formatTable}>
                    <thead>
                      <tr>
                        <th>字段名</th>
                        <th>是否必填</th>
                        <th>说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>英文名*</td>
                        <td>✅ 必填</td>
                        <td>用户的英文姓名</td>
                      </tr>
                      <tr>
                        <td>中文名</td>
                        <td>可选</td>
                        <td>用户的中文姓名</td>
                      </tr>
                      <tr>
                        <td>电话号码*</td>
                        <td>✅ 必填</td>
                        <td>10位数字，以0开头</td>
                      </tr>
                      <tr>
                        <td>部门*</td>
                        <td>✅ 必填</td>
                        <td>例如：1年A班、行政部</td>
                      </tr>
                      <tr>
                        <td>邮箱</td>
                        <td>可选</td>
                        <td>用户的电子邮箱</td>
                      </tr>
                      <tr>
                        <td>身份标签*</td>
                        <td>✅ 必填</td>
                        <td>student/teacher/staff/parent</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 模式 2: 手动输入 */}
            {importMode === 'manual' && (
              <div style={styles.manualSection}>
                <div style={styles.manualTableWrapper}>
                  <table style={styles.manualTable}>
                    <thead>
                      <tr>
                        <th>英文名*</th>
                        <th>中文名</th>
                        <th>电话号码*</th>
                        <th>部门*</th>
                        <th>邮箱</th>
                        <th>身份标签*</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualData.map((row, index) => (
                        <tr key={index}>
                          <td>
                            <input
                              type="text"
                              value={row.englishName}
                              onChange={(e) => updateManualData(index, 'englishName', e.target.value)}
                              style={styles.tableInput}
                              placeholder="John Doe"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.chineseName}
                              onChange={(e) => updateManualData(index, 'chineseName', e.target.value)}
                              style={styles.tableInput}
                              placeholder="张三"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.phoneNumber}
                              onChange={(e) => updateManualData(index, 'phoneNumber', e.target.value)}
                              style={styles.tableInput}
                              placeholder="0123456789"
                              maxLength="10"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={row.department}
                              onChange={(e) => updateManualData(index, 'department', e.target.value)}
                              style={styles.tableInput}
                              placeholder="1年A班"
                            />
                          </td>
                          <td>
                            <input
                              type="email"
                              value={row.email}
                              onChange={(e) => updateManualData(index, 'email', e.target.value)}
                              style={styles.tableInput}
                              placeholder="user@example.com"
                            />
                          </td>
                          <td>
                            <select
                              value={row.identityTag}
                              onChange={(e) => updateManualData(index, 'identityTag', e.target.value)}
                              style={styles.tableSelect}
                            >
                              <option value="student">Student</option>
                              <option value="teacher">Teacher</option>
                              <option value="staff">Staff</option>
                              <option value="parent">Parent</option>
                            </select>
                          </td>
                          <td>
                            <button
                              onClick={() => removeManualRow(index)}
                              style={styles.removeButton}
                              disabled={manualData.length === 1}
                            >
                              🗑️
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button style={styles.addRowButton} onClick={addManualRow}>
                  ➕ 添加更多行
                </button>

                <button style={styles.previewButton} onClick={previewManualData}>
                  👁️ 预览数据
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            {/* 预览数据 */}
            <div style={styles.previewSection}>
              <h3 style={styles.previewTitle}>
                📋 预览导入数据 ({previewData.length} 位用户)
              </h3>

              {/* 显示验证错误 */}
              {errors.length > 0 && (
                <div style={styles.errorSection}>
                  <h4 style={styles.errorTitle}>❌ 发现 {errors.length} 处错误：</h4>
                  {errors.map((error, index) => (
                    <div key={index} style={styles.errorItem}>
                      <strong>第 {error.row} 行 ({error.user}):</strong>
                      <ul style={styles.errorList}>
                        {error.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}

              {/* 预览表格 */}
              <div style={styles.previewTableWrapper}>
                <table style={styles.previewTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>英文名</th>
                      <th>中文名</th>
                      <th>电话</th>
                      <th>部门</th>
                      <th>邮箱</th>
                      <th>身份</th>
                      <th>预设角色</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((user, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{user.englishName}</td>
                        <td>{user.chineseName || '-'}</td>
                        <td>{user.phoneNumber}</td>
                        <td>{user.department}</td>
                        <td>{user.email || '-'}</td>
                        <td>{user.identityTag}</td>
                        <td>
                          <span style={styles.roleBadge}>Seller</span>
                          <span style={styles.roleBadge}>Customer</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={styles.previewActions}>
                <button style={styles.backButton} onClick={() => setShowPreview(false)}>
                  ← 返回修改
                </button>
                <button
                  style={styles.importButton}
                  onClick={handleBatchImport}
                  disabled={loading || errors.length > 0}
                >
                  {loading ? '⏳ 导入中...' : `✅ 确认导入 (${previewData.length} 位用户)`}
                </button>
              </div>
            </div>
          </>
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
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'white',
    borderRadius: '16px',
    width: '95%',
    maxWidth: '1200px',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
  },
  header: {
    padding: '1.5rem 2rem',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    position: 'sticky',
    top: 0,
    background: 'white',
    zIndex: 1
  },
  title: {
    margin: 0,
    fontSize: '1.5rem',
    color: '#1f2937'
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.5rem',
    borderRadius: '8px',
    transition: 'background 0.2s'
  },
  modeSelector: {
    padding: '1.5rem 2rem',
    display: 'flex',
    gap: '2rem',
    borderBottom: '1px solid #e5e7eb'
  },
  modeOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: 'pointer',
    fontSize: '1.1rem'
  },
  uploadSection: {
    padding: '2rem'
  },
  templateSection: {
    background: '#eff6ff',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '2rem',
    textAlign: 'center'
  },
  templateText: {
    margin: '0 0 1rem 0',
    color: '#1e40af',
    fontSize: '1rem'
  },
  downloadButton: {
    padding: '0.75rem 2rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  uploadArea: {
    marginBottom: '2rem'
  },
  fileInput: {
    display: 'none'
  },
  uploadLabel: {
    display: 'block',
    padding: '3rem',
    border: '2px dashed #d1d5db',
    borderRadius: '12px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: '#f9fafb'
  },
  uploadIcon: {
    fontSize: '4rem',
    marginBottom: '1rem'
  },
  uploadText: {
    fontSize: '1.1rem',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  uploadHint: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  formatInfo: {
    background: '#f9fafb',
    padding: '1.5rem',
    borderRadius: '12px'
  },
  formatTitle: {
    margin: '0 0 1rem 0',
    fontSize: '1rem',
    color: '#374151'
  },
  formatTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  manualSection: {
    padding: '2rem'
  },
  manualTableWrapper: {
    overflowX: 'auto',
    marginBottom: '1rem'
  },
  manualTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  tableInput: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.875rem'
  },
  tableSelect: {
    width: '100%',
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '0.875rem'
  },
  removeButton: {
    background: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '1rem'
  },
  addRowButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    marginRight: '1rem'
  },
  previewButton: {
    padding: '0.75rem 2rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  previewSection: {
    padding: '2rem'
  },
  previewTitle: {
    margin: '0 0 1.5rem 0',
    fontSize: '1.25rem',
    color: '#1f2937'
  },
  errorSection: {
    background: '#fee2e2',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  errorTitle: {
    margin: '0 0 0.5rem 0',
    color: '#dc2626'
  },
  errorItem: {
    marginBottom: '0.5rem'
  },
  errorList: {
    margin: '0.25rem 0 0 1.5rem',
    color: '#991b1b'
  },
  previewTableWrapper: {
    overflowX: 'auto',
    marginBottom: '1.5rem',
    maxHeight: '400px',
    overflow: 'auto',
    border: '1px solid #e5e7eb',
    borderRadius: '8px'
  },
  previewTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.875rem'
  },
  roleBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    background: '#e0e7ff',
    color: '#4f46e5',
    borderRadius: '4px',
    fontSize: '0.75rem',
    marginRight: '0.25rem'
  },
  previewActions: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem'
  },
  backButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '2px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600'
  },
  importButton: {
    padding: '0.75rem 2rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  }
};

// 为表格添加样式
const styleSheet = document.createElement('style');
styleSheet.textContent = `
  table th {
    background: #f3f4f6;
    padding: 0.75rem;
    text-align: left;
    border-bottom: 2px solid #d1d5db;
    font-weight: 600;
    color: #374151;
  }
  table td {
    padding: 0.75rem;
    border-bottom: 1px solid #e5e7eb;
  }
  table tbody tr:hover {
    background: #f9fafb;
  }
`;
document.head.appendChild(styleSheet);

export default BatchImportUser;