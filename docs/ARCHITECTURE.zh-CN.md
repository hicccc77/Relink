# 架构

[English](ARCHITECTURE.md) | [简体中文](ARCHITECTURE.zh-CN.md)

## 系统边界

```text
用户数据 / 数据库 / API / 文件 / 事件流
                   |
        RelinkDataProvider
                   |
        RelinkRuntime
          - AgentService 模型主导循环
          - 原始记录读取与游标
          - 时间采样与事件上下文
          - 研究计划、笔记与反馈
          - 媒体复核与记忆事务
          - 提示缓存、重试与上下文压缩
          - 运行快照、日志、恢复与续跑
          - 标题、反馈学习与记忆整理
                   |
          SDK / CLI / HTTP / MCP
                   |
              可选 Skill
```

`src/agent/services/agentModelLedService.ts` 是 Agent 编排核心。它管理模型工具选择、证据工作区、研究状态和恢复策略，并通过 `RelinkDataProvider` 读取数据。

`src/agent/runtime.ts` 是公共运行边界，负责：

- 将 prompt 或 UI messages 转换为 AI SDK 消息；
- 将实体对范围解析为 Provider 的稳定 session；
- 为每次运行建立数据指纹和 `AbortController`；
- 收集 UI message chunks、结构化进度和最终快照；
- 暴露续跑、重放、中止、运行列表、记忆和 Provider 搜索。

SDK、CLI、HTTP API 和 MCP 都调用这个 Runtime，不维护各自的分析流程。

## Provider 合同

Agent 的读取器需要 session 目录、session 详情、分页记录、记录周边、日期统计、批量扫描和文本搜索。媒体、时间线和网页搜索是可选能力；未实现时会返回明确的能力不可用结果。

`DatasetProvider` 将通用 `Dataset` 的参与者集合转换成稳定关系 session，并将 `sourceRef`、互动类型、时间、发起者和媒体元数据保留在记录定位信息中。自定义 Provider 可以连接数据库、搜索索引、对象存储、邮件系统或内部 API。

Provider 由集成方负责授权、租户隔离、分页上限和字段脱敏。Agent 不会绕过 Provider 读取数据。

## 运行生命周期

1. Runtime 建立运行 ID、数据指纹、恢复指纹和快照。
2. Agent 读取目录和范围概览，并根据模型决策加载工具。
3. 模型选择原始记录页、时间线、事件上下文、媒体复核、记忆或网页搜索工具。
4. 每个工具调用、研究页和阶段状态写入运行快照；大参数写入追加日志，以支持意外中止后的恢复。
5. 上下文接近模型窗口时执行压缩，保留研究计划、已确认事实、来源发现和未决问题。
6. Agent 校验并综合最终回答，写入 `finalAnswer` 和研究轨迹，然后发送 `[DONE]`。
7. 网络失败、用户中止或进程退出会保留可审计状态；之后可以通过 `resumeFromRunId` 续跑或通过 `replay` 重放答案。
8. 可选记忆阶段使用同一模型配置提取稳定偏好；该阶段与主回答隔离，失败不会覆盖已完成的运行。

## 隔离与缓存

Provider facade 使用 `AsyncLocalStorage` 保存每次运行的 Provider，避免同一进程中的并行 Runtime 串读数据。持久化目录由 Runtime 的 `dataDir` 决定。

`ownerFingerprint`、`sourceFingerprint` 和自动生成的 `datasetFingerprint` 参与恢复与缓存指纹。多租户集成应按租户隔离 `dataDir`，并设置前两项。原文页只有在调用方提供 `cacheEncryptionSecret` 时才会以 AES-256-GCM 加密后写入磁盘。

## Skill 的职责

Skill 只提供工具选择和结果展示指导。长任务状态、上下文压缩、证据分页、模型协议、重试与恢复都由 Runtime 管理。直接使用 SDK、CLI 或 HTTP 时不需要安装 Skill。
