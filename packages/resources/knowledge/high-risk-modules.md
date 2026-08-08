# OpenHarmony 高风险模块清单

> 基于 Nday 解题日志知识库统计生成（2026-08-08，共 214 条模式）
> 优先级 = 历史漏洞模式数量，供 0day 扫描排序使用

## 高风险模块（Top 12）

| 优先级 | 模块路径 | 模式数 | 主要漏洞类型 |
|:---|:---|:---|:---|
| 1 | arkcompiler/ets_runtime/ecmascript | 50 | 缓冲区溢出、UAF、条件竞争 |
| 2 | arkcompiler/ets_runtime | 21 | UAF、条件竞争、整数溢出 |
| 3 | foundation/filemanagement/storage_service | 19 | TOCTOU、越界读写、权限绕过 |
| 4 | foundation/web/arkweb | 17 | 缓冲区溢出、越界写 |
| 5 | foundation/communication/netmanager_base | 16 | UAF、整数溢出 |
| 6 | base/security/certificate_manager | 12 | 权限绕过、越界读写 |
| 7 | foundation/web/web_webview | 11 | 缓冲区溢出、条件竞争 |
| 8 | foundation/multimedia/audio_framework | 7 | UAF、缓冲区溢出 |
| 9 | foundation/communication/wifi | 7 | 整数溢出 |
| 10 | foundation/multimedia/camera_framework | 6 | UAF、条件竞争 |
| 11 | foundation/multimedia/medical | 3 | UAF |
| 12 | arkcompiler/ets_runtime/process.cpp | 3 | TOCTOU |

## 重点关注漏洞类型（按出现频率）

1. **缓冲区溢出**（104 条）— NAPI/parcel 反序列化、字符串拷贝
2. **条件竞争**（34 条）— TOCTOU、引用计数、异步回调
3. **UAF**（27 条）— 异步释放、回调后访问
4. **权限绕过**（7 条）— IPC 入口缺权限校验
5. **整数溢出**（5 条）— 长度计算、数组索引

## NAPI 接口重点关注

所有通过 NAPI 暴露的 Native 接口均为高风险，重点关注：
- `napi_get_cb_info` 参数校验
- `napi_get_value_string_*` 长度校验
- 跨进程传参的信任边界
