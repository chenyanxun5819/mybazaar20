import { useState, useEffect } from 'react';
import { db, functions, storage } from '../../config/firebase';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, getDoc, deleteDoc } from 'firebase/firestore';
import { auth } from '../../config/firebase';
import { safeFetch } from '../../services/safeFetch';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
// ✅ 新增 Storage imports
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import MerchantQRPrintModal from './components/MerchantQRPrintModal';

const PlatformDashboard = () => {
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const orgsSnapshot = await getDocs(collection(db, 'organizations'));
      const orgsData = await Promise.all(
        orgsSnapshot.docs.map(async (orgDoc) => {
          const orgData = orgDoc.data();

          const eventsSnapshot = await getDocs(
            collection(db, 'organizations', orgDoc.id, 'events')
          );
          const events = eventsSnapshot.docs.map(eventDoc => ({
            id: eventDoc.id,
            ...eventDoc.data()
          }));

          return {
            id: orgDoc.id,
            ...orgData,
            events
          };
        })
      );

      // ✅ 添加总计日志
      const totalUsers = orgsData.reduce((sum, org) => sum + (org.statistics?.totalUsers || 0), 0);
      console.log('[PlatformDashboard] 总用户数:', totalUsers);
      console.log('[PlatformDashboard] 组织数据:', orgsData);

      setOrganizations(orgsData);
    } catch (error) {
      console.error('加载组织失败:', error);
      window.mybazaarShowToast('加载组织失败: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  // ← 新增登出函數
  const handleLogout = async () => {
    try {
      console.log('[PlatformDashboard] 开始登出');
      await signOut(auth);
      console.log('[PlatformDashboard] 登出成功');
      // 使用 react-router 的导航，避免直接刷新导致状态不一致
      navigate('/platform/login');
    } catch (error) {
      console.error('[PlatformDashboard] 登出失败:', error);
      window.mybazaarShowToast('登出失败：' + error.message);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* ← 修改后的 header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🎯 Platform 管理中心</h1>
          <p style={styles.subtitle}>管理所有组织和活动</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            style={styles.primaryButton}
            onClick={() => setShowCreateOrg(true)}
          >
            + 创建新组织
          </button>
          <button
            style={styles.logoutButton}
            onClick={handleLogout}
            title="登出"
          >
            🚪 登出
          </button>
        </div>
      </div>

      <div style={styles.statsGrid}>
        <StatCard
          title="总组织数"
          value={organizations.length}
          icon="🏢"
          color="#667eea"
        />
        <StatCard
          title="总活动数"
          value={organizations.reduce((sum, org) => sum + org.events.length, 0)}
          icon="📅"
          color="#764ba2"
        />
        <StatCard
          title="活跃活动"
          value={organizations.reduce(
            (sum, org) => sum + org.events.filter(e => e.status === 'active').length,
            0
          )}
          icon="✨"
          color="#10b981"
        />
        <StatCard
          title="总用户数"
          value={organizations.reduce((sum, org) => sum + (org.statistics?.totalUsers || 0), 0)}
          icon="👥"
          color="#f59e0b"
        />
      </div>

      <div style={styles.orgList}>
        {organizations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '64px', marginBottom: '1rem' }}>📦</div>
            <h3>还没有组织</h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              点击上方按钮创建第一个组织
            </p>
          </div>
        ) : (
          organizations.map(org => (
            <OrganizationCard
              key={org.id}
              organization={org}
              onCreateEvent={(org) => {
                setSelectedOrg(org);
                setShowCreateEvent(true);
              }}
              onReload={loadOrganizations}
            />
          ))
        )}
      </div>

      {showCreateOrg && (
        <CreateOrganizationModal
          onClose={() => setShowCreateOrg(false)}
          onSuccess={() => {
            setShowCreateOrg(false);
            loadOrganizations();
          }}
        />
      )}

      {showCreateEvent && (
        <CreateEventModal
          organization={selectedOrg}
          onClose={() => {
            setShowCreateEvent(false);
            setSelectedOrg(null);
          }}
          onSuccess={() => {
            setShowCreateEvent(false);
            setSelectedOrg(null);
            loadOrganizations();
          }}
        />
      )}

    </div>
  );
};

// ========== Logo 上传辅助函数 ==========

/**
 * 上传 logo 到 Firebase Storage
 * @param {File} file - 图片文件
 * @param {string} path - Storage 路径（如 'organizations/orgId/logo.png'）
 * @returns {Promise<string>} - 下载 URL
 */
const uploadLogo = async (file, path) => {
  try {
    console.log('[uploadLogo] 开始上传:', path);

    // 验证文件大小（2MB 限制）
    if (file.size > 2 * 1024 * 1024) {
      throw new Error('文件大小不能超过 2MB');
    }

    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      throw new Error('请选择图片文件');
    }

    const storageRef = ref(storage, path);
    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    console.log('[uploadLogo] ✅ 上传成功:', downloadURL);
    return downloadURL;
  } catch (error) {
    console.error('[uploadLogo] 上传失败:', error);
    throw error;
  }
};

/**
 * 调用 Cloud Function 更新组织 logo
 */
const updateOrganizationLogo = async (organizationId, logoUrl, idToken) => {
  try {
    const response = await fetch(
      `https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/updateOrganizationLogoHttp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          logoUrl
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[updateOrganizationLogo] 错误:', error);
    throw error;
  }
};

/**
 * 调用 Cloud Function 更新活动 logo
 */
const updateEventLogo = async (organizationId, eventId, logoUrl, idToken) => {
  try {
    const response = await fetch(
      `https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/updateEventLogoHttp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          logoUrl
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[updateEventLogo] 错误:', error);
    throw error;
  }
};

/**
 * 调用 Cloud Function 更新活动详情
 */
const updateEventDetails = async (organizationId, eventId, updates, idToken) => {
  try {
    const response = await fetch(
      `https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/updateEventDetailsHttp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          updates
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[updateEventDetails] 错误:', error);
    throw error;
  }
};

/**
 * 调用 Cloud Function 重置活动 users
 */
const resetEventUsers = async (organizationId, eventId, newEventManager, idToken) => {
  try {
    const response = await fetch(
      `https://asia-southeast1-mybazaar-c4881.cloudfunctions.net/resetEventUsersHttp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          newEventManager
        })
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[resetEventUsers] 错误:', error);
    throw error;
  }
};

// ========== Logo 上传组件 ==========

const LogoUploadButton = ({ onUpload, currentLogoUrl, entityType = 'organization' }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setError(null);
      setUploading(true);
      await onUpload(file);
      setUploading(false);
    } catch (err) {
      setError(err.message);
      setUploading(false);
    }
  };

  return (
    <div style={styles.logoUploadContainer}>
      {/* Logo 预览 */}
      <div style={styles.logoPreviewSection}>
        {currentLogoUrl ? (
          <img
            src={currentLogoUrl}
            alt="Current Logo"
            style={styles.logoPreview}
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextElementSibling.style.display = 'flex';
            }}
          />
        ) : (
          <div style={styles.logoPlaceholder}>
            <span>📷</span>
          </div>
        )}
      </div>

      {/* 上传操作 */}
      <div style={styles.logoUploadActions}>
        <label style={styles.uploadButton}>
          {uploading ? '上传中...' : '选择新 Logo'}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            disabled={uploading}
            style={{ display: 'none' }}
          />
        </label>
        {error && <span style={styles.errorText}>{error}</span>}
      </div>
    </div>
  );
};

// ========== 编辑活动 Modal ==========

