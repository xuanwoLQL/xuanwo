---
id: ohos-taint
name: OpenHarmony 污点源分析
description: OpenHarmony 污点数据源（want 参数、IPC 接收、Ability 启动）到危险 API 的流追踪
tools: [grep, read]
vulnerability_type: 权限绕过
taint_sources:
  - "getStringParam"
  - "getIntParam"
  - "getBooleanParam"
  - "GetStringOption"
  - "GetIntOption"
  - "ReadString"
  - "ReadInt32"
  - "ReadUint32"
  - "ReadBuffer"
  - "OnRemoteRequest"
  - "OnAbilityConnectDone"
  - "GetRawData"
  - "GetDataSize"
  - "router.getParams"
  - "want.parameters"
  - "getParams"
  - "AppStorage.get"
  - "PersistentStorage.get"
dangerous_apis:
  - "memcpy"
  - "strcpy"
  - "sprintf"
  - "CheckPermission"
  - "CheckCallingPermission"
  - "VerifyAccessToken"
  - "napi_get_value_string_utf8"
  - "napi_create_reference"
  - "startAbility"
  - "router.pushUrl"
entry_points:
  - "OnRemoteRequest"
  - "OnAbilityConnectDone"
  - "startAbility"
  - "ConnectAbility"
  - "onCreate"
  - "onNewWant"
---

# OpenHarmony 污点源分析

## 概述

OpenHarmony 中通过 want 参数、IPC 消息、Ability 启动传递的数据均为不可信污点数据，需追踪其流向危险 API。

## 常见风险点

- want 参数解析（getStringParam/getIntParam 等）→ 内存操作/权限判断
- IPC 通信数据接收（ReadString/ReadBuffer）→ memcpy/越界
- Ability 启动参数 → 路径拼接/命令执行
- OnRemoteRequest 入口 → 权限校验缺失

## 安全检查清单

- [ ] 是否验证 want/IPC 数据来源？
- [ ] 是否检查参数类型和长度范围？
- [ ] 危险 API 前是否有长度/权限校验？
- [ ] IPC 入口是否调用权限校验 API？

## 污点流模型

```
污点源(want/parcel/ability参数)
    ↓
数据流(变量传递/函数参数)
    ↓
危险汇点(memcpy/strcpy/权限判断/字符串处理)
```

核心：找到「污点源未经校验到达危险汇点」的路径即候选漏洞。
