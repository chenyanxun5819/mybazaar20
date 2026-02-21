import { useState, useEffect, useRef } from 'react';
import { db } from '../../../config/firebase';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { QRCodeCanvas } from 'qrcode.react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

/**
 * MerchantQRPrintModal
 *
 * 📌 用途：Platform Admin 专用 — 下载指定 Event 内所有摊位的 QR Code（ZIP 包）
 *
 * 设计原则：
 * - QR Code 输出权由 Platform Admin 掌控，merchantManager 无此功能
 * - QR Code 内容遵循 Firestore schema qrCodeData 格式（type: MERCHANT_PAYMENT）
 * - 每个摊位独立一张 PNG，文件名为「序号_摊位名称-qrcode.png」
 * - 全部打包成 ZIP 一次下载
 *
 * 依赖（需先安装）：
 *   npm install jszip file-saver
 *
 * @param {string} organizationId  - 组织 Firestore 文档 ID
 * @param {string} eventId         - 活动 Firestore 文档 ID
 * @param {string} eventName       - 活动显示名称（用于标题 & ZIP 文件名）
 * @param {Function} onClose       - 关闭 Modal 回调
 */
const MerchantQRPrintModal = ({ organizationId, eventId, eventName, onClose }) => {
  const [merchants, setMerchants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0-100

  // 用 ref 数组收集每个 QRCodeCanvas 渲染出来的 wrapper div
  const canvasRefs = useRef([]);

  // ============================================
  // 加载摊位列表
  // ============================================
  useEffect(() => {
    const loadMerchants = async () => {
      try {
        setLoading(true);
        setError('');

        const merchantsRef = collection(
          db,
          'organizations', organizationId,
          'events', eventId,
          'merchants'
        );

        let merchantsList = [];
        try {
          const q = query(merchantsRef, orderBy('metadata.createdAt', 'asc'));
          const snapshot = await getDocs(q);
          merchantsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch {
          // index 未建立时回退不排序
          const snapshot = await getDocs(merchantsRef);
          merchantsList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        }

        setMerchants(merchantsList);
        canvasRefs.current = new Array(merchantsList.length).fill(null);
      } catch (err) {
        console.error('[MerchantQRPrintModal] 加载摊位失败:', err);
        setError('加载摊位失败：' + (err.message || String(err)));
      } finally {
        setLoading(false);
      }
    };

    if (organizationId && eventId) {
      loadMerchants();
    }
  }, [organizationId, eventId]);

  // ============================================
  // 生成 QR Code 数据
  // ============================================
  const generateQRData = (merchantId) => {
    return JSON.stringify({
      type: 'MERCHANT_PAYMENT',
      version: '1.0',
      merchantId,
      eventId,
      organizationId
    });
  };

  // ============================================
  // 清理文件名（移除特殊字符）
  // ============================================
  const sanitizeFilename = (name) => {
    return name
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '_')
      .trim() || 'merchant';
  };

  // ============================================
  // 下载 ZIP
  // ============================================
  const handleDownloadZip = async () => {
    if (merchants.length === 0) return;

    setDownloading(true);
    setDownloadProgress(0);

    try {
      const zip = new JSZip();
      const folder = zip.folder('QR_Codes');

      for (let i = 0; i < merchants.length; i++) {
        const merchant = merchants[i];
        const stallName = merchant.stallName || `merchant_${i + 1}`;

        // 从 wrapper div 里取 <canvas>
        const wrapperDiv = canvasRefs.current[i];
        const canvas = wrapperDiv?.querySelector('canvas');

        if (!canvas) {
          console.warn(`[ZIP] 找不到第 ${i + 1} 个摊位的 canvas:`, stallName);
          continue;
        }

        // canvas → PNG base64（QRCodeCanvas 已生成 512px，直接使用原始高清 canvas）
        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        const filename = `${String(i + 1).padStart(2, '0')}_${sanitizeFilename(stallName)}-qrcode.png`;
        folder.file(filename, base64, { base64: true });

        setDownloadProgress(Math.round(((i + 1) / merchants.length) * 90));
      }

      // 生成 ZIP blob
      setDownloadProgress(95);
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // 触发浏览器下载
      const zipName = `${sanitizeFilename(eventName || 'event')}_QRCodes.zip`;
      saveAs(zipBlob, zipName);

      setDownloadProgress(100);
      setTimeout(() => setDownloadProgress(0), 1500);

    } catch (err) {
      console.error('[MerchantQRPrintModal] 下载 ZIP 失败:', err);
      setError('下载失败：' + (err.message || String(err)));
    } finally {
      setDownloading(false);
    }
  };

  // ============================================
  // 渲染
  // ============================================
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>

        {/* 标题栏 */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>📱 摊位 QR Code 下载</h2>
            <p style={styles.subtitle}>
              {eventName}&nbsp;·&nbsp;
              {loading ? '加载中...' : `共 ${merchants.length} 个摊位`}
            </p>
          </div>
          <div style={styles.headerActions}>
            <button
              style={{
                ...styles.downloadButton,
                ...(downloading || loading || merchants.length === 0
                  ? styles.downloadButtonDisabled : {})
              }}
              onClick={handleDownloadZip}
              disabled={downloading || loading || merchants.length === 0}
            >
              {downloading
                ? `⏳ 打包中 ${downloadProgress}%`
                : '📦 下载全部 ZIP'}
            </button>
            <button style={styles.closeButton} onClick={onClose}>✕</button>
          </div>
        </div>

        {/* 进度条 */}
        {downloading && (
          <div style={styles.progressBarTrack}>
            <div style={{ ...styles.progressBarFill, width: `${downloadProgress}%` }} />
          </div>
        )}

        {/* 内容区 */}
        <div style={styles.body}>

          {loading && (
            <div style={styles.centerBox}>
              <div style={styles.spinner}></div>
              <p style={styles.loadingText}>正在加载摊位资料...</p>
            </div>
          )}

          {!loading && error && (
            <div style={styles.errorBox}>
              <span>⚠️</span>
              <p style={{ margin: 0 }}>{error}</p>
            </div>
          )}

          {!loading && !error && merchants.length === 0 && (
            <div style={styles.centerBox}>
              <p style={styles.emptyText}>此活动暂无摊位资料</p>
              <p style={{ color: '#9ca3af', fontSize: '0.875rem', margin: 0 }}>
                请先在 Merchant Manager 中创建摊位
              </p>
            </div>
          )}

          {!loading && !error && merchants.length > 0 && (
            <>
              <div style={styles.hint}>
                💡 预览如下。点击「下载全部 ZIP」即可下载包含所有 QR Code 的压缩包，
                每张图片以摊位名称命名，方便分发给各摊主自行打印。
              </div>

              <div style={styles.qrGrid}>
                {merchants.map((merchant, index) => (
                  <QRCard
                    key={merchant.id}
                    merchant={merchant}
                    qrData={generateQRData(merchant.id)}
                    index={index}
                    canvasWrapperRef={el => { canvasRefs.current[index] = el; }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* 底部 */}
        {!loading && merchants.length > 0 && (
          <div style={styles.footer}>
            <span style={styles.footerNote}>
              ⚠️ QR Code 仅供此次义卖会使用，请妥善保管
            </span>
            <button
              style={{
                ...styles.downloadButton,
                ...(downloading ? styles.downloadButtonDisabled : {})
              }}
              onClick={handleDownloadZip}
              disabled={downloading}
            >
              {downloading ? `⏳ 打包中 ${downloadProgress}%` : '📦 下载全部 ZIP'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

// ============================================
// QR Code 卡片子组件
// ============================================
const QRCard = ({ merchant, qrData, index, canvasWrapperRef }) => {
  const stallName = merchant.stallName || '未命名摊位';
  const isActive = merchant.operationStatus?.isActive;

  return (
    <div style={styles.qrCard}>
      {/* 序号 + 状态 */}
      <div style={styles.qrCardTop}>
        <span style={styles.indexBadge}>#{String(index + 1).padStart(2, '0')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{
            ...styles.statusDot,
            backgroundColor: isActive ? '#10b981' : '#d1d5db'
          }} />
          <span style={styles.statusText}>{isActive ? '营业中' : '已暂停'}</span>
        </div>
      </div>

      {/* QR Code（生成 512px 高清版本，用 CSS 压缩显示为预览；下载时取原始高清）*/}
      <div ref={canvasWrapperRef} style={styles.qrCodeWrapper}>
        <QRCodeCanvas
          value={qrData}
          size={512}
          level="H"
          includeMargin={true}
          style={{ display: 'block', transform: 'scale(0.3125)', transformOrigin: 'top left' }}
        />
      </div>

      {/* 摊位名称 */}
      <div style={styles.qrCardBottom}>
        <div style={styles.stallName}>{stallName}</div>
        {merchant.description && (
          <div style={styles.stallDesc}>{merchant.description}</div>
        )}
        <div style={styles.scanHint}>扫码付款</div>
      </div>
    </div>
  );
};

// ============================================
// 样式
// ============================================
const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2000,
    padding: '1rem'
  },
  modal: {
    backgroundColor: '#fff',
    borderRadius: '12px',
    width: '100%',
    maxWidth: '900px',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
    overflow: 'hidden'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '1.5rem',
    borderBottom: '2px solid #e5e7eb',
    backgroundColor: '#fafafa'
  },
  title: {
    fontSize: '1.375rem',
    fontWeight: '700',
    color: '#111827',
    margin: 0
  },
  subtitle: {
    fontSize: '0.875rem',
    color: '#6b7280',
    margin: '0.375rem 0 0 0'
  },
  headerActions: {
    display: 'flex',
    gap: '0.75rem',
    alignItems: 'center'
  },
  downloadButton: {
    padding: '0.625rem 1.25rem',
    backgroundColor: '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '0.9375rem',
    fontWeight: '600',
    boxShadow: '0 2px 4px rgba(124,58,237,0.3)',
    whiteSpace: 'nowrap'
  },
  downloadButtonDisabled: {
    backgroundColor: '#c4b5fd',
    cursor: 'not-allowed',
    boxShadow: 'none'
  },
  closeButton: {
    padding: '0.5rem',
    width: '36px',
    height: '36px',
    backgroundColor: '#f3f4f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '1.125rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#6b7280'
  },
  progressBarTrack: {
    height: '4px',
    backgroundColor: '#e5e7eb'
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#7c3aed',
    transition: 'width 0.2s ease'
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '1.5rem'
  },
  hint: {
    fontSize: '0.8125rem',
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '0.625rem 1rem',
    marginBottom: '1.25rem'
  },
  qrGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem'
  },
  qrCard: {
    border: '1px solid #e5e7eb',
    borderRadius: '10px',
    padding: '1rem 0.875rem',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.07)'
  },
  qrCardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: '0.5rem'
  },
  indexBadge: {
    fontSize: '0.6875rem',
    fontWeight: '700',
    color: '#7c3aed',
    backgroundColor: '#f3e8ff',
    padding: '0.125rem 0.375rem',
    borderRadius: '4px'
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block'
  },
  statusText: {
    fontSize: '0.6875rem',
    color: '#9ca3af'
  },
  qrCodeWrapper: {
    padding: '0.5rem',
    backgroundColor: '#fff',
    borderRadius: '6px',
    width: '160px',
    height: '160px',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'flex-start'
  },
  qrCardBottom: {
    marginTop: '0.75rem',
    textAlign: 'center',
    width: '100%'
  },
  stallName: {
    fontSize: '1rem',
    fontWeight: '700',
    color: '#111827',
    marginBottom: '0.25rem',
    wordBreak: 'break-all'
  },
  stallDesc: {
    fontSize: '0.75rem',
    color: '#6b7280',
    marginBottom: '0.375rem',
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical'
  },
  scanHint: {
    fontSize: '0.6875rem',
    color: '#9ca3af',
    letterSpacing: '0.05em'
  },
  centerBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '0.75rem'
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '4px solid #f3f4f6',
    borderTop: '4px solid #7c3aed',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite'
  },
  loadingText: { color: '#6b7280', margin: 0 },
  emptyText: { fontSize: '1.125rem', color: '#374151', margin: 0 },
  errorBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    padding: '1rem',
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px'
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '1rem 1.5rem',
    borderTop: '2px solid #e5e7eb',
    backgroundColor: '#fafafa'
  },
  footerNote: {
    fontSize: '0.8125rem',
    color: '#9ca3af'
  }
};

export default MerchantQRPrintModal;