import { useState, useEffect } from 'react';

const EditMerchantModal = ({ merchant, onClose, onSubmit, availableOwners, availableAsists }) => {
  const [formData, setFormData] = useState({
    stallName: '',
    description: '',
    contactInfo: {
      phone: '',
      email: '',
      note: ''
    },
    newMerchantOwnerId: '',
    merchantAsists: {
      add: [],
      remove: []
    },
    isActive: false
  });

  const [currentAsists, setCurrentAsists] = useState([]);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 初始化表单数据
  useEffect(() => {
    if (merchant) {
      setFormData({
        stallName: merchant.stallName || '',
        description: merchant.description || '',
        contactInfo: {
          phone: merchant.contactInfo?.phone || '',
          email: merchant.contactInfo?.email || '',
          note: merchant.contactInfo?.note || ''
        },
        newMerchantOwnerId: merchant.merchantOwnerId || '',
        merchantAsists: {
          add: [],
          remove: []
        },
        isActive: merchant.operationStatus?.isActive || false
      });
      setCurrentAsists(merchant.merchantAsists || []);
    }
  }, [merchant]);

  // 验证表单
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.stallName.trim()) {
      newErrors.stallName = '请输入摊位名称';
    }
    
    if (!formData.contactInfo.phone.trim()) {
      newErrors.phone = '请输入联系电话';
    }
    
    // 检查助理总数
    const totalAsists = currentAsists.length + formData.merchantAsists.add.length - formData.merchantAsists.remove.length;
    if (totalAsists > 5) {
      newErrors.asists = `助理数量不能超过5人（当前将有${totalAsists}人）`;
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // 提交表单
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // 准备更新数据
      const updates = {};
      
      // 基本信息
      if (formData.stallName !== merchant.stallName) {
        updates.stallName = formData.stallName.trim();
      }
      if (formData.description !== merchant.description) {
        updates.description = formData.description.trim();
      }
      
      // 联系方式
      if (formData.contactInfo.phone !== merchant.contactInfo?.phone ||
          formData.contactInfo.email !== merchant.contactInfo?.email ||
          formData.contactInfo.note !== merchant.contactInfo?.note) {
        updates.contactInfo = {
          phone: formData.contactInfo.phone.trim(),
          email: formData.contactInfo.email.trim(),
          note: formData.contactInfo.note.trim()
        };
      }
      
      // 摊主
      if (formData.newMerchantOwnerId !== merchant.merchantOwnerId) {
        updates.newMerchantOwnerId = formData.newMerchantOwnerId || null;
      }
      
      // 助理
      if (formData.merchantAsists.add.length > 0 || formData.merchantAsists.remove.length > 0) {
        updates.merchantAsists = formData.merchantAsists;
      }
      
      // 营业状态
      if (formData.isActive !== merchant.operationStatus?.isActive) {
        updates.isActive = formData.isActive;
      }
      
      // 如果没有任何更新，提示用户
      if (Object.keys(updates).length === 0) {
        window.mybazaarShowToast('没有任何修改');
        return;
      }
      
      await onSubmit(merchant.id, updates);
    } catch (error) {
      console.error('提交失败:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 处理助理添加
  const handleAddAsist = (asistId) => {
    setFormData(prev => ({
      ...prev,
      merchantAsists: {
        ...prev.merchantAsists,
        add: [...prev.merchantAsists.add, asistId],
        remove: prev.merchantAsists.remove.filter(id => id !== asistId)
      }
    }));
  };

  // 处理助理移除
  const handleRemoveAsist = (asistId) => {
    setFormData(prev => ({
      ...prev,
      merchantAsists: {
        ...prev.merchantAsists,
        remove: [...prev.merchantAsists.remove, asistId],
        add: prev.merchantAsists.add.filter(id => id !== asistId)
      }
    }));
  };

  // 取消助理操作
  const handleCancelAsistChange = (asistId) => {
    setFormData(prev => ({
      ...prev,
      merchantAsists: {
        add: prev.merchantAsists.add.filter(id => id !== asistId),
        remove: prev.merchantAsists.remove.filter(id => id !== asistId)
      }
    }));
  };

  // 获取助理显示状态
  const getAsistStatus = (asistId) => {
    if (formData.merchantAsists.add.includes(asistId)) return 'adding';
    if (formData.merchantAsists.remove.includes(asistId)) return 'removing';
    if (currentAsists.includes(asistId)) return 'current';
    return 'available';
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={styles.header}>
          <h2 style={styles.title}>编辑摊位</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.scrollContainer}>
            {/* 基本信息 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>基本信息</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  摊位名称 <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  value={formData.stallName}
                  onChange={(e) => setFormData({ ...formData, stallName: e.target.value })}
                  style={{...styles.input, ...(errors.stallName && styles.inputError)}}
                />
                {errors.stallName && <div style={styles.errorText}>{errors.stallName}</div>}
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>摊位描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows="3"
                  style={styles.textarea}
                />
              </div>
            </div>

            {/* 摊主管理 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>摊主管理</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>指定摊主</label>
                <select
                  value={formData.newMerchantOwnerId}
                  onChange={(e) => setFormData({ ...formData, newMerchantOwnerId: e.target.value })}
                  style={styles.select}
                >
                  <option value="">-- 不指定摊主 --</option>
                  {/* 当前摊主 */}
                  {merchant.merchantOwnerId && (
                    <option value={merchant.merchantOwnerId}>
                      （当前）{/* 这里应该显示摊主姓名 */}
                    </option>
                  )}
                  {/* 可用摊主 */}
                  {availableOwners.map(owner => (
                    <option key={owner.id} value={owner.id}>
                      {owner.basicInfo?.chineseName || owner.id}
                    </option>
                  ))}
                </select>
                {formData.newMerchantOwnerId !== merchant.merchantOwnerId && (
                  <div style={styles.changeNotice}>
                    ⚠️ 将更换摊主
                  </div>
                )}
              </div>
            </div>

            {/* 助理管理 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>助理管理（最多5人）</h3>
              
              {/* 当前助理 */}
              {currentAsists.length > 0 && (
                <div style={styles.formGroup}>
                  <label style={styles.label}>当前助理</label>
                  <div style={styles.asistList}>
                    {currentAsists.map(asistId => {
                      const asist = availableAsists.find(a => a.id === asistId);
                      const status = getAsistStatus(asistId);
                      
                      return (
                        <div key={asistId} style={styles.asistItem}>
                          <span>
                            {asist?.basicInfo?.chineseName || asistId}
                          </span>
                          {status === 'current' && (
                            <button
                              type="button"
                              onClick={() => handleRemoveAsist(asistId)}
                              style={styles.removeButton}
                            >
                              移除
                            </button>
                          )}
                          {status === 'removing' && (
                            <>
                              <span style={styles.removingTag}>待移除</span>
                              <button
                                type="button"
                                onClick={() => handleCancelAsistChange(asistId)}
                                style={styles.cancelButton}
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 可添加的助理 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>添加助理</label>
                <div style={styles.asistList}>
                  {availableAsists
                    .filter(asist => !currentAsists.includes(asist.id))
                    .map(asist => {
                      const status = getAsistStatus(asist.id);
                      
                      return (
                        <div key={asist.id} style={styles.asistItem}>
                          <span>
                            {asist.basicInfo?.chineseName || asist.id}
                            {asist.merchantAsist?.merchantId && (
                              <span style={styles.asistCount}>
                                (已关联商家)
                              </span>
                            )}
                          </span>
                          {status === 'available' && (
                            <button
                              type="button"
                              onClick={() => handleAddAsist(asist.id)}
                              style={styles.addButton}
                              disabled={
                                currentAsists.length + 
                                formData.merchantAsists.add.length - 
                                formData.merchantAsists.remove.length >= 5
                              }
                            >
                              添加
                            </button>
                          )}
                          {status === 'adding' && (
                            <>
                              <span style={styles.addingTag}>待添加</span>
                              <button
                                type="button"
                                onClick={() => handleCancelAsistChange(asist.id)}
                                style={styles.cancelButton}
                              >
                                取消
                              </button>
                            </>
                          )}
                        </div>
                      );
                    })}
                </div>
                {errors.asists && <div style={styles.errorText}>{errors.asists}</div>}
                <div style={styles.hint}>
                  当前助理: {currentAsists.length}
                  {formData.merchantAsists.add.length > 0 && ` + ${formData.merchantAsists.add.length}`}
                  {formData.merchantAsists.remove.length > 0 && ` - ${formData.merchantAsists.remove.length}`}
                  {' = '}
                  {currentAsists.length + formData.merchantAsists.add.length - formData.merchantAsists.remove.length} / 5
                </div>
              </div>
            </div>

            {/* 营业状态 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>营业状态</h3>
              
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  style={styles.checkbox}
                />
                <span>营业中</span>
              </label>
            </div>
          </div>

          {/* 底部按钮 */}
          <div style={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelButtonFooter}
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              style={styles.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? '保存中...' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 样式（复用 CreateMerchantModal 的样式，添加一些额外的）
const styles = {
  overlay: {
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
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '600px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)'
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
    fontWeight: '700',
    color: '#1f2937',
    margin: 0
  },
  closeButton: {
    backgroundColor: 'transparent',
    border: 'none',
    fontSize: '1.5rem',
    cursor: 'pointer',
    color: '#6b7280',
    padding: '0.25rem',
    width: '32px',
    height: '32px'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden'
  },
  scrollContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '1.5rem'
  },
  section: {
    marginBottom: '2rem'
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem',
    paddingBottom: '0.5rem',
    borderBottom: '2px solid #f3f4f6'
  },
  formGroup: {
    marginBottom: '1.25rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  required: {
    color: '#ef4444'
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    boxSizing: 'border-box'
  },
  inputError: {
    borderColor: '#ef4444'
  },
  textarea: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    resize: 'vertical',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: 'white',
    cursor: 'pointer',
    boxSizing: 'border-box'
  },
  changeNotice: {
    fontSize: '0.875rem',
    color: '#f59e0b',
    marginTop: '0.5rem',
    fontWeight: '500'
  },
  asistList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  asistItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem',
    backgroundColor: 'white',
    borderRadius: '6px',
    fontSize: '0.875rem'
  },
  asistCount: {
    color: '#6b7280',
    fontSize: '0.75rem',
    marginLeft: '0.5rem'
  },
  addButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  removeButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  cancelButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151'
  },
  addingTag: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  removingTag: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: 'pointer',
    fontSize: '0.875rem'
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.5rem'
  },
  errorText: {
    fontSize: '0.875rem',
    color: '#ef4444',
    marginTop: '0.5rem'
  },
  footer: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem',
    borderTop: '2px solid #e5e7eb',
    justifyContent: 'flex-end'
  },
  cancelButtonFooter: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    color: '#374151'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(139,92,246,0.3)'
  }
};

export default EditMerchantModal;

