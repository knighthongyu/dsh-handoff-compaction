# DSH Handoff Compaction

[中文说明](README.zh.md)

> Context compression for small-context models: keep the task moving with a configurable token budget and searchable history.

`dsh-handoff-compaction` is a DSH context-compression plugin. It turns older conversation into a structured `# Context Handoff`, keeps recent messages in their original form, and lets the agent search and read the full history when it needs an earlier detail. Small-context models can continue long development and debugging sessions with the task's goals, progress, decisions, constraints, next steps, and verification status at hand.

Set a fixed token budget for the summary and a retention budget for recent messages. The plugin compresses older context automatically near the configured threshold; `/compact` also lets you trigger it manually. It is especially useful for 16K, 32K, or similarly constrained local models after adjusting the budgets to fit their window.

## What you get

The current task stays in context, and older details remain available through history tools:

| What needs to survive | How the plugin preserves it |
| --- | --- |
| Configurable context budgets | `maxTokens` caps the summary output; `retainTokens` sets the recent raw-message retention budget. Adjust both to suit the model's context window. |
| Cache-friendly full-surface compaction | The summary request replays the complete **current conversation surface** with the same system prompt and tools, then appends the handoff instruction. It does not first truncate the prompt to the older portion being summarized. This keeps the existing prefix eligible for reuse by local providers that cannot reuse a shortened prompt; actual cache hits depend on the provider and can be checked through `cacheReadTokens`. |
| Long-term memory without loss | Session events remain append-only. Facts hidden by compaction remain searchable and readable on demand through the official SQLite history tools. |
| Task continuity | `Context Handoff` records what you are doing, what is complete, and what to do next, including exact facts and verification status. |

```text
Long session
  → structured handoff + recent raw tail
  → small-context model continues current work
  → full history is retrieved on demand when an older fact matters
```

The plugin does not enlarge a model's native context window. The budgets control summary output and recent-message retention, rather than an exact total request size: system prompts, tool definitions, complete messages, and tool-call pairing also use space. Leave room for these when configuring a small window.

## DSH compatibility

One plugin package covers all declared DSH versions; users install by package name without choosing a separate plugin build.

| DSH version | Support and verification |
| --- | --- |
| `0.2.0-rc.2` | Supported; installation, Web/headless startup, compaction, and history tools verified in this update. |
| `0.2.0-rc.1` | Supported; verified in the previous release. |
| `0.1.7-rc.2` | Supported; installation, Web/headless startup, and history tools verified in the previous release. |
| Other previously declared DSH 0.1 prereleases | Declared compatible; not individually rerun in this update. |

DSH 0.1 peer range: `^0.1.1-rc.2 || ^0.1.2-rc.1 || ^0.1.5-rc.2 || ^0.1.7-alpha.2`.

Node.js: `^22.19.0 || >=24.0.0`. The list separates declared support from actual verification; future DSH releases will be checked as they arrive.

## Install

