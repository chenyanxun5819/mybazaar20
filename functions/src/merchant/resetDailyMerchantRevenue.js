/**
 * resetDailyMerchantRevenue.js
 * 每日重置商家销售额 - 使用 Cloud Scheduler 每天 00:00 MYT 执行
 * 
 * 功能：
 * 1. 重置所有商家的 dailyRevenue.today
 * 2. 重置所有商家的 dailyRevenue.todayTransactionCount
 * 3. 重置所有商家的 dailyRevenue.todayOwnerCollected
 * 4. 重置所有商家的 dailyRevenue.todayAsistsCollected
 * 5. 重置所有 merchantAsist 的 todayCollected 和 todayTransactionCount
 * 
 * Cloud Scheduler 配置:
 * - Cron: 0 0 * * * (每天 00:00)
 * - 时区: Asia/Kuala_Lumpur (MYT)
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

exports.resetDailyMerchantRevenue = onSchedule(
  {
    schedule: '0 0 * * *', // 每天 00:00
    timeZone: 'Asia/Kuala_Lumpur', // MYT 时区
    region: 'asia-southeast1'
  },
  async (event) => {
    try {
      console.log('[resetDailyMerchantRevenue] 开始执行每日重置...');

      const db = admin.firestore();
      const now = admin.firestore.FieldValue.serverTimestamp();

      // 统计数据
      let totalOrgs = 0;
      let totalEvents = 0;
      let totalMerchants = 0;
      let totalAsists = 0;

      // ========== 1. 遍历所有组织 ==========
      const orgsSnapshot = await db.collection('organizations').get();

      for (const orgDoc of orgsSnapshot.docs) {
        totalOrgs++;
        const orgId = orgDoc.id;

        // ========== 2. 遍历该组织的所有活动 ==========
        const eventsSnapshot = await db
          .collection('organizations').doc(orgId)
          .collection('events')
          .get();

        for (const eventDoc of eventsSnapshot.docs) {
          totalEvents++;
          const eventId = eventDoc.id;

          // ========== 3. 重置所有商家的每日销售额 ==========
          const merchantsSnapshot = await db
            .collection('organizations').doc(orgId)
            .collection('events').doc(eventId)
            .collection('merchants')
            .get();

          // 使用批处理操作
          const batch = db.batch();
          let batchCount = 0;

          for (const merchantDoc of merchantsSnapshot.docs) {
            totalMerchants++;

            batch.update(merchantDoc.ref, {
              'dailyRevenue.today': 0,
              'dailyRevenue.todayTransactionCount': 0,
              'dailyRevenue.todayOwnerCollected': 0,
              'dailyRevenue.todayAsistsCollected': 0,
              'dailyRevenue.lastResetAt': now
            });

            batchCount++;

            // Firestore 批处理限制为 500 个操作
            if (batchCount >= 500) {
              await batch.commit();
              batchCount = 0;
            }
          }

          // 提交剩余的批处理
          if (batchCount > 0) {
            await batch.commit();
          }

          // ========== 4. 重置所有 merchantAsist 的每日统计 ==========
          const asistsSnapshot = await db
            .collection('organizations').doc(orgId)
            .collection('events').doc(eventId)
            .collection('users')
            .where('roles', 'array-contains', 'merchantAsist')
            .get();

          const asistBatch = db.batch();
          let asistBatchCount = 0;

          for (const asistDoc of asistsSnapshot.docs) {
            totalAsists++;

            asistBatch.update(asistDoc.ref, {
              'merchantAsist.statistics.todayCollected': 0,
              'merchantAsist.statistics.todayTransactionCount': 0
            });

            asistBatchCount++;

            if (asistBatchCount >= 500) {
              await asistBatch.commit();
              asistBatchCount = 0;
            }
          }

          // 提交剩余的批处理
          if (asistBatchCount > 0) {
            await asistBatch.commit();
          }

          console.log(`[resetDailyMerchantRevenue] ${orgId}/${eventId}: ${merchantsSnapshot.size} 商家, ${asistsSnapshot.size} 助理`);
        }
      }

      console.log('[resetDailyMerchantRevenue] 每日重置完成:', {
        totalOrgs,
        totalEvents,
        totalMerchants,
        totalAsists,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        totalOrgs,
        totalEvents,
        totalMerchants,
        totalAsists
      };

    } catch (error) {
      console.error('[resetDailyMerchantRevenue] 错误:', error);
      throw error;
    }
  }
);
