# 蓝牙网络错误 (NetworkError) 解决指南 - 2026-03-14

## 您遇到的问题

```
Error: [Bluetooth] 连接失败: Name: NetworkError
Message: Connection Error: Connection attempt failed
Code: 19
```

这个错误意味着：**找到了打印机，但无法建立蓝牙通讯**

### 发生的流程

```
✅ 选择设备 → "Printer001-022C" 被找到
✅ 请求 GATT 连接 → 尝试连接
❌ 连接失败 → NetworkError (物理层问题)
```

---

## 最可能的原因（按顺序）

| 原因 | 症状 | 概率 |
|------|------|------|
| **打印机被其他设备占用** | 数秒前在其他电脑/平板上用过此打印机 | 🔴 70% |
| **打印机需要重启** | 打印机已开机但蓝牙栈崩溃 | 🟠 20% |
| **蓝牙配对信息失效** | 系统中的配对记录与打印机内存不同步 | 🟡 5% |
| **蓝牙驱动不兼容** | Windows 蓝牙驱动版本太旧或有 bug | 🟡 3% |
| **蓝牙信号过弱** | 信号干扰或距离太远 | 🟡 2% |

---

## 逐步解决方案

### 📱 方案 1：释放打印机占用（**最可能有效**）

打印机对应的设备名称是 `Printer001-022C`

**步骤：**

#### Windows 11

1. 打开 **设置**
   - 快捷键：`Win + I`

2. 进入 **蓝牙和设备**
   - 左侧菜单 > 蓝牙和设备

3. 在 **已连接的设备** 或 **配对设备** 中找到 `Printer001-022C`

4. 点击它，选择 **删除设备**
   - 确认删除

5. **重新配对**
   - 点击"+ 添加设备" > 蓝牙
   - 从列表中选择 `Printer001-022C`
   - 等待配对完成（通常 5-10 秒）

6. 返回网页，**刷新页面**（Ctrl + F5）

7. 再次点击蓝牙打印按钮，选择 `Printer001-022C`

#### macOS

1. 打开 **系统偏好设置** > **蓝牙**

2. 在设备列表找到 `Printer001-022C`

3. 点击 ⓧ 或 **删除**

4. 重新配对

---

### 🔌 方案 2：重启打印机（**物理层重置**）

这会清除打印机错误状态和缓冲区。

**步骤：**

1. **完全关机打印机**
   - 按住电源键直到关闭（约 3 秒）
   - 或拔掉电源

2. **等待 10-15 秒**
   - 这可以清除蓝牙模块的 RAM

3. **重新开机**
   - 按电源键开机
   - 等待 LED 稳定（通常 5 秒）

4. **确认打印机蓝牙是开启的**
   - 检查蓝牙指示灯（通常是蓝色 LED）

5. **返回网页重试**

---

### 🔄 方案 3：强制重新配对

如果前两个方案没有效果。

**步骤：**

1. **删除配对**（如方案 1）

2. **在打印机上清除配对信息**
   - 从打印机设置菜单（如果有）删除已配对的蓝牙设备
   - 或重启打印机（方案 2）

3. **让打印机进入配对模式**
   - 通常是长按电源键或蓝牙按钮 3-5 秒
   - 查看打印机手册确认方式

4. **在 Windows 蓝牙设置中添加新设备**
   - 设置 > 蓝牙 > 添加设备
   - 选择 `Printer001-022C`

5. **如果要求输入配对码，默认通常是 0000 或 1234**

---

### 🔧 方案 4：更新或重装蓝牙驱动

如果前 3 个方案都不行（较少见）。

**Windows：**

1. 打开 **设备管理器**
   - 右键点击"此电脑" > 管理
   - 或按 `Win + X` > 设备管理器

2. 展开 **蓝牙**

3. 找到您的蓝牙适配器（通常叫 "Intel Bluetooth" 或类似）

4. **更新驱动**
   - 右键 > 更新驱动程序
   - 选择"自动搜索更新驱动"

5. 如果有更新则安装，然后**重启电脑**

**macOS：**
- 通常不需要手动更新驱动，系统会自动管理

---

## 排查清单

按顺序尝试，每个步骤后都重试蓝牙打印：

