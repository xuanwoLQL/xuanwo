---
id: ipc-security
name: 鸿蒙 IPC 通信安全分析
description: OpenHarmony IPC/Binder、Ability、RPC 通信机制的安全分析方法
tools: [grep, read]
---

# 鸿蒙 IPC 通信安全分析

OpenHarmony IPC（进程间通信）包括 IPC/Binder、Ability 调用、RPC、事件订阅等。

## 审计步骤
1. 定位 IPC 处理入口（`OnRemoteRequest` / `OnAbilityConnectDone` / RPC stub）
2. 检查入口是否做调用方权限校验
3. 检查跨进程参数（fd、buffer、长度）是否可信
4. 检查 Parcel 反序列化的边界

## 高危模式清单

| 模式 | 危险信号 | 后果 |
|:---|:---|:---|
| 缺权限校验 | `OnRemoteRequest` 无 `CheckCallingPermission` | 越权访问 |
| fd 混淆 | 直接使用对方传入的 fd | 任意文件访问 |
| Parcel 越界 | 反序列化长度与实际不符 | 缓冲区溢出 |
| TOCTOU | 校验与使用之间存在窗口 | 权限绕过 |
| 类型混淆 | 反序列化不校验真实类型 | 内存破坏 |

## 关键检查点
- 搜索: `OnRemoteRequest|CheckCallingPermission|VerifyAccessToken|CheckRemoteToken`
- 对 IPC 入口，确认是否调用权限校验 API
- 跟踪 fd/长度参数是否来自 IPC 消息（不可信边界）
- Parcel 序列化用 `WriteInterfaceToken` 标记，读侧需校验

## 输出格式
每个可疑点输出: `入口函数 file:line + 权限校验缺失? + 参数来源 + 利用条件`
