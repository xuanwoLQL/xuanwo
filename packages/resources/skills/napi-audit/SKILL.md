---
id: napi-audit
name: NAPI 接口审计指南
description: NAPI（Node-API）接口安全审计方法，覆盖参数校验、内存安全、引用管理、数据流追踪
tools: [grep, read]
vulnerability_type: 缓冲区溢出
taint_sources:
  - "napi_get_cb_info"
  - "napi_get_value_string_utf8"
  - "napi_get_value_array_length"
  - "napi_get_value_int"
dangerous_apis:
  - "memcpy"
  - "strcpy"
  - "strncpy"
  - "sprintf"
  - "snprintf"
  - "memmove"
entry_points:
  - "napi_set_named_property"
  - "napi_create_function"
---

# NAPI 接口审计指南

NAPI 是 OpenHarmony/Node 生态暴露原生能力到 JS 的标准接口，是漏洞高发区。

## 审计步骤
1. 定位所有 `napi_get_cb_info` 调用，检查 `argc` 是否校验
2. 追踪 `napi_get_value_*` 系列调用，检查 bufsize/长度参数
3. 检查 `napi_create_reference` / `napi_ref` 的引用生命周期
4. 检查 `napi_create_async_work` 回调中的对象访问

## 高危模式清单

| 模式 | 危险信号 | 后果 |
|:---|:---|:---|
| argc 未校验 | `napi_get_cb_info` 后直接访问 `argv[i]` | 未初始化读取/UAF |
| bufsize 不匹配 | `napi_get_value_string_utf8` 传 `sizeof(buf)` | 栈/堆溢出 |
| 引用泄漏 | `napi_create_reference` 无对称 delete | 内存耗尽 |
| 回调 UAF | 异步回调访问已释放对象 | UAF |
| 类型未校验 | `napi_get_value_*` 前不检查 `napi_typeof` | 类型混淆 |

## 关键检查点
- 用 grep 搜索: `napi_get_cb_info|napi_get_value|napi_create_reference|napi_create_async_work`
- 对每个 NAPI 入口函数建立调用链，追踪参数来源（JS 侧不可信）
- 参考知识库 Nday 模式中的真实修复 commit

## 输出格式
每个可疑点输出: `file:line + 类型 + 触发路径 + 修复建议`