Install from npm by package name. The same package is used for every DSH version in the declared compatibility range. For a local checkout or tarball, see [Other package sources](#other-package-sources).

Add the bundle directly to each DSH profile where you want it enabled:

```sh
dsh plugin --profile web add dsh-handoff-compaction
dsh plugin --profile headless add dsh-handoff-compaction
```

After the add command completes, restart that profile normally. The restart only reloads the profile; it is not a separate setup step. No Handoff Preset selection or plugin-specific setup command is required.

### Verify the profile (read-only)

After restarting, use these standard profile-scoped read-only verification commands; this is not a second setup step:

```sh
dsh plugin --profile web list --depth 0
dsh plugin --profile headless list --depth 0
dsh --profile web --dump-config
dsh --profile headless --dump-config
```

The matching `list` output must show `dsh-handoff-compaction` as installed. In each `--dump-config` output, confirm the active `handoff-compaction` entry uses `dsh-handoff-compaction` with the documented defaults and history configuration: `thresholdRatio: 0.8`, `retainTokens: 16000`, and `maxTokens: 8192`. The same dump must show the visible SQLite backend entry `@deepseek-ai/dsh-session-query-sqlite` with `openAt: first-search` and `session-query.sqlite`. The five runtime history tools are bundled in this plugin as an adaptation of `@deepseek-ai/dsh-tool-session-query`, not the visible SQLite backend name to search for in that entry. These commands only inspect the already-installed profile; they do not install, configure, or enable anything.

Installation is a profile-wide replacement. The Bundle patch disables `compaction-basic` and `tool-result-pruner`, keeps `command-compact`, and injects this compactor together with the official SQLite backend at `$DSH_HOME/session-query.sqlite` using `openAt: first-search`.

The approved V1 defaults are:

```yaml
thresholdRatio: 0.8
retainTokens: 16000
maxTokens: 8192
compactionRetries: 1
maxOverflowRetries: 1
auto: true
```

### Other package sources

Every supported package source uses the same `dsh plugin --profile <profile> add <source>` interface. These Web examples show npm, GitHub, a local directory, and a packed tarball; substitute `headless` when installing into that profile:

```sh
dsh plugin --profile web add dsh-handoff-compaction
dsh plugin --profile web add github:knighthongyu/dsh-handoff-compaction
dsh plugin --profile web add ./dsh-handoff-compaction
dsh plugin --profile web add ./dsh-handoff-compaction-0.2.0-rc.2.tgz
```

## Searchable history, not forgotten history

The Bundle injects all five tools adapted from the MIT-licensed official `@deepseek-ai/dsh-tool-session-query` implementation with the compactor:

- `session_search`
- `session_event_search`
- `session_trace`
- `session_event_trace`
- `session_event_read`

There is **no automatic RAG or automatic retrieval**: the agent calls these tools only when prior work is relevant. The official SQLite full-text index is derived lazily in `session-query.sqlite`. Compaction shadows old surface events but does not rewrite them, so `session_event_search` can find a shadowed fact and `session_event_read` can return its exact event. Workspace authorization still applies.

Existing sessions remain append-only. Installing the plugin affects subsequent context selection and compaction; it does not rewrite earlier session events. Their history becomes queryable when the first search opens or updates the index.

## Remove and optional legacy cleanup

Remove package activation with the standard command for each profile:

```sh
dsh plugin --profile web remove dsh-handoff-compaction
dsh plugin --profile headless remove dsh-handoff-compaction
```

Restart each affected profile normally after removal. DSH then returns to the remaining profile Bundle configuration and uses the native compactor when the base profile provides one.

Removal must not delete session logs, `session-query.sqlite`, or user files automatically. They can contain recoverable history or user changes. Review them and make any backup you need before manual deletion.

Optional legacy cleanup applies only if an earlier release created the `handoff-standard`, `handoff-code`, or `handoff-cordis` directories. After confirming they are old generated copies rather than user-owned work, remove them manually. This cleanup is not part of current installation or removal.

## Behavior at failure boundaries

Summary aborts, stream errors, empty replay input, malformed handoff structure, all-`(none)` handoffs, missing working state, image output, and max-token stops fail closed: no invalid replacement summary is committed. When the provider returns invalid Markdown or tool calls, the plugin makes one immediate recovery attempt inside the same compaction transaction with a stronger instruction. Both calls replay the same system prompt, tools, and source-message prefix; on the same provider/model route they also inherit the durable `reasoningEffort`, `temperature`, and `stop` controls so the rendered prompt prefix remains cache-aligned. The summary-specific `maxTokens` cap remains independent, and only the short final recovery instruction changes between attempts. A configured different summary route cannot reuse the conversation route's provider cache and does not inherit its route-specific controls.

Every completed summary logs a content-free diagnostic containing `cacheAlignment`, route, request-control presence, attempt number, and reported token usage including `cacheReadTokens` when the provider exposes it. Validation diagnostics contain the same safe metadata plus the error code; neither log includes conversation or summary text.

After a successful handoff, the recent raw tail remains available, while older raw events stay retrievable from the append-only history. Disabling `tool-result-pruner` is required so tool results are not separately and irreversibly stripped from that history. Installing this fix does not automatically repair a previously committed all-`(none)` checkpoint; recover such a session explicitly from its shadowed events.

## Development

Use pnpm to install dependencies, check types, run tests, and build the precompiled `lib/` output:

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

The npm package is hook-free and ships the prebuilt runtime; installing it does not run lifecycle build or setup scripts.

### Contributor release gate

Maintainers can run the same local release verification used by CI:

```sh
pnpm check
pnpm check:package
pnpm smoke:dsh
pnpm verify:release
```

`check:package` creates a temporary real tarball, prints its filename, SHA-256, and file list, then removes it. `verify:release` combines the typecheck/build/test, archive audit, and isolated Web/headless smoke gates. These are contributor checks only; normal users still install with the standard single `dsh plugin --profile <profile> add <source>` command above.
