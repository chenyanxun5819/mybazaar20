# Identity Tags 动态化 - 完整修改指南

## 📋 概述

将硬编码的身份标签（staff, student, teacher）改为由 Platform Admin 在 Organization 级别动态设置。

---

## ✅ 已完成的修改

### 前端文件（3个）

1. **PlatformDashboard.jsx** ✅
   - 添加 "🏷️ 身份标签" 按钮
   - 显示身份标签预览
   - EditIdentityTagsModal 组件（编辑、添加、删除、排序）
   - 创建新组织时自动添加默认标签

2. **AssignEventManager.jsx** ✅
   - 从 Organization 动态读取 identityTags
   - 移除硬编码选项

3. **AddUser.jsx** ✅
   - 从 Firestore 加载 Organization 的 identityTags
   - 动态生成下拉选项

---

## 🔧 后端修改（需要你手动修改）

### 1. admin.js

#### 修改 1.1: createEventManager 函数（约第 105-116 行）

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

**替换为：**
```javascript
    // Locate organization and event
    const orgRef = getDb().collection('organizations').doc(organizationId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) {
      throw new functions.https.HttpsError('not-found', '组织不存在');
    }
    
    const orgData = orgSnap.data();
    
    // ✨ 验证 identityTag 是否存在于组织的 identityTags 中
    const identityTags = orgData.identityTags || [];
    const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
    if (!validTag) {
      throw new functions.https.HttpsError(
        'invalid-argument', 
        `身份标签 "${identityTag}" 不存在或已停用，请在组织设置中检查可用的身份标签`
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

#### 修改 1.2: createUserByEventManagerHttp 函数（约第 1902-1908 行）

**找到并删除这段硬编码验证：**
```javascript
    // 验证身份标签
    const validIdentityTags = ['staff', 'teacher', 'student', 'parent'];
    if (!validIdentityTags.includes(identityTag)) {
      res.status(400).json({ error: '身份标签无效' });
      return;
    }
```

**替换为动态验证（插入到第 1909 行之前）：**
```javascript
    // 1. 验证组织和活动是否存在
    const orgDoc = await getDb().collection('organizations').doc(organizationId).get();
    if (!orgDoc.exists) {
      res.status(404).json({ error: '组织不存在' });
      return;
    }

    // ✨ 验证身份标签（从 Organization 动态读取）
    const orgData = orgDoc.data();
    const identityTags = orgData.identityTags || [];
    const validTag = identityTags.find(tag => tag.id === identityTag && tag.isActive);
    if (!validTag) {
      res.status(400).json({ 
        error: `身份标签 "${identityTag}" 不存在或已停用，请在组织设置中检查可用的身份标签` 
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

**注意：** 原代码在第 1909-1926 行有重复的组织和活动验证，需要删除：
```javascript
    // 删除这段重复代码（第 1909-1926 行）
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

---

#### 修改 1.3: createUserByEventManagerHttp 中的 identityInfo 构建（约第 1971-1998 行）

**找到这段 switch 代码：**
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

**替换为通用方式：**
```javascript
    // 6. 构建 identityInfo（通用方式，支持任意身份标签）
    const identityInfo = {
      identityId: `${identityTag.toUpperCase()}_${Date.now()}`,
      identityName: validTag.name['zh-CN'],
      identityNameEn: validTag.name['en'],
      department: department || '未分配'
    };
```

---

## 🗄️ Firestore 数据迁移

### 运行迁移脚本

已经提供了迁移脚本在你的 Cloud Functions 中。

**访问这个 URL 执行迁移（只需执行一次）：**
```
https://us-central1-mybazaar-c4881.cloudfunctions.net/migrateIdentityTags
```

**迁移内容：**
- 为所有现有 Organizations 添加 `identityTags` 字段
- 默认标签：staff（职员）, student（学生）, teacher（教师）

---

## 📦 部署步骤

### 步骤 1: 前端部署

1. 替换这 3 个文件到你的项目：
   - `src/views/platformAdmin/PlatformDashboard.jsx`
   - `src/views/platformAdmin/AssignEventManager.jsx`
   - `src/components/common/AddUser.jsx`

2. 重新构建并部署：
   ```bash
   npm run build
   firebase deploy --only hosting
   ```

### 步骤 2: 后端修改

1. 打开 `functions/admin.js`
2. 按照上面的说明修改 3 个地方
3. 保存文件

### 步骤 3: 部署 Cloud Functions

```bash
cd functions
npm install
firebase deploy --only functions
```

### 步骤 4: 运行数据迁移

访问迁移 URL（只需执行一次）：
```
https://us-central1-mybazaar-c4881.cloudfunctions.net/migrateIdentityTags
```

---

## ✨ 新功能使用方法

### 1. 编辑组织的身份标签

1. 登录 Platform Admin Dashboard
2. 找到要编辑的组织
3. 点击 **🏷️ 身份标签** 按钮
4. 在弹出窗口中：
   - ➕ 点击"添加新标签"
   - ✏️ 编辑中英文名称
   - ▲▼ 调整显示顺序
   - 🗑️ 删除不需要的标签（如果有用户使用会阻止删除）
5. 点击"保存修改"

### 2. 创建 Event Manager

现在创建 Event Manager 时，身份标签下拉框会显示该组织的所有活跃标签。

### 3. 添加用户

Event Manager 在添加用户时，身份标签选项会自动从组织读取。

---

## 🔍 测试清单

- [ ] 前端文件部署成功
- [ ] 后端函数修改完成
- [ ] Cloud Functions 部署成功
- [ ] 运行迁移脚本
- [ ] 在 Firestore 中验证 Organizations 有 `identityTags` 字段
- [ ] 测试编辑身份标签功能
- [ ] 测试创建 Event Manager（选择身份）
- [ ] 测试添加用户（选择身份）
- [ ] 尝试删除有用户使用的标签（应该被阻止）

---

## ⚠️ 注意事项

1. **迁移脚本只运行一次**：不要重复执行
2. **备份数据**：修改前请备份 Firestore 数据
3. **删除保护**：有用户使用的标签无法删除
4. **多语言支持**：所有标签都支持中英文

---

## 🆘 常见问题

### Q: 如果组织没有身份标签会怎样？
A: 创建 Event Manager 和添加用户时会显示警告，并禁用提交按钮。

### Q: 可以修改已有用户的身份标签吗？
A: 目前不支持批量修改，但可以在编辑身份标签时修改名称。

### Q: 删除标签后，已使用该标签的用户怎么办？
A: 系统会阻止删除正在使用的标签，显示有多少用户正在使用。

---

## 📞 联系支持

如有问题，请查看：
- Firestore Console: 验证数据结构
- Cloud Functions Logs: 查看错误日志
- Browser Console: 查看前端错误

---

**最后更新：** 2025-10-25
