let erudaLoadPromise = null;

const ERUDA_SCRIPT_ID = 'mybazaar-eruda-script';
const ERUDA_CDN = 'https://cdn.jsdelivr.net/npm/eruda';

const canUseDom = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const loadErudaScript = async () => {
  if (!canUseDom()) return null;

  if (window.eruda) {
    return window.eruda;
  }

  if (erudaLoadPromise) {
    return erudaLoadPromise;
  }

  erudaLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById(ERUDA_SCRIPT_ID);
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.eruda || null), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Eruda 脚本载入失败')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = ERUDA_SCRIPT_ID;
    script.src = ERUDA_CDN;
    script.async = true;
    script.onload = () => resolve(window.eruda || null);
    script.onerror = () => reject(new Error('Eruda 脚本载入失败'));
    document.body.appendChild(script);
  });

  try {
    return await erudaLoadPromise;
  } catch (error) {
    erudaLoadPromise = null;
    throw error;
  }
};

export const enableEruda = async () => {
  if (!canUseDom()) return;

  try {
    const eruda = await loadErudaScript();
    if (!eruda) return;

    if (!window.__MYBAZAAR_ERUDA_ENABLED__) {
      eruda.init();
      window.__MYBAZAAR_ERUDA_ENABLED__ = true;
    } else if (eruda.show) {
      eruda.show();
    }
  } catch (error) {
    console.warn('[Eruda] 启用失败:', error?.message || error);
  }
};

export const disableEruda = () => {
  if (!canUseDom() || !window.eruda) return;

  try {
    if (window.eruda.destroy) {
      window.eruda.destroy();
    }
  } catch (error) {
    console.warn('[Eruda] 关闭失败:', error?.message || error);
  } finally {
    window.__MYBAZAAR_ERUDA_ENABLED__ = false;
  }
};

export const syncErudaVisibility = async (enabled) => {
  if (enabled) {
    await enableEruda();
    return;
  }

  disableEruda();
};

// ✅ 新增：持久化 Eruda 状态到 localStorage
export const persistErudaState = (enabled) => {
  try {
    localStorage.setItem('mybazaar_erudaEnabled', enabled ? '1' : '0');
  } catch (e) {}
};

// ✅ 新增：app 启动时从 localStorage 恢复 Eruda（处理刷新页面场景）
export const checkAndInitErudaFromStorage = () => {
  try {
    const enabled = localStorage.getItem('mybazaar_erudaEnabled') === '1';
    if (enabled) {
      enableEruda();
    }
  } catch (e) {}
};