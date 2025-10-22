## 📝 数据迁移工作交接文档

---

## 🎯 任务概述

**任务：** 将 Firestore 数据从嵌套对象架构迁移到子集合架构

**优先级：** 🔴 高（必须完成才能继续开发）

**预计时间：** 1-2 小时

---

## ❓ 为什么需要迁移

### 当前问题

**现有架构（嵌套对象）：**
```
organizations/{orgId}
  └─ events: {            ❌ 对象字段
       eventId: {
         users: {         ❌ 嵌套对象
           userId: {...}
         }
       }
     }
```

**问题：**
- ❌ Firestore 文档大小限制 1MB（用户多了会超过）
- ❌ 每次读取都要加载整个文档（性能差）
- ❌ 不能独立设置权限
- ❌ 不支持复杂查询
- ❌ 并发更新容易冲突

### 目标架构（子集合）

```
organizations (collection)
└─ {orgId} (document)
   └─ events (subcollection) ✅
      └─ {eventId} (document)
         └─ users (subcollection) ✅
            └─ {userId} (document)
```

**优点：**
- ✅ 无大小限制
- ✅ 性能好
- ✅ 可独立设置权限
- ✅ 支持复杂查询

---

## 📊 影响范围分析

### 需要更新的代码文件

| 文件路径 | 说明 | 影响 |
|---------|------|------|
| `src/views/platform/PlatformDashboard.jsx` | Platform Admin 加载组织和活动 | 🟡 中度 |
| `src/views/eventManager/EventManagerLogin.jsx` | Event Manager 登录查询 | 🟢 轻微 |
| `src/views/eventManager/EventManagerDashboard.jsx` | Event Manager 加载活动数据 | 🟡 中度 |
| `functions/admin.js` - `createEventManager` | 创建 Event Manager | 🟢 轻微 |
| `functions/admin.js` - `loginEventManagerHttp` | Event Manager 登录验证 | 🟡 中度 |
| 其他已开发的页面 | 需要逐一检查 | ❓ 待确认 |

---

## 🗂️ 当前数据结构示例

**实际 Firestore 数据：**

```json
{
  "organizations": {
    "fYqHtUWjh58NVJJsCMan": {
      "orgCode": "xhessbn",
      "orgName": {
        "zh-CN": "芙蓉新华小学",
        "en": "Xin Hua Element School"
      },
      "events": {
        "zcaWnsF3zTNeqZ738x2V": {
          "eventCode": "2025",
          "eventName": {...},
          "users": {
            "phone_60123456789": {
              "roles": ["event_manager"],
              ...
            },
            "usr_4d711157-ff50-4fe7-bbcf-0a6b26a7b815": {
              "roles": ["event_manager"],
              ...
            }
          }
        }
      }
    }
  }
}
```

---

## 🚀 迁移步骤

### 步骤 1：准备工作

**1.1 下载 Service Account Key**

1. 打开 Firebase Console: https://console.firebase.google.com
2. 选择项目：`mybazaar-c4881`
3. 项目设置 → 服务账号
4. 点击"生成新的私钥"
5. 下载 JSON 文件
6. 重命名为 `serviceAccountKey.json`
7. 放在项目根目录：`C:\mybazaar20\serviceAccountKey.json`

**1.2 添加到 .gitignore**

```bash
# 在 .gitignore 中添加
serviceAccountKey.json
```

**1.3 安装依赖**

```bash
cd C:\mybazaar20
npm install firebase-admin --save-dev
```

---

### 步骤 2：创建迁移脚本

**2.1 创建目录**

```bash
mkdir scripts
```

**2.2 创建文件：`scripts/migrateToSubcollections.js`**

```javascript
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
```

---

### 步骤 3：执行迁移

**3.1 运行迁移脚本**

```bash
cd C:\mybazaar20
node scripts/migrateToSubcollections.js
```

**3.2 预期输出**

```
🚀 开始迁移数据...

📊 找到 2 个组织

============================================================
📁 处理组织: xhessbn (fYqHtUWjh58NVJJsCMan)
============================================================

✨ 发现 1 个嵌套活动需要迁移

  📅 活动: 2025 (zcaWnsF3zTNeqZ738x2V)
     👥 包含 5 个用户
     ✅ 活动文档已创建到子集合
     🔄 开始迁移用户...
        已迁移 5/5 个用户
     ✅ 用户迁移完成

  🗑️  清理嵌套数据...
  ✅ 已删除嵌套 events 字段

============================================================
📁 处理组织: chhsban (VyJ7kgHC70hn7QjmdUPK)
============================================================
  ⏭️  跳过：已经是子集合结构或无活动

============================================================
🎉 数据迁移完成！
============================================================
```

---

### 步骤 4：验证迁移结果

**4.1 在 Firebase Console 检查**

1. 打开 Firestore Database
2. 导航到 `organizations`
3. 选择一个组织文档
4. 检查：
   - ❌ `events` 字段应该**不存在**了
   - ✅ 应该看到 `events` **子集合**图标
5. 点击 `events` 子集合
6. 选择一个活动文档
7. 检查：
   - ❌ `users` 字段应该**不存在**了
   - ✅ 应该看到 `users` **子集合**图标

**4.2 验证数据完整性**

检查每个用户文档是否包含：
- ✅ `roles` 数组
- ✅ `basicInfo` 对象
- ✅ `authUid`
- ✅ 其他必要字段

---

### 步骤 5：更新代码

