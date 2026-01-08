const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateToSubcollections() {
  try {
    console.log('🚀 开始迁移数据...\n');
    
    // 1. 获取所有组织
    const orgsSnapshot = await db.collection('organizations').get();
    console.log(`📊 找到 ${orgsSnapshot.size} 个组织\n`);
    
    for (const orgDoc of orgsSnapshot.docs) {
      const orgId = orgDoc.id;
      const orgData = orgDoc.data();
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`📁 处理组织: ${orgData.orgCode} (${orgId})`);
      console.log('='.repeat(60));
      
      // 2. 检查是否有嵌套的 events 对象
      if (orgData.events && typeof orgData.events === 'object') {
        const events = orgData.events;
        const eventIds = Object.keys(events);
        
        console.log(`\n✨ 发现 ${eventIds.length} 个嵌套活动需要迁移`);
        
        // 3. 迁移每个活动
        for (const eventId of eventIds) {
          const eventData = events[eventId];
          
          console.log(`\n  📅 活动: ${eventData.eventCode} (${eventId})`);
          
          // 4. 分离用户数据
          const users = eventData.users || {};
          const userIds = Object.keys(users);
          console.log(`     👥 包含 ${userIds.length} 个用户`);
          
          // 从活动数据中删除 users 字段
          delete eventData.users;
          
          // 5. 创建活动子集合文档
          const eventRef = db
            .collection('organizations')
            .doc(orgId)
            .collection('events')
            .doc(eventId);
          
          await eventRef.set(eventData);
          console.log(`     ✅ 活动文档已创建到子集合`);
          
          // 6. 迁移用户到子集合
          if (userIds.length > 0) {
            console.log(`     🔄 开始迁移用户...`);
            
            let migratedCount = 0;
            for (const userId of userIds) {
              const userData = users[userId];
              const userRef = eventRef.collection('users').doc(userId);
              await userRef.set(userData);
              migratedCount++;
              
              if (migratedCount % 5 === 0 || migratedCount === userIds.length) {
                console.log(`        已迁移 ${migratedCount}/${userIds.length} 个用户`);
              }
            }
            
            console.log(`     ✅ 用户迁移完成`);
          }
        }
        
        // 7. 删除原有的嵌套 events 字段
        console.log(`\n  🗑️  清理嵌套数据...`);
        await db.collection('organizations').doc(orgId).update({
          events: admin.firestore.FieldValue.delete()
        });
        console.log(`  ✅ 已删除嵌套 events 字段`);
        
      } else {
        console.log(`  ⏭️  跳过：已经是子集合结构或无活动`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 数据迁移完成！');
    console.log('='.repeat(60));
    console.log('\n请在 Firebase Console 中验证数据结构\n');
    
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    console.error('\n错误详情:', error.message);
    process.exit(1);
  }
}

// 执行迁移
migrateToSubcollections();
