import { useState } from 'react';

const CreateMerchantModal = ({ onClose, onSubmit, availableOwners, availableAsists }) => {
  const [formData, setFormData] = useState({
    stallName: '',
    description: '',
    contactInfo: {
      phone: '',
      email: '',
      note: ''
    },
    merchantOwnerId: '',
    merchantAsists: [],
    isActive: false
  });

  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 验证表单
  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.stallName.trim()) {
      newErrors.stallName = '请输入摊位名称';
    }
    
    if (!formData.contactInfo.phone.trim()) {
      newErrors.phone = '请输入联系电话';
    } else if (!/^\+?[0-9\s\-()]+$/.test(formData.contactInfo.phone)) {
      newErrors.phone = '请输入有效的电话号码';
    }
    
    if (formData.merchantAsists.length > 5) {
      newErrors.asists = '助理数量不能超过5人';
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
      // 准备提交数据
      const submitData = {
        stallName: formData.stallName.trim(),
        description: formData.description.trim(),
        contactInfo: {
          phone: formData.contactInfo.phone.trim(),
          email: formData.contactInfo.email.trim(),
          note: formData.contactInfo.note.trim()
        },
        isActive: formData.isActive
      };
      
      // 只在有值时添加 owner 和 asists
      if (formData.merchantOwnerId) {
        submitData.merchantOwnerId = formData.merchantOwnerId;
      }
      
      if (formData.merchantAsists.length > 0) {
        submitData.merchantAsists = formData.merchantAsists;
      }
      
      await onSubmit(submitData);
    } catch (error) {
      console.error('提交失败:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 处理助理选择
  const handleAsistToggle = (asistId) => {
    setFormData(prev => {
      const newAsists = prev.merchantAsists.includes(asistId)
        ? prev.merchantAsists.filter(id => id !== asistId)
        : [...prev.merchantAsists, asistId];
      
      return {
        ...prev,
        merchantAsists: newAsists
      };
    });
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={styles.header}>
          <h2 style={styles.title}>创建摊位</h2>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.scrollContainer}>
            {/* 基本信息 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>基本信息</h3>
              
              {/* 摊位名称 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  摊位名称 <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  value={formData.stallName}
                  onChange={(e) => setFormData({ ...formData, stallName: e.target.value })}
                  placeholder="例如：美食天地"
                  style={{...styles.input, ...(errors.stallName && styles.inputError)}}
                />
                {errors.stallName && <div style={styles.errorText}>{errors.stallName}</div>}
              </div>

              {/* 摊位描述 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>摊位描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="简单介绍一下摊位..."
                  rows="3"
                  style={styles.textarea}
                />
              </div>
            </div>

            {/* 联系方式 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>联系方式</h3>
              
              {/* 联系电话 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  联系电话 <span style={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  value={formData.contactInfo.phone}
                  onChange={(e) => setFormData({
                    ...formData,
                    contactInfo: { ...formData.contactInfo, phone: e.target.value }
                  })}
                  placeholder="+60123456789"
                  style={{...styles.input, ...(errors.phone && styles.inputError)}}
                />
                {errors.phone && <div style={styles.errorText}>{errors.phone}</div>}
              </div>

              {/* 联系邮箱 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>联系邮箱（可选）</label>
                <input
                  type="email"
                  value={formData.contactInfo.email}
                  onChange={(e) => setFormData({
                    ...formData,
                    contactInfo: { ...formData.contactInfo, email: e.target.value }
                  })}
                  placeholder="email@example.com"
                  style={styles.input}
                />
              </div>

              {/* 备注 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>备注（可选）</label>
                <textarea
                  value={formData.contactInfo.note}
                  onChange={(e) => setFormData({
                    ...formData,
                    contactInfo: { ...formData.contactInfo, note: e.target.value }
                  })}
                  placeholder="营业时间、特殊说明等..."
                  rows="2"
                  style={styles.textarea}
                />
              </div>
            </div>

            {/* 人员分配 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>人员分配（可选）</h3>
              
              {/* 指定摊主 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>指定摊主</label>
                <select
                  value={formData.merchantOwnerId}
                  onChange={(e) => setFormData({ ...formData, merchantOwnerId: e.target.value })}
                  style={styles.select}
                >
                  <option value="">-- 暂不指定 --</option>
                  {availableOwners.map(owner => (
                    <option key={owner.id} value={owner.id}>
                      {owner.basicInfo?.chineseName || owner.id} - {owner.basicInfo?.phoneNumber}
                    </option>
                  ))}
                </select>
                <div style={styles.hint}>
                  可用摊主: {availableOwners.length} 人
                </div>
              </div>

              {/* 添加助理 */}
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  添加助理（最多5人）
                </label>
                <div style={styles.checkboxGrid}>
                  {availableAsists.length === 0 ? (
                    <div style={styles.emptyText}>暂无可用助理</div>
                  ) : (
                    availableAsists.map(asist => (
                      <label key={asist.id} style={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={formData.merchantAsists.includes(asist.id)}
                          onChange={() => handleAsistToggle(asist.id)}
                          disabled={
                            !formData.merchantAsists.includes(asist.id) &&
                            formData.merchantAsists.length >= 5
                          }
                          style={styles.checkbox}
                        />
                        <span>
                          {asist.basicInfo?.chineseName || asist.id}
                          {asist.merchantAsist?.assignedMerchants?.length > 0 && (
                            <span style={styles.asistCount}>
                              ({asist.merchantAsist.assignedMerchants.length} 个摊位)
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </div>
                {errors.asists && <div style={styles.errorText}>{errors.asists}</div>}
                <div style={styles.hint}>
                  已选择: {formData.merchantAsists.length} / 5
                </div>
              </div>
            </div>

            {/* 初始状态 */}
            <div style={styles.section}>
              <h3 style={styles.sectionTitle}>初始状态</h3>
              
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  style={styles.checkbox}
                />
                <span>立即开始营业</span>
              </label>
              <div style={styles.hint}>
                如果不勾选，摊位将处于"已暂停"状态，需要手动开启营业
              </div>
            </div>
          </div>

          {/* 底部按钮 */}
          <div style={styles.footer}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelButton}
              disabled={isSubmitting}
            >
              取消
            </button>
            <button
              type="submit"
              style={styles.submitButton}
              disabled={isSubmitting}
            >
              {isSubmitting ? '创建中...' : '创建摊位'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 样式
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
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '6px'
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
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '0.75rem',
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '8px'
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
  asistCount: {
    color: '#6b7280',
    fontSize: '0.75rem',
    marginLeft: '0.25rem'
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
  emptyText: {
    color: '#9ca3af',
    fontStyle: 'italic'
  },
  footer: {
    display: 'flex',
    gap: '1rem',
    padding: '1.5rem',
    borderTop: '2px solid #e5e7eb',
    justifyContent: 'flex-end'
  },
  cancelButton: {
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

export default CreateMerchantModal;
