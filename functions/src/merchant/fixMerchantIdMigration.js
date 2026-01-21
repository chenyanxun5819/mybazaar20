/**
 * 修复脚本：将 merchantAsist.assignedMerchants 数组迁移到 merchantAsist.merchantId
 * 
 * 用途：修复在新修复部署前创建的商家对应的助理用户
 * 
 * 执行方式：
 * 1. 在 Firebase 控制台的 Cloud Functions 测试面板中运行
 * 2. 或通过 Node.js 脚本使用 Firebase Admin SDK 执行
 * 
 * 注意：此脚本为一次性修复，请先备份数据
 */

const admin = require('firebase-admin');

/**
 * 修复单个用户的 merchantId
 */
async function fixUserMerchantId(organizationId, eventId, userId, userData) {
  const db = admin.firestore();
  const userRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users').doc(userId);

  try {
    const merchantAsist = userData.merchantAsist || {};
    const assignedMerchants = merchantAsist.assignedMerchants || [];

    // 如果已有 merchantId 且值有效，跳过
    if (merchantAsist.merchantId && assignedMerchants.length > 0) {
      console.log(`[SKIP] 用户 ${userId} 已有 merchantId: ${merchantAsist.merchantId}`);
      return {
        status: 'skipped',
        reason: 'already_has_merchantId',
        userId
      };
    }

    // 如果没有 assignedMerchants，说明不是需要修复的数据
    if (assignedMerchants.length === 0) {
      console.log(`[SKIP] 用户 ${userId} 没有 assignedMerchants`);
      return {
        status: 'skipped',
        reason: 'no_assignedMerchants',
        userId
      };
    }

    // 从 assignedMerchants 数组中取第一个作为 merchantId
    // （因为新的设计只支持单一商家关联）
    const merchantId = assignedMerchants[0];
    const merchantRef = db
      .collection('organizations').doc(organizationId)
      .collection('events').doc(eventId)
      .collection('merchants').doc(merchantId);

    const merchantDoc = await merchantRef.get();
    if (!merchantDoc.exists) {
      console.error(`[ERROR] 商家不存在: ${merchantId}`);
      return {
        status: 'failed',
        reason: 'merchant_not_found',
        userId,
        merchantId
      };
    }

    const stallName = merchantDoc.data().stallName;

    // 更新用户文档
    await userRef.update({
      'merchantAsist.merchantId': merchantId,
      'merchantAsist.stallName': stallName,
      'merchantAsist.migratedAt': admin.firestore.FieldValue.serverTimestamp(),
      'merchantAsist.migrationNote': `从 assignedMerchants 迁移，选择了第一个值: ${merchantId}`
    });

    console.log(`[FIXED] 用户 ${userId} 的 merchantId 已修复为: ${merchantId}`);
    return {
      status: 'fixed',
      userId,
      merchantId,
      stallName
    };

  } catch (error) {
    console.error(`[ERROR] 修复用户 ${userId} 失败:`, error);
    return {
      status: 'failed',
      reason: 'unknown_error',
      userId,
      error: error.message
    };
  }
}

/**
 * 批量修复所有需要修复的用户
 */
async function fixAllUsers(organizationId, eventId) {
  const db = admin.firestore();
  const usersRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users');

  try {
    console.log(`\n开始修复 ${organizationId}/${eventId} 的用户...`);

    const snapshot = await usersRef.get();
    const results = {
      fixed: [],
      skipped: [],
      failed: []
    };

    for (const doc of snapshot.docs) {
      const result = await fixUserMerchantId(organizationId, eventId, doc.id, doc.data());
      
      if (result.status === 'fixed') {
        results.fixed.push(result);
      } else if (result.status === 'skipped') {
        results.skipped.push(result);
      } else {
        results.failed.push(result);
      }
    }

    console.log(`\n修复完成：`);
    console.log(`- 已修复: ${results.fixed.length}`);
    console.log(`- 已跳过: ${results.skipped.length}`);
    console.log(`- 失败: ${results.failed.length}`);

    if (results.failed.length > 0) {
      console.error('\n失败的修复：', results.failed);
    }

    return results;

  } catch (error) {
    console.error('[ERROR] 批量修复失败:', error);
    throw error;
  }
}

/**
 * 验证修复结果
 */
async function validateFix(organizationId, eventId, merchantId) {
  const db = admin.firestore();
  const usersRef = db
    .collection('organizations').doc(organizationId)
    .collection('events').doc(eventId)
    .collection('users');

  try {
    const snapshot = await usersRef
      .where('merchantAsist.merchantId', '==', merchantId)
      .get();

    console.log(`\n验证: 商家 ${merchantId} 有 ${snapshot.size} 个关联的助理`);

    const issues = [];
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const { merchantAsist } = data;

      if (!merchantAsist.merchantId) {
        issues.push({
          userId: doc.id,
          issue: '缺少 merchantId'
        });
      }

      if (merchantAsist.assignedMerchants && merchantAsist.assignedMerchants.length > 0) {
        console.log(`[WARNING] 用户 ${doc.id} 仍有旧的 assignedMerchants: ${merchantAsist.assignedMerchants}`);
      }
    }

    if (issues.length === 0) {
      console.log('✓ 验证通过，所有数据完整');
    } else {
      console.error('✗ 发现问题：', issues);
    }

    return issues;

  } catch (error) {
    console.error('[ERROR] 验证失败:', error);
    throw error;
  }
}

// 导出函数供外部使用
module.exports = {
  fixUserMerchantId,
  fixAllUsers,
  validateFix
};

// 如果直接运行此文件
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('用法: node fixMerchantId.js <organizationId> <eventId> [action]');
    console.log('示例: node fixMerchantId.js org123 event456 fix');
    process.exit(1);
  }

  const [organizationId, eventId, action = 'fix'] = args;

  // 初始化 Firebase Admin SDK（需要配置）
  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: 'mybazaar-c4881'
    });
  }

  (async () => {
    try {
      if (action === 'fix') {
        await fixAllUsers(organizationId, eventId);
      } else if (action === 'validate') {
        // 需要传入 merchantId 进行验证
        const merchantId = args[2];
        if (!merchantId) {
          console.log('验证需要提供 merchantId');
          process.exit(1);
        }
        await validateFix(organizationId, eventId, merchantId);
      }
    } catch (error) {
      console.error('执行失败:', error);
      process.exit(1);
    }
  })();
}
