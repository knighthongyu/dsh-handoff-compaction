import { build } from 'esbuild'

await build({
  entryPoints: ['src/client.ts'], outfile: 'lib/client.js', bundle: true,
  platform: 'browser', format: 'cjs', target: 'es2022', sourcemap: true,
  external: ['react'],
  banner: { js: 'window.__ModuleLoader__.load({ id: "dsh-handoff-compaction", factory: (require) => { var module = { exports: {} }; var exports = module.exports;' },
  footer: { js: 'return module.exports; } });' },
})
