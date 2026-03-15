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
    this.maxChunkSize = 10; // ⭐ 改进：从 20 改为 10 bytes，避免缓冲溢出
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

      // ⭐ 改进：检查 HTTPS/localhost 环境
      const isSecureContext = window.isSecureContext;
      if (!isSecureContext) {
        throw new Error('需要 HTTPS 安全连接或 localhost 才能使用蓝牙功能');
      }

      console.log('[Bluetooth] 正在请求蓝牙设备...');

      // ⭐ 改进：支持更多的打印机型号和服务UUID
      this.device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'XP' },
          { namePrefix: 'MTP' },
          { namePrefix: 'P300' },
          { namePrefix: 'P-' },
          { namePrefix: 'BlueTooth Printer' },
          { namePrefix: 'Printer' },
          { namePrefix: 'POS' },
          { namePrefix: 'ESC' }
        ],
        optionalServices: [
          '000018f0-0000-1000-8000-00805f9b34fb',
          '0000ffe0-0000-1000-8000-00805f9b34fb',
          '0000fff0-0000-1000-8000-00805f9b34fb',
          '0000180a-0000-1000-8000-00805f9b34fb',
          // ⭐ 新增常見打印機 UUID
          '00001800-0000-1000-8000-00805f9b34fb',
          '00001801-0000-1000-8000-00805f9b34fb',
          '0000ff00-0000-1000-8000-00805f9b34fb',
          '0000ae00-0000-1000-8000-00805f9b34fb',
          '0000af00-0000-1000-8000-00805f9b34fb',
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip ISSC
          'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // 某些雜牌機
          '000018f0-0000-1000-8000-00805f9b34fb',
        ]
      });

      console.log('[Bluetooth] 找到设备:', this.device.name);
      console.log('[Bluetooth] 设备状态:', {
        name: this.device.name,
        id: this.device.id,
        connected: this.device.gatt?.connected || false
      });

      // 带重试机制的 GATT 连接
      let server = null;
      let connectAttempts = 0;
      const maxAttempts = 3;
      const connectRetryDelay = 1000;

      while (connectAttempts < maxAttempts && !server) {
        try {
          connectAttempts++;
          console.log(`[Bluetooth] GATT 连接尝试 ${connectAttempts}/${maxAttempts}...`);
          server = await this.device.gatt.connect();
          console.log('[Bluetooth] ✅ 已连接到 GATT 服务器');
          break;
        } catch (connectError) {
          console.error(`[Bluetooth] GATT 连接失败 (尝试 ${connectAttempts}):`, connectError?.message);

          if (connectAttempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, connectRetryDelay));
          } else {
            const hint = connectError?.name === 'NetworkError'
              ? '\n💡 提示: NetworkError 表示蓝牙连接层失败，可能原因：\n  • 打印机被其他设备占用\n  • 打印机需要重启\n  • 系统蓝牙设置中需要删除并重新配对此设备'
              : '';
            throw new Error(`无法连接到蓝牙设备（尝试 ${maxAttempts} 次）${hint}\n\n错误: ${connectError?.message}`);
          }
        }
      }

      // ⭐ 替換原來的 service 獲取邏輯
      let service = null;
      let allServices = [];

      try {
        // 嘗試枚舉所有服務（不指定 UUID）
        allServices = await server.getPrimaryServices();
        console.log('[Bluetooth] 打印機所有服務:', allServices.map(s => s.uuid));
      } catch (e) {
        console.warn('[Bluetooth] getPrimaryServices() 失敗，改用逐個嘗試:', e.message);
      }

      if (allServices.length > 0) {
        // 優先找常見打印服務 UUID
        const preferredServices = [
          '000018f0',  // ← ESC/POS 標準打印通道（你的打印機確認有）
          '0000ff00',  // ← 備選
          'ffe0',
          'fff0',
          'ae00',
          'af00',
          'e7810a71',  // ← 雜牌通道，排後面
          '49535343',  // ← ISSC，排最後
        ];

        // 先找優先 UUID
        service = allServices.find(s =>
          preferredServices.some(p => s.uuid.includes(p))
        );

        // 找不到就取第一個
        if (!service) {
          service = allServices[0];
          console.warn('[Bluetooth] 未找到優先服務，使用第一個:', service.uuid);
        }

        console.log('[Bluetooth] ✅ 選用服務:', service.uuid);

      } else {
        // fallback：逐個嘗試固定 UUID
        const serviceUUIDs = [
          '000018f0-0000-1000-8000-00805f9b34fb',
          '0000ffe0-0000-1000-8000-00805f9b34fb',
          '0000fff0-0000-1000-8000-00805f9b34fb',
          '0000ff00-0000-1000-8000-00805f9b34fb',
          '0000ae00-0000-1000-8000-00805f9b34fb',
        ];

        for (const uuid of serviceUUIDs) {
          try {
            service = await server.getPrimaryService(uuid);
            console.log(`[Bluetooth] ✅ 成功獲取服務 ${uuid}`);
            break;
          } catch (e) {
            console.log(`[Bluetooth] ❌ 服務 ${uuid} 不可用`);
          }
        }
      }

      if (!service) {
        // 列出調試信息
        throw new Error(
          `找不到兼容的蓝牙服务。\n` +
          `已发现服务数: ${allServices.length}\n` +
          `服务列表: ${allServices.map(s => s.uuid).join(', ') || '无'}`
        );
      }

      // 选择最像打印数据通道的特征。很多热敏机即使 write 成功，也可能写到非打印通道。
      const characteristics = await service.getCharacteristics();
      console.log('[Bluetooth] 找到特征列表:', characteristics.map((c) => ({
        uuid: c.uuid,
        write: !!c.properties?.write,
        writeWithoutResponse: !!c.properties?.writeWithoutResponse,
        notify: !!c.properties?.notify,
        indicate: !!c.properties?.indicate,
      })));
      // ⭐ 加入 2af1（18f0 服務的標準打印特徵）和 ff02
      const preferredUuidPatterns = [
        '2af1',   // ← 新增，18f0 服務標準打印通道
        'ff02',   // ← 新增，ff00 服務打印通道
        'ffe1', 'ffe2', 'fff1', 'fff2', 'ae01', 'ae02',
      ];

      const pickCharacteristic = (predicate) => characteristics.find((c) => {
        if (!predicate(c)) return false;
        return preferredUuidPatterns.some((pattern) => c.uuid.toLowerCase().includes(pattern));
      });

      let writableCharacteristic =
        pickCharacteristic((c) => c.properties?.writeWithoutResponse) ||
        pickCharacteristic((c) => c.properties?.write) ||
        characteristics.find((c) => c.properties?.writeWithoutResponse) ||
        characteristics.find((c) => c.properties?.write);

      if (!writableCharacteristic) {
        const charList = characteristics.map(c => `${c.uuid}: ${JSON.stringify(c.properties)}`).join('; ');
        throw new Error(`找不到可写特征。可用特征: ${charList}`);
      }

      console.log(`[Bluetooth] 选择特征: ${writableCharacteristic.uuid}, write: ${writableCharacteristic.properties?.write}, writeWithoutResponse: ${writableCharacteristic.properties?.writeWithoutResponse}`);

      this.characteristic = writableCharacteristic;

      console.log('[Bluetooth] 打印机已就绪');
      return true;
    } catch (error) {
      const errorName = error?.name || 'Unknown';
      const errorMsg = error?.message || String(error);
      console.error('[Bluetooth] 连接失败:', `Name: ${errorName}, Message: ${errorMsg}`);
      console.error('[Bluetooth] 完整错误对象:', error);
      throw error;
    }
  }

  // 发送数据到打印机（分块发送，XP-P300 优化）
  // 發送數據到打印機
  async send(data) {
    if (!this.characteristic) {
      throw new Error('打印機未連接');
    }

    try {
      const buffer = data instanceof Uint8Array ? data : new Uint8Array(data);

      // ⭐ XP-58 使用 writeValueWithoutResponse（串流模式）
      // writeValue (ATT_WRITE_REQUEST) 會逐包等待 ACK，導致 ESC/POS 指令被截斷
      const useWithoutResponse =
        this.characteristic.properties?.writeWithoutResponse;

      // ⭐ chunk size 提升到 100 bytes（10 bytes 太小，指令容易跨包被截斷）
      const chunkSize = useWithoutResponse ? 100 : 20;
      const totalChunks = Math.ceil(buffer.length / chunkSize);
      let sentChunks = 0;

      for (let offset = 0; offset < buffer.length; offset += chunkSize) {
        const chunk = buffer.slice(offset, offset + chunkSize);
        sentChunks++;

        try {
          if (useWithoutResponse) {
            // ⭐ 串流模式：不等回應，直接發下一包
            await this.characteristic.writeValueWithoutResponse(chunk);
            // 50ms 給打印機處理緩衝（比 writeValue 快但需要適當間隔）
            await new Promise((resolve) => setTimeout(resolve, 50));
          } else {
            // fallback：有回應確認模式
            await this.characteristic.writeValue(chunk);
            await new Promise((resolve) => setTimeout(resolve, 30));
          }

        } catch (chunkError) {
          console.error(`[Bluetooth] chunk ${sentChunks}/${totalChunks}:`, chunkError?.message);
          if (chunkError?.message?.includes('GATT')) {
            throw new Error(`蓝牙第${sentChunks}个分包时断开，请重启打印机`);
          }
          throw chunkError;
        }
      }

      console.log(`[Bluetooth] 数据完成: ${buffer.length}bytes`);
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

  // 使用打印机原生 ESC/POS QR 指令，避免通过蓝牙发送大位图导致 GATT 断线
  async printQRCode(qrData) {
    if (!qrData) {
      throw new Error('缺少 QR Code 数据');
    }

    const encoder = new TextEncoder();
    const payload = encoder.encode(qrData);

    if (payload.length > 7089) {
      throw new Error('QR Code 数据过长，无法使用打印机原生模式打印');
    }

    try {
      console.log('[QR Code] 使用 ESC/POS 原生 QR 指令打印...');
      console.log('[QR Code] 数据长度:', payload.length, 'bytes');

      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);

      // 选择 QR model 2
      await this.send(new Uint8Array([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]));

      // 模块大小 4（通用值，58mm 热敏纸安全范围内）
      await this.send(new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x04]));

      // 容错等级 M
      await this.send(new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]));

      // 存储 QR 数据
      const storeLength = payload.length + 3;
      const pL = storeLength & 0xFF;
      const pH = (storeLength >> 8) & 0xFF;
      const storeCommand = new Uint8Array(8 + payload.length);
      storeCommand.set([0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30], 0);
      storeCommand.set(payload, 8);
      await this.send(storeCommand);

      // 打印已存储的 QR
      await this.send(new Uint8Array([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]));
      await this.printText('\n');

      console.log('[QR Code] ✅ 原生 QR Code 打印完成');
    } catch (error) {
      console.error('[QR Code] 原生打印失败:', error);
      throw error;
    }
  }

  // 打印点数卡（XP-58 优化版 - 紧凑布局）
  async printPointCard(cardNumber, amount, qrData, eventName = 'MyBazaar') {
    let corePrinted = false;

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

      // 5. 使用打印机原生 QR 指令，避免蓝牙传大图断开
      console.log('[Print] 准备打印 QR Code...');
      await this.printQRCode(qrData);

      // 给打印机时间把 QR 渲染到纸上，避免后续命令把蓝牙链路挤断
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // 6. 点数金额（蓝牙版保留最关键内容）
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.send(ESCPOSPrinter.CMD.FONT_SIZE_LARGE);
      await this.send(ESCPOSPrinter.CMD.BOLD_ON);
      await this.printText(`${amount} Points\n`);
      await this.send(ESCPOSPrinter.CMD.BOLD_OFF);
      await this.send(ESCPOSPrinter.CMD.FONT_SIZE_NORMAL);
      corePrinted = true;

      // 蓝牙链路不稳定时，减少非必要文字和切纸命令
      await this.send(ESCPOSPrinter.CMD.ALIGN_CENTER);
      await this.printText('Use at merchant\n');
      await this.printText('\n\n\n\n\n');
      // ⭐ 加切紙指令（XP-58 支援）
      await this.send(ESCPOSPrinter.CMD.CUT_PAPER);

      console.log('[Print] ✅ 打印完成');
      return true;

    } catch (error) {
      console.error('[Print] 打印失败:', error);

      if (corePrinted && (error?.message?.includes('GATT') || error?.message?.includes('断开'))) {
        console.warn('[Print] 尾段蓝牙断开，但核心内容已发送，按成功处理');
        return true;
      }

      throw error;
    }
  }

  // 简易测试打印（纯 ASCII，不含 QR、无字体命令，用于诊断通道是否正常）
  async testPrint() {
    await this.send(new Uint8Array([0x1B, 0x40])); // ESC @ init
    await new Promise(r => setTimeout(r, 100));
    await this.send(new Uint8Array([0x1B, 0x61, 0x01])); // center
    const enc = new TextEncoder();
    await this.send(enc.encode('=== TEST PRINT ===\n'));
    await this.send(enc.encode('Printer OK\n'));
    await this.send(enc.encode('\n\n\n\n\n\n'));
    return true;
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
        eventName  // ← 添加 eventName 参数
      );

      setSuccessMessage('✅ 点数卡已打印');

    } catch (err) {
      console.error('[蓝牙打印] 失败:', err);
      console.error('[蓝牙打印] 错误类型:', err?.name, '错误代码:', err?.code);

      let errorMessage = '';
      let shouldResetConnection = false;

      // NetworkError - 蓝牙连接层故障（最常见）
      if (err.name === 'NetworkError' || err.message?.includes('NetworkError') || err.message?.includes('Connection attempt')) {
        errorMessage = '❌ 蓝牙连接失败\n\n可能原因：\n• 打印机被其他设备占用\n• 打印机需要重启\n• 配对信息失效\n\n✅ 解决步骤:\n1️⃣ 打开蓝牙设置\n2️⃣ 删除 "Printer001-022C"\n3️⃣ 重启打印机（关闭后等10秒）\n4️⃣ 重新配对此设备\n5️⃣ 返回此页重试';
        shouldResetConnection = true;
      }
      // 用户取消选择设备
      else if (err.name === 'NotAllowedError') {
        errorMessage = '您取消了蓝牙设备的选择';
      }
      // 未找到设备
      else if (err.name === 'NotFoundError') {
        errorMessage = '未找到打印机\n\n请检查：\n• 打印机已开机\n• 打印机在蓝牙范围内（≤5m）';
      }
      // 连接失败（特性、GATT等）
      else if (err.message?.includes('连接') || err.message?.includes('GATT') || err.message?.includes('特征')) {
        errorMessage = err.message || '无法连接到打印机\n请重启打印机后重试';
        shouldResetConnection = true;
      }
      // HTTPS 需求
      else if (err.message?.includes('HTTPS')) {
        errorMessage = '需要 HTTPS 安全连接\n请在生产环境下使用此功能';
      }
      // 其他错误
      else {
        errorMessage = (err.message || String(err)) || '打印失败，请重试';
      }

      // 自动重置蓝牙连接状态
      if (shouldResetConnection && bluetoothPrinter) {
        console.log('[蓝牙] 自动断开蓝牙重置...');
        bluetoothPrinter.disconnect();
        bluetoothPrinter = null;
        setIsPrinterConnected(false);
      }

      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };


  // 测试打印（纯文字，诊断蓝牙通道用）
  const handleTestPrint = async () => {
    if (!isWebBluetoothSupported) {
      setError('您的浏览器不支持蓝牙功能');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!bluetoothPrinter || !isPrinterConnected) {
        bluetoothPrinter = new ESCPOSPrinter();
        await bluetoothPrinter.connect();
        setIsPrinterConnected(true);
      }
      await bluetoothPrinter.testPrint();
      setSuccessMessage('✅ 测试打印已发送，请检查打印机是否出纸');
    } catch (err) {
      console.error('[测试打印] 失败:', err);
      setError(err.message || '测试打印失败');
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
            <button
              className="print-button"
              onClick={handleTestPrint}
              disabled={loading}
              style={{ fontSize: '0.8em', opacity: 0.75 }}
              title="发送纯文字，测试打印机通道是否正常"
            >
              🔧 测试打印
            </button>
          </div>

          {/* ⭐ 添加：蓝牙连接状态提示 */}
          {isPrinterConnected && (
            <div className="printer-status">
              ✅ 蓝牙打印机已连接
            </div>
          )}

          {/* 蓝牙打印错误提示（显示在打印按钮下方） */}
          {error && issuedCard && (
            <div className="error-message" style={{ whiteSpace: 'pre-wrap' }}>
              ⚠️ {error}
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
              <div className="error-message" style={{ whiteSpace: 'pre-wrap' }}>
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