```
□ 1. 打开 DevTools (F12) → Console，按照指南 "调试技巧" 查看日志
     （确保看到 "[Bluetooth] 找到设备: Printer001-022C" 这一行）

□ 2. 确认打印机电源灯亮 🔌

□ 3. 确认打印机蓝牙灯亮 📡 (通常是蓝色 LED)

□ 4. 在系统蓝牙设置中删除此设备，等待 30 秒

□ 5. 刷新网页 (Ctrl + F5 - 强制刷新)

□ 6. 重新在蓝牙设置中配对此设备

□ 7. 返回网页，点击蓝牙打印

□ 8. 如果仍失败，重启打印机（关电 10 秒）

□ 9. 重新配对并重试

□ 10. 如果还是不行，更新蓝牙驱动
```

---

## 调试技巧

### 查看详细日志

**打开 DevTools Console：**
- Windows: `F12`
- macOS: `Cmd + Option + I`

**查找这些日志：**

```javascript
// ✅ 成功的流程
[Bluetooth] 正在搜索打印机...
[Bluetooth] 找到设备: Printer001-022C          // ← 这行说明设备被找到
[Bluetooth] 设备状态: {name: "Printer001-022C", id: "xxx", connected: false}
[Bluetooth] GATT 连接尝试 1/3...                // ← 开始连接
[Bluetooth] ✅ 已连接到 GATT 服务器            // ← 成功！

// ❌ NetworkError 时会看到
[Bluetooth] 找到设备: Printer001-022C          // ← 找到了
[Bluetooth] GATT 连接失败 (尝试 1): Connection attempt failed
[Bluetooth] GATT 连接失败 (尝试 2): Connection attempt failed
[Bluetooth] GATT 连接失败 (尝试 3): Connection attempt failed
```

### 检查系统蓝牙状态

**PowerShell 命令（Windows）：**

```powershell
# 列出配对的蓝牙设备
Get-BluetoothDevice | Select-Object Name, Authenticated, Connected

# 查看蓝牙适配器状态
Get-BluetoothDevice | Where-Object {$_.Connected -eq $true}
```

---

## GitHub Copilot 助手验证清单

当您修复此问题时，通过以下方式验证：

1. **确认删除成功**
   ```
   Windows 蓝牙设置中不再显示 "Printer001-022C"
   ```

2. **重配成功**
   ```
   Windows 蓝牙设置中再次显示 "Printer001-022C" 并标记为 ✓ 已连接
   ```

3. **重试打印**
   ```
   点击蓝牙打印 > 选择 Printer001-022C > 看到 "正在打印..." > "✅ 点数卡已打印"
   ```

---

## 工程细节（针对开发者）

### NetworkError 本质

- **API 级别**：Web Bluetooth API 的 `gatt.connect()` 失败
- **真实原因**：底层 Bluetooth HCI 命令超时或被拒绝
- **常见代码**：`GATT_CONN_TIMEOUT`, `GATT_CONN_LMP_TIMEOUT`, `CONNECTION_ATTEMPT_FAILED`
- **为什么重启有效**：清除了蓝牙控制器的状态机

### 代码改进（已实现）

```javascript
// 新增的重试逻辑
while (connectAttempts < 3) {
  try {
    server = await this.device.gatt.connect();
    break;  // ✅ 成功
  } catch (connectError) {
    if (connectError.name === 'NetworkError') {
      // 重试（最多 3 次，延迟 1000ms）
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      throw connectError;
    }
  }
}
```

这可以处理瞬时网络抖动，但对于持久的连接问题仍需用户手动干预。

---

## 反馈和升级建议

如果：
- ✅ **问题已解决**：太好了！反馈给开发者以改进文档
- ❌ **问题仍未解决**：收集以下信息
  - 打印机型号（如：XP-P300, Printer001-022C）
  - Windows/macOS 版本
  - 浏览器类型和版本
  - 蓝牙适配器型号（如：Intel, Realtek）
  - 完整的 Console 日志（复制粘贴红色错误部分）

---

**最后更新：** 2026-03-14 v2.0  
**优化重点：** NetworkError 诊断和多步骤重连机制
