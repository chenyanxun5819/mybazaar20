// safeFetch: wrap native fetch and handle AbortError gracefully
export async function safeFetch(input, init) {
  try {
    return await fetch(input, init);
  } catch (e) {
    try {
      if (e && e.name === 'AbortError') {
        try {
          let debugLevel = 0;
          try {
            if (window.__debugAbortRequests) {
              debugLevel = window.__debugAbortRequests === 2 ? 2 : 1;
            } else {
              const qp = new URLSearchParams(window.location.search || '');
              const q = qp.get('debugAbort');
              if (q === '2') debugLevel = 2;
              else if (q === '1') debugLevel = 1;
              else {
                const v = String(window.localStorage?.getItem('debugAbortRequests') || '').trim();
                if (v === '2') debugLevel = 2;
                else if (v === '1' || v.toLowerCase() === 'true') debugLevel = 1;
              }
            }
          } catch {}

          if (debugLevel > 0) {
            const url = typeof input === 'string' ? input : (input && input.url) ? input.url : String(input || '');
            const method = (init && init.method) || (input && input.method) || 'GET';
            if (debugLevel >= 2) {
              console.warn('[AbortDebug]', { url, method, stack: (new Error()).stack });
            } else {
              console.warn('[AbortDebug]', { url, method });
            }
          }
        } catch {}
        // 返回一個最小 Response-like 物件，保證呼叫端的 resp.json()/resp.text() 不會拋錯
        console.debug('[safeFetch] request aborted (swallowed):', input);
        return {
          ok: false,
          status: 0,
          aborted: true,
          text: async () => '',
          json: async () => ({}),
        };
      }
    } catch (ignore) {}
    throw e;
  }
}

export default safeFetch;

