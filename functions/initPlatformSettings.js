/**
 * ========================================
 * Platform Settings 初始化脚本
 * ========================================
 * 
 * 功能：在 Firestore 中创建 platform_settings/config 文档
 * 
 * 使用方法：
 * 1. 通过 Firebase 模拟器或者使用已授权的 Firebase CLI 环境
 * 2. 运行: npm run init:platform-settings
 *    或者: node initPlatformSettings.js --use-emulator (如果使用模拟器)
 *    或者: firebase deploy (自动初始化)
 * 
 * 注意：只需运行一次！
 * 
 * 环境变量：
 * - FIRESTORE_EMULATOR_HOST: 本地模拟器地址 (localhost:8081)
 * - GOOGLE_APPLICATION_CREDENTIALS: 服务账号密钥文件路径
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
require('./loadEnv');

const DEFAULT_DEV_OTP_CODE = /^\d{6}$/.test(String(process.env.DEV_OTP_CODE || ''))
  ? String(process.env.DEV_OTP_CODE)
  : '223344';
const DEFAULT_SMS_PROVIDER = String(process.env.SMS_PROVIDER || 'disabled').trim().toLowerCase() || 'disabled';

// ========================================
// 初始化 Firebase Admin
// ========================================

// 获取命令行参数
const args = process.argv.slice(2);
const _useEmulator = args.includes('--use-emulator');

console.log('');
console.log('========================================');
console.log('🔧 Firebase Admin 初始化配置');
console.log('========================================');
console.log('');

if (!admin.apps.length) {
  try {
    // 尝试加载服务账号密钥
    let credential = null;
    
    // 检查常见的密钥文件位置
    const keyPaths = [
      path.join(process.cwd(), 'serviceAccountKey.json'),
      path.join(process.cwd(), 'key.json'),
      path.join(process.cwd(), '..', 'serviceAccountKey.json'),
      process.env.GOOGLE_APPLICATION_CREDENTIALS
    ];
    
    for (const keyPath of keyPaths) {
      if (keyPath && fs.existsSync(keyPath)) {
        const stats = fs.statSync(keyPath);
        if (stats.size > 100) {  // 有效的 JSON 应该不会只有几字节
          try {
            const serviceAccount = require(path.resolve(keyPath));
            credential = admin.credential.cert(serviceAccount);
            console.log(`✅ 找到服务账号密钥: ${keyPath}`);
            console.log(`📊 项目ID: ${serviceAccount.project_id}`);
            break;
          } catch (e) {
            console.log(`⚠️  ${keyPath} 不是有效的 JSON`);
          }
        }
      }
    }
    
    // 如果找到密钥就使用，否则尝试 ADC（Application Default Credentials）
    if (credential) {
      admin.initializeApp({
        credential: credential
      });
      console.log('✅ Firebase Admin 初始化成功（使用服务账号）');
    } else {
      // 尝试使用 ADC（gcloud auth application-default login 设置的凭证）
      console.log('🔗 尝试使用 ADC (Application Default Credentials)...');
      
      // ADC 模式下，直接指定项目ID
      admin.initializeApp({
        projectId: 'mybazaar-c4881'
      });
      
      console.log('✅ Firebase Admin 初始化成功（使用 ADC + 项目ID）');
    }
  } catch (error) {
    console.error('');
    console.error('❌ Firebase Admin 初始化失败:');
    console.error(error.message);
    console.error('');
    console.error('💡 解决方案：');
    console.error('   1. 运行: gcloud auth application-default login');
    console.error('   2. 或从 Firebase 控制台下载服务账号密钥到 functions/serviceAccountKey.json');
    console.error('');
    process.exit(1);
  }
}

const db = admin.firestore();

// ========================================
// Platform Settings 完整配置
// ========================================
const platformSettings = {
  // === OTP 配置 ===
  otp: {
    // 总开关（控制整个OTP系统）
    enabled: false,  // ⚠️ 初始关闭，后续由Platform Admin开启
    
    // SMS 提供商
    provider: DEFAULT_SMS_PROVIDER,
    
    // OTP 有效期（分钟）
    validityMinutes: 5,
    
    // 最大尝试次数
    maxAttempts: 3,
    
    // 360 SMS 配置
    smsConfig: {
      apiKey: '',
      apiSecret: '',
      baseUrl: process.env.API_BASE_URL_360 || 'https://sms.360.my/gw/bulk360/v3_0/send.php',
      sender: process.env.SMS_SENDER_360 || 'MyBazaar',
      managedInSecretManager: true
    },
    
    // 开发模式配置
    devMode: {
      enabled: false,
      fixedCode: DEFAULT_DEV_OTP_CODE,
      bypassForTestNumbers: [
        '+60123456789',  // 测试号码列表
        '+60198765432'
      ]
    }
  },
  
  // === OTP 场景开关（Platform Admin统一控制）===
  otpRequired: {
    // --- Customer 相关场景 ---
    customerPayment: false,        // Customer付款给Merchant
    customerTransfer: false,       // Customer转让点数给其他Customer
    pointCardTopup: false,         // Customer扫点数卡充值（通常不需要）
    
    // --- teamLeader 相关场景 ---
    teamLeaderAllocate: false,      // teamLeader分配点数给Seller
    teamLeaderCollectCash: false,   // teamLeader收款确认
    
    // --- Seller 相关场景 ---
    sellerSellPoints: false,       // Seller售出点数给Customer
    sellerSubmitCash: false,       // Seller上缴现金给teamLeader
    
    // --- PointSeller 相关场景 ---
    pointSellerIssueCard: false,       // PointSeller发行点数卡
    pointSellerReceiveCash: false,     // PointSeller收款确认
    
    // --- EventManager 相关场景 ---
    eventManagerBatchAllocate: false,  // EventManager批量分配点数
    eventManagerApproval: false,       // EventManager审批大额操作
    
    // --- FinanceManager 相关场景 ---
    financeManagerAllocate: false,     // FinanceManager分配点数
    financeManagerVerify: false,       // FinanceManager财务核实
    
    // --- Merchant 相关场景 ---
    merchantPayment: false         // Merchant收款（通常不需要）
  },
  
  // === OTP 场景详细配置 ===
  otpScenarios: {
    // Customer 付款给 Merchant
    customerPayment: {
      description: 'Customer付款给Merchant',
      triggerCondition: {
        minAmount: 0,        // 任何金额都触发（设为0）
        maxAmount: null      // 无上限
      },
      message: '您正在向商家【{merchantName}】付款 {amount} 点，请输入验证码确认。'
    },
    
    // Customer 转让点数
    customerTransfer: {
      description: 'Customer转让点数给其他Customer',
      triggerCondition: {
        minAmount: 10,       // 10点以上触发
        maxAmount: null
      },
      message: '您正在转让 {amount} 点给 {recipientName}（{recipientPhone}），请输入验证码确认。'
    },
    
    // Customer 点数卡充值
    pointCardTopup: {
      description: 'Customer扫点数卡充值到账户',
      triggerCondition: {
        minAmount: 0,
        maxAmount: null
      },
      message: '您正在使用点数卡充值 {amount} 点，请输入验证码确认。'
    },
    
    // teamLeader 分配点数
    teamLeaderAllocate: {
      description: 'teamLeader分配点数给Seller',
      triggerCondition: {
        minAmount: 100,      // 100点以上触发
        maxAmount: null
      },
      message: '您正在分配 {amount} 点给 {recipientName}（{department}），请输入验证码确认。'
    },
    
    // teamLeader 收款确认
    teamLeaderCollectCash: {
      description: 'teamLeader从Seller收取现金',
      triggerCondition: {
        minAmount: 50,       // 50 RM以上触发
        maxAmount: null
      },
      message: '您正在确认从 {sellerName} 收取现金 RM {amount}，请输入验证码确认。'
    },
    
    // Seller 售出点数
    sellerSellPoints: {
      description: 'Seller售出点数给Customer',
      triggerCondition: {
        minAmount: 50,       // 50点以上触发
        maxAmount: null
      },
      message: '您正在售出 {amount} 点给顾客，请输入验证码确认。'
    },
    
    // Seller 上缴现金
    sellerSubmitCash: {
      description: 'Seller上缴现金给teamLeader',
      triggerCondition: {
        minAmount: 50,
        maxAmount: null
      },
      message: '您正在上缴现金 RM {amount}，请输入验证码确认。'
    },
    
    // PointSeller 发行点数卡
    pointSellerIssueCard: {
      description: 'PointSeller发行点数卡',
      triggerCondition: {
        minAmount: 100,      // 100点以上触发
        maxAmount: null
      },
      message: '您正在发行面额 {amount} 点的点数卡，请输入验证码确认。'
    },
    
    // PointSeller 收款确认
    pointSellerReceiveCash: {
      description: 'PointSeller确认收到现金',
      triggerCondition: {
        minAmount: 100,
        maxAmount: null
      },
      message: '您正在确认收到现金 RM {amount}，请输入验证码确认。'
    },
    
    // EventManager 批量分配
    eventManagerBatchAllocate: {
      description: 'EventManager批量分配点数',
      triggerCondition: {
        minAmount: 500,      // 500点以上触发
        maxAmount: null
      },
      message: '您正在批量分配共 {amount} 点给 {recipientCount} 位用户，请输入验证码确认。'
    },
    
    // EventManager 审批
    eventManagerApproval: {
      description: 'EventManager审批大额操作',
      triggerCondition: {
        minAmount: 1000,     // 1000点以上触发
        maxAmount: null
      },
      message: '您正在审批金额 {amount} 点的操作，请输入验证码确认。'
    },
    
    // FinanceManager 分配点数
    financeManagerAllocate: {
      description: 'FinanceManager分配点数',
      triggerCondition: {
        minAmount: 200,
        maxAmount: null
      },
      message: '您正在分配 {amount} 点给 {recipientName}，请输入验证码确认。'
    },
    
    // FinanceManager 财务核实
    financeManagerVerify: {
      description: 'FinanceManager核实财务数据',
      triggerCondition: {
        minAmount: 100,
        maxAmount: null
      },
      message: '您正在核实金额 RM {amount} 的财务记录，请输入验证码确认。'
    },
    
    // Merchant 收款（通常不需要OTP）
    merchantPayment: {
      description: 'Merchant从Customer收款',
      triggerCondition: {
        minAmount: 0,
        maxAmount: null
      },
      message: '您正在确认收款 {amount} 点，请输入验证码确认。'
    }
  },
  
  // === 元数据 ===
  metadata: {
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'system',  // 初始化时为system
    version: '1.0.0',
    description: 'Platform级别配置，控制所有Event的OTP行为'
  }
};

// ========================================
// 执行初始化
// ========================================
async function initializePlatformSettings() {
  console.log('');
  console.log('========================================');
  console.log('🚀 开始初始化 Platform Settings');
  console.log('========================================');
  console.log('');
  
  try {
    // 检查文档是否已存在
    const docRef = db.collection('platform_settings').doc('config');
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      console.log('⚠️  警告：platform_settings/config 已存在！');
      console.log('');
      console.log('现有配置：');
      const existing = docSnap.data();
      console.log('  - OTP 总开关:', existing.otp?.enabled ? '✅ 开启' : '❌ 关闭');
      console.log('  - 开发模式:', existing.otp?.devMode?.enabled ? '✅ 开启' : '❌ 关闭');
      console.log('  - SMS 提供商:', existing.otp?.provider);
      console.log('  - 更新时间:', existing.metadata?.updatedAt?.toDate?.() || '未知');
      console.log('');
      console.log('❓ 是否要覆盖？（请手动确认）');
      console.log('   如需覆盖，请修改脚本中的 FORCE_OVERWRITE = true');
      console.log('');
      
      // 安全保护：不自动覆盖
      const FORCE_OVERWRITE = false;
      
      if (!FORCE_OVERWRITE) {
        console.log('✋ 已取消，保留现有配置');
        return;
      }
      
      console.log('⚠️  覆盖现有配置...');
    }
    
    // 写入配置
    await docRef.set(platformSettings, { merge: false });
    
    console.log('✅ Platform Settings 初始化成功！');
    console.log('');
    console.log('📄 文档路径：platform_settings/config');
    console.log('');
    console.log('📊 配置摘要：');
    console.log(`   - OTP总开关: ${platformSettings.otp.enabled ? '✅ 开启' : '❌ 关闭'}`);
    console.log(`   - 开发模式: ${platformSettings.otp.devMode.enabled ? '✅ 开启' : '❌ 关闭'}`);
    console.log(`   - 固定验证码: ${platformSettings.otp.devMode.fixedCode}`);
    console.log(`   - SMS提供商: ${platformSettings.otp.provider}`);
    console.log(`   - 场景总数: ${Object.keys(platformSettings.otpRequired).length}`);
    console.log('');
    console.log('🔐 OTP场景状态：');
    
    // 分组显示场景
    const scenarios = platformSettings.otpRequired;
    const groups = {
      'Customer': ['customerPayment', 'customerTransfer', 'pointCardTopup'],
      'teamLeader': ['teamLeaderAllocate', 'teamLeaderCollectCash'],
      'Seller': ['sellerSellPoints', 'sellerSubmitCash'],
      'PointSeller': ['pointSellerIssueCard', 'pointSellerReceiveCash'],
      'EventManager': ['eventManagerBatchAllocate', 'eventManagerApproval'],
      'FinanceManager': ['financeManagerAllocate', 'financeManagerVerify'],
      'Merchant': ['merchantPayment']
    };
    
    for (const [group, keys] of Object.entries(groups)) {
      console.log(`   ${group}:`);
      keys.forEach(key => {
        const status = scenarios[key] ? '✅' : '❌';
        console.log(`      ${status} ${key}`);
      });
    }
    
    console.log('');
    console.log('🎯 下一步：');
    console.log('   1. ✅ 配置已创建，所有OTP开关默认关闭');
    console.log('   2. 📝 开始开发Customer功能（OTP逻辑已内置）');
    console.log(`   3. 🔧 测试时可启用开发模式固定验证码：${DEFAULT_DEV_OTP_CODE}`);
    console.log('   4. 🎛️  未来在Platform Admin界面开启需要的OTP场景');
    console.log('');
    console.log('========================================');
    console.log('✨ 初始化完成！');
    console.log('========================================');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ 初始化失败：', error);
    console.error('');
    console.error('错误详情：', error.message);
    console.error('');
    throw error;
  }
}

// ========================================
// 运行脚本
// ========================================
initializePlatformSettings()
  .then(() => {
    console.log('脚本执行成功，可以安全退出。');
    process.exit(0);
  })
  .catch((error) => {
    console.error('脚本执行失败：', error);
    process.exit(1);
  });
