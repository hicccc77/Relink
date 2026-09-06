# CLI

[English](CLI.md) | [简体中文](CLI.zh-CN.md)

CLI、SDK、HTTP API 和 MCP 使用同一个 `RelinkRuntime`。以下命令假设已经在项目根目录执行 `npm install` 和 `npm run build`。

## 查看帮助

```bash
npm run cli -- --help
```

安装为依赖或全局命令后，也可以直接运行 `relink --help`。CLI 的默认输出和错误信息使用英文；本文件提供完整中文说明。

## 模型配置

```bash
export RELINK_MODEL_PROTOCOL="openai-compatible"
export RELINK_MODEL_PROVIDER="openai-compatible"
export RELINK_MODEL_BASE_URL="https://api.openai.com/v1"
export RELINK_MODEL_API_KEY="your-key"
export RELINK_MODEL="your-model"
```

`run`、`title`、`memory --action revise|refresh` 和 `feedback --action synthesize` 会调用模型。`import`、`summary`、`search` 和普通 CRUD 不需要模型。

每个模型字段也可以通过 `--protocol`、`--provider`、`--base-url`、`--api-key`、`--model`、`--reasoning-effort`、`--context-window` 和 `--max-output-tokens` 覆盖。

## 导入与检查

原始输入文件使用 `sample.ndjson`，规范化输出统一为 `sample.json`，后续示例都会复用这个文件。

```bash
npm run cli -- import --file sample.ndjson --out sample.json
npm run cli -- summary --file sample.json
npm run cli -- search --file sample.json --text "deadline" --limit 20
```

`import` 接受 JSON、NDJSON、CSV 和 TSV。字段映射见[数据格式](DATA-FORMAT.zh-CN.md)。

## 运行 Agent

```bash
npm run cli -- run \
  --file sample.json \
  --prompt "按时间顺序核验互动变化，引用原始记录并说明不确定性" \
  --mode deep-research \
  --data-dir ./.relink
```

使用 `--entity-a alice --entity-b bob` 可以限定实体对。`--json` 输出 chunks、progress、state 和证据轨迹。回答完成后默认整理稳定记忆；可以用 `--memory-synthesis false` 关闭。

续跑、列出、重放和中止：

```bash
npm run cli -- runs --data-dir ./.relink
npm run cli -- run --file sample.json --prompt "Continue the investigation" --resume-from <runId>
npm run cli -- replay --run-id <runId> --data-dir ./.relink
npm run cli -- abort --run-id <runId> --data-dir ./.relink
```

## 对话管理

```bash
npm run cli -- conversations --action create --title "Project review" --data-dir ./.relink
npm run cli -- conversations --action list --data-dir ./.relink
npm run cli -- conversations --action get --id 1 --data-dir ./.relink
npm run cli -- conversations --action rename --id 1 --title "New title" --data-dir ./.relink
npm run cli -- conversations --action metadata --id 1 --pinned true --data-dir ./.relink
npm run cli -- conversations --action delete --id 1 --data-dir ./.relink
```

复杂创建或保存载荷作为一个 shell 参数传入 JSON：

```bash
npm run cli -- conversations --action create --payload '{"title":"Review","scope":{"kind":"global"}}' --data-dir ./.relink
```

## 记忆管理

```bash
npm run cli -- memory --action create --content "Prefer evidence before conclusions" --category preference --data-dir ./.relink
npm run cli -- memory --action list --data-dir ./.relink
npm run cli -- memory --action get --id <memoryId> --data-dir ./.relink
npm run cli -- memory --action update --id <memoryId> --content "Prefer concise evidence tables" --data-dir ./.relink
npm run cli -- memory --action summary --data-dir ./.relink
npm run cli -- memory --action revise --instruction "Keep only explicit formatting preferences" --data-dir ./.relink
npm run cli -- memory --action refresh --data-dir ./.relink
npm run cli -- memory --action enable --enabled false --data-dir ./.relink
npm run cli -- memory --action clear --disable true --data-dir ./.relink
npm run cli -- memory --action delete --id <memoryId> --data-dir ./.relink
```

`--payload` 可以传入 `scope`、`source`、`confidence`、`expiresAt` 和 `archived` 等字段。

## 标题与反馈

```bash
npm run cli -- title --text "Review changes in project collaboration"
npm run cli -- feedback --action save --message-id answer-1 --run-id <runId> --rating up --reason evidence --data-dir ./.relink
npm run cli -- feedback --action list --data-dir ./.relink
npm run cli -- feedback --action summary --conversation-id 1 --data-dir ./.relink
npm run cli -- feedback --action synthesize --data-dir ./.relink
npm run cli -- feedback --action delete --message-id answer-1 --data-dir ./.relink
```

## 启动 API 与 MCP

```bash
npm run cli -- serve --file sample.json --host 127.0.0.1 --port 8787
npm run cli -- mcp --file sample.json --data-dir ./.relink
```

请求结构分别见 [HTTP API](API.zh-CN.md) 和 [MCP](MCP.zh-CN.md)。CLI 成功时返回适合管道处理的 JSON 或最终回答；参数和运行错误写入 stderr，并设置非零退出码。
