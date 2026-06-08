import { useState } from 'react';
import { getAuth } from 'firebase/auth';
import { safeFetch } from '../../../services/safeFetch';

// ────────────────────────────────────────────────────────────
// SheetJS 懒加载（只在用户点击导入/下载模板时才引入）
// ────────────────────────────────────────────────────────────
const loadXlsx = async () => {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.2/package/xlsx.mjs');
  return XLSX;
};

// ────────────────────────────────────────────────────────────
// 电话格式标准化（马来西亚 +60）
// ────────────────────────────────────────────────────────────
const normalizePhone = (raw) => {
  if (!raw) return '';
  let s = String(raw).replace(/\D/g, '');
  if (s.startsWith('60')) return '+' + s;
  if (s.startsWith('0')) return '+60' + s.slice(1);
  if (s.length >= 9) return '+60' + s;
  return '+' + s;
};

const isValidPhone = (phone) => /^\+60\d{8,10}$/.test(phone);

// ────────────────────────────────────────────────────────────
// 解析 Excel → stallsMap: { [stallName]: { owner, asists[] } }
// ────────────────────────────────────────────────────────────
const parseRosterExcel = async (file) => {
  const XLSX = await loadXlsx();
  const arrayBuffer = await file.arrayBuffer();
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  if (rows.length < 2) throw new Error('檔案內容為空，請確認格式正確');

  // 找列標頭（第一列）
  const headerRow = rows[0].map((h) => String(h).trim().toLowerCase());
  const colIdx = {
    phoneNumber: headerRow.findIndex((h) => /phone|電話|电话/.test(h)),
    stallName:   headerRow.findIndex((h) => /stall|攤位|摊位/.test(h)),
    role:        headerRow.findIndex((h) => /role|角色/.test(h)),
    chineseName: headerRow.findIndex((h) => /chinese|中文|中名/.test(h)),
    englishName: headerRow.findIndex((h) => /english|英文|英名/.test(h)),
  };

  if (colIdx.phoneNumber < 0) throw new Error('找不到「電話 / Phone」列，請使用標準模板');
  if (colIdx.stallName < 0) throw new Error('找不到「攤位名稱 / Stall Name」列，請使用標準模板');
  if (colIdx.role < 0) throw new Error('找不到「角色 / Role」列，請使用標準模板');

  const stallsMap = {};
  const globalErrors = [];

  rows.slice(1).forEach((row, i) => {
    const lineNo = i + 2;
    const rawPhone = row[colIdx.phoneNumber];
    const rawStall = colIdx.stallName >= 0 ? row[colIdx.stallName] : '';
    const rawRole  = colIdx.role >= 0 ? row[colIdx.role] : '';
    const chineseName = colIdx.chineseName >= 0 ? String(row[colIdx.chineseName] || '').trim() : '';
    const englishName = colIdx.englishName >= 0 ? String(row[colIdx.englishName] || '').trim() : '';

    // 跳過空行
    if (!rawPhone && !rawStall && !rawRole) return;

    const phoneNumber = normalizePhone(rawPhone);
    const stallName   = String(rawStall).trim();
    const role        = String(rawRole).trim().toLowerCase();

    const rowErrors = [];
    if (!isValidPhone(phoneNumber)) rowErrors.push(`第${lineNo}行：電話格式無效（${rawPhone}）`);
    if (!stallName) rowErrors.push(`第${lineNo}行：攤位名稱不可空白`);
    if (role !== 'merchantowner' && role !== 'merchantasist')
      rowErrors.push(`第${lineNo}行：角色必須是 merchantOwner 或 merchantAsist（現為 ${rawRole}）`);

    if (rowErrors.length) {
      globalErrors.push(...rowErrors);
      return;
    }

    const person = { phoneNumber, chineseName, englishName, lineNo };
    const normalizedRole = role === 'merchantowner' ? 'merchantOwner' : 'merchantAsist';

    if (!stallsMap[stallName]) stallsMap[stallName] = { stallName, owner: null, asists: [] };

    if (normalizedRole === 'merchantOwner') {
      if (stallsMap[stallName].owner) {
        globalErrors.push(`攤位「${stallName}」已有 merchantOwner，重複定義：${phoneNumber}`);
      } else {
        stallsMap[stallName].owner = person;
      }
    } else {
      stallsMap[stallName].asists.push(person);
    }
  });

  // 驗證：每個攤位必須有 owner；助理不超過 5 名
  Object.values(stallsMap).forEach(({ stallName, owner, asists }) => {
    if (!owner) globalErrors.push(`攤位「${stallName}」缺少 merchantOwner`);
    if (asists.length > 5) globalErrors.push(`攤位「${stallName}」助理超過 5 名（目前 ${asists.length} 名）`);
  });

  return { stallsMap, errors: globalErrors };
};

