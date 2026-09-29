# Local DSH 0.1.7-rc.2 compatibility copies

The two linked packages below and the `dsh-sidenote` icon patch are **local Web-profile overrides**, not part of the published `dsh-handoff-compaction` npm package. They pin the upstream code that was installed on 2026-09-28 and keep changes reviewable in this repository.

| Package | Upstream baseline | Local change |
| --- | --- | --- |
| `dsh-at-file` | `omdsh-dev/dsh-at-file` commit `da602d1a8f1b417b8a1d8d4059e0f4cb1c353524` (0.7.0) | Migrate legacy `settings.register/get` to volatile Loader `Config` and `settings.update`; migrate strict Typert codec `schema` fields to `create()` factories. |
| `dsh-schedule-panel` | A local, unpublished 0.1.0 source checkout | Use Loader entry config for task defaults instead of the removed settings namespace API. The custom HTTP-backed task card remains intact. |
| `dsh-sidenote` | npm 0.4.4, patched in the active Web profile | Replace 23 removed fixed-size DSH icon exports with their `Regular` counterparts, restoring native right-sidebar guide rendering. |

The active profile uses `link:` dependencies pointing to these directories. `compat/dsh-at-file/lib/index.js` is an upstream bundle with a small compatibility edit; its copied source map describes the upstream version, not this edit. `compat/dsh-schedule-panel/src/index.ts` is the maintained source and `lib/` is rebuilt output. Neither `node_modules` symlink is committed.

The active local checkout has untracked `node_modules` symlinks for dependency resolution. `dsh-at-file` points to the installed DSH runtime dependencies; the schedule-panel build points to its original development dependencies. Recreate these symlinks if moving this checkout to a different machine.

To reapply the overrides after a profile reset:

```sh
COMPAT_ROOT="$(pwd)/compat"
cd ~/.dsh/profiles/web
pnpm add --offline \
  "link:$COMPAT_ROOT/dsh-at-file" \
  "link:$COMPAT_ROOT/dsh-schedule-panel"
```

Rebuild the schedule panel after editing its source with `cd compat/dsh-schedule-panel && ./node_modules/.bin/tsdown`. Then run `pnpm check` at this repository root and restart `dsh web --no-open` to check real plugin activation. Do not run two Web servers on port 3080.

`dsh-sidenote` remains an npm dependency, so reinstalling it can overwrite its icon fix. From this repository root, reapply and verify the local patch with:

```sh
node compat/patch-sidenote-icons.mjs \
  ~/.dsh/profiles/web/node_modules/dsh-sidenote/lib/client.js \
  /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js
node compat/dsh-sidenote-icon-exports.test.mjs \
  ~/.dsh/profiles/web/node_modules/dsh-sidenote/lib/client.js \
  /opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js
```

This is a temporary compatibility layer. Prefer an upstream release once those plugins adopt the new DSH APIs; remove the local links only after verifying the replacements under the same DSH version.
