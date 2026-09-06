# 数据格式

[English](DATA-FORMAT.md) | [简体中文](DATA-FORMAT.zh-CN.md)

## 最小输入

数组中的每条记录至少需要两个可识别的参与者和一个时间字段：

```json
{ "sender": "a", "recipient": "b", "time": "2025-01-01T10:00:00Z", "content": "hello" }
```

支持的常见别名包括：

- 参与者：`participants`、`members`、`sender`、`from`、`author`、`recipient`、`to`
- 时间：`occurredAt`、`timestamp`、`time`、`date`、`createdAt`、`sentAt`
- 文本：`content`、`text`、`body`、`message`、`transcript`
- 类型：`kind`、`type`、`channel`、`eventType`

## 标准数据集

```ts
type Dataset = {
  id: string
  name: string
  version: 1
  entities: Entity[]
  interactions: Interaction[]
}
```

`Entity.id` 在一个数据集内必须稳定。`Interaction.participants` 引用实体 ID；多人事件可以包含两个以上参与者。`sourceRef.locator` 是调用方定义的原始位置，例如文件行号、邮件 ID 或数据库主键。

`Interaction.actorId` 是可选的明确发起者或作者 ID。如果原始数据没有方向信息，请省略该字段；适配器会标记为“未标注参与者”，不会根据数组顺序猜测作者。

## CSV 和 TSV

首行作为表头，每行转换为一条记录。例如：

```csv
sender,recipient,timestamp,kind,text
alice,bob,2025-01-01T10:00:00Z,message,"Hello, Bob"
```

多人字段可以使用逗号、分号、竖线或换行分隔，例如 `participants="alice;bob;carol"`。只有显式的 `actorId`、`actor`、`sender`、`from` 或 `author` 字段会被当作发起者，参与者数组顺序不用于猜测方向。

## 时间与去重

支持 ISO 8601、Unix 秒和 Unix 毫秒。没有可解析时间的记录会被放在 Unix epoch；生产导入流程应在进入 Agent 前拒绝这类记录。

显式 `id` 用于去重。没有 ID 时，加载器会根据参与者、时间、类型、内容和记录位置生成稳定 ID。

## Provider 输入

自定义 `RelinkDataProvider` 不必构造完整 Dataset，但其分页记录应提供稳定的 `messageKey`、`localId`、`sortSeq`、Unix 秒格式的 `createTime`，以及 `content`、`parsedContent` 和 `rawContent`。完整 Provider 约定见 [SDK](SDK.zh-CN.md#自定义-provider)。
