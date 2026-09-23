# DSH Handoff Compaction

[中文说明](README.zh.md)

> Help 16K, 32K, and other small-context local models carry long DSH engineering sessions forward with confidence.

`dsh-handoff-compaction` does not enlarge a model's native context window. Instead, it turns aging conversation into an actionable, structured `# Context Handoff`, keeping the active context within a predictable, configurable budget. It preserves the recent raw working tail and leaves the complete history in a searchable SQLite session record.

It keeps DSH's native compaction transaction, `/compact` command, retries, and append-only session log, then mounts the official persistent history-retrieval package. It is for people running 16K, 32K, or similarly constrained local models who still need to sustain multi-turn development, debugging, and handoffs.

## Why it works for small-context local models

Small-context models do not usually lose capability first—they lose the thread of a long task. A basic summary can reduce a session to free-form prose. This plugin makes the operational facts of the work reviewable and reusable:

| What needs to survive | How the plugin preserves it |
| --- | --- |
| A predictable active context | Older content becomes a structured handoff, while the recent raw tail is retained according to `retainTokens`. The defaults retain `16000` raw tokens and cap the summary at `8192` tokens. |
| Cache-friendly full-surface compaction | The summary request replays the complete **current conversation surface** with the same system prompt and tools, then appends the handoff instruction. It does not first truncate the prompt to the older portion being summarized. This keeps the existing prefix eligible for reuse by local providers that cannot reuse a shortened prompt; actual cache hits depend on the provider and can be checked through `cacheReadTokens`. |
| Long-term memory without loss | Session events remain append-only. Facts hidden by compaction remain searchable and readable on demand through the official SQLite history tools. |
| Engineering continuity | `Context Handoff` carries goals, progress, decisions, constraints, next steps, and verification status—not just a generic narrative summary. |

```text
Long session
  → structured handoff + recent raw tail
  → small-context model continues current work
  → full history is retrieved on demand when an older fact matters
```

This is neither magic context expansion nor automatic RAG. It is a clear strategy for bounding the active context while keeping recoverable history available through tools.

Compatibility: DSH `0.1.1-rc.2`, `0.1.2-rc.1`, `0.1.5-rc.2` (npm `latest` on 2026-09-23), and `0.1.7-alpha.2` (tested alpha); `@deepseek-ai/dsh-tool-session-query` `0.1.0-rc.8`; Node.js `^22.19.0 || >=24.0.0`. These are tested versions, not a promise of compatibility with every future DSH release.

## Install

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

The matching `list` output must show `dsh-handoff-compaction` as installed. In each `--dump-config` output, confirm the active `handoff-compaction` entry uses `dsh-handoff-compaction` with the documented defaults and history configuration: `thresholdRatio: 0.8`, `retainTokens: 16000`, and `maxTokens: 8192`. The same dump must show the visible SQLite backend entry `@deepseek-ai/dsh-session-query-sqlite` with `openAt: first-search` and `session-query.sqlite`. Separately, `@deepseek-ai/dsh-tool-session-query` supplies the five runtime history tools; it is not the visible SQLite backend name to search for in that entry. These commands only inspect the already-installed profile; they do not install, configure, or enable anything.

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
dsh plugin --profile web add ./dsh-handoff-compaction-0.1.4.tgz
```

## Searchable history, not forgotten history

The Bundle injects all five official tools from `@deepseek-ai/dsh-tool-session-query` with the compactor:

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
