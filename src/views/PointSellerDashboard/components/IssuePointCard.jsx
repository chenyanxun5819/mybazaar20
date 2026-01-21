/**
 * Issue Point Card Component
 * Tab 1: 发行点数卡 - 生成QR Code和卡号
 */

import React, { useState, useRef, useEffect } from 'react';
import QRCode from 'qrcode';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import TransactionPinDialog from '../common/TransactionPinDialog';
import qrcodeTicketIcon from '../../../assets/qrcode-ticket.svg';
import paymentQrcodeIcon from '../../../assets/payment-qrcode.svg';
import qrIcon from '../../../assets/qr .svg';
import './IssuePointCard.css';

/**
 * XP-58 专用优化版 - ESC/POS 打印机类
 * 支持蓝牙打印点数卡
 */

// ===== ESC/POS 蓝牙打印机类（XP-P300 优化版）=====
class ESCPOSPrinter {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.maxChunkSize = 20; // P300 蓝牙分包大小
  }

  // ESC/POS 控制指令
  static CMD = {
    INIT: [0x1B, 0x40],                    // 初始化打印机
    LINE_FEED: [0x0A],                     // 换行
    CUT_PAPER: [0x1D, 0x56, 0x00],        // 切纸
    ALIGN_CENTER: [0x1B, 0x61, 0x01],     // 居中对齐
    ALIGN_LEFT: [0x1B, 0x61, 0x00],       // 左对齐
    BOLD_ON: [0x1B, 0x45, 0x01],          // 粗体开启
    BOLD_OFF: [0x1B, 0x45, 0x00],         // 粗体关闭
    FONT_SIZE_NORMAL: [0x1D, 0x21, 0x00], // 正常字体
    FONT_SIZE_LARGE: [0x1D, 0x21, 0x11],  // 2倍字体
    FONT_SIZE_HUGE: [0x1D, 0x21, 0x22],   // 3倍字体
  };

  // 连接蓝牙打印机
  async connect() {
    try {
      console.log('[Bluetooth] 正在搜索打印机...');

      // 请求蓝牙设备
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'XP' },
          { namePrefix: 'MTP' },
          { namePrefix: 'BlueTooth Printer' },
          { namePrefix: 'Printer' }
        ],
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
      });

      console.log('[Bluetooth] 找到设备:', this.device.name);

      // 连接到 GATT 服务器
      const server = await this.device.gatt.connect();
      console.log('[Bluetooth] 已连接到 GATT 服务器');

      // 获取打印服务
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');

      // 选择可写特征
      const characteristics = await service.getCharacteristics();
      const writableCharacteristic = characteristics.find(
        (c) => c.properties?.writeWithoutResponse || c.properties?.write
      );

      if (!writableCharacteristic) {
        throw new Error('找不到可写入的蓝牙特征');
      }

      this.characteristic = writableCharacteristic;

      console.log('[Bluetooth] 打印机已就绪');
      return true;
    } catch (error) {
      console.error('[Bluetooth] 连接失败:', error);
      throw new Error('无法连接到蓝牙打印机: ' + error.message);
    }
  }

  // 发送数据到打印机（分块发送，XP-P300 优化）
  async send(data) {
    if (!this.characteristic) {
      throw new Error('打印机未连接');
    }

    try {
      const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

      // 分块发送（每次最多 20 bytes）
      for (let offset = 0; offset < buffer.length; offset += this.maxChunkSize) {
        const chunk = buffer.slice(offset, offset + this.maxChunkSize);

        if (this.characteristic.properties.writeWithoutResponse) {
          await this.characteristic.writeValueWithoutResponse(chunk);
        } else {
          await this.characteristic.writeValue(chunk);
        }

        // 轻微延迟，避免打印机缓冲溢出（XP-P300 需要）
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    } catch (error) {
      console.error('[Bluetooth] 发送失败:', error);
      throw error;
    }
  }

  // 打印文本
  async printText(text) {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    await this.send(data);
  }

  // ⭐ 核心修复：打印 QR Code 图片（XP-P300 专用）
  async printQRCodeImage(qrImageDataUrl, targetWidthPx = 288) {
    if (!qrImageDataUrl) {
      console.error('[QR Code] 缺少图片数据');
      return; // 不抛错，继续打印其他内容
    }

    try {
      console.log('[QR Code] 开始处理图片...');

      // 确保 QR 图像居中打印（避免受到前一个 ALIGN_LEFT 影响）
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);

      // 1. 加载图片
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = qrImageDataUrl;
      });

      console.log('[QR Code] 图片已加载，尺寸:', img.width, 'x', img.height);

      // 2. 创建 Canvas 并转换为黑白位图
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      if (!ctx) {
        throw new Error('无法创建 Canvas');
      }

      // 缩放到目标宽度
      const scale = targetWidthPx / img.width;
      const targetHeightPx = Math.max(1, Math.round(img.height * scale));

      canvas.width = targetWidthPx;
      canvas.height = targetHeightPx;

      // 绘制图片（关闭平滑以保持 QR Code 清晰）
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, targetWidthPx, targetHeightPx);

      // 3. 获取像素数据并转换为单色位图
      const imageData = ctx.getImageData(0, 0, targetWidthPx, targetHeightPx);
      const pixels = imageData.data;

      const widthBytes = Math.ceil(targetWidthPx / 8);
      const bitmap = new Uint8Array(widthBytes * targetHeightPx);

      console.log('[QR Code] 位图尺寸:', widthBytes, 'x', targetHeightPx, '=', bitmap.length, 'bytes');

      // 转换为位图（8个像素打包成1个字节）
      for (let y = 0; y < targetHeightPx; y++) {
        for (let xByte = 0; xByte < widthBytes; xByte++) {
          let byte = 0;

          for (let bit = 0; bit < 8; bit++) {
            const x = xByte * 8 + bit;
            if (x >= targetWidthPx) continue;

            const idx = (y * targetWidthPx + x) * 4;
            const r = pixels[idx];
            const g = pixels[idx + 1];
            const b = pixels[idx + 2];
            const a = pixels[idx + 3];

            // 亮度计算（透明=白色，亮度<128=黑色）
            const luminance = a === 0 ? 255 : Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            const isBlack = luminance < 128;

            if (isBlack) {
              byte |= (0x80 >> bit); // 黑色像素设为1
            }
          }

          bitmap[y * widthBytes + xByte] = byte;
        }
      }

      // 4. 发送 ESC/POS 光栅位图指令（GS v 0）
      const xL = widthBytes & 0xFF;
      const xH = (widthBytes >> 8) & 0xFF;
      const yL = targetHeightPx & 0xFF;
      const yH = (targetHeightPx >> 8) & 0xFF;

      // GS v 0: 光栅位图模式（XP-P300 支持）
      const header = new Uint8Array([
        0x1D, 0x76, 0x30, // GS v 0
        0x00,             // 正常模式
        xL, xH,           // 宽度（字节）
        yL, yH            // 高度（像素）
      ]);

      console.log('[QR Code] 发送指令头:', Array.from(header).map(b => '0x' + b.toString(16)).join(' '));
      await this.send(header);

      console.log('[QR Code] 发送位图数据...', bitmap.length, 'bytes');
      await this.send(bitmap);

      console.log('[QR Code] ✅ QR Code 打印完成');

    } catch (error) {
      console.error('[QR Code] 打印失败:', error);
      // 不抛错，让打印继续
      await this.printText('[QR Code Error]\n');
    }
  }

  // 打印点数卡（XP-58 优化版 - 紧凑布局）
  async printPointCard(cardNumber, amount, qrData, qrImageDataUrl, eventName = 'MyBazaar') {
    try {
      console.log('[Print] 开始打印点数卡...');

      // 1. 初始化打印机
      await this.send(ESCPOSPrinter.CMD.INIT);
      await new Promise(resolve => setTimeout(resolve, 100));

      // 2. 标题（英文，避免乱码；长标题自动换行/缩字）
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.send(ESCPOSPrinter.CMD.BOLD_ON);

      const safeEventName = String(eventName || 'MyBazaar').trim();
      const combined = `${safeEventName} Points Card`;

      // 58mm 常见：大字体一行可容纳字符更少；过长就拆两行
      if (combined.length > 24) {
        await this.send(ESCPOSPrinter.CMD.FONT_SIZE_NORMAL);
        await this.printText(`${safeEventName}\n`);
        await this.send(ESCPOSPrinter.CMD.FONT_SIZE_LARGE);
        await this.printText('Points Card\n');
      } else {
        await this.send(ESCPOSPrinter.CMD.FONT_SIZE_LARGE);
        await this.printText(`${combined}\n`);
      }

      await this.send(ESCPOSPrinter.CMD.BOLD_OFF);
      await this.send(ESCPOSPrinter.CMD.FONT_SIZE_NORMAL);

      // 3. 分隔线
      await this.printText('========================\n');

      // 4. 卡号（置中，避免版型偏左）
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.printText(`Card No: ${cardNumber}\n`);

      // 5. ⭐ QR Code（放大提高可扫性；并确保居中）
      console.log('[Print] 准备打印 QR Code...');
      await this.printQRCodeImage(qrImageDataUrl, 288);

      // 6. 点数金额（英文标签）
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.send(ESCPOSPrinter.CMD.FONT_SIZE_LARGE);
      await this.send(ESCPOSPrinter.CMD.BOLD_ON);
      await this.printText(`${amount} Points\n`);
      await this.send(ESCPOSPrinter.CMD.BOLD_OFF);
      await this.send(ESCPOSPrinter.CMD.FONT_SIZE_NORMAL);

      // 7. 分隔线
      await this.printText('========================\n');

      // 8. 使用说明（英文）
      await this.send(ESCPOSPrinter.CMD.ALIGN_LEFT);
      await this.printText('* Scan QR at merchant\n');
      await this.printText('* Valid until event ends\n');
      await this.printText('* Bearer card - keep safe\n');

      // 9. 发行时间（英文标签）
      const now = new Date().toLocaleString('en-GB', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).replace(',', '');

      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.printText(`Issued: ${now}\n`);

      // 10. 换行和切纸（减少空行）
      await this.printText('\n\n');
      await this.send(ESCPOSPrinter.CMD.CUT_PAPER);

      console.log('[Print] ✅ 打印完成');
      return true;

    } catch (error) {
      console.error('[Print] 打印失败:', error);
      throw error;
    }
  }

  // 断开连接
  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
      console.log('[Bluetooth] 已断开连接');
    }
  }
}

