// Lightweight global toast for non-blocking notifications
// Registers `window.mybazaarShowToast(messageOrStatus, maybeMessage)` on load.
(function () {
  if (typeof window === 'undefined') return;

  if (window.mybazaarShowToast) return; // already installed

  const createBanner = (opts) => {
    const { status = 'info', title = '', message = '' } = opts;
    const el = document.createElement('div');
    el.className = 'customer-notification-banner';
    el.style.position = 'fixed';
    el.style.top = '20px';
    el.style.left = '50%';
    el.style.transform = 'translateX(-50%)';
    el.style.color = 'white';
    el.style.padding = '16px 24px';
    el.style.borderRadius = '12px';
    el.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '12px';
    el.style.zIndex = 10000;
    el.style.minWidth = '240px';
    el.style.maxWidth = '90%';
    el.style.cursor = 'pointer';

    if (status === 'completed' || /成功|已完成|✅/.test(title + message)) {
      el.style.backgroundColor = '#10b981';
    } else if (status === 'error' || /失败|错误|❌/.test(title + message)) {
      el.style.backgroundColor = '#ef4444';
    } else {
      el.style.backgroundColor = '#374151';
    }

    const textWrap = document.createElement('div');
    textWrap.style.flex = '1';
    textWrap.style.display = 'flex';
    textWrap.style.flexDirection = 'column';

    if (title) {
      const t = document.createElement('div');
      t.textContent = title;
      t.style.fontWeight = '600';
      t.style.fontSize = '16px';
      t.style.margin = '0';
      textWrap.appendChild(t);
    }
    if (message) {
      const m = document.createElement('div');
      m.textContent = message;
      m.style.fontSize = '14px';
      m.style.opacity = '0.95';
      m.style.marginTop = title ? '4px' : '0';
      textWrap.appendChild(m);
    }

    el.appendChild(textWrap);

    el.addEventListener('click', () => {
      try { document.body.removeChild(el); } catch (e) {}
    });

    // insert and animate
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%) translateY(0)';
    }, 20);

    // auto remove
    const timeout = setTimeout(() => {
      try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      clearTimeout(timeout);
    }, 5000);
  };

  // API: mybazaarShowToast(arg1, arg2?)
  // - if only one arg provided and it's a string -> message
  // - if two args: (status, message)
  // - if first arg is object: { status, title, message }
  window.mybazaarShowToast = function (a, b) {
    try {
      if (!document || !document.body) return;
      if (typeof a === 'string' && b === undefined) {
        createBanner({ message: a });
      } else if (typeof a === 'string' && typeof b === 'string') {
        // treat a as status
        createBanner({ status: a, message: b });
      } else if (typeof a === 'object' && a !== null) {
        createBanner(a);
      } else {
        createBanner({ message: String(a) });
      }
    } catch (e) {
      // fallback to native alert if DOM unavailable
      try { window.mybazaarShowToast(String(b || a)); } catch (err) {}
    }
  };
})();