// ────────────────────────────────────────────────────────────
// 下載 Excel 模板
// ────────────────────────────────────────────────────────────
const downloadTemplate = async () => {
  const XLSX = await loadXlsx();
  const headers = ['phoneNumber（電話）', 'stallName（攤位名稱）', 'role（角色）', 'chineseName（中文名）', 'englishName（英文名）'];
  const sample = [
    ['+60123456789', '美食天地', 'merchantOwner', '陳大明', 'Tan Ah Ming'],
    ['+60198765432', '美食天地', 'merchantAsist', '李小花', 'Lee Xiao Hua'],
    ['+60111234567', '手工藝品', 'merchantOwner', '王美麗', 'Wong Mei Li'],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length * 1.5, 20) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '攤位名冊');
  XLSX.writeFile(wb, '攤位名冊匯入模板.xlsx');
};

// ================================================================
// 主組件
// ================================================================
const BatchImportMerchant = ({ organizationId, eventId, onClose, onSuccess }) => {
  const [step, setStep] = useState(1); // 1=上傳, 2=預覽, 3=結果
  const [file, setFile] = useState(null);
  const [stallsMap, setStallsMap] = useState({});
  const [parseErrors, setParseErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [parseLoading, setParseLoading] = useState(false);

  // ── 樣式 ──────────────────────────────────────────────────
  const styles = {
    overlay: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, padding: '1rem'
    },
    modal: {
      backgroundColor: 'white', borderRadius: '12px',
      width: '100%', maxWidth: '900px', maxHeight: '90vh',
      overflow: 'hidden', display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
    },
    header: {
      padding: '1.25rem 1.5rem', borderBottom: '1px solid #e5e7eb',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      flexShrink: 0
    },
    headerTitle: { fontSize: '1.2rem', fontWeight: 700, color: '#111827', margin: 0 },
    closeBtn: {
      background: 'none', border: 'none', fontSize: '1.5rem',
      color: '#6b7280', cursor: 'pointer', lineHeight: 1, padding: '0.25rem'
    },
    stepBar: {
      display: 'flex', gap: 0, borderBottom: '1px solid #e5e7eb',
      flexShrink: 0
    },
    stepItem: (active, done) => ({
      flex: 1, padding: '0.75rem 1rem', textAlign: 'center',
      fontSize: '0.875rem', fontWeight: active ? 600 : 400,
      color: active ? '#2563eb' : done ? '#059669' : '#9ca3af',
      borderBottom: active ? '2px solid #2563eb' : done ? '2px solid #059669' : '2px solid transparent',
      cursor: 'default'
    }),
    body: { flex: 1, overflowY: 'auto', padding: '1.5rem' },
    footer: {
      padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb',
      display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexShrink: 0
    },
    btn: (variant) => ({
      padding: '0.6rem 1.4rem', borderRadius: '8px', border: 'none',
      fontWeight: 500, cursor: 'pointer', fontSize: '0.95rem',
      backgroundColor: variant === 'primary' ? '#2563eb' : variant === 'success' ? '#059669' : '#6b7280',
      color: 'white', opacity: 1
    }),
    infoBox: {
      backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
      borderRadius: '8px', padding: '1rem', marginBottom: '1.25rem'
    },
    uploadArea: {
      border: '2px dashed #d1d5db', borderRadius: '8px',
      padding: '2.5rem 2rem', textAlign: 'center', cursor: 'pointer',
      transition: 'border-color 0.2s', marginBottom: '1rem'
    },
    errorBox: {
      backgroundColor: '#fef2f2', border: '1px solid #fca5a5',
      borderRadius: '8px', padding: '1rem', marginTop: '1rem'
    },
    stallCard: {
      border: '1px solid #e5e7eb', borderRadius: '8px',
      marginBottom: '1rem', overflow: 'hidden'
    },
    stallCardHeader: {
      backgroundColor: '#f9fafb', padding: '0.625rem 1rem',
      fontWeight: 600, fontSize: '0.95rem', color: '#374151',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center'
    },
    personRow: (isOwner) => ({
      padding: '0.5rem 1rem', fontSize: '0.875rem',
      backgroundColor: isOwner ? '#f0fdf4' : 'white',
      borderBottom: '1px solid #f3f4f6',
      display: 'flex', gap: '1rem', alignItems: 'center'
    }),
    roleBadge: (isOwner) => ({
      display: 'inline-block', padding: '0.125rem 0.5rem',
      borderRadius: '999px', fontSize: '0.75rem', fontWeight: 600,
      backgroundColor: isOwner ? '#dcfce7' : '#dbeafe',
      color: isOwner ? '#166534' : '#1e40af', whiteSpace: 'nowrap'
    }),
    resultStat: {
      display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '1rem', marginBottom: '1.5rem'
    },
    statCard: (color) => ({
      padding: '1rem', borderRadius: '8px', textAlign: 'center',
      backgroundColor: color === 'green' ? '#f0fdf4' : color === 'blue' ? '#eff6ff' : '#fef2f2',
      border: `1px solid ${color === 'green' ? '#86efac' : color === 'blue' ? '#bfdbfe' : '#fca5a5'}`
    }),
    statNumber: (color) => ({
      fontSize: '2rem', fontWeight: 700,
      color: color === 'green' ? '#059669' : color === 'blue' ? '#2563eb' : '#dc2626'
    }),
    statLabel: { fontSize: '0.75rem', color: '#6b7280', marginTop: '0.25rem' }
  };

  // ── Step 1 動作 ────────────────────────────────────────────
  const handleFileChange = (e) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setParseErrors([]);
      setStallsMap({});
    }
  };

  const handleParse = async () => {
    if (!file) return;
    setParseLoading(true);
    try {
      const { stallsMap: sm, errors } = await parseRosterExcel(file);
      setStallsMap(sm);
      setParseErrors(errors);
      if (errors.length === 0 && Object.keys(sm).length > 0) {
        setStep(2);
      }
    } catch (err) {
      setParseErrors([err.message]);
    } finally {
      setParseLoading(false);
    }
  };

  // ── Step 2 動作 ────────────────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    try {
      const auth = getAuth();
      const idToken = await auth.currentUser.getIdToken();

      const stalls = Object.values(stallsMap).map(({ stallName, owner, asists }) => ({
        stallName,
        owner,
        asists
      }));

      const response = await safeFetch('/api/importStallRosterHttp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({
          organizationId,
          eventId,
          stalls
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `匯入失敗（HTTP ${response.status}）`;
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.error || errorMessage;
        } catch {
          if (response.status === 502 || response.status === 504) {
            errorMessage = '服務器處理超時，請稍後重試';
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      setImportResult(result);
      setStep(3);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error('匯入失敗:', err);
      setParseErrors([err.message]);
    } finally {
      setImporting(false);
    }
  };

  const stallList = Object.values(stallsMap);
  const totalPersons = stallList.reduce((acc, s) => acc + 1 + s.asists.length, 0);

  // ── 渲染 ───────────────────────────────────────────────────
  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        {/* 標題 */}
        <div style={styles.header}>
          <h3 style={styles.headerTitle}>攤位名冊批量匯入</h3>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* 步驟指示器 */}
        <div style={styles.stepBar}>
          {['1. 上傳檔案', '2. 確認預覽', '3. 匯入完成'].map((label, i) => (
            <div key={i} style={styles.stepItem(step === i + 1, step > i + 1)}>{label}</div>
          ))}
        </div>

        {/* ── Step 1：上傳 ── */}
        {step === 1 && (
          <>
            <div style={styles.body}>
              {/* 說明 */}
              <div style={styles.infoBox}>
                <div style={{ fontWeight: 600, color: '#1e3a8a', marginBottom: '0.5rem' }}>📋 Excel 格式說明</div>
                <ul style={{ fontSize: '0.875rem', color: '#1e40af', margin: 0, paddingLeft: '1.25rem', lineHeight: 1.8 }}>
                  <li>每列代表一名人員，欄位：<strong>phoneNumber、stallName、role、chineseName、englishName</strong></li>
                  <li><strong>role</strong> 必須填寫 <code>merchantOwner</code>（攤主）或 <code>merchantAsist</code>（助理）</li>
                  <li>每個攤位 <strong>必須有且只有一位</strong> merchantOwner，助理最多 5 名</li>
                  <li>電話格式：馬來西亞號碼，如 <code>0123456789</code> 或 <code>+60123456789</code></li>
                  <li>不存在的電話號碼將自動建立新帳號（identityTag = external）</li>
                  <li>新建立的帳號將自動新增 <strong>customer 角色</strong>，可直接參與消費交易</li>
                </ul>
              </div>

              {/* 下載模板 */}
              <div style={{ marginBottom: '1.25rem' }}>
                <button
                  style={{ ...styles.btn('primary'), backgroundColor: '#0891b2' }}
                  onClick={downloadTemplate}
                >
                  ⬇️ 下載 Excel 模板
                </button>
              </div>

              {/* 上傳區域 */}
              <label style={styles.uploadArea}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📂</div>
                <div style={{ fontWeight: 600, color: '#374151', marginBottom: '0.25rem' }}>
                  {file ? file.name : '點此選擇 Excel 檔案'}
                </div>
                <div style={{ fontSize: '0.8rem', color: '#9ca3af' }}>.xlsx / .xls</div>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </label>

              {/* 解析錯誤 */}
              {parseErrors.length > 0 && (
                <div style={styles.errorBox}>
                  <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem' }}>
                    ❌ 發現 {parseErrors.length} 個問題，請修正後重新上傳
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#991b1b' }}>
                    {parseErrors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>

            <div style={styles.footer}>
              <button style={styles.btn('gray')} onClick={onClose}>取消</button>
              <button
                style={{ ...styles.btn('primary'), opacity: (!file || parseLoading) ? 0.5 : 1 }}
                disabled={!file || parseLoading}
                onClick={handleParse}
              >
                {parseLoading ? '解析中…' : '解析並預覽 →'}
              </button>
            </div>
          </>
        )}

        {/* ── Step 2：預覽 ── */}
        {step === 2 && (
          <>
            <div style={styles.body}>
              {/* 統計 */}
              <div style={{
                backgroundColor: '#f0fdf4', border: '1px solid #86efac',
                borderRadius: '8px', padding: '0.875rem 1rem',
                display: 'flex', gap: '2rem', marginBottom: '1.25rem',
                flexWrap: 'wrap'
              }}>
                <span style={{ fontWeight: 600, color: '#166534' }}>
                  共 <strong>{stallList.length}</strong> 個攤位
                </span>
                <span style={{ color: '#374151' }}>
                  共 <strong>{totalPersons}</strong> 名人員（{stallList.length} 位攤主 + {totalPersons - stallList.length} 位助理）
                </span>
              </div>

              {/* 攤位卡片 */}
              {stallList.map(({ stallName, owner, asists }) => (
                <div key={stallName} style={styles.stallCard}>
                  <div style={styles.stallCardHeader}>
                    <span>🏪 {stallName}</span>
                    <span style={{ fontWeight: 400, fontSize: '0.8rem', color: '#6b7280' }}>
                      攤主 1 名{asists.length > 0 ? ` + 助理 ${asists.length} 名` : ''}
                    </span>
                  </div>
                  {/* 攤主 */}
                  <div style={styles.personRow(true)}>
                    <span style={styles.roleBadge(true)}>攤主</span>
                    <span style={{ fontWeight: 500, color: '#111827' }}>{owner.phoneNumber}</span>
                    {(owner.chineseName || owner.englishName) && (
                      <span style={{ color: '#6b7280' }}>{[owner.chineseName, owner.englishName].filter(Boolean).join(' / ')}</span>
                    )}
                  </div>
                  {/* 助理 */}
                  {asists.map((a, i) => (
                    <div key={i} style={styles.personRow(false)}>
                      <span style={styles.roleBadge(false)}>助理</span>
                      <span style={{ color: '#374151' }}>{a.phoneNumber}</span>
                      {(a.chineseName || a.englishName) && (
                        <span style={{ color: '#6b7280' }}>{[a.chineseName, a.englishName].filter(Boolean).join(' / ')}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div style={styles.footer}>
              <button style={styles.btn('gray')} onClick={() => setStep(1)}>← 返回</button>
              <button
                style={{ ...styles.btn('success'), opacity: importing ? 0.5 : 1 }}
                disabled={importing}
                onClick={handleImport}
              >
                {importing ? '匯入中…' : `確認匯入 ${stallList.length} 個攤位`}
              </button>
            </div>
          </>
        )}

        {/* ── Step 3：結果 ── */}
        {step === 3 && importResult && (
          <>
            <div style={styles.body}>
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '3rem' }}>✅</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#059669', marginTop: '0.5rem' }}>
                  匯入完成
                </div>
              </div>

              <div style={styles.resultStat}>
                <div style={styles.statCard('blue')}>
                  <div style={styles.statNumber('blue')}>{importResult.createdMerchants ?? 0}</div>
                  <div style={styles.statLabel}>攤位建立</div>
                </div>
                <div style={styles.statCard('green')}>
                  <div style={styles.statNumber('green')}>
                    {(importResult.createdUsers ?? 0) + (importResult.updatedUsers ?? 0)}
                  </div>
                  <div style={styles.statLabel}>
                    人員處理（新建 {importResult.createdUsers ?? 0}，更新 {importResult.updatedUsers ?? 0}）
                  </div>
                </div>
                <div style={styles.statCard('red')}>
                  <div style={styles.statNumber('red')}>{importResult.errors?.length ?? 0}</div>
                  <div style={styles.statLabel}>錯誤</div>
                </div>
              </div>

              {importResult.errors?.length > 0 && (
                <div style={styles.errorBox}>
                  <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: '0.5rem' }}>部分資料匯入失敗：</div>
                  <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem', color: '#991b1b' }}>
                    {importResult.errors.map((e, i) => <li key={i}>{typeof e === 'string' ? e : JSON.stringify(e)}</li>)}
                  </ul>
                </div>
              )}

              {importResult.message && (
                <div style={{ fontSize: '0.875rem', color: '#6b7280', marginTop: '1rem', textAlign: 'center' }}>
                  {importResult.message}
                </div>
              )}
            </div>

            <div style={styles.footer}>
              <button style={styles.btn('primary')} onClick={onClose}>關閉</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BatchImportMerchant;
