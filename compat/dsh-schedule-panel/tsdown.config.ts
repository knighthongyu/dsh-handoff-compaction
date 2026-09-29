import type { UserConfig } from 'tsdown'

/**
 * dsh-schedule-panel 构建产出两个半区：
 *  - lib/index.js   host 半区（Node ESM：cron 定时执行 + /dsh-schedule-panel 命令 + HTTP API）
 *  - lib/client.js  browser 半区（设置页的「定时任务」页签，含实时结果预览）
 *
 * 客户端打包约定与官方 client 打包一致：闭包工厂产物，bundle 调用
 * window.__ModuleLoader__.load({ id, factory })，外部模块经注入的 require 在运行时解析。
 */
const ID = 'dsh-schedule-panel'

/** 浏览器侧外部模块：运行时由 loader 的 require 提供，绝不内联。 */
const PLATFORM_EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-runtime/client',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-client-ui-conversation/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
]

/** host 半区运行时值依赖：安装后自带的 node_modules 提供，不内联。 */
const HOST_RUNTIME_DEPS = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-llm',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-settings',
]

const libConfig: UserConfig = {
  name: ID,
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2022',
  fixedExtension: false,
  dts: true,
  clean: false,
  deps: { neverBundle: HOST_RUNTIME_DEPS },
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: false,
  deps: { neverBundle: PLATFORM_EXTERNALS },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

export default (): UserConfig[] => [libConfig, clientConfig]