**需要更新的代码模式：**

**❌ 旧代码（嵌套对象）：**
```javascript
// 读取组织文档，然后访问 events 字段
const orgDoc = await getDoc(doc(db, 'organizations', orgId));
const events = orgDoc.data().events;
const event = events[eventId];
```

**✅ 新代码（子集合）：**
```javascript
// 直接读取活动子集合文档
const eventDoc = await getDoc(
  doc(db, 'organizations', orgId, 'events', eventId)
);
const event = eventDoc.data();
```

---

## 📝 需要更新的具体代码位置

### 1. `PlatformDashboard.jsx`

**位置：** `loadOrganizations` 函数

**旧代码：**
```javascript
const eventsSnapshot = await getDocs(
  collection(db, 'organizations', orgDoc.id, 'events')
);
```

**状态：** ✅ 已经是正确的子集合代码，无需修改

---

### 2. `EventManagerLogin.jsx`

**位置：** `handleSubmit` 函数中的查询逻辑

**检查是否有这样的代码：**
```javascript
const orgDoc = await getDoc(...);
const events = orgDoc.data().events;
```

如果有，需要改为：
```javascript
const eventsSnapshot = await getDocs(
  collection(db, 'organizations', orgId, 'events')
);
```

---

### 3. `EventManagerDashboard.jsx`

**位置：** `loadDashboardData` 函数

**检查活动和用户的读取方式**

应该是：
```javascript
// 加载活动
const eventDoc = await getDoc(
  doc(db, 'organizations', info.organizationId, 'events', info.eventId)
);

// 加载用户
const usersSnapshot = await getDocs(
  collection(db, 'organizations', info.organizationId, 'events', info.eventId, 'users')
);
```

---

### 4. `functions/admin.js`

**检查所有 Cloud Functions 中的数据库操作**

**位置列表：**
- `createEventManager` - 创建用户到子集合
- `loginEventManagerHttp` - 查询用户
- 其他所有操作 events 或 users 的函数

**确保使用子集合路径：**
```javascript
// 正确的子集合路径
getDb().collection('organizations')
  .doc(orgId)
  .collection('events')
  .doc(eventId)
  .collection('users')
  .doc(userId)
```

---

## ⚠️ 注意事项

### 1. 备份数据

**迁移前务必备份！**

```bash
# 导出 Firestore 数据
firebase firestore:export backup-2025-01-16
```

### 2. 在测试环境先执行

如果有测试环境，先在测试环境执行迁移。

### 3. 选择低峰期

在用户较少的时间执行迁移。

### 4. 逐步验证

每迁移一个组织就验证一次。

### 5. 回滚计划

如果出问题，可以：
- 恢复备份数据
- 或手动将数据改回嵌套结构

---

## 🔍 迁移后的检查清单

| 检查项 | 状态 |
|--------|------|
| ✅ 组织文档不再有 `events` 字段 | ⬜ |
| ✅ 可以看到 `events` 子集合 | ⬜ |
| ✅ 活动文档不再有 `users` 字段 | ⬜ |
| ✅ 可以看到 `users` 子集合 | ⬜ |
| ✅ 用户数据完整 | ⬜ |
| ✅ Event Manager 可以登录 | ⬜ |
| ✅ Dashboard 数据显示正常 | ⬜ |
| ✅ Platform Dashboard 正常 | ⬜ |
| ✅ 无控制台错误 | ⬜ |

---

## 🆘 故障排除

### 问题 1：迁移脚本报错

**错误：** `Cannot find module '../serviceAccountKey.json'`

**解决：**
- 确认 `serviceAccountKey.json` 在项目根目录
- 检查文件名是否正确

---

### 问题 2：权限错误

**错误：** `Missing or insufficient permissions`

**解决：**
- Service Account Key 必须有完整权限
- 在 Firebase Console 重新下载

---

### 问题 3：迁移后代码报错

**错误：** `Cannot read property of undefined`

**解决：**
- 检查代码是否还在使用旧的嵌套对象方式
- 按照"步骤 5"更新所有代码

---

## 📞 联系信息

**如果遇到问题：**
1. 检查迁移脚本的输出日志
2. 在 Firebase Console 验证数据结构
3. 在新对话中提供：
   - 错误信息截图
   - 迁移脚本输出
   - 具体哪个步骤出错

---

## ✅ 完成标准

**迁移成功的标志：**
1. ✅ 迁移脚本执行成功（无错误）
2. ✅ Firebase Console 显示子集合结构
3. ✅ Event Manager 可以正常登录
4. ✅ Dashboard 数据正常显示
5. ✅ Platform Dashboard 正常运行
6. ✅ 所有现有功能都正常

---

## 🎯 迁移完成后

**回到主线继续：**
1. ✅ 完成方案 B（整理现有代码）
2. ✅ 创建 Seller Manager 功能
3. ✅ 创建 Merchant Manager 功能
4. ✅ 创建 Customer Manager 功能
5. ✅ 完成阶段三

---

## 📦 附件清单

**随此文档提供：**
1. ✅ 迁移脚本 `migrateToSubcollections.js`
2. ✅ 数据结构对比图
3. ✅ 代码更新指南
4. ✅ 故障排除指南

---

**祝迁移顺利！完成后我们继续阶段三的开发。** 🚀

---

**创建日期：** 2025-01-16  
**项目：** MyBazaar Platform  
**任务：** Firestore 数据迁移到子集合架构