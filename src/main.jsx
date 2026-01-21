// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './utils/toast';
// 調試：確保 antd 樣式已載入（Modal/Table/Card 必須）
import 'antd/dist/reset.css';

// 全域：忽略由 AbortError 引起的未處理 promise 拒絕，減少控制台雜訊
if (typeof window !== 'undefined') {
  const isAbortNoise = (value) => {
    try {
      const name = value && value.name;
      if (name === 'AbortError') return true;
      const text = String(value || '').toLowerCase();
      return (
        text.includes('aborterror') ||
        text.includes('the user aborted a request') ||
        text.includes('aborted a request') ||
        text.includes('fetch is aborted') ||
        // 保守：避免把其他錯誤吞掉，僅在明確 abort 關鍵字時視為雜訊
        (text.includes('abort') && (text.includes('request') || text.includes('fetch')))
      );
    } catch {
      return false;
    }
  };

  const pushAbortRecent = (entry) => {
    try {
      const buf = window.__abortDebugRecent || [];
      buf.push({ ts: Date.now(), ...entry });
      // keep last 30
      while (buf.length > 30) buf.shift();
      window.__abortDebugRecent = buf;
    } catch {}
  };

  const logAbortRecent = (label) => {
    try {
      const level = getAbortDebugLevel();
      if (level <= 0) return;
      const buf = window.__abortDebugRecent || [];
      const recent = buf.slice(-10);
      if (recent.length) {
        console.warn('[AbortDebug]', label, 'recent requests:', recent);
      }
    } catch {}
  };

  // Debug 開關：印出被 Abort 的 request URL（方便對照 Network 的 canceled）
  // 開啟方式（三選一，擇一即可）：
  // 1) 在 Console 執行（不會持久化，刷新後需再設一次）：
  //    - window.__debugAbortRequests = true  (只印 URL/method)
  //    - window.__debugAbortRequests = 2     (連 stack 也印)
  // 2) localStorage（可持久化）：
  //    - localStorage.setItem('debugAbortRequests','1')
  //    - localStorage.setItem('debugAbortRequests','2')
  // 3) 網址 query（一次性）：加上 ?debugAbort=1 或 ?debugAbort=2
  const getAbortDebugLevel = () => {
    try {
      if (window.__debugAbortRequests) {
        return window.__debugAbortRequests === 2 ? 2 : 1;
      }

      const qp = new URLSearchParams(window.location.search || '');
      const q = qp.get('debugAbort');
      if (q === '2') return 2;
      if (q === '1') return 1;

      const v = String(window.localStorage?.getItem('debugAbortRequests') || '').trim();
      if (v === '2') return 2;
      if (v === '1' || v.toLowerCase() === 'true') return 1;
    } catch {}
    return 0;
  };

  const extractFetchInfo = (input, init) => {
    try {
      // input: string | Request
      const url =
        typeof input === 'string'
          ? input
          : (input && typeof input === 'object' && 'url' in input)
            ? input.url
            : String(input || '');
      const method =
        (init && init.method) ||
        (input && typeof input === 'object' && 'method' in input && input.method) ||
        'GET';
      return { url, method };
    } catch {
      return { url: String(input || ''), method: (init && init.method) || 'GET' };
    }
  };

  // 包裝 fetch：只在 debug 開關啟用時輸出 aborted URL
  try {
    if (typeof window.fetch === 'function' && !window.__abortDebugFetchWrapped) {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const level = getAbortDebugLevel();
        if (level > 0) {
          try {
            const info = extractFetchInfo(input, init);
            pushAbortRecent({ type: 'fetch', phase: 'start', ...info });
          } catch {}
        }
        try {
          return await originalFetch(input, init);
        } catch (e) {
          if (isAbortNoise(e)) {
            const info = extractFetchInfo(input, init);
            if (level >= 2) {
              const stack = (() => {
                try { return new Error().stack; } catch { return ''; }
              })();
              console.warn('[AbortDebug] fetch aborted', { ...info, stack });
            } else {
              console.warn('[AbortDebug] fetch aborted', info);
            }
            pushAbortRecent({ type: 'fetch', phase: 'aborted', ...info });
          }
          throw e;
        } finally {
          if (level > 0) {
            try {
              const info = extractFetchInfo(input, init);
              pushAbortRecent({ type: 'fetch', phase: 'end', ...info });
            } catch {}
          }
        }
      };
      window.__abortDebugFetchWrapped = true;
    }
  } catch (e) {
    // ignore
  }

  // 包裝 XHR：Firebase/部分舊程式可能用 XMLHttpRequest，Abort 時抓 URL
  try {
    if (typeof window.XMLHttpRequest === 'function' && !window.__abortDebugXhrWrapped) {
      const proto = window.XMLHttpRequest.prototype;
      const originalOpen = proto.open;
      const originalSend = proto.send;

      proto.open = function(method, url, async, user, password) {
        try {
          this.__abortDebugInfo = { method: String(method || 'GET'), url: String(url || '') };
        } catch {}
        return originalOpen.apply(this, arguments);
      };

      proto.send = function(body) {
        const level = getAbortDebugLevel();
        if (level > 0 && !this.__abortDebugAbortListenerAttached) {
          this.__abortDebugAbortListenerAttached = true;
          const info = this.__abortDebugInfo;
          const stack = level >= 2 ? (() => { try { return new Error().stack; } catch { return ''; } })() : '';

          try {
            pushAbortRecent({ type: 'xhr', phase: 'start', ...(info || {}) });
          } catch {}

          try {
            this.addEventListener('abort', () => {
              try {
                if (level >= 2) {
                  console.warn('[AbortDebug] xhr aborted', { ...(info || {}), stack });
                } else {
                  console.warn('[AbortDebug] xhr aborted', info || {});
                }
                pushAbortRecent({ type: 'xhr', phase: 'aborted', ...(info || {}) });
              } catch {}
            });
          } catch {}
        }
        return originalSend.apply(this, arguments);
      };

      window.__abortDebugXhrWrapped = true;

    }
  } catch (e) {
    // ignore
  }

  // 統一印出啟用狀態（避免使用者找不到 banner）
  try {
    const lvl = getAbortDebugLevel();
    if (lvl > 0 && !window.__abortDebugBannerShown) {
      window.__abortDebugBannerShown = true;
      console.warn('[AbortDebug] enabled', {
        level: lvl,
        fetchWrapped: !!window.__abortDebugFetchWrapped,
        xhrWrapped: !!window.__abortDebugXhrWrapped,
      });
    }
  } catch {}

  // 方法1：攔截 unhandledrejection 事件
  if (window.addEventListener) {
    window.addEventListener('unhandledrejection', (evt) => {
      try {
        const reason = evt.reason;
        if (isAbortNoise(reason)) {
          logAbortRecent('unhandledrejection abort observed');
          evt.preventDefault();
          // 阻止其他監聽器（例如 Eruda）再把它當成錯誤輸出
          if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
          if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
          return;
        }
      } catch (e) {
        // ignore handler errors
      }
    }, true);
  }

  // 方法2：代理 console.error 以攔截 AbortError 日誌
  const originalError = console.error;
  console.error = function(...args) {
    try {
      if (args && args.length) {
        if (isAbortNoise(args[0])) return;
        const errorStr = args.map(a => String(a || '')).join(' ').toLowerCase();
        if (isAbortNoise(errorStr)) return;
      }
    } catch (e) {}
    return originalError.apply(console, args);
  };

  // 方法3：代理 console.log 的 catch
  if (window.addEventListener) {
    window.addEventListener('error', (evt) => {
      try {
        if (isAbortNoise(evt?.error) || isAbortNoise(evt?.message)) {
          logAbortRecent('window error abort observed');
          evt.preventDefault();
          if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
          if (typeof evt.stopPropagation === 'function') evt.stopPropagation();
          return;
        }
      } catch (e) {}
    }, true);
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

