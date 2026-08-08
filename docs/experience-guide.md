# xuanwo 体验指南

> OpenHarmony AI 漏洞挖掘命令行工具 · 版本 0.1.0
> 面向想要快速体验的人群

---

## 一、拿到什么

分发包是 `D:\xuanwo\dist\` 整个文件夹，包含：

```
dist/
├── xuanwo.exe          # 主程序（115MB，无需安装任何东西）
├── resources/          # 智能体、技能、知识库
└── node_modules/       # 凭据存储组件（必需，勿删）
```

**注意**：三个都要带上，`xuanwo.exe` 单独拷走无法运行。

## 二、环境要求

- Windows 10 / 11（其他系统暂未测试）
- 无需安装 Node.js、Python 或任何依赖
- 需要网络（调用 AI 大模型）
- 需要一个 DeepSeek API Key（后面说明）

## 三、三步上手

### 1. 双击或命令行运行

在命令行进入 `dist` 文件夹：

```cmd
cd D:\xuanwo\dist
xuanwo.exe tui
```

> 建议：先把终端代码页设为 UTF-8，否则中文/Logo 可能乱码：
> ```cmd
> chcp 65001
> ```

**推荐用 Windows Terminal**（Win11 自带或商店免费装），体验最佳。

### 2. 首次设置

如果第一次运行，需要完成设置：

```cmd
xuanwo.exe setup
```

按提示操作：
1. 阅读免责声明 → 输入 `YES` 确认
2. 选择 LLM 提供商 → 回车选 `1`（DeepSeek）
3. 输入 API Key（在 https://platform.deepseek.com 注册获取）
4. 默认模型 → 直接回车
5. 授权目录 → 留空回车，或填你要分析的源码路径

> API Key 会安全存入 Windows 凭据管理器，不会出现在配置文件里。

### 3. 开始体验

```cmd
xuanwo.exe tui
```

你会看到：
- 彩虹渐变的 `xuanwo` Logo 启动画面
- 进入对话界面后，底部有三行状态栏
- 直接输入文字即可与 AI 对话

## 四、可以玩什么

### 对话
直接输入任意问题，主控智能体会分析并回答，例如：
```
OpenHarmony 有哪些高危漏洞类型？
```

### 检索知识库
```
/knowledge use-after-free
/knowledge certificate
```
会返回从真实 CTF 解题日志提取的 214 条漏洞模式。

### 分析源码文件
先授权目录，再分析：
```cmd
xuanwo.exe config --authorize D:\某个源码目录
xuanwo.exe analyze D:\某个源码目录\xxx.cpp
```

### 扫描整个源码目录（0day 挖掘）
```cmd
xuanwo.exe scan D:\某个源码目录 --max-files 5
```
主控智能体自动调度子智能体（NAPI 审计 / IPC 分析 / 条件竞争检测）扫描。

### 常用命令
| 命令 | 作用 |
|:---|:---|
| `tui` | 进入交互界面 |
| `agent list` | 查看 5 个智能体 |
| `knowledge --stats` | 知识库统计 |
| `skill list` | 查看 3 个技能 |
| `report` | 查看审计报告 |
| `scan <path>` | 源码扫描 |
| `analyze <file>` | 单文件分析 |

## 五、TUI 快捷键

| 按键 | 功能 |
|:---|:---|
| `Ctrl+P` | 命令面板 |
| `Ctrl+T` | 切换智能体 |
| `PgUp / PgDn` | 滚动消息 |
| `↑ / ↓` | 输入历史 |
| `Ctrl+C` | 退出（需按两次） |

## 六、常见问题

**Q: Logo 显示乱码/方块？**
运行前先 `chcp 65001`，或用 Windows Terminal。

**Q: 报 API Key 无效？**
`xuanwo.exe setup` 重新配置，确认 Key 正确且账户有余额。

**Q: 分析慢？**
调大模型按 token 计费，长分析需要时间，属正常。

**Q: 提示路径未授权？**
`xuanwo.exe config --authorize "你的路径"` 添加授权。

## 七、安全说明

- 本工具**仅用于授权的安全测试与研究**
- 所有 AI 生成的结论需人工复核
- 未授权路径会被拒绝执行，外部工具调用经过白名单校验

---

有问题联系 xuanwo 作者。祝体验愉快！
