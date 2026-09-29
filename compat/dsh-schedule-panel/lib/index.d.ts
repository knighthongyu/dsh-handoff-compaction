import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
declare const name = "schedule-panel";
/** 设置页卡片与 Host 命名空间的配对键（浏览器卡片 key 必须等于此值）。 */
declare const SETTINGS_NAMESPACE = "dsh-schedule-panel";
/** 宿主侧注入的服务。 */
declare const inject: string[];
interface Config {
  readonly defaultCwd?: string;
  readonly defaultProvider?: string;
  readonly defaultModel?: string;
  readonly tickSeconds?: number;
  readonly maxRunMs?: number;
}
declare function apply(ctx: Context, config?: Config): void;
//#endregion
export { Config, SETTINGS_NAMESPACE, apply, inject, name };