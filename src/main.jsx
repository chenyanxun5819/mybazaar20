// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
// 調試：確保 antd 樣式已載入（Modal/Table/Card 必須）
import 'antd/dist/reset.css';

// 全域：忽略由 AbortError 引起的未處理 promise 拒絕，減少控制台雜訊
if (typeof window !== 'undefined') {
  // 方法1：攔截 unhandledrejection 事件
  if (window.addEventListener) {
    window.addEventListener('unhandledrejection', (evt) => {
      try {
        const reason = evt.reason;
        const name = reason && reason.name;
        const text = String(reason || '').toLowerCase();
        if (name === 'AbortError' || text.includes('abort') || text.includes('aborted') || text.includes('fetch is aborted')) {
          evt.preventDefault();
          return;
        }
      } catch (e) {
        // ignore handler errors
      }
    });
  }

  // 方法2：代理 console.error 以攔截 AbortError 日誌
  const originalError = console.error;
  console.error = function(...args) {
    try {
      const errorStr = args.map(a => String(a || '')).join(' ').toLowerCase();
      if (errorStr.includes('abort') && errorStr.includes('error')) {
        return; // 靜默忽略 AbortError 日誌
      }
      if (args[0] && args[0].name === 'AbortError') {
        return; // 靜默忽略 AbortError 物件
      }
    } catch (e) {}
    return originalError.apply(console, args);
  };

  // 方法3：代理 console.log 的 catch
  if (window.addEventListener) {
    window.addEventListener('error', (evt) => {
      try {
        const msg = String(evt.message || '').toLowerCase();
        if (msg.includes('abort') && msg.includes('error')) {
          evt.preventDefault();
          return;
        }
      } catch (e) {}
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
