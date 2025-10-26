# admin.js 修改指南（简化版）

## 📍 修改 1: createEventManager 函数

**位置：** 第 105-116 行附近

**找到这段代码：**
```javascript
// Locate event
const orgRef = getDb().collection('organizations').doc(organizationId);
const eventRef = orgRef.collection('events').doc(eventId);
const eventSnap = await eventRef.get();
if (!eventSnap.exists) {
  throw new functions.https.HttpsError('not-found', '活动不存在');
}
const eventData = eventSnap.data() || {};
if (eventData.eventManager) {
  throw new functions.https.HttpsError('already-exists', '此活动已指派 Event Manager');
}
```

**在第 106 行后面插入这些代码：**
```javascript
const orgSnap = await orgRef.get();
if (!orgSnap.exists) {
  throw new functions.https.HttpsError('not-found', '组织不存在');
}

const orgData = orgSnap.data();

// 验证 identityTag
const identityTags = orgData.identityTags || [];
const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
if (!validTag) {
  throw new functions.https.HttpsError(
    'invalid-argument', 
    `身份标签 "${identityTag}" 不存在或已停用`
  );
}
```

**完整修改后应该是：**
```javascript
// Locate event
const orgRef = getDb().collection('organizations').doc(organizationId);
const orgSnap = await orgRef.get();
if (!orgSnap.exists) {
  throw new functions.https.HttpsError('not-found', '组织不存在');
}

const orgData = orgSnap.data();

// 验证 identityTag
const identityTags = orgData.identityTags || [];
const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
if (!validTag) {
  throw new functions.https.HttpsError(
    'invalid-argument', 
    `身份标签 "${identityTag}" 不存在或已停用`
  );
}

const eventRef = orgRef.collection('events').doc(eventId);
const eventSnap = await eventRef.get();
if (!eventSnap.exists) {
  throw new functions.https.HttpsError('not-found', '活动不存在');
}
const eventData = eventSnap.data() || {};
if (eventData.eventManager) {
  throw new functions.https.HttpsError('already-exists', '此活动已指派 Event Manager');
}
```

---

## 📍 修改 2: createUserByEventManagerHttp 函数

**位置：** 第 1902-1927 行附近

**找到并删除这段代码（第 1902-1908 行）：**
```javascript
// 验证身份标签
const validIdentityTags = ['staff', 'teacher', 'student', 'parent'];
if (!validIdentityTags.includes(identityTag)) {
  res.status(400).json({ error: '身份标签无效' });
  return;
}
```

**然后找到这段代码（第 1909-1926 行）：**
```javascript
// 1. 验证组织和活动是否存在
const orgDoc = await getDb().collection('organizations').doc(organizationId).get();
if (!orgDoc.exists) {
  res.status(404).json({ error: '组织不存在' });
  return;
}

const eventDoc = await getDb()
  .collection('organizations')
  .doc(organizationId)
  .collection('events')
  .doc(eventId)
  .get();

if (!eventDoc.exists) {
  res.status(404).json({ error: '活动不存在' });
  return;
}
```

**替换为：**
```javascript
// 1. 验证组织和活动是否存在
const orgDoc = await getDb().collection('organizations').doc(organizationId).get();
if (!orgDoc.exists) {
  res.status(404).json({ error: '组织不存在' });
  return;
}

// 验证身份标签（从 Organization 动态读取）
const orgData = orgDoc.data();
const identityTags = orgData.identityTags || [];
const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
if (!validTag) {
  res.status(400).json({ 
    error: `身份标签 "${identityTag}" 不存在或已停用` 
  });
  return;
}

const eventDoc = await getDb()
  .collection('organizations')
  .doc(organizationId)
  .collection('events')
  .doc(eventId)
  .get();

if (!eventDoc.exists) {
  res.status(404).json({ error: '活动不存在' });
  return;
}
```

---

## 📍 修改 3: identityInfo 构建

**位置：** 第 1971-1998 行附近

**找到这整段 switch 代码：**
```javascript
// 6. 构建 identityInfo
let identityInfo = {};

switch (identityTag) {
  case 'staff':
    identityInfo = {
      staffId: `STF${Date.now()}`,
      department: department || '未分配'
    };
    break;
  case 'teacher':
    identityInfo = {
      teacherId: `TCH${Date.now()}`,
      department: department || '未分配'
    };
    break;
  case 'student':
    identityInfo = {
      studentId: `STU${Date.now()}`,
      grade: department || '未分配'
    };
    break;
  case 'parent':
    identityInfo = {
      parentId: `PAR${Date.now()}`
    };
    break;
}
```

**替换为：**
```javascript
// 6. 构建 identityInfo（通用方式）
const identityInfo = {
  identityId: `${identityTag.toUpperCase()}_${Date.now()}`,
  identityName: validTag.name['zh-CN'],
  identityNameEn: validTag.name['en'],
  department: department || '未分配'
};
```

---

## ✅ 完成后

1. 保存 admin.js
2. 部署 Cloud Functions:
   ```bash
   cd functions
   firebase deploy --only functions
   ```

3. 测试功能

---

## 🔍 如何验证修改成功

在 Cloud Functions 日志中，如果看到这样的错误信息就说明修改成功了：
```
身份标签 "xxx" 不存在或已停用
```

而不是：
```
身份标签无效
```
