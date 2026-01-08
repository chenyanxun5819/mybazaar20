import { useState } from 'react';
import { Store, Phone, Mail, Edit2, Save, X, Power, PowerOff, AlertCircle } from 'lucide-react';
import './MerchantProfile.css';

/**
 * MerchantProfile - 商家基本资料组件
 */
const MerchantProfile = ({ merchant, onUpdate, onToggleStatus }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [formData, setFormData] = useState({
    stallName: merchant?.stallName || '',
    description: merchant?.description || '',
    contactInfo: {
      phone: merchant?.contactInfo?.phone || '',
      email: merchant?.contactInfo?.email || '',
      note: merchant?.contactInfo?.note || ''
    }
  });

  // 处理输入变化
  const handleChange = (field, value) => {
    if (field.startsWith('contactInfo.')) {
      const contactField = field.split('.')[1];
      setFormData(prev => ({
        ...prev,
        contactInfo: {
          ...prev.contactInfo,
          [contactField]: value
        }
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
    }
  };

  // 保存修改
  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      // 验证必填字段
      if (!formData.stallName.trim()) {
        throw new Error('摊位名称不能为空');
      }

      if (!formData.contactInfo.phone.trim()) {
        throw new Error('联络电话不能为空');
      }

      await onUpdate(formData);
      setIsEditing(false);
    } catch (err) {
      console.error('Error saving profile:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // 取消编辑
  const handleCancel = () => {
    setFormData({
      stallName: merchant?.stallName || '',
      description: merchant?.description || '',
      contactInfo: {
        phone: merchant?.contactInfo?.phone || '',
        email: merchant?.contactInfo?.email || '',
        note: merchant?.contactInfo?.note || ''
      }
    });
    setIsEditing(false);
    setError(null);
  };

  return (
    <div className="merchant-profile-container">
      {/* 基本资料卡片 */}
      <div className="merchant-profile-card">
        {/* Header */}
        <div className="merchant-profile-header">
          <div className="merchant-profile-title">
            <div className="merchant-profile-icon">
              <Store />
            </div>
            <h3>基本资料</h3>
          </div>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="merchant-edit-btn"
            >
              <Edit2 />
              编辑
            </button>
          )}
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="merchant-error-alert">
            <AlertCircle />
            <p>{error}</p>
          </div>
        )}

        {/* 表单内容 */}
        <div className="merchant-form">
          {/* 摊位名称 */}
          <div className="merchant-form-field">
            <label>
              摊位名称 <span className="required">*</span>
            </label>
            {isEditing ? (
              <input
                type="text"
                value={formData.stallName}
                onChange={(e) => handleChange('stallName', e.target.value)}
                placeholder="例如：美食天地"
              />
            ) : (
              <p className="view-only">{merchant?.stallName || '-'}</p>
            )}
          </div>

          {/* 描述 */}
          <div className="merchant-form-field">
            <label>描述</label>
            {isEditing ? (
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                rows={3}
                placeholder="简单介绍您的摊位..."
              />
            ) : (
              <p className="view-only">{merchant?.description || '-'}</p>
            )}
          </div>

          {/* 联络电话 */}
          <div className="merchant-form-field">
            <label>
              <Phone />
              联络电话 <span className="required">*</span>
            </label>
            {isEditing ? (
              <input
                type="tel"
                value={formData.contactInfo.phone}
                onChange={(e) => handleChange('contactInfo.phone', e.target.value)}
                placeholder="+60123456789"
              />
            ) : (
              <p className="view-only">{merchant?.contactInfo?.phone || '-'}</p>
            )}
          </div>

          {/* 电子邮箱（可选） */}
          <div className="merchant-form-field">
            <label>
              <Mail />
              电子邮箱
            </label>
            {isEditing ? (
              <input
                type="email"
                value={formData.contactInfo.email}
                onChange={(e) => handleChange('contactInfo.email', e.target.value)}
                placeholder="example@email.com"
              />
            ) : (
              <p className="view-only">{merchant?.contactInfo?.email || '-'}</p>
            )}
          </div>

          {/* 备注（可选） */}
          <div className="merchant-form-field">
            <label>备注</label>
            {isEditing ? (
              <textarea
                value={formData.contactInfo.note}
                onChange={(e) => handleChange('contactInfo.note', e.target.value)}
                rows={2}
                placeholder="其他备注信息..."
              />
            ) : (
              <p className="view-only">{merchant?.contactInfo?.note || '-'}</p>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        {isEditing && (
          <div className="merchant-form-actions">
            <button
              onClick={handleSave}
              disabled={loading}
              className="merchant-save-btn"
            >
              <Save />
              {loading ? '保存中...' : '保存'}
            </button>
            <button
              onClick={handleCancel}
              disabled={loading}
              className="merchant-cancel-btn"
            >
              <X />
              取消
            </button>
          </div>
        )}
      </div>

      {/* 其他信息 */}
      <div className="merchant-meta-info">
        <p>商家信息</p>
        <div className="merchant-meta-list">
          <div className="merchant-meta-row">
            <span>商家编号</span>
            <span>{merchant?.id?.substring(0, 12)}...</span>
          </div>
          <div className="merchant-meta-row">
            <span>创建时间</span>
            <span>
              {merchant?.metadata?.createdAt
                ? new Date(merchant.metadata.createdAt.toDate()).toLocaleDateString('zh-CN')
                : '-'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MerchantProfile;
