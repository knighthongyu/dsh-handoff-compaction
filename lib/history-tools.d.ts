import z from "@deepseek-ai/schemastery";
/**
* Model-facing, workspace-authorized session-history search and read tools.
*
* @module @deepseek-ai/dsh-tool-session-query
*/
/** Cordis plugin name used by Loader diagnostics. */
declare const name = "tool-session-query";
/** Capability services required by the model-facing consumer. */
declare const inject: string[];
/** Default maximum number of authorized search hits returned by one call. */
declare const DEFAULT_MAX_SEARCH_RESULTS = 100;
/** Default cooperative deadline for either full-text search tool. */
declare const DEFAULT_SEARCH_TIMEOUT_MS = 30000;
/** Schemastery config for Loader defaults and generated configuration docs. */
declare const Config: z<Schemastery.ObjectS<NoInfer<{
    maxSearchResults: z<number, number, "defined">;
    searchTimeoutMs: z<number, number, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    maxSearchResults: z<number, number, "defined">;
    searchTimeoutMs: z<number, number, "defined">;
}>>, "plain">;
/** Register all five tools and their shared model guidance. */
declare function apply(ctx: any, config: any): void;
export { Config, DEFAULT_MAX_SEARCH_RESULTS, DEFAULT_SEARCH_TIMEOUT_MS, apply, inject, name };
//# sourceMappingURL=history-tools.d.ts.map