// 使用说明：
// 1. 将这个类替换到 IssuePointCard.jsx 文件顶部
// 2. 确保 qrCodeDataUrl 正确传入（第485行）
// 3. 打开浏览器控制台查看详细日志
// 4. 测试打印


// 全局打印机实例（组件外）
let bluetoothPrinter = null;

const IssuePointCard = ({
  isActiveHours,
  statistics,
  onRefresh,
  currentUser,
  userProfile,
  organizationId,
  eventId,
  callFunction
}) => {
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  // 交易密码对话框
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [pendingAmount, setPendingAmount] = useState(null);

  // 已发行的点数卡
  const [issuedCard, setIssuedCard] = useState(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState(null);
  const qrCanvasRef = useRef(null);

  // ⭐ 添加：蓝牙打印状态
  const [isPrinterConnected, setIsPrinterConnected] = useState(false);

  // 活动名称（从 events/{eventId}.eventName.en-US 读取）
  const [eventNameEnUs, setEventNameEnUs] = useState('');

  // 仅允许 ASCII，避免热敏机出现乱码
  const sanitizeAscii = (value) => {
    const text = String(value ?? '');
    return text
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 从 Firestore eventName 结构中取 en-US
  const getEventNameEnUs = (profile) => {
    const v = profile?.eventName;
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object') {
      return v['en-US'] || v.enUS || v.en || '';
    }
    return '';
  };

  // 读取 Event 文档的 eventName.en-US（避免 userProfile 没带 eventName）
  useEffect(() => {
    let cancelled = false;

    const orgId = userProfile?.organizationId || organizationId;
    const evtId = userProfile?.eventId || eventId;
    if (!orgId || !evtId) return;

    (async () => {
      try {
        const ref = doc(db, 'organizations', orgId, 'events', evtId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;

        const data = snap.data();
        const name = data?.eventName?.['en-US'] || '';
        const safe = sanitizeAscii(name);
        if (!cancelled) setEventNameEnUs(safe);
      } catch (e) {
        console.warn('[IssuePointCard] 读取 eventName 失败:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userProfile?.organizationId, userProfile?.eventId, organizationId, eventId]);

  // 检查 Web Bluetooth 支持
  const isWebBluetoothSupported = typeof navigator !== 'undefined' && navigator.bluetooth;

  // 格式化金额
  const formatAmount = (amount) => {
    if (!amount && amount !== 0) return 'RM 0.00';
    return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // 单笔限额（PointSeller没有库存限制，但有单笔限额）
  const MAX_PER_TRANSACTION = 100;

  // 处理发行点数卡按钮点击
  const handleIssueClick = () => {
    // 验证
    if (!amount || isNaN(amount) || parseInt(amount) <= 0) {
      setError('请输入有效的金额');
      return;
    }

    if (parseInt(amount) > MAX_PER_TRANSACTION) {
      setError(`单笔发行不能超过 ${MAX_PER_TRANSACTION} 点`);
      return;
    }

    // ⚠️ 测试阶段：时间限制已禁用（isActiveHours 始终为 true）
    if (!isActiveHours) {
      setError('当前不在营业时间内（6:00 AM - 6:00 PM）');
      return;
    }

    // 显示交易密码对话框
    setPendingAmount(parseInt(amount));
    setShowPinDialog(true);
    setError(null);
  };

  // 处理交易密码确认
  const handlePinConfirm = async (pin, note) => {
    try {
      setLoading(true);
      setShowPinDialog(false);
      setError(null);
      setSuccessMessage(null);

      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;

      if (!orgId || !evtId) {
        throw new Error('无法获取活动信息');
      }

      // 调用Cloud Function创建点数卡
      const result = await callFunction(
        'createPointCard',
        {
          orgId,
          eventId: evtId,
          amount: pendingAmount,
          cashReceived: pendingAmount,
          transactionPin: pin,
          note: note || ''
        },
        15000
      );

      if (result.data.success) {
        const cardData = result.data.data;

        // 生成QR Code
        // ⚠️ 必须与 app 扫描逻辑一致（PointCardTopup 期待 type=POINT_CARD）
        // 同时尽量缩短 payload，降低 QR 密度，提升可扫性
        const qrData = JSON.stringify({
          type: 'POINT_CARD',
          v: '1.0',
          cardId: cardData.cardId,
          organizationId: orgId,
          eventId: evtId
        });

        const qrDataUrl = await QRCode.toDataURL(qrData, {
          width: 500,                    // 显示/下载用高分辨率
          margin: 4,                     // 增加边距（quiet zone）
          errorCorrectionLevel: 'M',     // 降低版本/密度，热敏打印更易扫
          color: {
            dark: '#000000',             // 确保黑色够深
            light: '#FFFFFF'             // 确保白色够亮
          }
        });

        setQrCodeDataUrl(qrDataUrl);
        setIssuedCard(cardData);
        setSuccessMessage(`✅ 点数卡发行成功！卡号: ${cardData.cardNumber}`);

        // 重置表单
        setAmount('');
        setPendingAmount(null);

        // 刷新统计
        onRefresh();
      }
    } catch (err) {
      console.error('发行点数卡失败:', err);
      setError('发行失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  // 处理取消
  const handlePinCancel = () => {
    setShowPinDialog(false);
    setPendingAmount(null);
  };

  // 下载QR Code
  const handleDownloadQRCode = () => {
    if (!qrCodeDataUrl || !issuedCard) return;

    const link = document.createElement('a');
    link.download = `PointCard-${issuedCard.cardNumber}.png`;
    link.href = qrCodeDataUrl;
    link.click();
  };

  // USB/系统打印（Windows 11 已安装驱动：走浏览器打印对话框）
  const handleUsbPrintPointCard = () => {
    if (!qrCodeDataUrl || !issuedCard) {
      setError('没有可打印的点数卡');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=800,height=600');
    if (!printWindow) {
      setError('无法打开打印窗口（可能被浏览器阻挡弹窗）');
      return;
    }

    const issuedAt = new Date().toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const amountPts = issuedCard.balance?.initial || 0;
    const cashReceived = issuedCard.issuer?.cashReceived || 0;

    const titleEvent = sanitizeAscii(eventNameEnUs || getEventNameEnUs(userProfile)) || 'MyBazaar';

    const printContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>PointCard - ${issuedCard.cardNumber}</title>
  <style>
    /* XP-58/58mm receipt paper */
    @page { size: 58mm 100mm; margin: 0; }
    @media print {
      html, body {
        width: 58mm;
        height: 100mm;
        margin: 0;
        padding: 0;
        overflow: hidden;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
    body { font-family: Arial, sans-serif; background: #fff; }
    .card {
      width: 58mm;
      height: 100mm;
      box-sizing: border-box;
      padding: 3mm;
      text-align: center;
      overflow: hidden;
    }
    .h1 { font-size: 16px; font-weight: 700; margin: 0 0 2mm; line-height: 1.2; }
    .line { border-top: 1px solid #999; margin: 2mm 0; }
    .mono { font-family: "Courier New", monospace; font-size: 13px; font-weight: 700; }
    .qr { margin: 2mm 0; }
    .qr img { width: 30mm; height: 30mm; image-rendering: pixelated; }
    .amt { font-size: 24px; font-weight: 800; margin: 1mm 0; line-height: 1; }
    .small { font-size: 11px; color: #333; text-align: left; }
    .footer { font-size: 11px; color: #333; margin-top: 3mm; }
  </style>
</head>
<body>
  <div class="card">
    <div class="h1">${titleEvent} Points Card</div>
    <div class="line"></div>
    <div class="mono">Card No: ${issuedCard.cardNumber}</div>
    <div class="qr"><img src="${qrCodeDataUrl}" alt="QR Code" /></div>
    <div class="amt">${amountPts} PTS</div>
    <div class="line"></div>
    <div class="small">
      <div>* Scan QR at merchant</div>
      <div>* Valid until event ends</div>
      <div>* Bearer card - keep safe</div>
    </div>
    <div class="footer">Cash: RM ${Number(cashReceived).toFixed(2)}<br/>${issuedAt}</div>
  </div>
  <script>
    window.onload = () => {
      setTimeout(() => {
        window.print();
        window.onafterprint = () => window.close();
      }, 300);
    };
  </script>
</body>
</html>
    `;

    printWindow.document.open();
    printWindow.document.write(printContent);
    printWindow.document.close();
  };

  // ⭐ 添加：蓝牙打印函数
  const handleBluetoothPrint = async () => {
    if (!qrCodeDataUrl || !issuedCard) {
      setError('没有可打印的点数卡');
      return;
    }

    if (!isWebBluetoothSupported) {
      setError('您的浏览器不支持蓝牙功能，请使用 Chrome 或 Edge');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // 第一次使用时连接打印机
      if (!bluetoothPrinter || !isPrinterConnected) {
        setSuccessMessage('正在连接蓝牙打印机，请在弹出窗口中选择 XP-58 设备...');

        bluetoothPrinter = new ESCPOSPrinter();
        await bluetoothPrinter.connect();

        setIsPrinterConnected(true);
        setSuccessMessage('✅ 蓝牙打印机已连接');

        // 等待1秒再打印
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // 准备 QR Code 数据（与发行时一致）
      const orgId = userProfile?.organizationId || organizationId;
      const evtId = userProfile?.eventId || eventId;
      const qrData = JSON.stringify({
        type: 'POINT_CARD',
        v: '1.0',
        cardId: issuedCard.cardId,
        organizationId: orgId,
        eventId: evtId
      });

      // 打印
      setSuccessMessage('正在打印...');
      // 获取活动名称：优先 Event 文档读到的 en-US，其次才尝试 userProfile
      const eventName = sanitizeAscii(eventNameEnUs || getEventNameEnUs(userProfile)) || 'MyBazaar';

      await bluetoothPrinter.printPointCard(
        issuedCard.cardNumber,
        issuedCard.balance?.initial || 0,
        qrData,
        qrCodeDataUrl,
        eventName  // ← 添加 eventName 参数
      );

      setSuccessMessage('✅ 点数卡已打印');

    } catch (err) {
      console.error('[蓝牙打印] 失败:', err);

      // 用户取消配对
      if (err.name === 'NotFoundError') {
        setError('未选择打印机，打印已取消');
      }
      // 连接失败
      else if (err.message.includes('连接')) {
        setError('无法连接到打印机，请确保打印机已开机并在附近');
        bluetoothPrinter = null;
        setIsPrinterConnected(false);
      }
      // 其他错误
      else {
        setError('打印失败: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };


  // 清除已发行卡片（准备发行下一张）
  const handleClearCard = () => {
    setIssuedCard(null);
    setQrCodeDataUrl(null);
    setSuccessMessage(null);
    setError(null);
  };

  // ⭐ 添加：组件卸载时断开蓝牙
  useEffect(() => {
    return () => {
      if (bluetoothPrinter) {
        bluetoothPrinter.disconnect();
        bluetoothPrinter = null;
        setIsPrinterConnected(false);
      }
    };
  }, []);

  return (
    <div className="issue-point-card">
      <h2 className="section-title">🎫 发行点数卡</h2>

      {/* 库存统计 */}
      <div className="inventory-summary">
        <div className="inventory-card">
          <img src={qrcodeTicketIcon} alt="已发行" className="inventory-icon" />
          <div className="inventory-value">
            {statistics.todayStats?.cardsIssued || 0}
          </div>
          <div className="inventory-label">今日发行张数</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <img src={paymentQrcodeIcon} alt="发行点数" className="inventory-icon" />
          <div className="inventory-value">
            {statistics.todayStats?.totalPointsIssued || 0}
          </div>
          <div className="inventory-label">今日发行点数</div>
        </div>
        <div className="inventory-divider"></div>
        <div className="inventory-card">
          <img src={qrIcon} alt="现金" className="inventory-icon" />
          <div className="inventory-value">
            {formatAmount(statistics.todayStats?.totalCashReceived || 0)}
          </div>
          <div className="inventory-label">今日收现金</div>
        </div>
      </div>

      {/* 已发行的卡片显示 */}
      {issuedCard && qrCodeDataUrl && (
        <div className="issued-card-display">
          <div className="card-header">
            <h3>✅ 点数卡已发行</h3>
            <button className="clear-button" onClick={handleClearCard}>
              发行下一张
            </button>
          </div>

          <div className="card-details">
            <div className="card-info">
              <div className="info-row">
                <span className="info-label">卡号：</span>
                <span className="info-value card-number">{issuedCard.cardNumber}</span>
              </div>
              <div className="info-row">
                <span className="info-label">点数：</span>
                <span className="info-value">{issuedCard.balance?.initial || 0} 点</span>
              </div>
              <div className="info-row">
                <span className="info-label">现金：</span>
                <span className="info-value">{formatAmount(issuedCard.issuer?.cashReceived || 0)}</span>
              </div>
            </div>

            <div className="qr-code-display">
              <img src={qrCodeDataUrl} alt="点数卡QR Code" className="qr-code-image" />
              <p className="qr-hint">请交给客户此QR Code</p>
            </div>
          </div>

          <div className="card-actions">
            <button className="download-button" onClick={handleDownloadQRCode}>
              📥 下载QR Code
            </button>
            <button
              className="print-button"
              onClick={handleUsbPrintPointCard}
              disabled={loading || !issuedCard}
            >
              USB 打印点数卡
            </button>

            {/* ⭐ 添加：蓝牙打印按钮（总是显示，但 iOS 会失败） */}
            <button
              className="print-button bluetooth"
              onClick={handleBluetoothPrint}
              disabled={loading || !issuedCard}
              title={!isWebBluetoothSupported ? '您的浏览器可能不支持蓝牙（iOS 不支持）' : ''}
            >
              {isPrinterConnected ? '📱 蓝牙打印' : '🔗 连接蓝牙打印'}
            </button>
          </div>

          {/* ⭐ 添加：蓝牙连接状态提示 */}
          {isPrinterConnected && (
            <div className="printer-status">
              ✅ 蓝牙打印机已连接
            </div>
          )}

          <div className="reminder-box">
            <p className="reminder-icon">⚠️</p>
            <p className="reminder-text">
              请确认已收到客户 <strong>{formatAmount(issuedCard.issuer?.cashReceived || 0)}</strong> 现金后，
              再将此点数卡交给客户。
            </p>
          </div>
        </div>
      )}

      {/* 发行新卡表单 */}
      {!issuedCard && (
        <div className="issue-form">
          <div className="form-section">
            <div className="form-group">
              <label htmlFor="cardAmount">点数金额</label>
              <div className="amount-input-wrapper">
                <input
                  id="cardAmount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="100"
                  min="1"
                  max={MAX_PER_TRANSACTION}
                  disabled={loading || !isActiveHours}
                />
                <span className="input-suffix">点 = {formatAmount(amount || 0)}</span>
              </div>
              <small className="hint">
                客户支付 {formatAmount(amount || 0)} 现金，获得点数卡 {amount || 0} 点（单笔最多 {MAX_PER_TRANSACTION} 点）
              </small>
            </div>

            {/* 错误提示 */}
            {error && (
              <div className="error-message">
                ⚠️ {error}
              </div>
            )}

            {/* 成功提示 */}
            {successMessage && (
              <div className="success-message">
                {successMessage}
              </div>
            )}

            {/* 提交按钮 */}
            <button
              onClick={handleIssueClick}
              disabled={loading || !amount || !isActiveHours}
              className="submit-button"
            >
              {loading ? '处理中...' : `🎫 发行点数卡 ${amount || 0} 点`}
            </button>

            {/* 提示信息 */}
            <div className="info-box">
              <p className="info-title">💡 操作说明</p>
              <ul className="info-list">
                <li>输入点数金额（点数 = 现金金额）</li>
                <li>点击"发行点数卡"按钮</li>
                <li>输入交易密码确认</li>
                <li>收取客户现金</li>
                <li>下载/打印QR Code给客户</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 交易密码对话框 */}
      {showPinDialog && pendingAmount && (
        <TransactionPinDialog
          title="确认发行点数卡"
          message={`即将发行 ${pendingAmount} 点的点数卡，收取现金 ${formatAmount(pendingAmount)}`}
          onConfirm={handlePinConfirm}
          onCancel={handlePinCancel}
          confirmButtonText="✅ 确认发行"
        />
      )}
    </div>
  );
};


export default IssuePointCard;
