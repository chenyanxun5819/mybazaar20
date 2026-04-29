/**
 * OTP 轉發服務 (OTP Forwarding Service)
 * 
 * 運行在 WordPress VM 上 (34.123.222.228:3000)
 * 
 * Cloud Functions → OTP Forwarder → 360 SMS API
 * 
 * 功能：
 * 1. 接收來自 Cloud Functions 的 OTP 請求
 * 2. 轉發到 360 SMS API
 * 3. 返回結果給 Cloud Functions
 * 
 * 好處：
 * - Cloud Functions 有動態 IP，但 VM 有靜態 IP
 * - 360 SMS 白名單只需要加入 VM 的靜態 IP
 */

const http = require('http');
const https = require('https');
const url = require('url');

// ==========================================
// 配置
// ==========================================

const PORT = process.env.PORT || 3000;
const API_KEY_360 = process.env.API_KEY_360 || '';
const API_SECRET_360 = process.env.API_SECRET_360 || '';
const API_BASE_URL_360 = process.env.API_BASE_URL_360 || 'https://sms.360.my/gw/bulk360/v3_0/send.php';
const OTP_FORWARDER_SHARED_TOKEN = process.env.OTP_FORWARDER_SHARED_TOKEN || '';

// 安全檢查：允許的來源 IP
const ALLOWED_SOURCES = process.env.ALLOWED_SOURCES ? process.env.ALLOWED_SOURCES.split(',') : [
  '127.0.0.1',           // localhost
  '::1',                 // IPv6 localhost
  '10.128.0.0/10',       // GCP 內部網路
  '34.123.222.228',      // 此 VM 的外部 IP
  // 你可以添加 Cloud Functions 的內部 IP
];

// ==========================================
// 日誌函數
// ==========================================

