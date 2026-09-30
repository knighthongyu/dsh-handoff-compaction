window.__ModuleLoader__.load({ id: "dsh-handoff-compaction", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.ts
var client_exports = {};
__export(client_exports, {
  BudgetPanel: () => BudgetPanel,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(client_exports);
var import_react = require("react");

// src/budget-form.ts
function readBudgets(value) {
  return { maxTokens: value.maxTokens ?? 8192, retainTokens: value.retainTokens ?? 16e3 };
}
function budgetOperations(summary, recent) {
  const maxTokens = Number(summary);
  const retainTokens = Number(recent);
  if (summary.trim() === "" || recent.trim() === "" || !Number.isSafeInteger(maxTokens) || maxTokens < 1 || !Number.isSafeInteger(retainTokens) || retainTokens < 0) throw new Error("INVALID_BUDGET");
  return [
    { op: "set", path: ["maxTokens"], value: maxTokens },
    { op: "unset", path: ["retainRatio"] },
    { op: "set", path: ["retainTokens"], value: retainTokens }
  ];
}

// src/client.ts
var name = "handoff-budget-settings";
var inject = ["slots", "locale", "configForms"];
var NS = "handoff.budgets";
var zh = {
  title: "\u4E0A\u4E0B\u6587\u538B\u7F29",
  intro: "\u5C06\u8F83\u65E9\u7684\u5BF9\u8BDD\u6574\u7406\u6210\u4EA4\u63A5\u6458\u8981\uFF0C\u4FDD\u7559\u8FD1\u671F\u539F\u6587\u3002\u5B8C\u6574\u5386\u53F2\u4ECD\u53EF\u641C\u7D22\u548C\u8BFB\u53D6\u3002",
  summary: "\u4EA4\u63A5\u6458\u8981\u4E0A\u9650",
  summaryHint: "\u6458\u8981\u6700\u591A\u751F\u6210\u591A\u5C11 token\uFF0C\u5B9E\u9645\u5185\u5BB9\u53EF\u80FD\u66F4\u77ED\u3002\u9ED8\u8BA4 8192\uFF088k\uFF09\u3002",
  recent: "\u6700\u8FD1\u4E0A\u4E0B\u6587\u9884\u7B97",
  recentHint: "\u4FDD\u7559\u8FD1\u671F\u5BF9\u8BDD\u539F\u6587\u7684 token \u9884\u7B97\u3002\u5B8C\u6574\u6D88\u606F\u548C\u5DE5\u5177\u8C03\u7528\u914D\u5BF9\u53EF\u80FD\u4F7F\u5B9E\u9645\u4FDD\u7559\u91CF\u7565\u8D85\u9884\u7B97\u3002\u9ED8\u8BA4 16000\uFF0816k\uFF09\u3002",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  reset: "\u6062\u590D\u9ED8\u8BA4 8k + 16k",
  resetHint: "\u5DF2\u586B\u5165\u9ED8\u8BA4\u503C\uFF0C\u70B9\u51FB\u201C\u4FDD\u5B58\u201D\u751F\u6548\u3002",
  saved: "\u5DF2\u4FDD\u5B58\uFF0C\u540E\u7EED\u538B\u7F29\u4F7F\u7528\u65B0\u9884\u7B97\u3002",
  failed: "\u4FDD\u5B58\u672A\u6210\u529F\uFF0C\u914D\u7F6E\u53EF\u80FD\u5DF2\u88AB\u5176\u4ED6\u9875\u9762\u4FEE\u6539\u3002\u8BF7\u91CD\u65B0\u6253\u5F00\u672C\u9875\u540E\u518D\u8BD5\u3002",
  invalid: "\u6458\u8981\u4E0A\u9650\u987B\u4E3A\u6B63\u6574\u6570\uFF1B\u6700\u8FD1\u4E0A\u4E0B\u6587\u9884\u7B97\u987B\u4E3A\u975E\u8D1F\u6574\u6570\u3002",
  loading: "\u6B63\u5728\u8BFB\u53D6\u914D\u7F6E\u2026",
  unavailable: "\u63D2\u4EF6\u672A\u542F\u7528\uFF0C\u6682\u65F6\u65E0\u6CD5\u8C03\u6574\u9884\u7B97\u3002",
  readOnly: "\u5F53\u524D\u90E8\u7F72\u4E0D\u5141\u8BB8\u4FDD\u5B58\u914D\u7F6E\u3002",
  ratio: "\u5F53\u524D\u4F7F\u7528\u6BD4\u4F8B\u4FDD\u7559\u3002\u4FDD\u5B58\u6B64\u8868\u5355\u4F1A\u6539\u4E3A\u56FA\u5B9A token \u9884\u7B97\u3002",
  note: "\u4E24\u9879\u9884\u7B97\u4E0D\u4EE3\u8868\u6A21\u578B\u7684\u5168\u90E8\u8F93\u5165\u5927\u5C0F\uFF1B\u7CFB\u7EDF\u63D0\u793A\u8BCD\u548C\u5DE5\u5177\u5B9A\u4E49\u4E5F\u4F1A\u5360\u7528\u4E0A\u4E0B\u6587\u3002\u914D\u7F6E\u6587\u4EF6\u4E2D\u7684\u6309\u6A21\u578B\u9884\u7B97\u4F1A\u4F18\u5148\u4E8E\u8FD9\u91CC\u7684\u901A\u7528\u9884\u7B97\u3002"
};
var en = {
  title: "Context compression",
  intro: "Turn older conversations into structured handoffs while keeping recent messages verbatim. Full history remains searchable and readable.",
  summary: "Handoff summary limit",
  summaryHint: "Maximum tokens generated for the summary; the actual summary may be shorter. Default: 8192 (8k).",
  recent: "Recent context budget",
  recentHint: "Token budget for recent verbatim messages. Whole messages and paired tool calls may exceed it. Default: 16000 (16k).",
  save: "Save",
  saving: "Saving\u2026",
  reset: "Restore defaults: 8k + 16k",
  resetHint: "Defaults filled in. Save to apply.",
  saved: "Saved. Future compactions use these budgets.",
  failed: "Save failed or configuration changed elsewhere. Reopen this page and try again.",
  invalid: "The summary limit must be a positive integer; the recent context budget must be a nonnegative integer.",
  loading: "Loading configuration\u2026",
  unavailable: "Enable this plugin to adjust its budgets.",
  readOnly: "This deployment does not allow configuration writes.",
  ratio: "Retention currently uses a ratio. Saving this form switches to a fixed token budget.",
  note: "These budgets exclude system prompts and tool definitions. Model-specific budgets in the configuration file take precedence over these general budgets."
};
function BudgetPanel({ form, t, view }) {
  const state = (0, import_react.useSyncExternalStore)((listener) => form.subscribe(listener), () => form.getSnapshot());
  const [draft, setDraft] = (0, import_react.useState)();
  const [pending, setPending] = (0, import_react.useState)(false);
  const [notice, setNotice] = (0, import_react.useState)();
  const accepted = readBudgets(state.value ?? {});
  const current = draft ?? { summary: String(accepted.maxTokens), recent: String(accepted.retainTokens), revision: state.revision };
  const disabled = pending || state.status !== "ready" || !state.writable;
  let invalid = false;
  try {
    budgetOperations(current.summary, current.recent);
  } catch {
    invalid = true;
  }
  if (view === "summary") return (0, import_react.createElement)("span", null, t("intro"));
  const edit = (field2, text) => {
    setDraft({ ...current, [field2]: text });
    setNotice(void 0);
  };
  const save = async () => {
    if (disabled || invalid) return;
    setPending(true);
    setNotice(void 0);
    try {
      const ok = await form.mutate(budgetOperations(current.summary, current.recent), current.revision);
      if (ok) setDraft(void 0);
      setNotice(ok ? "saved" : "failed");
    } catch {
      setNotice("failed");
    } finally {
      setPending(false);
    }
  };
  const field = (key, min) => (0, import_react.createElement)(
    "div",
    { className: "handoff-budget-field" },
    (0, import_react.createElement)("label", { htmlFor: `handoff-${key}` }, t(key)),
    (0, import_react.createElement)(
      "div",
      { className: "handoff-budget-input" },
      (0, import_react.createElement)("input", {
        id: `handoff-${key}`,
        type: "number",
        min,
        step: 1,
        max: Number.MAX_SAFE_INTEGER,
        value: current[key],
        disabled,
        "aria-describedby": `handoff-${key}-hint`,
        "aria-invalid": invalid,
        onChange: (event) => edit(key, event.currentTarget.value)
      }),
      (0, import_react.createElement)("span", null, "token")
    ),
    (0, import_react.createElement)("p", { id: `handoff-${key}-hint` }, t(key === "summary" ? "summaryHint" : "recentHint"))
  );
  return (0, import_react.createElement)(
    "form",
    { className: "handoff-budgets", onSubmit: (event) => {
      event.preventDefault();
      void save();
    } },
    (0, import_react.createElement)("style", null, CSS),
    (0, import_react.createElement)("p", { className: "handoff-budget-intro" }, t("intro")),
    state.status !== "ready" && (0, import_react.createElement)("p", { role: "status" }, t(state.status === "loading" ? "loading" : "unavailable")),
    state.status === "ready" && !state.writable && (0, import_react.createElement)("p", { role: "status" }, t("readOnly")),
    state.value?.retainRatio !== void 0 && (0, import_react.createElement)("p", { className: "handoff-budget-note" }, t("ratio")),
    (0, import_react.createElement)("div", { className: "handoff-budget-grid" }, field("summary", 1), field("recent", 0)),
    (0, import_react.createElement)("p", { className: "handoff-budget-note" }, t("note")),
    (0, import_react.createElement)(
      "div",
      { className: "handoff-budget-actions" },
      (0, import_react.createElement)("button", { type: "submit", disabled: disabled || invalid || !draft, className: "handoff-budget-save" }, t(pending ? "saving" : "save")),
      (0, import_react.createElement)("button", { type: "button", disabled, onClick: () => {
        setDraft({ summary: "8192", recent: "16000", revision: state.revision });
        setNotice("resetHint");
      } }, t("reset"))
    ),
    (notice || invalid) && (0, import_react.createElement)("p", { role: invalid || notice === "failed" ? "alert" : "status", "aria-live": "polite" }, t(invalid ? "invalid" : notice))
  );
}
var CSS = `.handoff-budgets{max-width:720px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.6}.handoff-budget-intro{margin:0 0 24px;color:var(--dsw-alias-label-secondary)}.handoff-budget-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr));gap:24px}.handoff-budget-field label{display:block;font-weight:500;margin-bottom:8px}.handoff-budget-input{display:flex;align-items:center;gap:12px}.handoff-budget-input input{box-sizing:border-box;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:8px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;padding:8px 12px;font-variant-numeric:tabular-nums}.handoff-budget-input span,.handoff-budget-field p,.handoff-budget-note{color:var(--dsw-alias-label-tertiary);font-size:12px}.handoff-budget-field p{margin:8px 0 0}.handoff-budget-note{margin:20px 0}.handoff-budget-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}.handoff-budget-actions button{border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:8px;background:transparent;color:inherit;font:inherit;padding:7px 14px;cursor:pointer}.handoff-budget-actions .handoff-budget-save{background:var(--dsw-alias-label-primary,#222);color:var(--dsw-alias-label-primary-foreground,#fff)}.handoff-budgets :focus-visible{outline:2px solid var(--dsw-focus-ring-color,#3478f6);outline-offset:3px}.handoff-budgets :disabled{opacity:.5;cursor:default}.handoff-budgets [role=alert]{color:var(--dsw-alias-state-error-primary,#b33)}`;
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));
  const form = ctx.configForms.get("handoff-compaction");
  const register = (slot, key) => ctx.slots.inject(slot, () => ctx.slots.register(
    { name: slot, key, locale: NS },
    (props) => (0, import_react.createElement)(BudgetPanel, { form, t: props.t, view: props.view })
  ));
  ctx.effect(() => register("plugins.bundle.config", "dsh-handoff-compaction"));
  ctx.effect(() => register("plugins.row.config", "dsh-handoff-compaction#handoff-compaction"));
}
return module.exports; } });
//# sourceMappingURL=client.js.map
