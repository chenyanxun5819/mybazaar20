import { useState, useEffect } from 'react';
import { db } from '../../config/firebase';
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp, getDoc, deleteDoc } from 'firebase/firestore';
import AssignEventManager from './AssignEventManager';
import { auth } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

const PlatformDashboard = () => {
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showAssignManager, setShowAssignManager] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const navigate = useNavigate();  // ???啣?

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

      // ??瘛餃??餉恣?亙?
      const totalUsers = orgsData.reduce((sum, org) => sum + (org.statistics?.totalUsers || 0), 0);
      console.log('[PlatformDashboard] ?餌?瑟:', totalUsers);
      console.log('[PlatformDashboard] 蝏??唳:', orgsData);

      setOrganizations(orgsData);
    } catch (error) {
      console.error('?蝸蝏?憭梯揖:', error);
      alert('?蝸蝏?憭梯揖: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignManager = (org, event) => {
    setSelectedOrg(org);
    setSelectedEvent(event);
    setShowAssignManager(true);
  };

  const handleAssignSuccess = () => {
    setShowAssignManager(false);
    setSelectedOrg(null);
    setSelectedEvent(null);
    loadOrganizations();
  };

  // ???啣??餃?賣
  const handleLogout = async () => {
    try {
      console.log('[PlatformDashboard] 撘憪??);
      await signOut(auth);
      console.log('[PlatformDashboard] ?餃??');
      navigate('/platform/login');
    } catch (error) {
      console.error('[PlatformDashboard] ?餃憭梯揖:', error);
      alert('?餃憭梯揖嚗? + error.message);
    }
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loadingCard}>
          <div style={styles.spinner}></div>
          <p>?蝸銝?..</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* ??靽格?? header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>? Platform 蝞∠?銝剖?</h1>
          <p style={styles.subtitle}>蝞∠????蝏?瘣餃</p>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <button
            style={styles.primaryButton}
            onClick={() => setShowCreateOrg(true)}
          >
            + ?遣?啁?蝏?          </button>
          <button
            style={styles.logoutButton}
            onClick={handleLogout}
            title="?餃"
          >
            ? ?餃
          </button>
        </div>
      </div>

      <div style={styles.statsGrid}>
        <StatCard
          title="?餌?蝏"
          value={organizations.length}
          icon="?"
          color="#667eea"
        />
        <StatCard
          title="?餅暑?冽"
          value={organizations.reduce((sum, org) => sum + org.events.length, 0)}
          icon="??"
          color="#764ba2"
        />
        <StatCard
          title="瘣餉?瘣餃"
          value={organizations.reduce(
            (sum, org) => sum + org.events.filter(e => e.status === 'active').length,
            0
          )}
          icon="??
          color="#10b981"
        />
        <StatCard
          title="?餌?瑟"
          value={organizations.reduce((sum, org) => sum + (org.statistics?.totalUsers || 0), 0)}
          icon="?"
          color="#f59e0b"
        />
      </div>

      <div style={styles.orgList}>
        {organizations.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: '64px', marginBottom: '1rem' }}>?</div>
            <h3>餈瓷??蝏?/h3>
            <p style={{ color: '#6b7280', marginBottom: '1.5rem' }}>
              ?孵銝??遣蝚砌?銝芰?蝏?            </p>
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
              onAssignManager={handleAssignManager}
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

      {showAssignManager && (
        <AssignEventManager
          organization={selectedOrg}
          event={selectedEvent}
          onClose={() => {
            setShowAssignManager(false);
            setSelectedOrg(null);
            setSelectedEvent(null);
          }}
          onSuccess={handleAssignSuccess}
        />
      )}
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

const OrganizationCard = ({ organization, onCreateEvent, onAssignManager, onReload }) => {
  const [expanded, setExpanded] = useState(false);
  const [showEditIdentityTags, setShowEditIdentityTags] = useState(false);

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
              {organization.events.length} 銝芣暑??            </span>
            <span style={{
              ...styles.statusBadge,
              background: organization.status === 'active' ? '#d1fae5' : '#fee2e2',
              color: organization.status === 'active' ? '#065f46' : '#991b1b'
            }}>
              {organization.status === 'active' ? '餈?銝? : '撌脣???}
            </span>
          </div>
        </div>
        <div style={styles.orgActions}>
          <button
            style={styles.secondaryButton}
            onClick={() => setShowEditIdentityTags(true)}
            title="蝻?頨思遢?倌"
          >
            ?儭?頨思遢?倌
          </button>
          <button
            style={styles.secondaryButton}
            onClick={() => onCreateEvent(organization)}
          >
            + ?遣瘣餃
          </button>
          <button
            style={styles.iconButton}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '?? : '??}
          </button>
        </div>
      </div>

      {/* ???啣?嚗蝷箏??澈隞賣?蝑?*/}
      <div style={styles.identityTagsPreview}>
        <span style={styles.identityTagsLabel}>頨思遢?倌嚗?/span>
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
          <span style={styles.noTags}>?芾挽蝵株澈隞賣?蝑?/span>
        )}
      </div>

      {expanded && (
        <div style={styles.eventsSection}>
          <h4 style={styles.eventsTitle}>瘣餃?”</h4>
          {organization.events.length === 0 ? (
            <p style={styles.noEvents}>甇斤?蝏?瘝⊥?瘣餃</p>
          ) : (
            <div style={styles.eventsGrid}>
              {organization.events.map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  organization={organization}
                  onAssignManager={() => onAssignManager(organization, event)}
                  onReload={onReload}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ???啣?嚗?颲澈隞賣?蝑曄? Modal */}
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

// ???湔?? EventCard - 瘛餃??餃?蝵??曄內 + Event Manager 靽⊥
// ============================================
// 摰???鈭辣?嚗???admins 皜?嚗?// ============================================


const EventCard = ({ event, organization, onAssignManager, onReload }) => {
  const [copySuccess, setCopySuccess] = useState('');
  const [eventManager, setEventManager] = useState(null);
  const [loadingManager, setLoadingManager] = useState(true);
  const [deleting, setDeleting] = useState(false);

  // ?蝸 Event Manager 靽⊥
  useEffect(() => {
    const loadEventManager = async () => {
      try {
        setLoadingManager(true);
        if (!event.eventManager) {
          setEventManager(null);
          return;
        }

        const managerRef = doc(
          db,
          'organizations',
          organization.id,
          'events',
          event.id,
          'users',
          event.eventManager
        );

        const managerSnap = await getDoc(managerRef);
        if (managerSnap.exists()) {
          setEventManager(managerSnap.data());
        }
      } catch (error) {
        console.error('[EventCard] ?蝸 Event Manager 憭梯揖:', error);
      } finally {
        setLoadingManager(false);
      }
    };

    loadEventManager();
  }, [event.id, event.eventManager, organization.id]);

  // ?澆????  const formatDate = (dateStr) => {
    if (!dateStr) return '?芾挽蝵?;
    if (typeof dateStr === 'object' && dateStr.toDate) {
      return dateStr.toDate().toLocaleDateString('zh-CN');
    }
    return String(dateStr);
  };

  // ?寞瘨晶?恣蝞?隞嗥??  const getEventStatus = () => {
    const endDate = event.eventInfo?.consumptionPeriod?.endDate;
    if (!endDate) return event.status || 'planning';

    let end = new Date(endDate);

    // 憭? Firestore Timestamp 撖寡情
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

  // ??雿輻 Cloud Function ?鈭辣
  const handleDeleteEvent = async () => {
    // 1儭 憓撩?＆霈文笆霂?
    if (!confirm(
      `?? 蝖桀?閬??斗迨瘣餃??\n\n` +
      `瘣餃?妍嚗?{event.eventName?.['zh-CN']}\n` +
      `瘣餃隞??嚗?{event.eventCode}\n` +
      `?冽?圈?嚗?{event.statistics?.totalUsers || 0} 鈭暝n` +
      `Event Manager嚗?{eventManager ? eventManager.basicInfo?.englishName : '?芸???}\n\n` +
      `甇斗?雿??嚗n` +
      `  ??瘣餃?﹝?祈澈\n` +
      `  ?????瑟??(${event.statistics?.totalUsers || 0} 雿??\n` +
      `  ??????唳 (?券蝑?\n` +
      `  ??隞?admins ?”蝘駁 Event Manager\n` +
      `  ???湔蝏?蝏恣?唳\n\n` +
      `?? 甇斗?雿?瘜?嚗
    )) {
      return;
    }

    try {
      setDeleting(true);
      console.log('[EventCard] 撘憪??斗暑??', event.id);

      // 2儭 ?瑕?敶??冽??ID Token
      const idToken = await auth.currentUser.getIdToken();

      // 3儭 靚 Cloud Function
      const functionUrl = 'https://us-central1-mybazaar-c4881.cloudfunctions.net/deleteEventHttp';

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: organization.id,
          eventId: event.id,
          idToken: idToken
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '?憭梯揖');
      }

      const result = await response.json();
      console.log('[EventCard] ?????:', result);

      alert(
        `??瘣餃???嚗n\n` +
        `撌脣??歹?\n` +
        `  ??瘣餃?﹝: 1 銝歿n` +
        `  ???冽?唳: ${result.deletedUsers} 雿n` +
        `  ????? ${result.deletedMetadata} 銝歿n` +
        `  ??Event Manager: ${result.removedAdmins} 雿n` +
        `  ??撌脫?啁?蝏?霈⊥?害
      );

      // 4儭 ??蝸?唳
      if (onReload) {
        onReload();
      }

    } catch (error) {
      console.error('[EventCard] ?瘣餃憭梯揖:', error);
      alert(`???憭梯揖嚗?{error.message}\n\n霂瑟??嗅鈭圾霂衣?靽⊥`);
    } finally {
      setDeleting(false);
    }
  };

  // ???餃?蝵?
  const generateLoginUrl = () => {
    const baseUrl = window.location.origin;
    return `${baseUrl}/login/${organization.orgCode}-${event.eventCode}`;
  };

  const loginUrl = generateLoginUrl();

  // 憭?餃?蝵?
  const handleCopyLoginUrl = async () => {
    try {
      await navigator.clipboard.writeText(loginUrl);
      setCopySuccess('??撌脣???);
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      alert('憭憭梯揖嚗窈?憭');
    }
  };

  // ?? QR Code URL
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(loginUrl)}`;

  // ?? QR Code
  const handleShowQRCode = () => {
    window.open(qrCodeUrl, '_blank', 'width=350,height=350');
  };

  return (
    <div style={styles.eventCard}>
      {/* 鈭辣憭湧 */}
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
              {eventStatus === 'active' ? '餈?銝? :
                eventStatus === 'completed' ? '撌脩??? :
                  '蝑孵?銝?}
            </span>
          </div>
        </div>
      </div>

      {/* 蝏恣?唳 */}
      <div style={styles.eventStats}>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>?冽??/div>
          <div style={styles.statValue}>{event.statistics?.totalUsers || 0}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>鈭斗???/div>
          <div style={styles.statValue}>{event.statistics?.totalTransactions || 0}</div>
        </div>
        <div style={styles.statItem}>
          <div style={styles.statLabel}>撌脣?蝘臬?</div>
          <div style={styles.statValue}>{event.statistics?.totalPointsIssued || 0}</div>
        </div>
      </div>

      {/* 瘣餃?交? */}
      <div style={styles.eventDates}>
        <div style={styles.dateItem}>
          <span style={styles.dateLabel}>撣??交?嚗?/span>
          <span>{formatDate(event.eventInfo?.fairDate)}</span>
        </div>
        <div style={styles.dateItem}>
          <span style={styles.dateLabel}>瘨晶??</span>
          <span>
            {formatDate(event.eventInfo?.consumptionPeriod?.startDate)} - {formatDate(event.eventInfo?.consumptionPeriod?.endDate)}
          </span>
        </div>
      </div>

      {/* ?餃?蝵??箏? */}
      <div style={styles.loginUrlSection}>
        <div style={styles.loginUrlHeader}>
          <span style={styles.loginUrlLabel}>?? ?餃?蝵?</span>
          <button
            style={styles.qrButton}
            onClick={handleShowQRCode}
            title="?亦?鈭輕??
          >
            ? 鈭輕??          </button>
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
            {copySuccess || '?? 憭'}
          </button>
        </div>
        <span style={styles.loginUrlHint}>
          ?澈甇日?亦??冽餈?瘜典??敶?        </span>
      </div>

      {/* Event Manager 靽⊥ */}
      <div style={styles.managerInfo}>
        <div style={styles.dateLabel}>Event Manager嚗?/div>
        {loadingManager ? (
          <span style={styles.loadingText}>?蝸銝?..</span>
        ) : eventManager ? (
          <div style={styles.managerDetails}>
            <strong>{eventManager.basicInfo?.englishName}</strong> ({eventManager.basicInfo?.chineseName})
            <br />
            ?? {eventManager.basicInfo?.phoneNumber}
          </div>
        ) : (
          <span style={styles.loadingText}>?芸???/span>
        )}
      </div>

      {/* ??? */}
      <div style={styles.eventActions}>
        {/* ?? Event Manager - 隞??芸???曄內 */}
        {!eventManager && (
          <button
            style={styles.assignButton}
            onClick={onAssignManager}
          >
            ? ?? Event Manager
          </button>
        )}

        {/* ?? */}
        <button
          style={{
            ...styles.deleteButton,
            ...(deleting ? styles.deleteButtonDisabled : {})
          }}
          onClick={handleDeleteEvent}
          disabled={deleting}
        >
          {deleting ? '??儭??銝?..' : '??儭??甇斗暑??}
        </button>
      </div>
    </div>
  );
};


// ???啣?嚗?颲澈隞賣?蝑曄? Modal 蝏辣
const EditIdentityTagsModal = ({ organization, onClose, onSuccess }) => {
  const [identityTags, setIdentityTags] = useState(
    organization.identityTags || []
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [checkingUsage, setCheckingUsage] = useState(false);

  // 瘛餃??唳?蝑?  const handleAddTag = () => {
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

  // ?湔?倌
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

  // ??倌嚗?閬??交?行??冽雿輻嚗?  const handleDeleteTag = async (tagId) => {
    if (!confirm('蝖桀?閬??斗迨頨思遢?倌??')) {
      return;
    }

    try {
      setCheckingUsage(true);
      setError('');

      // 璉?交?行??冽雿輻甇斗?蝑?      const usageCount = await checkTagUsage(organization.id, tagId);

      if (usageCount > 0) {
        setError(`???嚗?? ${usageCount} 銝芰?瑚蝙?冽迨頨思遢?倌`);
        return;
      }

      // 憒?瘝⊥??冽雿輻嚗??
      setIdentityTags(identityTags.filter(tag => tag.id !== tagId));

    } catch (err) {
      console.error('璉?交?蝑曆蝙?冽??萄仃韐?', err);
      setError('璉?交?蝑曆蝙?冽??萄仃韐? ' + err.message);
    } finally {
      setCheckingUsage(false);
    }
  };

  // 璉?交?蝑曆蝙?冽???  const checkTagUsage = async (orgId, tagId) => {
    try {
      // ?????events嚗?曆蝙?冽迨?倌???      let totalCount = 0;

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
      console.error('璉?交?蝑曆蝙?典仃韐?', error);
      throw error;
    }
  };

  // 銝宏?倌
  const handleMoveUp = (index) => {
    if (index === 0) return;
    const newTags = [...identityTags];
    [newTags[index - 1], newTags[index]] = [newTags[index], newTags[index - 1]];
    // ?湔 displayOrder
    newTags.forEach((tag, i) => {
      tag.displayOrder = i + 1;
    });
    setIdentityTags(newTags);
  };

  // 銝宏?倌
  const handleMoveDown = (index) => {
    if (index === identityTags.length - 1) return;
    const newTags = [...identityTags];
    [newTags[index], newTags[index + 1]] = [newTags[index + 1], newTags[index]];
    // ?湔 displayOrder
    newTags.forEach((tag, i) => {
      tag.displayOrder = i + 1;
    });
    setIdentityTags(newTags);
  };

  // 撉?銵典?
  const validateForm = () => {
    for (const tag of identityTags) {
      if (!tag.name['zh-CN'].trim() || !tag.name['en'].trim()) {
        setError('??澈隞賣?蝑曉?憿餃‵?葉?望??妍');
        return false;
      }
    }
    return true;
  };

  // ?漱靽?
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // ?湔 Organization ??identityTags
      const orgRef = doc(db, 'organizations', organization.id);
      await updateDoc(orgRef, {
        identityTags: identityTags,
        updatedAt: serverTimestamp()
      });

      alert('頨思遢?倌?湔??嚗?);
      onSuccess();

    } catch (err) {
      console.error('?湔憭梯揖:', err);
      setError('?湔憭梯揖: ' + err.message);
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
            <h2 style={styles.modalTitle}>?儭?蝻?頨思遢?倌</h2>
            <p style={styles.modalSubtitle}>
              蝏?嚗organization.orgName['zh-CN']}
            </p>
          </div>
          <button
            style={styles.closeButton}
            onClick={onClose}
            disabled={submitting}
          >
            ??          </button>
        </div>

        <div style={styles.infoBox}>
          <p style={styles.infoText}>
            ? <strong>霂湔?嚗?/strong>頨思遢?倌撠??其?甇斤?蝏????暑?具?            ?冽瘜典??園?閬銝銝芾澈隞賣?蝑整?          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.tagsContainer}>
            {identityTags.length === 0 ? (
              <div style={styles.emptyTags}>
                <p>餈瓷?澈隞賣?蝑?/p>
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
                      title="銝宏"
                    >
                      ??                    </button>
                    <span style={styles.orderNumber}>{index + 1}</span>
                    <button
                      type="button"
                      style={styles.orderButton}
                      onClick={() => handleMoveDown(index)}
                      disabled={index === identityTags.length - 1 || submitting}
                      title="銝宏"
                    >
                      ??                    </button>
                  </div>

                  <div style={styles.tagInputs}>
                    <div style={styles.tagInputGroup}>
                      <label style={styles.tagLabel}>銝剜??妍</label>
                      <input
                        type="text"
                        value={tag.name['zh-CN']}
                        onChange={(e) => handleUpdateTag(tag.id, 'name', 'zh-CN', e.target.value)}
                        placeholder="靘?嚗???
                        style={styles.tagInput}
                        disabled={submitting}
                        required
                      />
                    </div>
                    <div style={styles.tagInputGroup}>
                      <label style={styles.tagLabel}>?望??妍</label>
                      <input
                        type="text"
                        value={tag.name['en']}
                        onChange={(e) => handleUpdateTag(tag.id, 'name', 'en', e.target.value)}
                        placeholder="靘?嚗taff"
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
                    title="??倌"
                  >
                    ??儭?                  </button>
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
            ??瘛餃??唳?蝑?          </button>

          {error && (
            <div style={styles.errorMessage}>
              ?? {error}
            </div>
          )}

          <div style={styles.modalActions}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              ??
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...(submitting ? styles.submitButtonDisabled : {})
              }}
              disabled={submitting}
            >
              {submitting ? '靽?銝?..' : '靽?靽格'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// CreateOrganizationModal 蝏辣
const CreateOrganizationModal = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    orgCode: '',
    orgNameEN: '',
    orgNameZH: '',
    status: 'active'
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

    if (!formData.orgCode || !formData.orgNameEN || !formData.orgNameZH) {
      setError('霂瑕‵????憛怠?畾?);
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // 璉??orgCode ?臬撌脣???      const orgsSnapshot = await getDocs(collection(db, 'organizations'));
      const existingOrg = orgsSnapshot.docs.find(
        doc => doc.data().orgCode.toLowerCase() === formData.orgCode.toLowerCase()
      );

      if (existingOrg) {
        setError('甇斤?蝏誨?歇摮嚗窈雿輻?嗡?隞??');
        return;
      }

      // ???遣暺恕?澈隞賣?蝑?      const defaultIdentityTags = [
        {
          id: 'staff',
          name: {
            'en': 'Staff',
            'zh-CN': '??'
          },
          displayOrder: 1,
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'student',
          name: {
            'en': 'Student',
            'zh-CN': '摮衣?'
          },
          displayOrder: 2,
          isActive: true,
          createdAt: new Date().toISOString()
        },
        {
          id: 'teacher',
          name: {
            'en': 'Teacher',
            'zh-CN': '??'
          },
          displayOrder: 3,
          isActive: true,
          createdAt: new Date().toISOString()
        }
      ];

      await addDoc(collection(db, 'organizations'), {
        orgCode: formData.orgCode.toLowerCase(),
        orgName: {
          'en': formData.orgNameEN,
          'zh-CN': formData.orgNameZH
        },
        identityTags: defaultIdentityTags, // ??瘛餃?暺恕頨思遢?倌
        status: formData.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      alert('蝏??遣??嚗?);
      onSuccess();

    } catch (err) {
      console.error('?遣憭梯揖:', err);
      setError('?遣憭梯揖: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>?遣?啁?蝏?/h2>

        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>蝏?隞?? *</label>
            <input
              type="text"
              name="orgCode"
              value={formData.orgCode}
              onChange={handleChange}
              placeholder="靘?嚗ch"
              style={styles.input}
              disabled={submitting}
              required
            />
            <small style={styles.hint}>撠?摮?嚗鈭?URL</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>蝏??妍嚗??*</label>
            <input
              type="text"
              name="orgNameEN"
              value={formData.orgNameEN}
              onChange={handleChange}
              placeholder="Organization Name"
              style={styles.input}
              disabled={submitting}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>蝏??妍嚗葉??*</label>
            <input
              type="text"
              name="orgNameZH"
              value={formData.orgNameZH}
              onChange={handleChange}
              placeholder="蝏??妍"
              style={styles.input}
              disabled={submitting}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>?嗆?/label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              style={styles.input}
              disabled={submitting}
            >
              <option value="active">餈?銝?/option>
              <option value="inactive">撌脣???/option>
            </select>
          </div>

          {error && (
            <div style={styles.errorMessage}>
              ?? {error}
            </div>
          )}

          <div style={styles.modalActions}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              ??
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...(submitting ? styles.submitButtonDisabled : {})
              }}
              disabled={submitting}
            >
              {submitting ? '?遣銝?..' : '?遣蝏?'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// CreateEventModal 蝏辣
const CreateEventModal = ({ organization, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    eventCode: '',
    eventNameEN: '',
    eventNameZH: '',
    fairDate: '',
    fairTime: '',
    location: '',
    purpose: '',
    consumptionStartDate: '',
    consumptionEndDate: '',
    status: 'planning'
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

    if (!formData.eventCode || !formData.eventNameEN || !formData.eventNameZH) {
      setError('霂瑕‵????憛怠?畾?);
      return;
    }

    try {
      setSubmitting(true);
      setError('');

      // 璉??eventCode ?臬撌脣???      const eventsSnapshot = await getDocs(
        collection(db, 'organizations', organization.id, 'events')
      );
      const existingEvent = eventsSnapshot.docs.find(
        doc => doc.data().eventCode.toLowerCase() === formData.eventCode.toLowerCase()
      );

      if (existingEvent) {
        setError('甇斗暑?其誨?歇摮嚗窈雿輻?嗡?隞??');
        return;
      }

      await addDoc(collection(db, 'organizations', organization.id, 'events'), {
        eventCode: formData.eventCode,
        eventName: {
          'en': formData.eventNameEN,
          'zh-CN': formData.eventNameZH
        },
        description: {
          fairDate: formData.fairDate || null,
          fairTime: formData.fairTime || null,
          location: formData.location || null,
          purpose: formData.purpose || null
        },
        eventInfo: {
          fairDate: formData.fairDate || null,
          consumptionPeriod: {
            startDate: formData.consumptionStartDate || null,
            endDate: formData.consumptionEndDate || null
          }
        },
        settings: {},
        status: formData.status,
        statistics: {
          totalUsers: 0
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      alert('瘣餃?遣??嚗?);
      onSuccess();

    } catch (err) {
      console.error('?遣憭梯揖:', err);
      setError('?遣憭梯揖: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
        <h2 style={styles.modalTitle}>?遣?唳暑??/h2>
        <div style={styles.infoBox}>
          <p><strong>蝏?嚗?/strong>{organization.orgName['zh-CN']}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={styles.formGroup}>
            <label style={styles.label}>瘣餃隞?? *</label>
            <input
              type="text"
              name="eventCode"
              value={formData.eventCode}
              onChange={handleChange}
              placeholder="靘?嚗?025"
              style={styles.input}
              disabled={submitting}
              required
            />
            <small style={styles.hint}>?虜雿輻撟港遢</small>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>瘣餃?妍嚗??*</label>
            <input
              type="text"
              name="eventNameEN"
              value={formData.eventNameEN}
              onChange={handleChange}
              placeholder="Event Name"
              style={styles.input}
              disabled={submitting}
              required
            />
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>瘣餃?妍嚗葉??*</label>
            <input
              type="text"
              name="eventNameZH"
              value={formData.eventNameZH}
              onChange={handleChange}
              placeholder="瘣餃?妍"
              style={styles.input}
              disabled={submitting}
              required
            />
          </div>

          <div style={styles.sectionDivider}>
            <h3 style={styles.sectionTitle}>瘣餃霂行?</h3>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>銋?隡??/label>
            <input
              type="date"
              name="fairDate"
              value={formData.fairDate}
              onChange={handleChange}
              style={styles.input}
              disabled={submitting}
            />
          </div>

          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>銋?隡??/label>
              <input
                type="time"
                name="fairTime"
                value={formData.fairTime}
                onChange={handleChange}
                style={styles.input}
                disabled={submitting}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>?啁</label>
              <input
                type="text"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="靘?嚗蝷澆?????
                style={styles.input}
                disabled={submitting}
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>瘣餃?桃?</label>
            <input
              type="text"
              name="purpose"
              value={formData.purpose}
              onChange={handleChange}
              placeholder="靘?嚗食?郎?∪?撅??
              style={styles.input}
              disabled={submitting}
            />
          </div>

          <div style={styles.formRow}>
            <div style={styles.formGroup}>
              <label style={styles.label}>瘨晶??憪?/label>
              <input
                type="date"
                name="consumptionStartDate"
                value={formData.consumptionStartDate}
                onChange={handleChange}
                style={styles.input}
                disabled={submitting}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>瘨晶????/label>
              <input
                type="date"
                name="consumptionEndDate"
                value={formData.consumptionEndDate}
                onChange={handleChange}
                style={styles.input}
                disabled={submitting}
              />
            </div>
          </div>

          <div style={styles.formGroup}>
            <label style={styles.label}>?嗆?/label>
            <select
              name="status"
              value={formData.status}
              onChange={handleChange}
              style={styles.input}
              disabled={submitting}
            >
              <option value="planning">蝑孵?銝?/option>
              <option value="active">餈?銝?/option>
              <option value="completed">撌脣???/option>
            </select>
          </div>

          {error && (
            <div style={styles.errorMessage}>
              ?? {error}
            </div>
          )}

          <div style={styles.modalActions}>
            <button
              type="button"
              style={styles.cancelButton}
              onClick={onClose}
              disabled={submitting}
            >
              ??
            </button>
            <button
              type="submit"
              style={{
                ...styles.submitButton,
                ...(submitting ? styles.submitButtonDisabled : {})
              }}
              disabled={submitting}
            >
              {submitting ? '?遣銝?..' : '?遣瘣餃'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

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
  // ???啣??瑕?嚗澈隞賣?蝑暸?閫?  identityTagsPreview: {
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
  // ???啣??瑕?嚗?颲澈隞賣?蝑?  tagsContainer: {
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
  // ???啣? Event Manager 靽⊥?瑕?
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
  }
};

// 瘛餃??蓮?函
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