function log(label, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${label}: ${message}${data ? ' ' + JSON.stringify(data) : ''}`);
}

// ==========================================
// 安全檢查：驗證來源 IP
// ==========================================

function isAllowedSource(remoteAddress) {
  // 移除 IPv6 映射前綴 (e.g., "::ffff:127.0.0.1" -> "127.0.0.1")
  let clientIp = remoteAddress.replace(/^::ffff:/, '');
  
  for (const allowed of ALLOWED_SOURCES) {
    if (allowed === clientIp) return true;
    // 簡單的 CIDR 檢查（可選）
    if (allowed.includes('/')) {
      // TODO: 實現 CIDR 檢查
    }
  }
  
  return false;
}

function hasValidSharedToken(req) {
  if (!OTP_FORWARDER_SHARED_TOKEN) return false;

  const requestToken = String(req.headers['x-otp-forwarder-token'] || '').trim();
  return requestToken && requestToken === OTP_FORWARDER_SHARED_TOKEN;
}

// ==========================================
// 轉發到 360 SMS API
// ==========================================

function forward360Sms(phoneNumber, message) {
  return new Promise((resolve, reject) => {
    try {
      if (!API_KEY_360 || !API_SECRET_360) {
        reject(new Error('缺少 API_KEY_360 或 API_SECRET_360 環境變量'));
        return;
      }

      // 歸一化電話號碼
      let msisdn = String(phoneNumber || '').replace(/[^\d+]/g, '');
      if (msisdn.startsWith('+')) msisdn = msisdn.slice(1);
      if (msisdn.startsWith('0')) {
        msisdn = '60' + msisdn.slice(1);
      } else if (!msisdn.startsWith('60')) {
        if (msisdn.startsWith('1')) {
          msisdn = '60' + msisdn;
        }
      }

      log('SMS', `電話號碼標準化: ${phoneNumber} → ${msisdn}`);

      // 使用與 Cloud Functions 直連 360 相同的表單編碼方式
      const bodyStr = new URLSearchParams({
        user: API_KEY_360,
        pass: API_SECRET_360,
        to: msisdn,
        text: message,
        detail: '1'
      }).toString();

      const endpoint = new url.URL(API_BASE_URL_360);
      const options = {
        hostname: endpoint.hostname,
        port: 443,
        path: endpoint.pathname || '/gw/bulk360/v3_0/send.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(bodyStr),
          'User-Agent': 'MyBazaar-OTP-Forwarder/1.0'
        },
        timeout: 10000
      };

      log('SMS', '發送請求到 360 API', { hostname: options.hostname, path: options.path });

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            log('SMS', `360 API 回應 (code=${result.code})`, result);
            
            if (result.code === 200 || result.code === '200') {
              resolve(result);
            } else {
              const error = new Error(`360 API 錯誤 (code=${result.code}): ${result.desc || data}`);
              error.code = result.code;
              error.description = result.desc;
              error.details = result;
              reject(error);
            }
          } catch (e) {
            log('SMS', '無法解析 360 API 回應', { raw: data });
            reject(new Error(`無法解析 360 API 回應: ${data}`));
          }
        });
      });

      req.on('error', (error) => {
        log('SMS', '360 API 請求失敗', { error: error.message });
        reject(error);
      });

      req.on('timeout', () => {
        log('SMS', '360 API 請求超時');
        req.destroy();
        reject(new Error('360 API 請求超時'));
      });

      req.write(bodyStr);
      req.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ==========================================
// HTTP 伺服器
// ==========================================

const server = http.createServer(async (req, res) => {
  // CORS 標頭
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONS 預檢
  if (req.method === 'OPTIONS') {
    return res.writeHead(204).end();
  }

  // 只允許 POST
  if (req.method !== 'POST') {
    return res.writeHead(405, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: '只支持 POST' }));
  }

  // 安全檢查：驗證來源 IP
  const clientIp = req.connection.remoteAddress || req.socket.remoteAddress;
  log('HTTP', `收到請求 (IP=${clientIp}, path=${req.url})`);

  const isTrustedByToken = hasValidSharedToken(req);
  if (OTP_FORWARDER_SHARED_TOKEN) {
    if (!isTrustedByToken) {
      log('HTTP', '❌ 共享 Token 驗證失敗');
      return res.writeHead(403, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Token 不被允許' }));
    }
  } else if (!isAllowedSource(clientIp)) {
    log('HTTP', `❌ 來源 IP 不被允許: ${clientIp}`);
    return res.writeHead(403, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: 'IP 不被允許' }));
  }

  // ==========================================
  // 路由：/otp （OTP 轉發）
  // ==========================================

  if (req.url === '/otp' || req.url === '/otp/') {
    let body = '';

    req.on('data', (chunk) => { body += chunk; });

    req.on('end', async () => {
      try {
        log('OTP', '解析請求主體');
        let data;
        try {
          data = JSON.parse(body);
        } catch (e) {
          log('OTP', '❌ 無效的 JSON');
          return res.writeHead(400, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: '無效的 JSON' }));
        }

        const { phoneNumber, message } = data;

        if (!phoneNumber || !message) {
          log('OTP', '❌ 缺少必要參數', { has_phone: !!phoneNumber, has_message: !!message });
          return res.writeHead(400, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ error: '缺少 phoneNumber 或 message' }));
        }

        log('OTP', '轉發 SMS', { phoneNumber, messageLength: message.length });

        // 轉發到 360 SMS API
        const result = await forward360Sms(phoneNumber, message);

        log('OTP', '✅ SMS 轉發成功');
        return res.writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(result));

      } catch (error) {
        log('OTP', '❌ 轉發失敗', { error: error.message });

        const statusCode = error.code === 403 ? 400 : 500;
        return res.writeHead(statusCode, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({
            error: error.message,
            code: error.code
          }));
      }
    });

    return;
  }

  // ==========================================
  // 路由：/health （健康檢查）
  // ==========================================

  if (req.url === '/health' || req.url === '/health/') {
    log('HEALTH', 'Health check');
    return res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      }));
  }

  // ==========================================
  // 404 Not Found
  // ==========================================

  log('HTTP', `❌ 404 Not Found: ${req.url}`);
  return res.writeHead(404, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ error: 'Not Found' }));
});

// ==========================================
// 啟動伺服器
// ==========================================

server.listen(PORT, '0.0.0.0', () => {
  log('SERVER', `✅ OTP 轉發服務已啟動`, { port: PORT, api_url: API_BASE_URL_360 });
});

// 優雅關閉
process.on('SIGTERM', () => {
  log('SERVER', '收到 SIGTERM，正在關閉...');
  server.close(() => {
    log('SERVER', '伺服器已關閉');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  log('SERVER', '收到 SIGINT，正在關閉...');
  server.close(() => {
    log('SERVER', '伺服器已關閉');
    process.exit(0);
  });
});
