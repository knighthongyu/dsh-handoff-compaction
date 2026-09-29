window.__ModuleLoader__.load({
	id: "dsh-schedule-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/index.ts
		/** 别名：React.createElement，供下方以 createElement 风格构建元素。 */
		const h = react.createElement;
		const name = "schedule-panel-client";
		/**
		* 本插件在设置页的导航项 id，必须与 Host 侧注册的 settings namespace
		*（`SETTINGS_NAMESPACE = 'dsh-schedule-panel'`）完全一致，卡才能出现在设置页。
		*/
		const ID = "dsh-schedule-panel";
		/** 本客户端模块注入的服务：settings.plugin.item 槽位由 ui-settings-slots 提供。 */
		const inject = ["slots"];
		/** 请求超时（毫秒）。 */
		const FETCH_TIMEOUT_MS = 1e4;
		/** 统一 fetch：超时 + 服务端错误消息透传。 */
		async function fetchJson(input, init) {
			const res = await fetch(input, {
				...init,
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				cache: "no-store"
			});
			let body;
			try {
				body = await res.json();
			} catch {
				body = null;
			}
			return {
				ok: res.ok,
				status: res.status,
				body
			};
		}
		/** 从载荷中取服务端 message；没有则给出带状态码的通用错误。 */
		function serverMessage(payload, status) {
			if (typeof payload === "object" && payload !== null) {
				const message = payload.message;
				if (typeof message === "string" && message !== "") return message;
			}
			return `HTTP ${status}`;
		}
		function formatNextRunAt(ts) {
			if (ts == null) return "—";
			const diff = ts - Date.now();
			if (diff < 6e4) return "即将";
			const minutes = Math.round(diff / 6e4);
			if (minutes < 60) return `约 ${minutes} 分钟后`;
			const hours = Math.floor(minutes / 60);
			if (hours < 24) return `约 ${hours} 小时后`;
			const d = new Date(ts);
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
		}
		function formatLastStatus(task) {
			if (task.running) return "运行中";
			if (task.lastStatus === "error") return `失败：${task.lastError ?? "未知原因"}`;
			if (task.lastStatus === "success") return `成功${task.lastDurationMs ? `（${(task.lastDurationMs / 1e3).toFixed(1)}s）` : ""}`;
			return "未运行";
		}
		/** 由选择的时间（HH:MM）+ 重复频率拼出 5 段 cron（分 时 日 月 周）。
		*  分钟与小时来自选择，日恒为 `*`；周字段按频率取 `*`（每天）/ `1-5`（工作日）/ `0,6`（周末）。
		*/
		function cronFromTime(time, frequency) {
			const [hour, minute] = time.split(":").map((x) => String(Number(x)).padStart(2, "0"));
			let weekday = "*";
			if (frequency === "weekdays") weekday = "1-5";
			else if (frequency === "weekends") weekday = "0,6";
			return `${minute} ${hour} * * ${weekday}`;
		}
		/** 组件样式（内联，使用 DSH 主题变量并带兜底值，避免依赖 CSS Module 注入）。 */
		const styles = {
			card: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-bg-layer-3, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l2, #e6e6e6)",
				borderRadius: "12px",
				marginBottom: "14px"
			},
			head: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "12px",
				width: "100%",
				boxSizing: "border-box",
				textAlign: "left",
				cursor: "pointer",
				background: "transparent",
				border: 0,
				borderRadius: 0,
				padding: "14px 16px",
				color: "inherit",
				font: "inherit"
			},
			headText: {
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				minWidth: 0
			},
			name: {
				color: "var(--dsw-alias-label-primary, #1f2430)",
				fontSize: "15px",
				fontWeight: 600,
				lineHeight: 1.4
			},
			desc: {
				color: "var(--dsw-alias-label-tertiary, #8b909c)",
				fontSize: "13px",
				lineHeight: 1.5
			},
			badge: {
				flex: "none",
				background: "var(--dsw-alias-bg-layer-2, #f2f3f5)",
				color: "var(--dsw-alias-label-secondary, #6b7080)",
				borderRadius: "999px",
				padding: "2px 10px",
				fontSize: "12px",
				fontWeight: 600,
				whiteSpace: "nowrap"
			},
			body: {
				boxSizing: "border-box",
				padding: "4px 16px 16px",
				display: "flex",
				flexDirection: "column",
				gap: "12px"
			},
			okMsg: {
				color: "var(--dsw-alias-state-success-primary, #177e55)",
				background: "var(--dsw-alias-state-success-bg, #eaf5ee)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "6px",
				padding: "6px 10px",
				fontSize: "12px"
			},
			errMsg: {
				color: "var(--dsw-alias-state-error-primary, #d1242b)",
				background: "var(--dsw-alias-state-error-bg, #fdecee)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "6px",
				padding: "6px 10px",
				fontSize: "12px"
			},
			addForm: {
				display: "flex",
				flexDirection: "column",
				gap: "8px"
			},
			row: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			time: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-bg-layer-1, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "6px",
				padding: "6px 8px",
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary, #1f2430)",
				minWidth: "104px"
			},
			frequency: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-bg-layer-1, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "6px",
				padding: "6px 10px",
				fontSize: "13px",
				color: "var(--dsw-alias-label-primary, #1f2430)",
				cursor: "pointer",
				minWidth: "88px"
			},
			list: {
				display: "flex",
				flexDirection: "column",
				gap: "10px"
			},
			empty: {
				color: "var(--dsw-alias-label-secondary, #6b7080)",
				textAlign: "center",
				padding: "18px 0",
				fontSize: "13px"
			},
			task: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-bg-layer-2, #f2f3f5)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "8px",
				padding: "10px 12px",
				display: "flex",
				flexDirection: "column",
				gap: "6px"
			},
			taskHead: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				gap: "8px"
			},
			cron: {
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: "12px",
				fontWeight: 600,
				padding: "2px 6px",
				background: "var(--dsw-alias-bg-layer-1, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "4px",
				color: "var(--dsw-alias-label-primary, #1f2430)"
			},
			status: {
				fontSize: "12px",
				fontWeight: 600,
				whiteSpace: "nowrap",
				color: "var(--dsw-alias-label-secondary, #6b7080)"
			},
			statusRunning: { color: "var(--dsw-alias-state-warn-primary, #b8860b)" },
			taskPrompt: {
				fontSize: "13px",
				lineHeight: 1.5,
				color: "var(--dsw-alias-label-primary, #1f2430)",
				margin: "2px 0",
				wordBreak: "break-word"
			},
			taskDesc: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, #6b7080)"
			},
			taskMeta: {
				display: "flex",
				gap: "8px",
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, #6b7080)"
			},
			actions: {
				display: "flex",
				gap: "8px",
				flexWrap: "wrap"
			},
			smallBtn: {
				fontSize: "12px",
				fontWeight: 600,
				cursor: "pointer",
				background: "transparent",
				border: 0,
				padding: 0,
				color: "var(--dsw-alias-brand-primary, #3366ff)",
				textDecoration: "underline"
			},
			previewWrap: {
				display: "flex",
				flexDirection: "column",
				gap: "4px",
				marginTop: "2px"
			},
			preview: {
				boxSizing: "border-box",
				background: "var(--dsw-alias-bg-layer-1, #ffffff)",
				border: "1px solid var(--dsw-alias-border-l1, #e6e6e6)",
				borderRadius: "6px",
				padding: "8px 10px",
				fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
				fontSize: "12px",
				lineHeight: 1.5,
				whiteSpace: "pre-wrap",
				wordBreak: "break-word",
				maxHeight: "240px",
				overflowY: "auto"
			},
			previewHint: { color: "var(--dsw-alias-label-secondary, #6b7080)" }
		};
		/** 定时任务页签：作为设置页插件卡（`<li className="lc-settings-card">`）渲染。
		* 顶部为标题/描述头，下方为「添加任务」表单与任务列表；运行中的任务可展开实时预览其会话文本。 */
		function SchedulePanel(_props) {
			const [tasks, setTasks] = (0, react.useState)([]);
			const [form, setForm] = (0, react.useState)({
				time: "09:00",
				frequency: "daily",
				cron: cronFromTime("09:00", "daily"),
				prompt: "",
				description: ""
			});
			const [message, setMessage] = (0, react.useState)("");
			const [error, setError] = (0, react.useState)("");
			const [expandedPreview, setExpandedPreview] = (0, react.useState)({});
			const load = (0, react.useCallback)(async () => {
				const result = await fetchJson("/dsh-schedule-panel/tasks");
				if (!result.ok) throw new Error(serverMessage(result.body, result.status));
				const payload = result.body;
				if (payload.ok === false || !Array.isArray(payload.tasks)) throw new Error("获取任务列表失败");
				setTasks(payload.tasks);
			}, []);
			(0, react.useEffect)(() => {
				load();
				const timer = setInterval(() => void load(), 2e3);
				return () => clearInterval(timer);
			}, [load]);
			const notify = (nextMessage, nextError) => {
				setMessage(nextMessage);
				setError(nextError);
				setTimeout(() => {
					setMessage("");
					setError("");
				}, 5e3);
			};
			const commit = async () => {
				setError("");
				const result = await fetchJson("/dsh-schedule-panel/tasks", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						action: "add",
						cron: form.cron,
						prompt: form.prompt,
						...form.description.trim() !== "" ? { description: form.description.trim() } : {}
					})
				});
				if (!result.ok) {
					setError(serverMessage(result.body, result.status));
					return;
				}
				const payload = result.body;
				setTasks(payload.tasks ?? tasks);
				notify(payload.message ?? "已添加", "");
				setForm((f) => ({
					...f,
					prompt: "",
					description: ""
				}));
			};
			const action = async (actionValue, id) => {
				const result = await fetchJson("/dsh-schedule-panel/tasks", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						action: actionValue,
						id
					})
				});
				if (!result.ok) {
					setError(serverMessage(result.body, result.status));
					return;
				}
				const payload = result.body;
				setTasks(payload.tasks ?? tasks);
				notify(payload.message ?? "", "");
				load();
			};
			const togglePreview = (id) => setExpandedPreview((prev) => ({
				...prev,
				[id]: !prev[id]
			}));
			const runningCount = tasks.filter((t) => t.running).length;
			return h("li", {
				className: "lc-settings-card lc-settings-open",
				role: "region",
				"aria-label": "定时任务",
				style: styles.card
			}, [h("button", {
				type: "button",
				className: "lc-settings-head",
				style: styles.head,
				onClick: () => void load()
			}, [h("div", { style: styles.headText }, [h("span", { style: styles.name }, "定时任务"), h("span", { style: styles.desc }, "选择触发时间，派发多个后台 Agent 任务，并实时查看结果")]), h("span", { style: styles.badge }, runningCount > 0 ? `${runningCount} 运行中` : null)]), h("div", { style: styles.body }, [
				message ? h("div", {
					className: "lc-schedule-msg lc-schedule-msg--ok",
					role: "status",
					style: styles.okMsg
				}, message) : null,
				error ? h("div", {
					className: "lc-schedule-msg lc-schedule-msg--error",
					role: "status",
					style: styles.errMsg
				}, error) : null,
				h("div", {
					className: "lc-schedule-add",
					style: styles.addForm
				}, [
					h("div", {
						className: "lc-schedule-time-row",
						style: styles.row
					}, [
						h("input", {
							className: "lc-schedule-time",
							type: "time",
							value: form.time,
							onChange: (e) => setForm((f) => ({
								...f,
								time: e.target.value,
								cron: cronFromTime(e.target.value, f.frequency)
							}))
						}),
						h("select", {
							className: "lc-schedule-frequency",
							value: form.frequency,
							onChange: (e) => setForm((f) => ({
								...f,
								frequency: e.target.value,
								cron: cronFromTime(f.time, e.target.value)
							}))
						}, [
							h("option", { value: "daily" }, "每天"),
							h("option", { value: "weekdays" }, "工作日"),
							h("option", { value: "weekends" }, "周末")
						]),
						h("button", {
							type: "button",
							className: "lc-schedule-add-btn",
							onClick: commit,
							disabled: form.prompt.trim() === ""
						}, "添加任务")
					]),
					h("input", {
						className: "lc-schedule-desc",
						placeholder: "备注（可选）",
						value: form.description,
						onChange: (e) => setForm((f) => ({
							...f,
							description: e.target.value
						}))
					}),
					h("textarea", {
						className: "lc-schedule-prompt",
						placeholder: "任务内容：到点交给 Agent 执行的工作，如“总结昨天的进展”",
						rows: 3,
						value: form.prompt,
						onChange: (e) => setForm((f) => ({
							...f,
							prompt: e.target.value
						}))
					})
				]),
				h("div", {
					className: "lc-schedule-list",
					style: styles.list
				}, tasks.length === 0 ? h("div", {
					className: "lc-schedule-empty",
					style: styles.empty
				}, "暂无定时任务，用上方表单添加一个。") : tasks.map((task) => h("div", {
					className: "lc-schedule-task",
					key: task.id,
					style: styles.task
				}, [
					h("div", {
						className: "lc-schedule-task-head",
						style: styles.taskHead
					}, [h("span", {
						className: "lc-schedule-cron",
						style: styles.cron
					}, task.cron), h("span", {
						className: "lc-schedule-status" + (task.running ? " running" : task.lastStatus === "error" ? " failed" : task.lastStatus === "success" ? " ok" : ""),
						style: {
							...styles.status,
							...task.running ? styles.statusRunning : {}
						}
					}, formatLastStatus(task))]),
					h("div", {
						className: "lc-schedule-task-prompt",
						style: styles.taskPrompt
					}, task.prompt),
					task.description ? h("div", {
						className: "lc-schedule-task-desc",
						style: styles.taskDesc
					}, task.description) : null,
					h("div", {
						className: "lc-schedule-task-meta",
						style: styles.taskMeta
					}, [h("span", null, `下次：${formatNextRunAt(task.nextRunAt)}`), task.runCount > 0 ? h("span", { className: "lc-schedule-count" }, `  已运行 ${task.runCount} 次${task.failCount > 0 ? ` / 失败 ${task.failCount}` : ""}`) : null]),
					task.running && h("div", {
						className: "lc-schedule-preview",
						style: styles.previewWrap
					}, [h("button", {
						type: "button",
						className: "lc-schedule-preview-toggle",
						style: styles.smallBtn,
						onClick: () => togglePreview(task.id)
					}, expandedPreview[task.id] ? "隐藏预览" : "显示预览"), (expandedPreview[task.id] || Boolean(task.preview)) && h("div", {
						className: "lc-schedule-preview-text",
						style: styles.preview
					}, task.preview && task.preview.length > 0 ? task.preview : h("span", { style: styles.previewHint }, "执行中…"))]),
					h("div", {
						className: "lc-schedule-actions",
						style: styles.actions
					}, [
						h("button", {
							type: "button",
							className: "lc-schedule-btn",
							onClick: () => action(task.enabled ? "pause" : "resume", task.id)
						}, task.enabled ? "暂停" : "恢复"),
						h("button", {
							type: "button",
							className: "lc-schedule-btn",
							onClick: () => action("run", task.id)
						}, "立即运行"),
						h("button", {
							type: "button",
							className: "lc-schedule-btn lc-schedule-btn--danger",
							onClick: () => action("remove", task.id)
						}, "删除")
					])
				])))
			])]);
		}
		/**
		* 设置页注册：在「插件」分区向 `settings.plugin.item` 注册本卡，
		* `key` 必须等于 Host 侧注册的 settings namespace（`ID`）。
		*
		* 运行时 `ConfigurablePluginsTabController` 取“Host 已服务的命名空间”与
		* “本卡登记的 `key`”的交集来决定展示哪些卡——因此这里的 `key` 与 Host 的
		* `SETTINGS_NAMESPACE` 配对，卡就出现在设置页，无需绑定 settingsScope。
		*/
		function apply(ctx) {
			ctx.slots.inject("settings.plugin.item", () => {
				return ctx.slots.register({
					name: "settings.plugin.item",
					key: ID
				}, (props) => h(SchedulePanel, props));
			});
		}
		//#endregion
		exports.ID = ID;
		exports.apply = apply;
		exports.cronFromTime = cronFromTime;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map