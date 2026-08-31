# DSH 结构化交接压缩

`dsh-handoff-compaction` 用结构化的 `# Context Handoff` 替换 DSH 基础上下文摘要，同时复用 DSH 原生压缩事务、`/compact` 命令、重试机制、最近原文尾部和只追加会话日志，并挂载官方持久化历史检索包。

兼容版本：DSH `0.1.1-rc.2`；`@deepseek-ai/dsh-tool-session-query` `0.1.0-rc.8`；Node.js `^22.19.0 || >=24.0.0`。

## 安装

把 Bundle 直接添加到需要启用它的 DSH profile：

```sh
dsh plugin --profile web add dsh-handoff-compaction
dsh plugin --profile headless add dsh-handoff-compaction
```

add 命令完成后，按正常方式重启对应 profile。重启只负责重新载入 profile，不是额外的设置步骤；无需选择 Handoff Preset，也无需运行插件专用设置命令。

### 验证 profile（只读）

重启后可使用以下标准的 profile 范围只读验证命令；这不是第二次设置步骤：

```sh
dsh plugin --profile web list --depth 0
dsh plugin --profile headless list --depth 0
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

对应的 `list` 输出必须显示 `dsh-handoff-compaction` 已安装。每个 `--dump-config` 输出中，确认活动的 `handoff-compaction` 条目使用 `dsh-handoff-compaction`，并保留已记录的默认值和历史配置：`thresholdRatio: 0.8`、`retainTokens: 16000`、`maxTokens: 8192`。同一份 dump 还必须显示可见的 SQLite 后端条目 `@deepseek-ai/dsh-session-query-sqlite`，其中包含 `openAt: first-search` 和 `session-query.sqlite`。`@deepseek-ai/dsh-tool-session-query` 提供五个运行时历史工具，不是用户应在该条目中查找的可见的 SQLite 后端名称。这些命令只检查已经安装的 profile，不会安装、配置或启用任何内容。

安装会替换整个 profile 的压缩配置。Bundle patch 会禁用 `compaction-basic` 和 `tool-result-pruner`，保留 `command-compact`，并同时注入本压缩器与官方 SQLite 后端；数据库位于 `$DSH_HOME/session-query.sqlite`，使用 `openAt: first-search`。

V1 确认的默认值是：

```yaml
thresholdRatio: 0.8
retainTokens: 16000
maxTokens: 8192
compactionRetries: 1
maxOverflowRetries: 1
auto: true
```

### 其他包来源

所有支持的包来源都使用同一个 `dsh plugin --profile <profile> add <source>` 接口。下面以 Web profile 演示 npm、GitHub、本地目录和打包 tarball；安装到 Headless 时把 profile 名替换为 `headless`：

```sh
dsh plugin --profile web add dsh-handoff-compaction
dsh plugin --profile web add github:knighthongyu/dsh-handoff-compaction
dsh plugin --profile web add ./dsh-handoff-compaction
dsh plugin --profile web add ./dsh-handoff-compaction-0.1.0.tgz
```

## 历史检索

Bundle 会把 `@deepseek-ai/dsh-tool-session-query` 的五个官方工具与压缩器一起注入：

- `session_search`
- `session_event_search`
- `session_trace`
- `session_event_trace`
- `session_event_read`

这里是 no automatic RAG / no automatic retrieval：只有代理判断旧工作相关时才调用工具。官方 SQLite 全文索引在第一次搜索时延迟生成到 `session-query.sqlite`。压缩只会让旧事件退出当前上下文表面，不会改写事件；因此 `session_event_search` 仍能找到被压缩遮蔽的事实，`session_event_read` 能返回完整原事件，同时继续执行 workspace 授权隔离。

Existing sessions（已有会话）仍保持只追加。安装插件只影响后续上下文选择和压缩，不会重写历史事件；第一次检索打开或更新索引后即可查询旧记录。

## 移除与可选旧文件清理

使用标准命令从各 profile 移除插件激活：

```sh
dsh plugin --profile web remove dsh-handoff-compaction
dsh plugin --profile headless remove dsh-handoff-compaction
```

移除后，正常重启对应 profile。DSH 随后会回到剩余的 profile Bundle 配置；如果基础 profile 提供了原生压缩器，则恢复使用该压缩器。

移除时 must not delete（绝不能自动删除）会话日志、`session-query.sqlite` 或用户文件；其中可能包含可恢复历史或用户修改。只有在检查内容并完成所需备份后，才可人工删除。

可选的旧文件清理仅适用于旧版本曾创建 `handoff-standard`、`handoff-code` 或 `handoff-cordis` 目录的情况。请先确认它们是旧版生成副本而不是用户自有内容，再手动删除。该清理不属于当前安装或移除流程。

## 失败边界

摘要取消、流错误、空重放输入、Handoff 结构错误、全 `(none)`、缺失可恢复工作状态、图片输出或达到 max-token 都会 fail closed：不提交替换摘要，选中的原始 surface 保持当前状态。当提供方返回无效 Markdown 或 tool calls 时，插件会在同一压缩事务内立即进行一次恢复调用，并使用更强的指令。两次调用重放相同的 system prompt、tools 和源消息前缀，以便利用长前缀缓存；只改变简短的最终恢复指令。若恢复仍失败，选中的原始 surface 继续保持当前状态。校验诊断只包含错误码、源消息数量、模型路由、尝试次数和 token 使用量，不记录对话或摘要正文。

成功交接后仍保留最近原文尾部，较早事件继续存在于只追加历史中。必须禁用 `tool-result-pruner`，避免工具结果被另一条链路单独且不可逆地剥离。安装本修复不会自动修正已经提交的全 `(none)` checkpoint；这类既有会话需要从 shadowed events 显式恢复。

## 开发

使用 pnpm 安装依赖、检查类型、运行测试，并构建预编译的 `lib/` 输出：

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

npm 包不含生命周期 hook，并直接发布预构建运行时；安装包时不会执行构建或设置脚本。

### 贡献者发布门禁

维护者可运行与 CI 相同的本地发布验证：

```sh
pnpm check
pnpm check:package
pnpm smoke:dsh
pnpm verify:release
```

`check:package` 会在临时目录创建真实 tarball，输出文件名、SHA-256 和文件列表，然后清理该文件。`verify:release` 组合类型检查/构建/测试、归档审计与隔离的 Web/headless 冒烟门禁。这些仅是贡献者验证；普通用户仍只需使用上面的标准单条 `dsh plugin --profile <profile> add <source>` 命令安装。
