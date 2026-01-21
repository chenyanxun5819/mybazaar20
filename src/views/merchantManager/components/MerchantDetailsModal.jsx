import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

const MerchantDetailsModal = ({ merchant, onClose }) => {
  const [activeTab, setActiveTab] = useState('basic'); // basic, qrcode, revenue

  // 格式化日期
  const formatDate = (timestamp) => {
    if (!timestamp) return '-';
    try {
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleString('zh-CN');
    } catch {
      return '-';
    }
  };

  // 下载 QR Code
  const handleDownloadQR = () => {
    const svg = document.getElementById('merchant-qrcode');
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();
    
    canvas.width = 512;
    canvas.height = 512;
    
    img.onload = () => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `merchant-${merchant.id}-qrcode.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };
    
    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>{merchant.stallName}</h2>
            <div style={styles.subtitle}>
              {merchant.operationStatus?.isActive ? (
                <span style={styles.activeBadge}>营业中</span>
              ) : (
                <span style={styles.inactiveBadge}>已暂停</span>
              )}
            </div>
          </div>
          <button onClick={onClose} style={styles.closeButton}>✕</button>
        </div>

        {/* 标签页 */}
        <div style={styles.tabs}>
          <button
            onClick={() => setActiveTab('basic')}
            style={{...styles.tab, ...(activeTab === 'basic' && styles.activeTab)}}
          >
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('qrcode')}
            style={{...styles.tab, ...(activeTab === 'qrcode' && styles.activeTab)}}
          >
            QR Code
          </button>
          <button
            onClick={() => setActiveTab('revenue')}
            style={{...styles.tab, ...(activeTab === 'revenue' && styles.activeTab)}}
          >
            收入统计
          </button>
        </div>

        {/* 内容区域 */}
        <div style={styles.content}>
          {/* 基本信息 */}
          {activeTab === 'basic' && (
            <div style={styles.tabContent}>
              {/* 摊位信息 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>摊位信息</h3>
                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>摊位ID</div>
                    <div style={styles.infoValue}>{merchant.id}</div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>摊位名称</div>
                    <div style={styles.infoValue}>{merchant.stallName}</div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>摊位描述</div>
                    <div style={styles.infoValue}>
                      {merchant.description || '-'}
                    </div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>营业状态</div>
                    <div style={styles.infoValue}>
                      {merchant.operationStatus?.isActive ? '营业中' : '已暂停'}
                      {!merchant.operationStatus?.isActive && merchant.operationStatus?.pauseReason && (
                        <div style={styles.pauseReason}>
                          原因: {merchant.operationStatus.pauseReason}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 联系方式 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>联系方式</h3>
                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>联系电话</div>
                    <div style={styles.infoValue}>{merchant.contactInfo?.phone || '-'}</div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>联系邮箱</div>
                    <div style={styles.infoValue}>{merchant.contactInfo?.email || '-'}</div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>备注</div>
                    <div style={styles.infoValue}>{merchant.contactInfo?.note || '-'}</div>
                  </div>
                </div>
              </div>

              {/* 人员信息 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>人员信息</h3>
                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>摊主</div>
                    <div style={styles.infoValue}>
                      {merchant.merchantOwnerId ? (
                        <span style={styles.ownerBadge}>已分配</span>
                      ) : (
                        <span style={styles.unassignedBadge}>未分配</span>
                      )}
                    </div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>助理数</div>
                    <div style={styles.infoValue}>
                      {merchant.merchantAsistsCount || 0} / 5
                    </div>
                  </div>
                </div>
              </div>

              {/* 元数据 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>创建信息</h3>
                <div style={styles.infoGrid}>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>创建时间</div>
                    <div style={styles.infoValue}>
                      {formatDate(merchant.metadata?.createdAt)}
                    </div>
                  </div>
                  <div style={styles.infoItem}>
                    <div style={styles.infoLabel}>最后更新</div>
                    <div style={styles.infoValue}>
                      {formatDate(merchant.metadata?.updatedAt)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* QR Code */}
          {activeTab === 'qrcode' && (
            <div style={styles.tabContent}>
              <div style={styles.qrcodeContainer}>
                <h3 style={styles.sectionTitle}>收款 QR Code</h3>
                <p style={styles.qrcodeHint}>
                  Customer 扫描此二维码可向该摊位付款
                </p>
                
                <div style={styles.qrcodeWrapper}>
                  <QRCodeSVG
                    id="merchant-qrcode"
                    value={JSON.stringify(merchant.qrCodeData || {})}
                    size={256}
                    level="H"
                  />
                </div>
                
                <div style={styles.qrcodeInfo}>
                  <div style={styles.qrcodeInfoItem}>
                    <strong>类型:</strong> {merchant.qrCodeData?.type || '-'}
                  </div>
                  <div style={styles.qrcodeInfoItem}>
                    <strong>摊位ID:</strong> {merchant.qrCodeData?.merchantId || '-'}
                  </div>
                  <div style={styles.qrcodeInfoItem}>
                    <strong>生成时间:</strong> {formatDate(merchant.qrCodeData?.generatedAt)}
                  </div>
                </div>
                
                <button
                  onClick={handleDownloadQR}
                  style={styles.downloadButton}
                >
                  📥 下载 QR Code
                </button>
              </div>
            </div>
          )}

          {/* 收入统计 */}
          {activeTab === 'revenue' && (
            <div style={styles.tabContent}>
              {/* 总收入统计 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>总收入统计</h3>
                <div style={styles.statsGrid}>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>总收入</div>
                    <div style={styles.statValue}>
                      {(merchant.revenueStats?.totalRevenue || 0).toLocaleString()} 点
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>交易笔数</div>
                    <div style={styles.statValue}>
                      {merchant.revenueStats?.transactionCount || 0} 笔
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>平均交易额</div>
                    <div style={styles.statValue}>
                      {(merchant.revenueStats?.averageTransactionAmount || 0).toFixed(0)} 点
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>最后交易</div>
                    <div style={styles.statValue}>
                      {formatDate(merchant.revenueStats?.lastTransactionAt)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 今日收入 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>今日收入</h3>
                <div style={styles.statsGrid}>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>今日收入</div>
                    <div style={styles.statValue}>
                      {(merchant.dailyRevenue?.today || 0).toLocaleString()} 点
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>今日交易数</div>
                    <div style={styles.statValue}>
                      {merchant.dailyRevenue?.todayTransactionCount || 0} 笔
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>摊主收取</div>
                    <div style={styles.statValue}>
                      {(merchant.dailyRevenue?.todayOwnerCollected || 0).toLocaleString()} 点
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>助理收取</div>
                    <div style={styles.statValue}>
                      {(merchant.dailyRevenue?.todayAsistsCollected || 0).toLocaleString()} 点
                    </div>
                  </div>
                </div>
                <div style={styles.hint}>
                  数据每日00:00（MYT）自动重置
                </div>
              </div>

              {/* 收入分布 */}
              <div style={styles.section}>
                <h3 style={styles.sectionTitle}>收入分布</h3>
                <div style={styles.statsGrid}>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>摊主收取（总计）</div>
                    <div style={styles.statValue}>
                      {(merchant.revenueStats?.ownerCollectedRevenue || 0).toLocaleString()} 点
                    </div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={styles.statLabel}>助理收取（总计）</div>
                    <div style={styles.statValue}>
                      {(merchant.revenueStats?.asistsCollectedRevenue || 0).toLocaleString()} 点
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部 */}
        <div style={styles.footer}>
          <button onClick={onClose} style={styles.closeButtonFooter}>
            关闭
          </button>
        </div>
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
    maxWidth: '800px',
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
  subtitle: {
    marginTop: '0.5rem'
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
  activeBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  inactiveBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#f3f4f6',
    color: '#4b5563',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500'
  },
  tabs: {
    display: 'flex',
    borderBottom: '2px solid #e5e7eb',
    paddingLeft: '1.5rem'
  },
  tab: {
    padding: '1rem 1.5rem',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    color: '#6b7280',
    marginBottom: '-2px'
  },
  activeTab: {
    color: '#8b5cf6',
    borderBottomColor: '#8b5cf6'
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '1.5rem'
  },
  tabContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  section: {
    backgroundColor: '#f9fafb',
    padding: '1.5rem',
    borderRadius: '8px'
  },
  sectionTitle: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: '#374151',
    marginBottom: '1rem'
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
    gap: '1rem'
  },
  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  infoLabel: {
    fontSize: '0.875rem',
    fontWeight: '500',
    color: '#6b7280'
  },
  infoValue: {
    fontSize: '1rem',
    color: '#1f2937'
  },
  pauseReason: {
    fontSize: '0.875rem',
    color: '#ef4444',
    marginTop: '0.25rem'
  },
  ownerBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#d1fae5',
    color: '#065f46',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500',
    display: 'inline-block'
  },
  unassignedBadge: {
    padding: '0.25rem 0.75rem',
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    borderRadius: '9999px',
    fontSize: '0.875rem',
    fontWeight: '500',
    display: 'inline-block'
  },
  qrcodeContainer: {
    textAlign: 'center'
  },
  qrcodeHint: {
    color: '#6b7280',
    marginBottom: '1.5rem'
  },
  qrcodeWrapper: {
    display: 'inline-block',
    padding: '2rem',
    backgroundColor: 'white',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
    marginBottom: '1.5rem'
  },
  qrcodeInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    textAlign: 'left',
    backgroundColor: '#f9fafb',
    padding: '1rem',
    borderRadius: '8px',
    marginBottom: '1rem',
    fontSize: '0.875rem'
  },
  qrcodeInfoItem: {
    color: '#374151'
  },
  downloadButton: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(139,92,246,0.3)'
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '1rem'
  },
  statCard: {
    backgroundColor: 'white',
    padding: '1rem',
    borderRadius: '8px',
    textAlign: 'center'
  },
  statLabel: {
    fontSize: '0.875rem',
    color: '#6b7280',
    marginBottom: '0.5rem'
  },
  statValue: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: '#1f2937'
  },
  hint: {
    fontSize: '0.75rem',
    color: '#9ca3af',
    marginTop: '0.5rem',
    fontStyle: 'italic'
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '1.5rem',
    borderTop: '2px solid #e5e7eb'
  },
  closeButtonFooter: {
    padding: '0.75rem 1.5rem',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: '500',
    color: '#374151'
  }
};

export default MerchantDetailsModal;

