import { useState } from 'react';
import { auth } from '../../config/firebase';
import { safeFetch } from '../../services/safeFetch';

const AssignEventManager = ({ organization, event, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    phoneNumber: '',
    password: '',
    englishName: '',
    chineseName: '',
    email: '',
    identityTag: '',
    identityId: '',
    department: ''
  });
  // 部門選項（根據 organization.departments）
  const availableDepartments = organization.departments?.filter(dep => dep.isActive) || [];

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const availableIdentityTags = organization.identityTags
    ?.filter(tag => tag.isActive)
    ?.sort((a, b) => a.displayOrder - b.displayOrder) || [];

  if (!formData.identityTag && availableIdentityTags.length > 0) {
    formData.identityTag = availableIdentityTags[0].id;
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError('');
  };

  const validateForm = () => {
    // 验证必填字段
    if (!formData.phoneNumber || !formData.password || !formData.englishName || !formData.identityTag || !formData.department) {
      setError('请填写所有必填字段');
      return false;
    }

    // 验证手机号格式
    if (!/^01\d{8,9}$/.test(formData.phoneNumber)) {
      setError('手机号格式不正确，请输入01开头的10-11位数字');
      return false;
    }

    // 验证密码强度
    if (formData.password.length < 8) {
      setError('密码至少需要8个字符');
      return false;
    }

    if (!/[a-zA-Z]/.test(formData.password) || !/\d/.test(formData.password)) {
      setError('密码必须包含英文字母和数字');
      return false;
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      console.log('[AssignEventManager] Calling /api/createEventManagerHttp via HTTP...');

      const idToken = await auth.currentUser?.getIdToken(true);
      if (!idToken) {
        throw new Error('需要登录');
      }

      const resp = await safeFetch('/api/createEventManagerHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          eventId: event.id,
          phoneNumber: formData.phoneNumber,
          password: formData.password,
          englishName: formData.englishName,
          chineseName: formData.chineseName,
          email: formData.email,
        })
      });

      if (!resp.ok) {
        if (resp.status === 401) {
          const unauth = new Error('需要登录');
          unauth.code = 'unauthenticated';
          unauth.status = 401;
          throw unauth;
        }
        // 更健壮的错误解析
        let text = '';
        let data = null;
        try {
          text = await resp.text();
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          // 非 JSON 回應保持 text
        }
        const code = data?.error?.code || data?.code || undefined;
        const message = data?.error?.message || data?.message || text || `HTTP ${resp.status}`;
        const err = new Error(message);
        if (code) err.code = code;
        err.status = resp.status;
        throw err;
      }

      const result = await resp.json();
      console.log('[AssignEventManager] Success:', result);

      alert(`Event Manager 创建成功！\n\n手机号：${formData.phoneNumber}\n姓名：${formData.englishName}`);

      if (onSuccess) {
        onSuccess();
      }

    } catch (err) {
      console.error('[AssignEventManager] Error:', err);

      let errorMessage = '创建 Event Manager 失败';

      if (err.status === 409 || err.code === 'already-exists') {
        errorMessage = err.message || '此活动已有 Event Manager 或手机号已被使用';
      } else if (err.code === 'permission-denied') {
        errorMessage = '权限不足，只有 Platform Admin 可以指派 Event Manager';
      } else if (err.code === 'invalid-argument') {
        errorMessage = err.message || '输入数据格式不正确';
      } else if (err.code === 'not-found') {
        errorMessage = err.message || '组织或活动不存在';
      } else if (err.message) {
        errorMessage = err.message;
      }

      setError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>指派 Event Manager</h2>
          <button
            style={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div style={styles.infoBox}>
          <div style={styles.infoRow}>
            <strong>组织：</strong>
            <span>{organization.orgName['zh-CN']}</span>
          </div>
          <div style={styles.infoRow}>
            <strong>活动：</strong>
            <span>{event.eventName['zh-CN']}</span>
          </div>
          <div style={styles.infoRow}>
            <strong>活动代码：</strong>
            <span>{organization.orgCode}-{event.eventCode}</span>
          </div>
        </div>

        {/* 检查是否有可用的身份标签 */}
        {availableIdentityTags.length === 0 && (
          <div style={styles.warningBox}>
            ⚠️ <strong>警告：</strong>此组织还没有设置身份标签。
            <br />
            请先在组织卡片中点击"🏷️ 身份标签"按钮设置身份标签。
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>
              手机号 <span style={styles.required}>*</span>
            </label>
            <input
              type="tel"
              name="phoneNumber"
              value={formData.phoneNumber}
              onChange={handleChange}
              placeholder="01xxxxxxxx"
              style={styles.input}
              disabled={submitting}
              maxLength="11"
            />
            <small style={styles.hint}>马来西亚手机号，01开头</small>
          </div>

          {/* 部門輸入欄位 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              部门 <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              name="department"
              value={formData.department}
              onChange={handleChange}
              placeholder="请输入部门名称"
              style={styles.input}
              disabled={submitting}
            />
            <small style={styles.hint}>请填写 Event Manager 所属部门（如无可填“无”）</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              初始密码 <span style={styles.required}>*</span>
            </label>
            <input
              type="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              placeholder="至少8位，包含英文和数字"
              style={styles.input}
              disabled={submitting}
              minLength="8"
            />
            <small style={styles.hint}>至少8个字符，必须包含英文字母和数字</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              英文名 <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              name="englishName"
              value={formData.englishName}
              onChange={handleChange}
              placeholder="例如：John Doe"
              style={styles.input}
              disabled={submitting}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>中文名</label>
            <input
              type="text"
              name="chineseName"
              value={formData.chineseName}
              onChange={handleChange}
              placeholder="例如：张三"
              style={styles.input}
              disabled={submitting}
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>电子邮箱</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="example@email.com"
              style={styles.input}
              disabled={submitting}
            />
          </div>

          {/* ✨ 新增：identityId 字段 */}
          <div style={styles.formGroup}>
            <label style={styles.label}>
              工号/学号
            </label>
            <input
              type="text"
              name="identityId"
              value={formData.identityId}
              onChange={handleChange}
              placeholder="例如：T12345 或 S202401001"
              style={styles.input}
              disabled={submitting}
            />
            <small style={styles.hint}>
              教职员工号或学生学号（可选，但建议填写）
            </small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>
              身份标签 <span style={styles.required}>*</span>
            </label>
            {/* 动态生成选项 */}
            <select
              name="identityTag"
              value={formData.identityTag}
              onChange={handleChange}
              style={styles.select}
              disabled={submitting || availableIdentityTags.length === 0}
            >
              {availableIdentityTags.length === 0 ? (
                <option value="">无可用身份标签</option>
              ) : (
                availableIdentityTags.map(tag => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name['zh-CN']} ({tag.name['en']})
                  </option>
                ))
              )}
            </select>
            <small style={styles.hint}>Event Manager 必须是组织成员</small>
          </div>

          {error && (
            <div style={styles.errorMessage}>
              ⚠️ {error}
            </div>
          )}

          <div style={styles.modalActions}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...(submitting || availableIdentityTags.length === 0 ? styles.submitButtonDisabled : {})
              }}
              disabled={submitting || availableIdentityTags.length === 0}
            >
              {submitting ? '创建中...' : '创建 Event Manager'}
            </button>
          </div>
        </form>
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
    maxWidth: '600px',
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
  infoBox: {
    background: '#f3f4f6',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1.5rem'
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '0.5rem',
    fontSize: '0.875rem'
  },
  warningBox: {
    background: '#fef3c7',
    border: '1px solid #fbbf24',
    color: '#92400e',
    padding: '1rem',
    borderRadius: '8px',
    fontSize: '0.875rem',
    marginBottom: '1.5rem',
    lineHeight: '1.5'
  },
  formGroup: {
    marginBottom: '1.5rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '0.5rem'
  },
  required: {
    color: '#ef4444'
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '1rem',
    outline: 'none',
    boxSizing: 'border-box',
    background: 'white'
  },
  hint: {
    display: 'block',
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  errorMessage: {
    padding: '0.875rem',
    background: '#fee2e2',
    color: '#991b1b',
    borderRadius: '8px',
    fontSize: '0.875rem',
    border: '1px solid #fecaca',
    marginBottom: '1rem'
  },
  modalActions: {
    display: 'flex',
    gap: '1rem',
    justifyContent: 'flex-end',
    marginTop: '2rem'
  },
  cancelButton: {
    padding: '0.75rem 1.5rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '1rem',
    cursor: 'pointer',
    fontWeight: '500'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  submitButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  }
};

export default AssignEventManager;