// ✅ 辅助函数：安全地将 Firestore Timestamp 转换为 ISO 日期字符串
const convertFirebaseTimestampToDateString = (timestamp) => {
  try {
    if (!timestamp) return '';

    let date;
    // 处理 Firestore Timestamp 对象
    if (timestamp.seconds) {
      date = new Date(timestamp.seconds * 1000);
    }
    // 处理 JavaScript Date 对象
    else if (timestamp instanceof Date) {
      date = timestamp;
    }
    // 处理 ISO 字符串
    else if (typeof timestamp === 'string') {
      date = new Date(timestamp);
    }
    else {
      return '';
    }

    // 验证日期是否有效
    if (isNaN(date.getTime())) {
      console.warn('[convertFirebaseTimestampToDateString] 无效的日期:', timestamp);
      return '';
    }

    // 转换为本地日期字符串 (YYYY-MM-DD 格式)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  } catch (error) {
    console.error('[convertFirebaseTimestampToDateString] 转换失败:', error);
    return '';
  }
};

const EditEventModal = ({ organization, event, onClose, onSuccess }) => {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // 表单状态 - ✅ 改用安全的转换函数
  const [fairDate, setFairDate] = useState(
    convertFirebaseTimestampToDateString(event.eventInfo?.fairDate) || ''
  );
  const [consumptionStart, setConsumptionStart] = useState(
    convertFirebaseTimestampToDateString(event.eventInfo?.consumptionPeriod?.start) || ''
  );
  const [consumptionEnd, setConsumptionEnd] = useState(
    convertFirebaseTimestampToDateString(event.eventInfo?.consumptionPeriod?.end) || ''
  );
  const [logoUrl, setLogoUrl] = useState(event.logoUrl || '');

  // 重置 users 相关状态
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetManagerData, setResetManagerData] = useState({
    chineseName: '',
    englishName: '',
    phoneNumber: '',
    password: ''
  });

  const handleLogoUpload = async (file) => {
    try {
      setError(null);
      const path = `events/${organization.id}/${event.id}/logo_${Date.now()}`;
      const downloadUrl = await uploadLogo(file, path);
      setLogoUrl(downloadUrl);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleSubmit = async () => {
    try {
      setError(null);
      setSubmitting(true);

      const idToken = await auth.currentUser.getIdToken();

      const updates = {};
      if (fairDate) {
        updates.fairDate = new Date(fairDate).getTime();
      }
      if (consumptionStart || consumptionEnd) {
        updates.consumptionPeriod = {};
        if (consumptionStart) updates.consumptionPeriod.start = new Date(consumptionStart).getTime();
        if (consumptionEnd) updates.consumptionPeriod.end = new Date(consumptionEnd).getTime();
      }
      if (logoUrl !== event.logoUrl) {
        updates.logoUrl = logoUrl;
      }

      await updateEventDetails(organization.id, event.id, updates, idToken);
      window.mybazaarShowToast('活动详情更新成功');
      setSubmitting(false);
      onSuccess();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  const handleResetUsers = async () => {
    try {
      setError(null);
      setSubmitting(true);

      if (!resetManagerData.chineseName || !resetManagerData.phoneNumber || !resetManagerData.password) {
        throw new Error('请填写所有必填字段');
      }

      const idToken = await auth.currentUser.getIdToken();
      await resetEventUsers(organization.id, event.id, resetManagerData, idToken);

      window.mybazaarShowToast('活动 users 已重置，新 Event Manager 已创建');
      setSubmitting(false);
      onSuccess();
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2>编辑活动：{event.eventName['zh-CN']}</h2>
          <button style={styles.closeButton} onClick={onClose}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {error && <div style={styles.errorBanner}>{error}</div>}

          {/* 标签页 */}
          <div style={styles.tabsContainer}>
            {/* Logo 上传标签页 */}
            <div style={styles.tabContent}>
              <h3>活动 Logo</h3>
              <LogoUploadButton
                onUpload={handleLogoUpload}
                currentLogoUrl={logoUrl}
                entityType="event"
              />
            </div>

            {/* 活动日期标签页 */}
            <div style={styles.tabContent}>
              <h3>活动日期</h3>
              <div style={styles.formGroup}>
                <label>活动日期</label>
                <input
                  type="date"
                  value={fairDate}
                  onChange={(e) => setFairDate(e.target.value)}
                  style={styles.formInput}
                />
              </div>
              <div style={styles.formGroup}>
                <label>消费开始日期</label>
                <input
                  type="date"
                  value={consumptionStart}
                  onChange={(e) => setConsumptionStart(e.target.value)}
                  style={styles.formInput}
                />
              </div>
              <div style={styles.formGroup}>
                <label>消费结束日期</label>
                <input
                  type="date"
                  value={consumptionEnd}
                  onChange={(e) => setConsumptionEnd(e.target.value)}
                  style={styles.formInput}
                />
              </div>
            </div>

            {/* 重置 Users 标签页 */}
            <div style={styles.tabContent}>
              <h3>⚠️ 重置活动 Users</h3>
              {showResetConfirm ? (
                <div>
                  <p style={styles.warningText}>
                    ⚠️ 此操作将删除该活动的所有 users 并创建新的 Event Manager。无法撤销！
                  </p>
                  <div style={styles.formGroup}>
                    <label>新 Event Manager 中文名</label>
                    <input
                      type="text"
                      value={resetManagerData.chineseName}
                      onChange={(e) => setResetManagerData({ ...resetManagerData, chineseName: e.target.value })}
                      style={styles.formInput}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label>新 Event Manager 英文名</label>
                    <input
                      type="text"
                      value={resetManagerData.englishName}
                      onChange={(e) => setResetManagerData({ ...resetManagerData, englishName: e.target.value })}
                      style={styles.formInput}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label>新 Event Manager 手机号</label>
                    <input
                      type="tel"
                      value={resetManagerData.phoneNumber}
                      onChange={(e) => setResetManagerData({ ...resetManagerData, phoneNumber: e.target.value })}
                      style={styles.formInput}
                    />
                  </div>
                  <div style={styles.formGroup}>
                    <label>新 Event Manager 密码</label>
                    <input
                      type="password"
                      value={resetManagerData.password}
                      onChange={(e) => setResetManagerData({ ...resetManagerData, password: e.target.value })}
                      style={styles.formInput}
                    />
                  </div>
                  <div style={styles.buttonGroup}>
                    <button
                      style={styles.dangerButton}
                      onClick={handleResetUsers}
                      disabled={submitting}
                    >
                      {submitting ? '处理中...' : '确认重置'}
                    </button>
                    <button
                      style={styles.secondaryButton}
                      onClick={() => setShowResetConfirm(false)}
                      disabled={submitting}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  style={styles.dangerButton}
                  onClick={() => setShowResetConfirm(true)}
                >
                  开始重置 Users
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={styles.modalFooter}>
          <button
            style={styles.secondaryButton}
            onClick={onClose}
            disabled={submitting}
          >
            取消
          </button>
          <button
            style={styles.primaryButton}
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? '保存中...' : '保存更改'}
          </button>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, color }) => (
  <div style={{ ...styles.statCard, borderTopColor: color }}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
    </div>
  </div>
);

const OrganizationCard = ({ organization, onCreateEvent, onReload }) => {
  const [expanded, setExpanded] = useState(false);
  const [showEditIdentityTags, setShowEditIdentityTags] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);  // ✅ 新增

  // ✅ 新增：处理组织 logo 上传
  const handleOrgLogoUpload = async (file) => {
    try {
      setUploadingLogo(true);
      const path = `organizations/${organization.id}/logo_${Date.now()}`;
      const downloadUrl = await uploadLogo(file, path);

      const idToken = await auth.currentUser.getIdToken();
      await updateOrganizationLogo(organization.id, downloadUrl, idToken);

      window.mybazaarShowToast('组织 logo 更新成功');
      onReload();
      setUploadingLogo(false);
    } catch (error) {
      window.mybazaarShowToast('上传失败：' + error.message);
      setUploadingLogo(false);
    }
  };

  return (
    <div style={styles.orgCard}>
      <div style={styles.orgHeader}>
        <div style={styles.orgInfo}>
          <h3 style={styles.orgName}>
            {organization.orgName['zh-CN']}
          </h3>
          <div style={styles.orgMeta}>
            <span style={styles.badge}>{organization.orgCode}</span>
            <span style={styles.metaText}>
              {organization.events.length} 个活动
            </span>
            <span style={{
              ...styles.statusBadge,
              background: organization.status === 'active' ? '#d1fae5' : '#fee2e2',
              color: organization.status === 'active' ? '#065f46' : '#991b1b'
            }}>
              {organization.status === 'active' ? '运作中' : '已停用'}
            </span>
          </div>
        </div>
        <div style={styles.orgActions}>
          {/* ✅ 新增：Logo 上传按钮 */}
          <LogoUploadButton
            onUpload={handleOrgLogoUpload}
            currentLogoUrl={organization.logoUrl}
            entityType="organization"
          />
          <button
            style={styles.secondaryButton}
            onClick={() => setShowEditIdentityTags(true)}
            title="编辑身份标签"
          >
            🏷️ 身份标签
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => onCreateEvent(organization)}
          >
            + 创建活动
          </button>
          <button
            style={styles.iconButton}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* ✨ 新增：显示当前身份标签 */}
      <div style={styles.identityTagsPreview}>
        <span style={styles.identityTagsLabel}>身份标签：</span>
        {organization.identityTags && organization.identityTags.length > 0 ? (
          <div style={styles.tagsList}>
            {organization.identityTags
              .filter(tag => tag.isActive)
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map(tag => (
                <span key={tag.id} style={styles.identityTagBadge}>
                  {tag.name['zh-CN']} / {tag.name['en']}
                </span>
              ))}
          </div>
        ) : (
          <span style={styles.noTags}>未设置身份标签</span>
        )}
      </div>

      {expanded && (
        <div style={styles.eventsSection}>
          <h4 style={styles.eventsTitle}>活动列表</h4>
          {organization.events.length === 0 ? (
            <p style={styles.noEvents}>此组织还没有活动</p>
          ) : (
            <div style={styles.eventsGrid}>
              {organization.events.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  organization={organization}
                  onReload={onReload}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ✨ 新增：编辑身份标签的 Modal */}
      {showEditIdentityTags && (
        <EditIdentityTagsModal
          organization={organization}
          onClose={() => setShowEditIdentityTags(false)}
          onSuccess={() => {
            setShowEditIdentityTags(false);
            onReload();
          }}
        />
      )}
    </div>
  );
};

// ✨ 更新后的 EventCard - 添加登录网址显示 + Event Manager 信息
// ============================================
// 完整版：删除事件功能（包含 admins 清理）
// ============================================

const EventCard = ({ event, organization, onReload }) => {
  const [copySuccess, setCopySuccess] = useState('');
  const [eventManager, setEventManager] = useState(null);
  const [loadingManager, setLoadingManager] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showEditEvent, setShowEditEvent] = useState(false);  // ✅ 新增
  const [showQRPrint, setShowQRPrint] = useState(false);      // 🆕 摊位 QR Code 输出
  // ✅ 新架构：直接使用 Event.eventManager 對象
  useEffect(() => {
    if (event.eventManager) {
      setEventManager(event.eventManager);
      setLoadingManager(false);
    } else {
      setEventManager(null);
      setLoadingManager(false);
    }
  }, [event.eventManager]);

  // 格式化日期
  const formatDate = (dateStr) => {
    if (!dateStr) return '未设置';
    if (typeof dateStr === 'object' && dateStr.toDate) {
      return dateStr.toDate().toLocaleDateString('zh-CN');
    }
    return String(dateStr);
  };

  // 根据消费期计算事件状态
  const getEventStatus = () => {
    const endDate = event.eventInfo?.consumptionPeriod?.endDate;
    if (!endDate) return event.status || 'planning';

    let end = new Date(endDate);

    // 处理 Firestore Timestamp 对象
    if (typeof endDate === 'object' && endDate.toDate) {
      end = endDate.toDate();
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);

    if (today > end) {
      return 'completed';
    }
    return 'active';
  };

  const eventStatus = getEventStatus();

  // ✅ 使用 Cloud Function 删除事件
  const handleDeleteEvent = async () => {
    // 1️⃣ 增强的确认对话框
    if (!confirm(
      `⚠️ 确定要删除此活动吗？\n\n` +
      `活动名称：${event.eventName?.['zh-CN']}\n` +
      `活动代码：${event.eventCode}\n` +
      `用户数量：${event.statistics?.totalUsers || 0} 人\n` +
      `Event Manager：${eventManager ? eventManager.englishName : '未分配'}\n\n` +
      `此操作将删除：\n` +
      `  • 活动文档本身\n` +
      `  • 所有用户数据 (${event.statistics?.totalUsers || 0} 位用户)\n` +
      `  • 所有元数据 (部门等)\n` +
      `  • 所有点数分配记录 (pointAllocations)\n` +
      `  • 所有部门统计 (departmentStats)\n` +
      `  • 所有 Seller Manager 统计 (sellerManagerStats)\n` +
      `  • Event Manager 信息\n` +
      `  • 更新组织统计数据\n\n` +
      `⚠️ 此操作无法撤销！`
    )) {
      return;
    }

    try {
      setDeleting(true);
      console.log('[EventCard] 开始删除活动:', event.id);

      // 2️⃣ 获取当前用户的 ID Token
      const idToken = await auth.currentUser.getIdToken();

      // 3️⃣ 调用 Cloud Function
      const functionUrl = '/api/deleteEventHttp';

      const resp = await safeFetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          eventId: event.id,
          idToken: idToken
        })
      });

      let respData;
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        respData = await resp.json();
      } else {
        const text = await resp.text();
        throw new Error(`Cloud Function 回應非 JSON，狀態碼 ${resp.status}，內容：${text.slice(0, 200)}`);
      }

      if (!resp.ok || respData?.error) {
        const errMsg = respData?.error || `HTTP ${resp.status}`;
        throw new Error(errMsg);
      }
      console.log('[EventCard] 删除成功响应:', respData);
      // 删除成功后，从本地状态中移除该event
      // 触发父组件重新加载，确保 UI 立即更新
      if (onReload) {
        try {
          onReload();
        } catch (e) {
          console.warn('[EventCard] onReload 调用失败:', e);
        }
      }
      window.mybazaarShowToast('活动删除成功！');

    } finally {
      setDeleting(false);
    }
  };

  // 生成登录网址
  const generateLoginUrl = () => {
    // 統一使用 system.mybazaar.my
    const baseUrl = 'https://system.mybazaar.my';
    return `${baseUrl}/login/${organization.orgCode}-${event.eventCode}`;
  };

  const loginUrl = generateLoginUrl();

  // 复制登录网址
  const handleCopyLoginUrl = async () => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopySuccess('✓ 已复制');
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      window.mybazaarShowToast('复制失败，请手动复制');
    }
  };

  // 生成 QR Code URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(loginUrl)}`;

  // 打开 QR Code
  const handleShowQRCode = () => {
    window.open(qrCodeUrl, '_blank', 'width=350,height=350');
  };

  return (
    <div style={styles.eventCard}>
      {/* 事件头部 */}
      <div style={styles.eventHeader}>
        <div>
          <h4 style={styles.eventName}>
            {event.eventName?.['zh-CN']}
          </h4>
          <div style={styles.eventMeta}>
            <span style={styles.badge}>{event.eventCode}</span>
            <span style={{
              ...styles.statusBadge,
              background:
                eventStatus === 'active' ? '#d1fae5' :
                  eventStatus === 'completed' ? '#fee2e2' :
                    '#fef3c7',
              color:
                eventStatus === 'active' ? '#065f46' :
                  eventStatus === 'completed' ? '#991b1b' :
                    '#92400e'
            }}>
              {eventStatus === 'active' ? '进行中' :
                eventStatus === 'completed' ? '已结束' :
                  '筹备中'}
            </span>
          </div>
        </div>
      </div>

      {/* 统计数据 */}
      <div style={styles.eventStats}>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>用户数</div>
          <div style={styles.statValue}>{event.statistics?.totalUsers || 0}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>交易数</div>
          <div style={styles.statValue}>{event.statistics?.totalTransactions || 0}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>已发积分</div>
          <div style={styles.statValue}>{event.statistics?.totalPointsIssued || 0}</div>
        </div>
      </div>

      {/* 活动日期 */}
      <div style={styles.eventDates}>
        <div style={styles.dateItem}>
          <span style={styles.dateLabel}>市集日期：</span>
          <span>{formatDate(event.eventInfo?.fairDate)}</span>
        </div>
        <div style={styles.dateItem}>
          <span style={styles.dateLabel}>消费期：</span>
          <span>
            {formatDate(event.eventInfo?.consumptionPeriod?.startDate)} - {formatDate(event.eventInfo?.consumptionPeriod?.endDate)}
          </span>
        </div>
      </div>

      {/* 登录网址区域 */}
      <div style={styles.loginUrlSection}>
        <div style={styles.loginUrlHeader}>
          <span style={styles.loginUrlLabel}>🔗 登录网址</span>
          <button
            style={styles.qrButton}
            onClick={handleShowQRCode}
            title="查看二维码"
          >
            📱 二维码
          </button>
        </div>
        <div style={styles.loginUrlBox}>
          <input
            type="text"
            value={loginUrl}
            readOnly
            style={styles.loginUrlInput}
          />
          <button
            style={styles.copyButton}
            onClick={handleCopyLoginUrl}
          >
            {copySuccess || '📋 复制'}
          </button>
        </div>
        <span style={styles.loginUrlHint}>
          分享此链接给用户进行注册和登录
        </span>
      </div>

      {/* Event Manager 信息 */}
      <div style={styles.managerInfo}>
        <div style={styles.dateLabel}>Event Manager：</div>
        {loadingManager ? (
          <span style={styles.loadingText}>加载中...</span>
        ) : eventManager ? (
          <div style={styles.managerDetails}>
            <strong>{eventManager.englishName}</strong>
            {eventManager.chineseName && ` (${eventManager.chineseName})`}
            <br />
            📞 {eventManager.phoneNumber}
          </div>
        ) : (
          <span style={styles.loadingText}>未分配</span>
        )}
      </div>

      {/* ========== ✨ 新增：OTP 设置 ========== */}
      <div style={styles.otpSettingsSection}>
        <div style={styles.otpSettingsHeader}>
          <span style={styles.dateLabel}>🔐 OTP 验证设置：</span>
        </div>
        <div style={styles.otpSettingsContent}>
          <label style={styles.otpSwitchLabel}>
            <input
              type="checkbox"
              checked={event.otpSettings?.enabled || false}
              onChange={async (e) => {
                const newEnabled = e.target.checked;
                console.log('[OTP Switch] 开关切换:', { newEnabled, currentUser: !!auth.currentUser });

                if (confirm(
                  newEnabled
                    ? '✅ 确定要启用真实OTP验证吗？\n\n启用后，用户登录时将收到360发送的真实验证码短信（需要短信费用）。'
                    : '⚠️ 确定要使用测试OTP吗？\n\n关闭后，系统将使用固定验证码 223344（仅用于开发测试）。'
                )) {
                  try {
                    if (!auth.currentUser) {
                      throw new Error('用户未登录，请重新登录');
                    }

                    const idToken = await auth.currentUser.getIdToken();
                    console.log('[OTP Switch] 调用 updateEventDetails...');

                    await updateEventDetails(organization.id, event.id, {
                      otpEnabled: newEnabled
                    }, idToken);

                    console.log('[OTP Switch] ✅ 更新成功，等待 Firestore 同步...');

                    // 等待 1 秒确保 Firestore 数据已同步
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    window.mybazaarShowToast(
                      newEnabled
                        ? '✅ 已启用真实OTP验证（360短信）'
                        : '✅ 已切换为测试模式（固定码 223344）'
                    );

                    console.log('[OTP Switch] 开始重新加载数据...');
                    onReload();
                  } catch (error) {
                    console.error('[OTP Switch] ❌ 更新失败:', error);
                    window.mybazaarShowToast('更新失败：' + error.message);
                  }
                }
              }}
              style={styles.otpCheckbox}
            />
            <span style={styles.otpSwitchText}>
              启用真实OTP验证（360短信）
            </span>
          </label>

          {/* 当前状态显示 */}
          <div style={{
            ...styles.otpStatusBadge,
            ...(event.otpSettings?.enabled ? styles.otpStatusEnabled : styles.otpStatusDisabled)
          }}>
            {event.otpSettings?.enabled
              ? '✅ 当前状态：真实短信验证码'
              : '🔧 当前状态：测试验证码（223344）'}
          </div>

          <div style={styles.otpHint}>
            {event.otpSettings?.enabled
              ? '💰 用户登录时将收到真实的6位验证码短信（产生短信费用）'
              : '🆓 所有用户统一使用固定验证码 223344（免费，仅用于开发测试）'}
          </div>

          {event.otpSettings?.enabled && event.otpSettings?.enabledAt && (
            <div style={styles.otpMeta}>
              启用时间：{new Date(event.otpSettings.enabledAt.toDate()).toLocaleString('zh-CN')}
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={styles.actionButtons}>
        {/* 删除按钮 */}
        <button
          style={{
            ...styles.deleteButton,
            ...(deleting ? styles.deleteButtonDisabled : {})
          }}
          onClick={handleDeleteEvent}
          disabled={deleting}
        >
          {deleting ? '🗑️ 删除中...' : '🗑️ 删除此活动'}
        </button>
        {/* ✅ 新增：编辑活动按钮 */}
        <button
          style={styles.primaryButton}
          onClick={() => setShowEditEvent(true)}
        >
          ✏️ 编辑活动
        </button>
        {/* 🆕 输出摊位 QR Code 按钮 */}
        <button
          style={styles.qrPrintButton}
          onClick={() => setShowQRPrint(true)}
        >
          📱 输出摊位 QR Code
        </button>
      </div>
      {/* ✅ 新增：编辑活动 Modal */}
      {showEditEvent && (
        <EditEventModal
          organization={organization}
          event={event}
          onClose={() => setShowEditEvent(false)}
          onSuccess={() => {
            setShowEditEvent(false);
            onReload();
          }}
        />
      )}
      {/* 🆕 摊位 QR Code 打印 Modal */}
      {showQRPrint && (
        <MerchantQRPrintModal
          organizationId={organization.id}
          eventId={event.id}
          eventName={event.eventName?.['zh-CN'] || event.eventName?.['en-US'] || event.eventCode}
          onClose={() => setShowQRPrint(false)}
        />
      )}


    </div>
  );
};


// ✨ 新增：编辑身份标签的 Modal 组件
const EditIdentityTagsModal = ({ organization, onClose, onSuccess }) => {
  const [identityTags, setIdentityTags] = useState(
    organization.identityTags || []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [checkingUsage, setCheckingUsage] = useState(false);

  // 添加新标签
  const handleAddTag = () => {
    const newTag = {
      id: `tag_${Date.now()}`,
      name: {
        'en': '',
        'zh-CN': ''
      },
      displayOrder: identityTags.length + 1,
      isActive: true,
      createdAt: new Date().toISOString()
    };
    setIdentityTags([...identityTags, newTag]);
  };

  // 更新标签
  const handleUpdateTag = (tagId, field, lang, value) => {
    setIdentityTags(identityTags.map(tag => {
      if (tag.id === tagId) {
        if (field === 'name') {
          return {
            ...tag,
            name: {
              ...tag.name,
              [lang]: value
            }
          };
        }
        return { ...tag, [field]: value };
      }
      return tag;
    }));
  };

  // 删除标签（需要检查是否有用户使用）
  const handleDeleteTag = async (tagId) => {
    if (!confirm('确定要删除此身份标签吗？')) {
      return;
    }

    try {
      setCheckingUsage(true);
      setError('');

      // 检查是否有用户使用此标签
      const usageCount = await checkTagUsage(organization.id, tagId);

      if (usageCount > 0) {
        setError(`无法删除：目前有 ${usageCount} 个用户使用此身份标签`);
        return;
      }

      // 如果没有用户使用，则删除
      setIdentityTags(identityTags.filter(tag => tag.id !== tagId));

    } catch (err) {
      console.error('检查标签使用情况失败:', err);
      setError('检查标签使用情况失败: ' + err.message);
    } finally {
      setCheckingUsage(false);
    }
  };

  // 检查标签使用情况
  const checkTagUsage = async (orgId, tagId) => {
    try {
      // 遍历所有 events，查找使用此标签的用户
      let totalCount = 0;

      for (const event of organization.events) {
        const usersSnapshot = await getDocs(
          collection(db, 'organizations', orgId, 'events', event.id, 'users')
        );

        const count = usersSnapshot.docs.filter(doc => {
          const userData = doc.data();
          return userData.identityTag === tagId;
        }).length;

        totalCount += count;
      }

      return totalCount;
    } catch (error) {
      console.error('检查标签使用失败:', error);
      throw error;
    }
  };

  // 上移标签
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newTags = [...identityTags];
    [newTags[index - 1], newTags[index]] = [newTags[index], newTags[index - 1]];
    // 更新 displayOrder
    newTags.forEach((tag, i) => {
      tag.displayOrder = i + 1;
    });
    setIdentityTags(newTags);
  };

  // 下移标签
  const handleMoveDown = (index) => {
    if (index === identityTags.length - 1) return;
    const newTags = [...identityTags];
    [newTags[index], newTags[index + 1]] = [newTags[index + 1], newTags[index]];
    // 更新 displayOrder
    newTags.forEach((tag, i) => {
      tag.displayOrder = i + 1;
    });
    setIdentityTags(newTags);
  };

  // 验证表单
  const validateForm = () => {
    for (const tag of identityTags) {
      if (!tag.name['zh-CN'].trim() || !tag.name['en'].trim()) {
        setError('所有身份标签必须填写中英文名称');
        return false;
      }
    }
    return true;
  };

  // 提交保存
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) return;

    setSubmitting(true);
    setError('');

    try {
      const orgRef = doc(db, 'organizations', organization.id);
      await updateDoc(orgRef, {
        identityTags: identityTags,
        updatedAt: serverTimestamp()
      });

      window.mybazaarShowToast('身份标签更新成功！');
      onSuccess();
    } catch (err) {
      console.error('更新身份标签失败:', err);
      setError(err.message || '更新身份标签失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div
        style={{ ...styles.modalContent, maxWidth: '800px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={styles.modalHeader}>
          <div>
            <h2 style={styles.modalTitle}>🏷️ 编辑身份标签</h2>
            <p style={styles.modalSubtitle}>
              组织：{organization.orgName['zh-CN']}
            </p>
          </div>
          <button
            style={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div style={styles.infoBox}>
          <p style={styles.infoText}>
            💡 <strong>说明：</strong>身份标签将应用于此组织下的所有活动。
            用户注册时需要选择一个身份标签。
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.tagsContainer}>
            {identityTags.length === 0 ? (
              <div style={styles.emptyTags}>
                <p>还没有身份标签</p>
              </div>
            ) : (
              identityTags.map((tag, index) => (
                <div key={tag.id} style={styles.tagItem}>
                  <div style={styles.tagOrderControls}>
                    <button
                      type="button"
                      style={styles.orderButton}
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0 || submitting}
                      title="上移"
                    >
                      ▲
                    </button>
                    <span style={styles.orderNumber}>{index + 1}</span>
                    <button
                      type="button"
                      style={styles.orderButton}
                      onClick={() => handleMoveDown(index)}
                      disabled={index === identityTags.length - 1 || submitting}
                      title="下移"
                    >
                      ▼
                    </button>
                  </div>

                  <div style={styles.tagInputs}>
                    <div style={styles.tagInputGroup}>
                      <label style={styles.tagLabel}>中文名称</label>
                      <input
                        type="text"
                        value={tag.name['zh-CN']}
                        onChange={(e) => handleUpdateTag(tag.id, 'name', 'zh-CN', e.target.value)}
                        placeholder="例如：职员"
                        style={styles.tagInput}
                        disabled={submitting}
                        required
                      />
                    </div>
                    <div style={styles.tagInputGroup}>
                      <label style={styles.tagLabel}>英文名称</label>
                      <input
                        type="text"
                        value={tag.name['en']}
                        onChange={(e) => handleUpdateTag(tag.id, 'name', 'en', e.target.value)}
                        placeholder="例如：Staff"
                        style={styles.tagInput}
                        disabled={submitting}
                        required
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    style={styles.deleteTagButton}
                    onClick={() => handleDeleteTag(tag.id)}
                    disabled={submitting || checkingUsage}
                    title="删除标签"
                  >
                    🗑️
                  </button>
                </div>
              ))
            )}
          </div>

          <button
            type="button"
            style={styles.addTagButton}
            onClick={handleAddTag}
            disabled={submitting}
          >
            ➕ 添加新标签
          </button>

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
                ...(submitting ? styles.submitButtonDisabled : {})
              }}
              disabled={submitting}
            >
              {submitting ? '保存中...' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ✅ 修改後的 CreateOrganizationModal
// 位置：PlatformDashboard.jsx Line 961 開始
// 修改內容：新增 contact 字段（組織聯絡人）

const CreateOrganizationModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    orgCode: '',
    orgNameEN: '',
    orgNameZH: '',
    status: 'active',
    // ✅ 新增：組織聯絡人信息
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    contactPosition: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ✅ 修改驗證：新增 contact 必填驗證
    if (!formData.orgCode || !formData.orgNameEN || !formData.orgNameZH ||
      !formData.contactName || !formData.contactPhone) {
      setError('请填写所有必填字段（包括联系人姓名和电话）');
      return;
    }

    // ✅ 驗證聯絡電話格式
    if (!/^01\d{8,9}$/.test(formData.contactPhone)) {
      setError('联系电话格式不正确，请输入01开头的10-11位数字');
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // 检查 orgCode 是否已存在
      const orgsSnapshot = await getDocs(collection(db, 'organizations'));
      const existingOrg = orgsSnapshot.docs.find(
        doc => doc.data().orgCode.toLowerCase() === formData.orgCode.toLowerCase()
      );

      if (existingOrg) {
        setError('此组织代码已存在，请使用其他代码');
        return;
      }

      // 创建默认的身份标签
      const defaultIdentityTags = [
        {
          id: 'staff',
          name: {
            'en-US': 'Staff',
            'zh-CN': '职员'
          },
          displayOrder: 1,
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'student',
          name: {
            'en-US': 'Student',
            'zh-CN': '学生'
          },
          displayOrder: 2,
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'teacher',
          name: {
            'en-US': 'Teacher',
            'zh-CN': '教师'
          },
          displayOrder: 3,
          isActive: true,
          createdAt: new Date().toISOString()
        }
      ];

      // ✅ 創建組織文檔（包含 contact）
      await addDoc(collection(db, 'organizations'), {
        orgCode: formData.orgCode.toLowerCase(),
        orgName: {
          'en-US': formData.orgNameEN,
          'zh-CN': formData.orgNameZH
        },
        identityTags: defaultIdentityTags,
        departments: [],  // 初始化空的部門陣列
        // ✅ 新增：contact 字段
        contact: {
          name: formData.contactName,
          phone: formData.contactPhone,
          email: formData.contactEmail || '',
          position: formData.contactPosition || ''
        },
        statistics: {
          totalEvents: 0,
          activeEvents: 0,
          totalUsers: 0
        },
        status: formData.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      window.mybazaarShowToast('组织创建成功！');
      onSuccess();

    } catch (err) {
      console.error('创建组织失败:', err);
      setError(err.message || '创建组织失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>创建新组织</h2>

        {error && (
          <div style={styles.errorMessage}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* ====== 組織基本信息 ====== */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>🏢 组织基本信息</h3>

            <div style={styles.formGroup}>
              <label style={styles.label}>组织代码 *</label>
              <input
                type="text"
                name="orgCode"
                value={formData.orgCode}
                onChange={handleChange}
                placeholder="例如：chhs（小写字母）"
                style={styles.input}
                required
              />
              <small style={{ fontSize: '12px', color: '#666', marginTop: '5px', display: 'block' }}>
                将自动转换为小写
              </small>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>组织名称（中文）*</label>
                <input
                  type="text"
                  name="orgNameZH"
                  value={formData.orgNameZH}
                  onChange={handleChange}
                  placeholder="例如：芙蓉中华中学"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>组织名称（英文）*</label>
                <input
                  type="text"
                  name="orgNameEN"
                  value={formData.orgNameEN}
                  onChange={handleChange}
                  placeholder="例如：Chung Hua High School"
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>状态</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                style={styles.input}
              >
                <option value="active">激活</option>
                <option value="inactive">停用</option>
              </select>
            </div>
          </div>

          {/* ====== 新增：組織聯絡人信息 ====== */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>👤 组织联系人</h3>
            <p style={styles.sectionNote}>
              组织的主要联系人信息（如校长、主任等）
            </p>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>联系人姓名 *</label>
                <input
                  type="text"
                  name="contactName"
                  value={formData.contactName}
                  onChange={handleChange}
                  placeholder="例如：张校长"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>联系电话 *</label>
                <input
                  type="tel"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  placeholder="01XXXXXXXX"
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>联系邮箱</label>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  placeholder="例如：zhang@school.edu.my"
                  style={styles.input}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>职位</label>
                <input
                  type="text"
                  name="contactPosition"
                  value={formData.contactPosition}
                  onChange={handleChange}
                  placeholder="例如：校长、主任"
                  style={styles.input}
                />
              </div>
            </div>
          </div>

          {/* ====== 按钮区 ====== */}
          <div style={styles.buttonGroup}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelButton}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="submit"
              style={styles.submitButton}
              disabled={submitting}
            >
              {submitting ? '创建中...' : '创建组织'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ✅ 修改後的 CreateEventModal
// 位置：PlatformDashboard.jsx Line 1157 開始
// 修改內容：
// 1. 移除所有 contactPerson 相關字段
// 2. 補充完整的 Event Manager 字段（參考 AssignEventManager.jsx）
// 3. 新增 position 字段

const CreateEventModal = ({ organization, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    // Event 基本信息
    eventCode: '',
    eventNameZh: '',
    eventNameEn: '',
    description: '',
    fairDate: '',
    fairTime: '',
    startDate: '',
    endDate: '',
    status: 'planning',

    // ❌ 移除所有 contactPerson 字段
    // contactPersonName: '',
    // contactPersonPhone: '',
    // contactPersonEmail: '',
    // contactPersonPosition: '',

    // ✅ Event Manager 信息（完整字段）
    emPhoneNumber: '',
    emEnglishName: '',
    emChineseName: '',
    emEmail: '',
    emIdentityTag: '',
    emIdentityId: '',          // ✅ 新增
    emDepartment: '',
    emPosition: ''             // ✅ 新增 position 字段
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const availableIdentityTags = organization.identityTags
    ?.filter(tag => tag.isActive)
    ?.sort((a, b) => a.displayOrder - b.displayOrder) || [];

  const availableDepartments = organization.departments?.filter(dep => dep.isActive) || [];

  // 設置默認 identityTag
  if (!formData.emIdentityTag && availableIdentityTags.length > 0) {
    setFormData(prev => ({
      ...prev,
      emIdentityTag: availableIdentityTags[0].id
    }));
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
    // Event 基本信息驗證
    if (!formData.eventCode || !formData.eventNameZh || !formData.fairDate) {
      setError('请填写活动代码、活动名称（中文）和活动当天日期');
      return false;
    }

    // ❌ 移除 contactPerson 驗證

    // Event Manager 驗證
    if (!formData.emPhoneNumber || !formData.emEnglishName || !formData.emDepartment) {
      setError('请填写 Event Manager 的必填字段（手机号、英文名、部门）');
      return false;
    }

    if (!/^01\d{8,9}$/.test(formData.emPhoneNumber)) {
      setError('Event Manager 手机号格式不正确，请输入01开头的10-11位数字');
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

      const user = auth.currentUser;
      if (!user) {
        throw new Error('用户未登录，请重新登录');
      }

      const idToken = await user.getIdToken();
      const apiUrl = '/api/createEventByPlatformAdminHttp';

      const response = await safeFetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId: organization.id,
          orgCode: organization.orgCode,
          eventCode: formData.eventCode,
          eventName: {
            'zh-CN': formData.eventNameZh,
            'en-US': formData.eventNameEn || formData.eventNameZh
          },
          description: formData.description,
          eventInfo: {
            fairDate: formData.fairDate,
            fairTime: formData.fairTime,
            consumptionPeriod: {
              startDate: formData.startDate,
              endDate: formData.endDate
            }
          },
          status: formData.status,
          // ❌ 移除 contactPerson
          // ✅ Event Manager 信息
          eventManagerInfo: {
            phoneNumber: formData.emPhoneNumber,
            englishName: formData.emEnglishName,
            chineseName: formData.emChineseName,
            email: formData.emEmail,
            identityTag: formData.emIdentityTag,
            identityId: formData.emIdentityId,
            department: formData.emDepartment,
            position: formData.emPosition || '活动负责人'  // ✅ position 字段
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}: 创建活动失败`);
      }

      const result = await response.json();
      window.mybazaarShowToast('活动和 Event Manager 创建成功！');
      onSuccess();
      onClose();

    } catch (err) {
      console.error('[CreateEventModal] Error:', err);
      setError(err.message || '创建活动失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>创建新活动</h2>
        <p style={styles.modalSubtitle}>
          在 <strong>{organization.orgName['zh-CN']}</strong> 下创建活动
        </p>

        {error && (
          <div style={styles.errorMessage}>
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={styles.form}>
          {/* ====== 第一部分：Event 基本信息 ====== */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>📋 活动基本信息</h3>

            <div style={styles.formGroup}>
              <label style={styles.label}>活动代码 *</label>
              <input
                type="text"
                name="eventCode"
                value={formData.eventCode}
                onChange={handleChange}
                placeholder="例如：ban2025"
                style={styles.input}
                required
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>活动名称（中文）*</label>
                <input
                  type="text"
                  name="eventNameZh"
                  value={formData.eventNameZh}
                  onChange={handleChange}
                  placeholder="例如：2025年慈善义卖会"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>活动名称（英文）</label>
                <input
                  type="text"
                  name="eventNameEn"
                  value={formData.eventNameEn}
                  onChange={handleChange}
                  placeholder="例如：2025 Charity Bazaar"
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>活动描述</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleChange}
                placeholder="简单描述活动内容..."
                style={{ ...styles.input, minHeight: '80px' }}
              />
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>活动当天日期 *</label>
                <input
                  type="date"
                  name="fairDate"
                  value={formData.fairDate}
                  onChange={handleChange}
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>活动当天时间</label>
                <input
                  type="time"
                  name="fairTime"
                  value={formData.fairTime}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>消费开始日期</label>
                <input
                  type="date"
                  name="startDate"
                  value={formData.startDate}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>消费结束日期</label>
                <input
                  type="date"
                  name="endDate"
                  value={formData.endDate}
                  onChange={handleChange}
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>活动状态</label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                style={styles.input}
              >
                <option value="planning">筹备中</option>
                <option value="active">进行中</option>
                <option value="completed">已完成</option>
              </select>
            </div>
          </div>

          {/* ====== 第二部分：Event Manager（系统管理员） ====== */}
          <div style={styles.section}>
            <h3 style={styles.sectionTitle}>🔑 Event Manager（系统管理员）</h3>
            <p style={styles.sectionNote}>
              Event Manager 将拥有系统管理权限，可以管理用户和监控所有数据。<br />
              Event Manager 的基本信息也将作为活动的对外联络信息。
            </p>

            {/* 基本信息 */}
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>手机号 * (登录帐号)</label>
                <input
                  type="tel"
                  name="emPhoneNumber"
                  value={formData.emPhoneNumber}
                  onChange={handleChange}
                  placeholder="01XXXXXXXX (10-11位)"
                  style={styles.input}
                  required
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>英文名 *</label>
                <input
                  type="text"
                  name="emEnglishName"
                  value={formData.emEnglishName}
                  onChange={handleChange}
                  placeholder="例如：John Lee"
                  style={styles.input}
                  required
                />
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>中文名</label>
                <input
                  type="text"
                  name="emChineseName"
                  value={formData.emChineseName}
                  onChange={handleChange}
                  placeholder="例如：李华"
                  style={styles.input}
                />
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>邮箱</label>
                <input
                  type="email"
                  name="emEmail"
                  value={formData.emEmail}
                  onChange={handleChange}
                  placeholder="例如：john@school.edu.my"
                  style={styles.input}
                />
              </div>
            </div>

            {/* 身份和部门 */}
            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>身份标签 *</label>
                <select
                  name="emIdentityTag"
                  value={formData.emIdentityTag}
                  onChange={handleChange}
                  style={styles.input}
                  required
                >
                  {availableIdentityTags.length === 0 && (
                    <option value="">无可用身份标签</option>
                  )}
                  {availableIdentityTags.map(tag => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name['zh-CN'] || tag.name['en-US'] || tag.id}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>身份编号</label>
                <input
                  type="text"
                  name="emIdentityId"
                  value={formData.emIdentityId}
                  onChange={handleChange}
                  placeholder="例如：工号、学号（可选）"
                  style={styles.input}
                />
              </div>
            </div>

            <div style={styles.formRow}>
              <div style={styles.formGroup}>
                <label style={styles.label}>
                  部门 *
                  <small style={{ fontSize: '12px', color: '#666', marginLeft: '8px' }}>
                    （可从建议中选择或输入新部门）
                  </small>
                </label>
                <input
                  type="text"
                  name="emDepartment"
                  list="departmentList"
                  placeholder="例如：行政部、J1A"
                  value={formData.emDepartment}
                  onChange={handleChange}
                  style={styles.input}
                  required
                />
                <datalist id="departmentList">
                  {availableDepartments.map(dept => (
                    <option
                      key={dept.id}
                      value={dept.name}
                    >
                      {dept.name} ({dept.userCount || 0} 人)
                    </option>
                  ))}
                </datalist>
                <small style={{
                  fontSize: '12px',
                  color: '#666',
                  marginTop: '5px',
                  display: 'block'
                }}>
                  提示：输入时会显示现有部门建议，也可以输入新部门名称
                </small>
              </div>
              <div style={styles.formGroup}>
                <label style={styles.label}>职位</label>
                <input
                  type="text"
                  name="emPosition"
                  value={formData.emPosition}
                  onChange={handleChange}
                  placeholder="例如：活动负责人"
                  style={styles.input}
                />
                <small style={{
                  fontSize: '12px',
                  color: '#666',
                  marginTop: '5px',
                  display: 'block'
                }}>
                  选填：Event Manager 的职位（默认为"活动负责人"）
                </small>
              </div>
            </div>
          </div>

          {/* ====== 按钮区 ====== */}
          <div style={styles.buttonGroup}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelButton}
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="submit"
              style={styles.submitButton}
              disabled={submitting}
            >
              {submitting ? '创建中...' : '创建活动'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};


// ============================================================================
// 說明：這個修正後的組件使用以下改進：
// ============================================================================
// 1. ✅ 使用 '/api/createEvent' 路徑而非直接 Cloud Functions URL
// 2. ✅ 添加詳細的錯誤處理和日誌記錄
// 3. ✅ 驗證用戶登入狀態
// 4. ✅ 獲取並使用 ID Token 進行身份驗證
// 5. ✅ 正確處理響應和錯誤狀態
// ============================================================================

const styles = {
  container: {
    minHeight: '100vh',
    background: '#f9fafb',
    padding: '2rem'
  },
  loadingCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '3rem',
    textAlign: 'center',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  spinner: {
    width: '50px',
    height: '50px',
    border: '4px solid #f3f4f6',
    borderTopColor: '#667eea',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '0 auto 1rem'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
    fontSize: '1rem',
    color: '#6b7280',
    margin: 0
  },
  primaryButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '500',
    cursor: 'pointer'
  },
    qrPrintButton: {
    padding: '0.5rem 1rem',
    backgroundColor: '#f3e8ff',
    color: '#7c3aed',
    border: '1.5px solid #c4b5fd',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.875rem',
    fontWeight: '600'
  },
  logoutButton: {
    padding: '0.75rem 1.5rem',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    whiteSpace: 'nowrap'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  statCard: {
    background: 'white',
    padding: '1.5rem',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    borderTop: '4px solid',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  statIcon: {
    fontSize: '2.5rem'
  },
  statValue: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937'
  },
  statTitle: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  orgList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  emptyState: {
    background: 'white',
    padding: '4rem 2rem',
    borderRadius: '16px',
    textAlign: 'center'
  },
  orgCard: {
    background: 'white',
    borderRadius: '16px',
    padding: '1.5rem',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  orgHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  orgInfo: {
    flex: 1
  },
  orgName: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  orgMeta: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center'
  },
  badge: {
    background: '#dbeafe',
    color: '#1e40af',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  metaText: {
    color: '#6b7280',
    fontSize: '0.875rem'
  },
  statusBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  orgActions: {
    display: 'flex',
    gap: '0.5rem'
  },
  secondaryButton: {
    padding: '0.5rem 1rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '0.875rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
  },
  iconButton: {
    padding: '0.5rem 0.75rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer'
  },
  // ✨ 新增样式：身份标签预览
  identityTagsPreview: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem',
    background: '#f9fafb',
    borderRadius: '8px',
    marginBottom: '1rem',
    flexWrap: 'wrap'
  },
  identityTagsLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#374151'
  },
  tagsList: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  identityTagBadge: {
    background: '#e0e7ff',
    color: '#3730a3',
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  noTags: {
    color: '#9ca3af',
    fontSize: '0.875rem',
    fontStyle: 'italic'
  },
  eventsSection: {
    borderTop: '1px solid #e5e7eb',
    paddingTop: '1rem',
    marginTop: '1rem'
  },
  eventsTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem'
  },
  noEvents: {
    color: '#9ca3af',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: '2rem'
  },
  eventsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
    gap: '1rem'
  },
  eventCard: {
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '1rem'
  },
  eventHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
    marginBottom: '0.75rem'
  },
  eventName: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#1f2937',
    margin: 0
  },
  managerStatus: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem',
    background: '#f3f4f6',
    borderRadius: '6px',
    marginBottom: '0.75rem',
    fontSize: '0.875rem'
  },
  managerLabel: {
    color: '#6b7280',
    fontWeight: '500'
  },
  managerAssigned: {
    color: '#059669',
    fontWeight: '600'
  },
  managerNotAssigned: {
    color: '#dc2626',
    fontWeight: '600'
  },
  eventMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1rem'
  },
  metaItem: {
    fontSize: '0.875rem',
    color: '#6b7280'
  },
  assignButton: {
    width: '100%',
    padding: '0.75rem',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    marginBottom: '0.75rem'
  },
  eventLinks: {
    display: 'flex',
    gap: '0.5rem'
  },
  linkButton: {
    flex: 1,
    padding: '0.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    textDecoration: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    textAlign: 'center',
    fontWeight: '500',
    display: 'block'
  },
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
    alignItems: 'start',
    marginBottom: '1.5rem'
  },
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: 0
  },
  modalSubtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginTop: '0.25rem'
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
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: '8px',
    padding: '1rem',
    marginBottom: '1.5rem'
  },
  infoText: {
    fontSize: '0.875rem',
    color: '#0c4a6e',
    margin: 0
  },
  // ✨ 新增样式：编辑身份标签
  tagsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    marginBottom: '1rem',
    maxHeight: '400px',
    overflowY: 'auto',
    padding: '0.5rem'
  },
  emptyTags: {
    textAlign: 'center',
    padding: '2rem',
    color: '#9ca3af',
    fontStyle: 'italic'
  },
  tagItem: {
    display: 'flex',
    gap: '1rem',
    alignItems: 'center',
    padding: '1rem',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '8px'
  },
  tagOrderControls: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    alignItems: 'center'
  },
  orderButton: {
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '0.75rem'
  },
  orderNumber: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#6b7280'
  },
  tagInputs: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem'
  },
  tagInputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  tagLabel: {
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#6b7280'
  },
  tagInput: {
    padding: '0.5rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    outline: 'none'
  },
  deleteTagButton: {
    background: '#fee2e2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    borderRadius: '6px',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '1.25rem'
  },
  addTagButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px dashed #d1d5db',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '500',
    cursor: 'pointer',
    marginBottom: '1rem'
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
  formGroup: {
    marginBottom: '1.5rem'
  },
  formRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '1rem'
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#374151',
    marginBottom: '0.5rem'
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
  hint: {
    display: 'block',
    fontSize: '0.75rem',
    color: '#6b7280',
    marginTop: '0.25rem'
  },
  sectionDivider: {
    marginBottom: '1.5rem'
  },
  sectionTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#374151',
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
  },
  loginUrlSection: {
    background: 'white',
    border: '2px solid #e0e7ff',
    borderRadius: '10px',
    padding: '1rem',
    marginBottom: '1rem'
  },
  loginUrlHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '0.75rem'
  },
  loginUrlLabel: {
    fontSize: '0.875rem',
    fontWeight: '600',
    color: '#4338ca'
  },
  qrButton: {
    padding: '0.375rem 0.75rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'transform 0.2s'
  },
  loginUrlBox: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '0.5rem'
  },
  loginUrlInput: {
    flex: 1,
    padding: '0.625rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    background: '#f9fafb',
    color: '#374151',
    fontFamily: 'monospace'
  },
  copyButton: {
    padding: '0.625rem 1rem',
    background: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'background 0.2s'
  },
  loginUrlHint: {
    fontSize: '0.75rem',
    color: '#6b7280',
    fontStyle: 'italic'
  },
  // ✨ 新增 Event Manager 信息样式
  managerInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  managerDetails: {
    background: '#d1fae5',
    padding: '0.5rem 0.75rem',
    borderRadius: '6px',
    fontSize: '0.85rem',
    color: '#065f46',
    lineHeight: '1.4'
  },
  loadingText: {
    color: '#9ca3af',
    fontSize: '0.875rem'
  },
  eventActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  deleteButton: {
    width: '100%',
    padding: '0.75rem',
    background: '#fee2e2',
    color: '#991b1b',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  deleteButtonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  section: {
    marginBottom: '30px',
    padding: '20px',
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    border: '1px solid #e0e0e0'
  },
  // ✅ 新增：Logo 上传相关样式
  logoUploadContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '0.75rem',
    backgroundColor: '#f0f9ff',
    borderRadius: '6px'
  },
  logoPreviewSection: {
    flex: '0 0 60px',
    height: '60px',
    backgroundColor: '#e0e7ff',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  logoPreview: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'cover'
  },
  logoPlaceholder: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    width: '100%',
    height: '100%'
  },
  logoUploadActions: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  uploadButton: {
    padding: '0.5rem 1rem',
    background: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  errorText: {
    fontSize: '0.75rem',
    color: '#dc2626'
  },
  // ✅ 新增：Modal 样式补充
  tabsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  tabContent: {
    padding: '1rem',
    backgroundColor: '#f9fafb',
    borderRadius: '8px'
  },
  formInput: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontFamily: 'inherit'
  },
  buttonGroup: {
    display: 'flex',
    gap: '0.75rem',
    marginTop: '1rem'
  },
  dangerButton: {
    padding: '0.75rem 1.5rem',
    background: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.875rem',
    fontWeight: '600',
    cursor: 'pointer'
  },
  warningText: {
    color: '#991b1b',
    backgroundColor: '#fee2e2',
    padding: '0.75rem',
    borderRadius: '6px',
    marginBottom: '1rem'
  },
  errorBanner: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: '0.75rem',
    borderRadius: '6px',
    marginBottom: '1rem'
  },
  // ========== ✨ 新增：OTP 设置样式 ==========
  otpSettingsSection: {
    background: '#f0f9ff',
    border: '2px solid #bae6fd',
    borderRadius: '8px',
    padding: '1rem',
    marginBottom: '1rem'
  },
  otpSettingsHeader: {
    marginBottom: '0.75rem'
  },
  otpSettingsContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  otpSwitchLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    cursor: 'pointer',
    userSelect: 'none'
  },
  otpCheckbox: {
    width: '20px',
    height: '20px',
    cursor: 'pointer'
  },
  otpSwitchText: {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: '#0c4a6e'
  },
  otpStatusBadge: {
    padding: '0.75rem 1rem',
    borderRadius: '6px',
    fontSize: '0.9rem',
    fontWeight: '600',
    marginLeft: '2rem',
    marginTop: '0.5rem',
    marginBottom: '0.5rem'
  },
  otpStatusEnabled: {
    background: '#d1fae5',
    color: '#065f46',
    border: '1px solid #a7f3d0'
  },
  otpStatusDisabled: {
    background: '#fef3c7',
    color: '#92400e',
    border: '1px solid #fde68a'
  },
  otpHint: {
    fontSize: '0.85rem',
    color: '#0369a1',
    fontStyle: 'italic',
    marginLeft: '2rem'
  },
  otpMeta: {
    fontSize: '0.75rem',
    color: '#64748b',
    marginLeft: '2rem',
    marginTop: '0.25rem'
  }
};

// 添加旋转动画
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

export default PlatformDashboard;