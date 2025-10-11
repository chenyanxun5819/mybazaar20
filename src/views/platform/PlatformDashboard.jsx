import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';

const PlatformDashboard = () => {
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
          
          // 載入該組織的所有活動
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
      setOrganizations(orgsData);
    } catch (error) {
      console.error('載入組織失敗:', error);
      alert('載入組織失敗: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* 頂部導航 */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>🎯 Platform 管理中心</h1>
          <p style={styles.subtitle}>管理所有組織和活動</p>
        </div>
        <button
          style={styles.primaryButton}
          onClick={() => setShowCreateOrg(true)}
        >
          + 創建新組織
        </button>
      </div>

      {/* 統計卡片 */}
      <div style={styles.statsGrid}>
        <StatCard
          title="總組織數"
          value={organizations.length}
          icon="🏢"
          color="#667eea"
        />
        <StatCard
          title="總活動數"
          value={organizations.reduce((sum, org) => sum + org.events.length, 0)}
          icon="📅"
          color="#764ba2"
        />
        <StatCard
          title="活躍活動"
          value={organizations.reduce(
            (sum, org) => sum + org.events.filter(e => e.status === 'active').length,
            0
          )}
          icon="✨"
          color="#10b981"
        />
        <StatCard
          title="總用戶數"
          value={organizations.reduce((sum, org) => sum + (org.statistics?.totalUsers || 0), 0)}
          icon="👥"
          color="#f59e0b"
        />
      </div>

      {/* 組織列表 */}
      <div style={styles.orgList}>
        {organizations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '64px', marginBottom: '1rem' }}>📦</div>
            <h3>還沒有組織</h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              點擊上方按鈕創建第一個組織
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

      {/* 創建組織 Modal */}
      {showCreateOrg && (
        <CreateOrganizationModal
          onClose={() => setShowCreateOrg(false)}
          onSuccess={() => {
            setShowCreateOrg(false);
            loadOrganizations();
          }}
        />
      )}

      {/* 創建活動 Modal */}
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

// 統計卡片組件
const StatCard = ({ title, value, icon, color }) => (
  <div style={{...styles.statCard, borderTopColor: color}}>
    <div style={styles.statIcon}>{icon}</div>
    <div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
    </div>
  </div>
);

// 組織卡片組件
const OrganizationCard = ({ organization, onCreateEvent, onReload }) => {
  const [expanded, setExpanded] = useState(false);

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
              {organization.events.length} 個活動
            </span>
            <span style={{...styles.statusBadge, 
              background: organization.status === 'active' ? '#d1fae5' : '#fee2e2',
              color: organization.status === 'active' ? '#065f46' : '#991b1b'
            }}>
              {organization.status === 'active' ? '運作中' : '已停用'}
            </span>
          </div>
        </div>
        <div style={styles.orgActions}>
          <button
            style={styles.secondaryButton}
            onClick={() => onCreateEvent(organization)}
          >
            + 創建活動
          </button>
          <button
            style={styles.iconButton}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div style={styles.eventsSection}>
          <h4 style={styles.eventsTitle}>活動列表</h4>
          {organization.events.length === 0 ? (
            <p style={styles.noEvents}>此組織還沒有活動</p>
          ) : (
            <div style={styles.eventsGrid}>
              {organization.events.map(event => (
                <EventCard key={event.id} event={event} organization={organization} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// 活動卡片組件
const EventCard = ({ event, organization }) => {
  const eventUrl = `/${organization.orgCode}-${event.eventCode}/mobile`;
  
  return (
    <div style={styles.eventCard}>
      <div style={styles.eventHeader}>
        <h5 style={styles.eventName}>{event.eventName['zh-CN']}</h5>
        <span style={{...styles.statusBadge,
          background: event.status === 'active' ? '#dbeafe' : '#fee2e2',
          color: event.status === 'active' ? '#1e40af' : '#991b1b'
        }}>
          {event.status === 'active' ? '進行中' : event.status}
        </span>
      </div>
      <div style={styles.eventMeta}>
        <div style={styles.metaItem}>
          📅 {event.eventInfo?.startDate} ~ {event.eventInfo?.endDate}
        </div>
        <div style={styles.metaItem}>
          👥 {event.statistics?.totalUsers || 0} 位用戶
        </div>
        <div style={styles.metaItem}>
          💰 RM {event.settings?.totalCapital?.toLocaleString() || 0}
        </div>
      </div>
      <div style={styles.eventLinks}>
        <a
          href={eventUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.linkButton}
        >
          📱 手機版
        </a>
        <a
          href={eventUrl.replace('/mobile', '/desktop')}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.linkButton}
        >
          🖥️ 桌機版
        </a>
      </div>
    </div>
  );
};

// 創建組織 Modal
const CreateOrganizationModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    orgNameZh: '',
    orgNameEn: '',
    orgCode: '',
    email: '',
    phone: '',
    address: ''
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.orgNameZh || !formData.orgCode || !formData.email) {
      alert('請填寫必填欄位');
      return;
    }

    try {
      setSubmitting(true);
      
      await addDoc(collection(db, 'organizations'), {
        orgName: {
          'zh-CN': formData.orgNameZh,
          'en': formData.orgNameEn || formData.orgNameZh
        },
        orgCode: formData.orgCode.toLowerCase(),
        contactInfo: {
          email: formData.email,
          phone: formData.phone,
          address: formData.address
        },
        settings: {
          defaultLanguage: 'zh-CN',
          supportedLanguages: ['zh-CN', 'en'],
          timezone: 'Asia/Kuala_Lumpur',
          currency: 'MYR'
        },
        admins: [],
        statistics: {
          totalEvents: 0,
          activeEvents: 0,
          totalUsers: 0,
          totalTransactions: 0
        },
        status: 'active',
        createdAt: serverTimestamp(),
        createdBy: 'platform_admin',
        updatedAt: serverTimestamp()
      });

      alert('組織創建成功！');
      onSuccess();
    } catch (error) {
      console.error('創建組織失敗:', error);
      alert('創建組織失敗: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>創建新組織</h2>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>組織名稱（中文）*</label>
            <input
              type="text"
              style={styles.input}
              value={formData.orgNameZh}
              onChange={e => setFormData({...formData, orgNameZh: e.target.value})}
              placeholder="例如：芙蓉中华中学"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>組織名稱（英文）</label>
            <input
              type="text"
              style={styles.input}
              value={formData.orgNameEn}
              onChange={e => setFormData({...formData, orgNameEn: e.target.value})}
              placeholder="例如：Foon Chung Hua School"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>組織代碼 *</label>
            <input
              type="text"
              style={styles.input}
              value={formData.orgCode}
              onChange={e => setFormData({...formData, orgCode: e.target.value.toLowerCase()})}
              placeholder="例如：fch（僅小寫字母）"
              pattern="[a-z]+"
              required
            />
            <small style={styles.hint}>用於生成 URL，僅限小寫英文字母</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>聯絡郵箱 *</label>
            <input
              type="email"
              style={styles.input}
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
              placeholder="admin@example.com"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>聯絡電話</label>
            <input
              type="tel"
              style={styles.input}
              value={formData.phone}
              onChange={e => setFormData({...formData, phone: e.target.value})}
              placeholder="0123456789"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>地址</label>
            <textarea
              style={{...styles.input, minHeight: '80px'}}
              value={formData.address}
              onChange={e => setFormData({...formData, address: e.target.value})}
              placeholder="組織地址"
            />
          </div>

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
              style={styles.submitButton}
              disabled={submitting}
            >
              {submitting ? '創建中...' : '創建組織'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 創建活動 Modal
const CreateEventModal = ({ organization, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    eventNameZh: '',
    eventNameEn: '',
    eventCode: new Date().getFullYear().toString(),
    descriptionZh: '',
    startDate: '',
    endDate: '',
    location: '',
    totalCapital: 2000000
  });
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.eventNameZh || !formData.eventCode || !formData.startDate) {
      alert('請填寫必填欄位');
      return;
    }

    try {
      setSubmitting(true);
      
      await addDoc(
        collection(db, 'organizations', organization.id, 'events'),
        {
          eventCode: formData.eventCode,
          eventName: {
            'zh-CN': formData.eventNameZh,
            'en': formData.eventNameEn || formData.eventNameZh
          },
          eventInfo: {
            description: {
              'zh-CN': formData.descriptionZh,
              'en': formData.descriptionZh
            },
            startDate: formData.startDate,
            endDate: formData.endDate || formData.startDate,
            location: formData.location,
            purpose: '筹募学校发展基金'
          },
          eventManager: null,
          settings: {
            totalCapital: parseInt(formData.totalCapital),
            pointToRinggitRatio: 1,
            allowCustomerRegistration: true,
            requireOTP: true,
            multiLanguage: true
          },
          statistics: {
            totalUsers: 0,
            totalCustomers: 0,
            totalSellers: 0,
            totalMerchants: 0,
            totalManagers: 0,
            totalTransactions: 0,
            totalPointsIssued: 0,
            totalPointsConsumed: 0,
            assignedCapital: 0,
            availableCapital: parseInt(formData.totalCapital)
          },
          status: 'planning',
          createdAt: serverTimestamp(),
          createdBy: 'platform_admin',
          updatedAt: serverTimestamp()
        }
      );

      alert('活動創建成功！');
      onSuccess();
    } catch (error) {
      console.error('創建活動失敗:', error);
      alert('創建活動失敗: ' + error.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>
          為 {organization.orgName['zh-CN']} 創建活動
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>活動名稱（中文）*</label>
            <input
              type="text"
              style={styles.input}
              value={formData.eventNameZh}
              onChange={e => setFormData({...formData, eventNameZh: e.target.value})}
              placeholder="例如：2025校庆义卖会"
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>活動名稱（英文）</label>
            <input
              type="text"
              style={styles.input}
              value={formData.eventNameEn}
              onChange={e => setFormData({...formData, eventNameEn: e.target.value})}
              placeholder="例如：2025 Charity Fair"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>活動代碼 *</label>
            <input
              type="text"
              style={styles.input}
              value={formData.eventCode}
              onChange={e => setFormData({...formData, eventCode: e.target.value})}
              placeholder="例如：2025"
              required
            />
            <small style={styles.hint}>
              URL 將會是: /{organization.orgCode}-{formData.eventCode}/mobile
            </small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>活動描述</label>
            <textarea
              style={{...styles.input, minHeight: '80px'}}
              value={formData.descriptionZh}
              onChange={e => setFormData({...formData, descriptionZh: e.target.value})}
              placeholder="活動詳細描述"
            />
          </div>

          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>開始日期 *</label>
              <input
                type="date"
                style={styles.input}
                value={formData.startDate}
                onChange={e => setFormData({...formData, startDate: e.target.value})}
                required
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>結束日期</label>
              <input
                type="date"
                style={styles.input}
                value={formData.endDate}
                onChange={e => setFormData({...formData, endDate: e.target.value})}
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>活動地點</label>
            <input
              type="text"
              style={styles.input}
              value={formData.location}
              onChange={e => setFormData({...formData, location: e.target.value})}
              placeholder="活動舉辦地點"
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>總資本額度（RM）</label>
            <input
              type="number"
              style={styles.input}
              value={formData.totalCapital}
              onChange={e => setFormData({...formData, totalCapital: e.target.value})}
              min="0"
              step="1000"
            />
          </div>

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
              style={styles.submitButton}
              disabled={submitting}
            >
              {submitting ? '創建中...' : '創建活動'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// 樣式定義
const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    padding: '2rem'
  },
  loadingCard: {
    background: 'white',
    padding: '3rem',
    borderRadius: '16px',
    textAlign: 'center',
    maxWidth: '400px',
    margin: '0 auto'
  },
  spinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #667eea',
    borderTopColor: 'transparent',
    borderRadius: '50%',
    margin: '0 auto 1rem',
    animation: 'spin 1s linear infinite'
  },
  header: {
    background: 'white',
    padding: '2rem',
    borderRadius: '16px',
    marginBottom: '2rem',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
  },
  title: {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: '#1f2937',
    margin: '0 0 0.5rem 0'
  },
  subtitle: {
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
    cursor: 'pointer',
    transition: 'transform 0.2s'
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
    cursor: 'pointer'
  },
  iconButton: {
    padding: '0.5rem 0.75rem',
    background: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer'
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
    fontWeight: '500'
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
  modalTitle: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: '1.5rem'
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
    cursor: 'pointer'
  },
  submitButton: {
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: '500',
    cursor: 'pointer'
  }
};

export default PlatformDashboard;