import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region src/cron.ts
/** 解析失败的错误类型，便于客户端给出中文提示。 */
var CronParseError = class extends Error {
	fieldIndex;
	constructor(fieldIndex, message) {
		super(message);
		this.fieldIndex = fieldIndex;
		this.name = "CronParseError";
	}
};
const FIELD_NAMES = [
	"分",
	"时",
	"日",
	"月",
	"周"
];
function parseField(raw, min, max, fieldIndex) {
	const field = /* @__PURE__ */ new Set();
	const pushValue = (value) => {
		if (value < min || value > max) throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 越界：期望 ${min}–${max}`);
		field.add(value);
	};
	for (const token of raw.split(",")) {
		const t = token.trim();
		if (t === "") throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段为空`);
		const stepMatch = /^(.*)(?:\/(\d+))?$/.exec(t);
		if (!stepMatch) throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段格式无效：${raw}`);
		const base = stepMatch[1];
		const step = stepMatch[2] !== void 0 ? Number.parseInt(step, 10) : 1;
		if (step <= 0 || !Number.isInteger(step)) throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 步长无效：${raw}`);
		if (base === "*") for (let v = min; v <= max; v += step) pushValue(v);
		else if (/^\d+$/.test(base)) {
			const dashMatch = /^(\d+)-(\d+)$/.exec(base);
			if (dashMatch) {
				const lo = Number.parseInt(dashMatch[1], 10);
				const hi = Number.parseInt(dashMatch[2], 10);
				if (lo > hi) throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 范围起点大于终点：${raw}`);
				for (let v = lo; v <= hi; v += step) pushValue(v);
			} else pushValue(Number.parseInt(base, 10));
		} else throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段格式无效：${raw}`);
	}
	if (field.size === 0) throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段解析结果为空`);
	return field;
}
/** 解析 5 字段 cron 表达式。 */
function parseCron(input) {
	const fields = input.trim().split(/\s+/u).filter((f) => f !== "");
	if (fields.length < 5) throw new CronParseError(0, `cron 需要 5 个字段（分 时 日 月 周），实际 ${fields.length} 个`);
	if (fields.length > 5) throw new CronParseError(0, `cron 字段过多（最多 5 个：分 时 日 月 周），实际 ${fields.length} 个`);
	const [minute, hour, day, month, weekday] = fields;
	return {
		minute: parseField(minute, 0, 59, 0),
		hour: parseField(hour, 0, 23, 1),
		day: parseField(day, 1, 31, 2),
		month: parseField(month, 1, 12, 3),
		weekday: parseField(weekday, 0, 7, 4)
	};
}
/** cronMatches 命中判定：处理「日/周至少满足其一」的经典约定。 */
function cronMatches(schedule, now) {
	const minute = now.getMinutes();
	const hour = now.getHours();
	const day = now.getDate();
	const month = now.getMonth() + 1;
	let weekday = now.getDay();
	const { weekday: cronWeekday } = schedule;
	if (!schedule.minute.has(minute)) return false;
	if (!schedule.hour.has(hour)) return false;
	if (!schedule.month.has(month)) return false;
	if (!schedule.day.has(day)) return false;
	const dayMatch = schedule.day.has(day);
	const weekdayMatch = cronWeekday.has(weekday) || cronWeekday.has(weekday === 0 ? 7 : 0);
	if (schedule.day.size === 1 && cronWeekday.size === 1) return dayMatch && weekdayMatch;
	return dayMatch || weekdayMatch;
}
/** 计算 cron 之后的下一次触发时间（分钟对齐）；若解析的表达式永不命中返回 undefined。 */
function nextRun(schedule, from) {
	let cursor = new Date(from.getTime());
	cursor.setSeconds(0, 0);
	cursor.setMinutes(cursor.getMinutes() + 1);
	const limit = from.getTime() + 316224e5;
	while (cursor.getTime() < limit) {
		const m = cursor.getMinutes();
		const h = cursor.getHours();
		const d = cursor.getDate();
		const mo = cursor.getMonth() + 1;
		let wd = cursor.getDay();
		if (schedule.minute.has(m) && schedule.hour.has(h) && schedule.month.has(mo) && schedule.day.has(d)) {
			const weekdayOk = schedule.weekday.has(wd) || schedule.weekday.has(wd === 0 ? 7 : 0);
			const dayMatch = schedule.day.has(d);
			const weekdayMatch = weekdayOk;
			if (schedule.day.size === 1 && schedule.weekday.size === 1) {
				if (dayMatch && weekdayMatch) return new Date(cursor.getTime());
			} else if (dayMatch || weekdayMatch) return new Date(cursor.getTime());
		}
		cursor.setMinutes(cursor.getMinutes() + 1);
	}
}
//#endregion
//#region src/store.ts
/**
* 定时任务持久化存储 —— 内存镜像 + JSON 落盘（$DSH_HOME/schedule-panel.json）。
*
* 写入串行化：所有写操作排队到首轮文件加载之后执行，避免启动期“未读到旧
* 任务就覆盖写盘”的数据丢失。读/解析失败时以空表继续（损坏文件保留原位以便排查）。
*/
function sanitize(raw) {
	if (!Array.isArray(raw)) return [];
	const tasks = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		if (typeof record.id !== "string" || typeof record.cron !== "string" || typeof record.prompt !== "string") continue;
		const lastStatus = record.lastStatus === "success" || record.lastStatus === "error" ? record.lastStatus : void 0;
		tasks.push({
			id: record.id,
			cron: record.cron,
			prompt: record.prompt,
			...typeof record.description === "string" && record.description !== "" ? { description: record.description } : {},
			...typeof record.cwd === "string" && record.cwd !== "" ? { cwd: record.cwd } : {},
			enabled: record.enabled === true,
			createdAt: typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
			...typeof record.lastRunAt === "number" ? { lastRunAt: record.lastRunAt } : {},
			...lastStatus !== void 0 ? { lastStatus } : {},
			...typeof record.lastError === "string" ? { lastError: record.lastError } : {},
			...typeof record.lastDurationMs === "number" ? { lastDurationMs: record.lastDurationMs } : {},
			runCount: typeof record.runCount === "number" ? record.runCount : 0,
			failCount: typeof record.failCount === "number" ? record.failCount : 0
		});
	}
	return tasks;
}
/** 定时任务存储：内存镜像 + 串行化 JSON 落盘。 */
var PanelStore = class {
	tasks = /* @__PURE__ */ new Map();
	path;
	logger;
	sessions;
	operationTail;
	constructor(options) {
		this.path = join(options.home, "schedule-panel.json");
		this.logger = options.logger;
		this.sessions = options.sessions ?? {
			set() {},
			clear() {},
			get() {}
		};
		this.operationTail = this.load();
	}
	async load() {
		try {
			const raw = JSON.parse(await readFile(this.path, "utf8"));
			for (const task of sanitize(raw)) this.tasks.set(task.id, task);
		} catch (error) {
			if ((error instanceof Error && "code" in error ? error.code : void 0) !== "ENOENT") this.logger.warn("schedule-panel: 读取任务文件失败（%s）：%s", this.path, error instanceof Error ? error.message : String(error));
		}
	}
	list() {
		return [...this.tasks.values()].sort((a, b) => a.createdAt - b.createdAt);
	}
	get(id) {
		return this.tasks.get(id);
	}
	/** 等待当前写链（含首轮文件加载）排空。 */
	flush() {
		return this.operationTail;
	}
	async persist() {
		const payload = JSON.stringify(this.list(), null, 2);
		await mkdir(dirname(this.path), { recursive: true });
		const temp = `${this.path}.tmp`;
		await writeFile(temp, payload, "utf8");
		await rename(temp, this.path);
	}
	enqueue(operation) {
		const result = this.operationTail.then(operation);
		this.operationTail = result.then(() => void 0, () => void 0);
		return result;
	}
	add(draft) {
		return this.enqueue(async () => {
			const task = {
				id: randomUUID(),
				...draft,
				createdAt: Date.now(),
				enabled: true,
				runCount: 0,
				failCount: 0
			};
			this.tasks.set(task.id, task);
			await this.persist();
			return task;
		});
	}
	remove(id) {
		return this.enqueue(async () => {
			const removed = this.tasks.delete(id);
			if (removed) {
				this.sessions.clear(id);
				await this.persist();
			}
			return removed;
		});
	}
	setEnabled(id, enabled) {
		return this.enqueue(async () => {
			const task = this.tasks.get(id);
			if (task === void 0) return void 0;
			const next = {
				...task,
				enabled
			};
			this.tasks.set(id, next);
			await this.persist();
			return next;
		});
	}
	/** 记录一次运行结果（成功时清掉上次的失败原因）。 */
	recordRun(id, outcome) {
		return this.enqueue(async () => {
			const task = this.tasks.get(id);
			if (task === void 0) return void 0;
			const next = {
				...task,
				lastRunAt: outcome.runAt,
				lastStatus: outcome.status,
				lastError: outcome.status === "error" ? outcome.error ?? "未知错误" : void 0,
				lastDurationMs: outcome.durationMs,
				runCount: task.runCount + 1,
				failCount: task.failCount + (outcome.status === "error" ? 1 : 0)
			};
			this.tasks.set(id, next);
			await this.persist();
			return next;
		});
	}
	/** 暴露运行追踪器（供 HTTP 实时预览）。 */
	get runTracker() {
		return this.sessions;
	}
};
//#endregion
//#region src/run.ts
/** 从会话事件提取可显示文本；仅取 user/assistant/tool 等产生 Message 的事件。 */
function extractEventText(session, event) {
	const msg = session.deriveEventMessage(event);
	if (msg === null) return "";
	let text = "";
	for (const block of msg.content ?? []) if (block.type === "text") text += block.text;
	return text;
}
const MAX_MESSAGE_LENGTH = 200;
function truncate(text) {
	return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
}
function shortId(id) {
	return id.slice(0, 8);
}
function formatMs$1(ms) {
	if (ms < 1e3) return `${ms}ms`;
	return `${(ms / 1e3).toFixed(1)}s`;
}
function errorMessage$2(error) {
	return error instanceof Error ? error.message : String(error);
}
/** 从会话日志的最后一个 turn/end 判定任务结果。 */
function describeOutcome(reason) {
	if (reason === void 0) return {
		failed: true,
		text: "任务未产生运行结果（可能被中断）"
	};
	switch (reason.kind) {
		case "completed": return { failed: false };
		case "max-tokens": return {
			failed: true,
			text: "输出达到 token 上限，任务可能未完成"
		};
		case "aborted": return {
			failed: true,
			text: "任务被中断"
		};
		case "blocked": return {
			failed: true,
			text: "任务被阻止"
		};
		case "error": return {
			failed: true,
			text: reason.error?.message ?? "运行出错"
		};
		case "interrupted": return {
			failed: true,
			text: "运行被异常中断"
		};
		default: return {
			failed: true,
			text: "运行出错"
		};
	}
}
/** 创建任务执行器。 */
function createTaskRunner(ctx, store, config = {}) {
	const defaultCwd = (config.defaultCwd?.trim() ?? "") === "" ? process.cwd() : config.defaultCwd;
	const maxRunMs = config.maxRunMs ?? 18e5;
	const liveTracker = config.liveTracker ?? {
		set() {},
		clear() {},
		get() {}
	};
	const runningTasks = /* @__PURE__ */ new Set();
	const lastTriggerMinute = /* @__PURE__ */ new Map();
	const minuteKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
	const recordFailure = async (task, errorText, runAt, durationMs) => {
		try {
			await store.recordRun(task.id, {
				status: "error",
				error: errorText,
				durationMs,
				runAt
			});
		} catch (persistError) {
			ctx.logger.warn("schedule-panel: 任务 %s 结果登记失败：%s", task.id, errorMessage$2(persistError));
		}
	};
	const runTask = async (id, precomputedSchedule) => {
		const task = store.get(id);
		if (task === void 0) return {
			ok: false,
			message: `任务不存在：${id}`
		};
		if (runningTasks.has(id)) return {
			ok: false,
			message: "该任务正在运行中，请等它结束后再试"
		};
		runningTasks.add(id);
		const runAt = Date.now();
		try {
			let schedule = precomputedSchedule;
			if (schedule === void 0) try {
				schedule = parseCron(task.cron);
			} catch (error) {
				await recordFailure(task, `时间格式无效：${errorMessage$2(error)}`, runAt, 0);
				return {
					ok: false,
					message: `任务 ${shortId(id)} 的时间格式无效：${truncate(errorMessage$2(error))}`
				};
			}
			const cwd = resolveCwd(task.cwd, defaultCwd);
			const info = await stat(cwd).catch(() => null);
			if (info === null || !info.isDirectory()) {
				await recordFailure(task, `工作目录不存在：${cwd}`, runAt, 0);
				return {
					ok: false,
					message: `任务 ${shortId(id)} 的工作目录不存在：${cwd}`
				};
			}
			const agents = ctx.get("agents");
			const sessions = ctx.get("sessions");
			if (agents === void 0 || sessions === void 0) {
				const text = "运行环境未就绪";
				await recordFailure(task, text, runAt, 0);
				return {
					ok: false,
					message: `${text}：暂时无法执行任务，请重启 DSH 后重试`
				};
			}
			let provider = config.defaultProvider;
			let model = config.defaultModel;
			if ((provider?.trim() ?? "") === "" || (model?.trim() ?? "") === "") {
				const selection = ctx.get("agentDefaultModel")?.currentSelection?.();
				if (selection !== void 0) {
					if ((provider?.trim() ?? "") === "") provider = selection.provider;
					if ((model?.trim() ?? "") === "") model = selection.model;
				}
			}
			if ((provider?.trim() ?? "") === "" || (model?.trim() ?? "") === "") {
				const text = "未配置任务模型：请先在 DSH 的模型设置里选择一个模型，或请管理员在插件配置中设置默认模型后重试";
				await recordFailure(task, text, runAt, 0);
				return {
					ok: false,
					message: text
				};
			}
			await store.recordRun(id, {
				status: "error",
				error: "运行中",
				durationMs: 0,
				runAt
			});
			ctx.logger.info("schedule-panel: 开始运行任务 %s（%s）", shortId(id), summarizePrompt$1(task.prompt));
			let previewText = "";
			const previewListeners = /* @__PURE__ */ new Set();
			const runState = {
				sessionId: `panel-${randomUUID()}`,
				startedAt: Date.now(),
				getPreview: () => previewText,
				subscribe: (listener) => {
					previewListeners.add(listener);
					return () => {
						previewListeners.delete(listener);
					};
				}
			};
			liveTracker.set(id, runState);
			const { agent, dispose } = await agents.create({
				sessionId: SessionId(runState.sessionId),
				meta: { cwd },
				agentOptions: {
					provider,
					model
				}
			});
			try {
				const unsubscribe = agent.ctx.on("session/event", (session, event) => {
					const text = extractEventText(session, event);
					if (text === "") return;
					previewText += previewText === "" ? text : `\n${text}`;
					for (const listener of previewListeners) try {
						listener();
					} catch {}
				});
				agent.followup(createUserMessage({
					content: [{
						type: "text",
						text: task.prompt
					}],
					source: {
						kind: "plugin",
						plugin: "schedule-panel"
					}
				}));
				if (maxRunMs > 0) {
					const stopTimer = ctx.timeout(() => {
						ctx.logger.warn("schedule-panel: 任务 %s 超过 %dms，强制停止", shortId(id), maxRunMs);
						agent.cancel({
							kind: "hook",
							reason: "schedule-panel run timeout"
						});
					}, maxRunMs);
					try {
						await agent.whenIdle();
					} finally {
						stopTimer();
					}
				} else await agent.whenIdle();
				unsubscribe();
				await sessions.flush(agent.session);
			} finally {
				await dispose().catch(() => void 0);
			}
			const events = agent.session.events;
			let lastTurnEnd;
			for (let i = events.length - 1; i >= 0; i -= 1) if (events[i].type === "turn/end") {
				lastTurnEnd = events[i];
				break;
			}
			const outcome = describeOutcome(lastTurnEnd?.data.reason);
			const durationMs = Date.now() - runAt;
			await store.recordRun(id, {
				status: outcome.failed ? "error" : "success",
				...outcome.failed && outcome.text !== void 0 ? { error: outcome.text } : {},
				durationMs,
				runAt
			});
			ctx.logger.info("schedule-panel: 任务 %s %s（%s）", shortId(id), outcome.failed ? "失败" : "完成", formatMs$1(durationMs));
			return outcome.failed ? {
				ok: false,
				message: `任务 ${shortId(id)} 运行失败（${formatMs$1(durationMs)}）：${truncate(outcome.text ?? "未知原因")}。完整原因见任务记录`
			} : {
				ok: true,
				message: `任务 ${shortId(id)} 运行完成（${formatMs$1(durationMs)}`
			};
		} catch (error) {
			const message = errorMessage$2(error);
			await recordFailure(task, message, runAt, Date.now() - runAt);
			ctx.logger.warn("schedule-panel: 任务 %s 异常：%s", shortId(id), message);
			return {
				ok: false,
				message: `任务 ${shortId(id)} 运行出错（${formatMs$1(Date.now() - runAt)}）：${truncate(message)}。请稍后重试或查看任务记录`
			};
		} finally {
			runningTasks.delete(id);
			store.runTracker.clear(id);
		}
	};
	const tick = (now) => {
		const key = minuteKey(now);
		for (const task of store.list()) {
			if (!task.enabled || runningTasks.has(task.id)) continue;
			if (lastTriggerMinute.get(task.id) === key) continue;
			let schedule;
			try {
				schedule = parseCron(task.cron);
			} catch {
				continue;
			}
			if (!cronMatches(schedule, now)) continue;
			lastTriggerMinute.set(task.id, key);
			runTask(task.id, schedule).catch((error) => {
				ctx.logger.warn("schedule-panel: 任务 %s 触发失败：%s", task.id, errorMessage$2(error));
			});
		}
	};
	const isRunning = (id) => runningTasks.has(id);
	return {
		runTask,
		tick,
		isRunning
	};
}
function summarizePrompt$1(prompt) {
	const single = prompt.replace(/\s+/gu, " ").trim();
	return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}
function resolveCwd(taskCwd, defaultCwd) {
	return (taskCwd?.trim() ?? "") === "" ? defaultCwd : taskCwd;
}
//#endregion
//#region src/http.ts
const MAX_BODY_BYTES = 65536;
function errorMessage$1(error) {
	return error instanceof Error ? error.message : String(error);
}
function respond(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(payload));
}
/** 读取请求体（上限 64KB）。 */
async function readBody(req) {
	const chunks = [];
	let size = 0;
	let tooLarge = false;
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		size += buffer.length;
		if (size > MAX_BODY_BYTES) {
			tooLarge = true;
			break;
		}
		chunks.push(buffer);
	}
	if (tooLarge) {
		req.resume();
		throw new Error("请求内容过大（上限 64KB）");
	}
	if (chunks.length === 0) return {};
	try {
		const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (typeof parsed !== "object" || parsed === null) throw new Error("请求内容格式错误，请重试");
		return parsed;
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error("请求内容格式错误，请重试");
		throw error;
	}
}
/** 注册 /dsh-schedule-panel/* 路由；返回 disposer。 */
function registerHttpRoutes(ctx, options) {
	const { store, runner } = options;
	function nextRunSafe(cron) {
		try {
			return nextRun(parseCron(cron), /* @__PURE__ */ new Date())?.getTime() ?? null;
		} catch {
			return null;
		}
	}
	/** 任务视图（供客户端渲染）；把实时预览文本并入运行态。 */
	function taskView(task) {
		const runState = store.runTracker.get(task.id);
		return {
			id: task.id,
			cron: task.cron,
			prompt: task.prompt,
			description: task.description,
			cwd: task.cwd,
			enabled: task.enabled,
			createdAt: task.createdAt,
			lastRunAt: task.lastRunAt,
			lastStatus: task.lastStatus,
			lastError: task.lastError,
			lastDurationMs: task.lastDurationMs,
			runCount: task.runCount,
			failCount: task.failCount,
			running: runner.isRunning(task.id),
			nextRunAt: nextRunSafe(task.cron),
			preview: runState ? runState.getPreview() : ""
		};
	}
	const handleTasks = async (req, res) => {
		const method = (req.method ?? "GET").toUpperCase();
		if (method === "GET") {
			respond(res, 200, {
				ok: true,
				tasks: store.list().map(taskView)
			});
			return;
		}
		if (method !== "POST") {
			respond(res, 405, {
				ok: false,
				message: `不支持的请求方式（${method}）`
			});
			return;
		}
		let body;
		try {
			body = await readBody(req);
		} catch (error) {
			respond(res, 400, {
				ok: false,
				message: errorMessage$1(error)
			});
			return;
		}
		const action = body.action;
		try {
			if (action === "add") {
				const cron = typeof body.cron === "string" ? body.cron.trim() : "";
				const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
				if (cron === "" || prompt === "") {
					respond(res, 400, {
						ok: false,
						message: "触发时间与任务内容为必填项"
					});
					return;
				}
				try {
					parseCron(cron);
				} catch (error) {
					respond(res, 400, {
						ok: false,
						message: cronErrorText(error)
					});
					return;
				}
				const cwd = typeof body.cwd === "string" && body.cwd.trim() !== "" ? body.cwd.trim() : void 0;
				const description = typeof body.description === "string" && body.description.trim() !== "" ? body.description.trim() : void 0;
				respond(res, 200, {
					ok: true,
					message: `已添加任务 ${(await store.add({
						cron,
						prompt,
						...cwd !== void 0 ? { cwd } : {},
						...description !== void 0 ? { description } : {}
					})).id}`,
					tasks: store.list().map(taskView)
				});
				return;
			}
			const id = typeof body.id === "string" ? body.id : "";
			if (id === "") {
				respond(res, 400, {
					ok: false,
					message: "缺少任务 id"
				});
				return;
			}
			if (action === "remove") {
				const removed = await store.remove(id);
				respond(res, removed ? 200 : 404, {
					ok: removed,
					message: removed ? `已删除任务 ${id}` : `任务不存在：${id}`,
					tasks: store.list().map(taskView)
				});
				return;
			}
			if (action === "pause" || action === "resume") {
				const task = await store.setEnabled(id, action === "resume");
				respond(res, task !== void 0 ? 200 : 404, {
					ok: task !== void 0,
					message: task !== void 0 ? `任务 ${id} 已${action === "resume" ? "恢复" : "暂停"}` : `任务不存在：${id}`,
					tasks: store.list().map(taskView)
				});
				return;
			}
			if (action === "run") {
				const result = await runner.runTask(id);
				respond(res, result.ok ? 200 : 400, {
					ok: result.ok,
					message: result.message,
					tasks: store.list().map(taskView)
				});
				return;
			}
			respond(res, 400, {
				ok: false,
				message: `不支持的操作：${String(action)}`
			});
		} catch (error) {
			respond(res, 400, {
				ok: false,
				message: errorMessage$1(error)
			});
		}
	};
	const handleStatus = (_req, res) => {
		const tasks = store.list();
		runner.isRunning;
		const runningCount = tasks.filter((t) => runner.isRunning(t.id)).length;
		respond(res, 200, {
			ok: true,
			total: tasks.length,
			runningCount,
			enabledCount: tasks.filter((t) => t.enabled).length,
			tickSeconds: 30
		});
	};
	const handleNext = (req, res) => {
		const idMatch = /^\/tasks\/([^/]+)(?:\/next)?$/.exec(req.url ?? "");
		if (!idMatch) {
			respond(res, 404, {
				ok: false,
				message: "未知路径"
			});
			return;
		}
		const id = decodeURIComponent(idMatch[1]);
		const task = store.get(id);
		if (task === void 0) {
			respond(res, 404, {
				ok: false,
				message: `任务不存在：${id}`
			});
			return;
		}
		try {
			respond(res, 200, {
				ok: true,
				nextRunAt: nextRun(parseCron(task.cron), /* @__PURE__ */ new Date())?.getTime() ?? null
			});
		} catch (error) {
			respond(res, 200, {
				ok: true,
				nextRunAt: null,
				error: cronErrorText(error)
			});
		}
	};
	const disposeTasks = ctx.webServer.register({
		kind: "exact",
		path: "/dsh-schedule-panel/tasks",
		handler: handleTasks
	});
	const disposeStatus = ctx.webServer.register({
		kind: "exact",
		path: "/dsh-schedule-panel/status",
		handler: handleStatus
	});
	const disposeNext = ctx.webServer.register({
		kind: "regex",
		path: /^\/dsh-schedule-panel\/tasks\/([^/]+)(?:\/next)?$/,
		handler: handleNext
	});
	return () => {
		disposeTasks();
		disposeStatus();
		disposeNext();
	};
}
function cronErrorText(error) {
	if (error instanceof CronParseError) return `时间格式无效：${error.message}。格式为 5 段（分 时 日 月 周），示例 0 9 * * * 表示每天 9 点`;
	return errorMessage$1(error);
}
//#endregion
//#region src/index.ts
const name = "schedule-panel";
/** 设置页卡片与 Host 命名空间的配对键（浏览器卡片 key 必须等于此值）。 */
const SETTINGS_NAMESPACE = "dsh-schedule-panel";
/** 宿主侧注入的服务。 */
const inject = [
	"commands",
	"webServer",
	"timer"
];
function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
function tokens(rawInput) {
	return rawInput.trim().split(/\s+/u).filter((token) => token.length > 0);
}
/** 解析 /add 的 <时间>：支持裸 5 字段或引号包裹的整段。 */
function parseAddArgs(args) {
	if ((args[1] ?? "").startsWith("\"")) {
		let end = -1;
		for (let i = 1; i < args.length; i += 1) if (args[i].endsWith("\"")) {
			end = i;
			break;
		}
		if (end < 0) return { error: "时间参数引号未闭合" };
		const cron = args.slice(1, end + 1).map((p) => p.replaceAll("\"", "")).join(" ");
		try {
			parseCron(cron);
		} catch (error) {
			return { error: cronErrorText(error) };
		}
		return {
			cron,
			promptStart: end + 1
		};
	}
	const cronFields = args.slice(1, 6);
	if (cronFields.length < 5) return { error: `cron 需要 5 个字段（分 时 日 月 周），实际 ${cronFields.length} 个` };
	const cron = cronFields.join(" ");
	try {
		parseCron(cron);
	} catch (error) {
		return { error: cronErrorText(error) };
	}
	return {
		cron,
		promptStart: 6
	};
}
function summarizePrompt(prompt) {
	const single = prompt.replace(/\s+/gu, " ").trim();
	return single.length > 40 ? `${single.slice(0, 40)}…` : single;
}
function formatMs(ms) {
	if (ms < 1e3) return `${ms}ms`;
	return `${(ms / 1e3).toFixed(1)}s`;
}
function apply(ctx, config = {}) {
	const liveTracker = {
		set() {},
		clear() {},
		get() {}
	};
	const store = new PanelStore({
		home: resolveDshHome(),
		sessions: liveTracker,
		logger: ctx.logger
	});
	const defaultCwd = config.defaultCwd ?? "";
	const defaultProvider = config.defaultProvider ?? "";
	const defaultModel = config.defaultModel ?? "";
	const rawTick = config.tickSeconds;
	const tickSeconds = Number.isFinite(rawTick) ? Math.max(5, Number(rawTick) ?? 30) : 30;
	const runner = createTaskRunner(ctx, store, {
		defaultCwd,
		defaultProvider,
		defaultModel,
		maxRunMs: config.maxRunMs ?? 18e5,
		liveTracker
	});
	const commandDisposers = [];
	ctx.effect(() => {
		commandDisposers.push(ctx.commands.register({
			name: "dsh-schedule-panel",
			description: "定时任务：到点自动执行（时间 5 段：分 时 日 月 周）；子命令 list/add/remove/pause/resume/run",
			input: { hint: "list | add <时间(如 0 9 * * *)> <任务内容...> | remove <id> | pause <id> | resume <id> | run <id>" },
			handler: async (invocation) => {
				const args = tokens(invocation.rawInput);
				const sub = args[0] ?? "";
				try {
					if (sub === "" || sub === "list") {
						const tasks = store.list();
						if (tasks.length === 0) return {
							kind: "success",
							text: "定时任务：无\n添加示例：/dsh-schedule-panel add 0 9 * * * 每天 9 点总结进展（0 9 * * * = 每天 9 点）"
						};
						return {
							kind: "success",
							text: `定时任务（${tasks.length}）：\n${tasks.map(formatTaskLine).join("\n")}`
						};
					}
					if (sub === "add") {
						if (args.length < 2) return {
							kind: "error",
							text: "用法：/dsh-schedule-panel add <时间> <任务内容...>\n时间格式：5 段（分 时 日 月 周），如 0 9 * * * = 每天 9 点"
						};
						const parsed = parseAddArgs(args);
						if ("error" in parsed) return {
							kind: "error",
							text: parsed.error
						};
						const prompt = args.slice(parsed.promptStart).join(" ").trim();
						if (prompt === "") return {
							kind: "error",
							text: "缺少任务内容"
						};
						const task = await store.add({
							cron: parsed.cron,
							prompt
						});
						return {
							kind: "success",
							text: `已添加任务 ${task.id}\n${formatTaskLine(task)}`
						};
					}
					if (sub === "remove") return {
						kind: "success",
						text: await store.remove(args[1] ?? "") ? `已删除任务：${args[1]}` : `任务不存在：${args[1]}`
					};
					if (sub === "pause" || sub === "resume") return await store.setEnabled(args[1] ?? "", sub === "resume") === void 0 ? {
						kind: "error",
						text: `任务不存在：${args[1]}`
					} : {
						kind: "success",
						text: `任务 ${args[1]} 已${sub === "resume" ? "恢复" : "暂停"}`
					};
					if (sub === "run") {
						const result = await runner.runTask(args[1] ?? "");
						return result.ok ? {
							kind: "success",
							text: result.message
						} : {
							kind: "error",
							text: result.message
						};
					}
					return {
						kind: "error",
						text: `未知子命令：${sub}\n用法：/dsh-schedule-panel [list|add <时间> <任务内容...>|remove <id>|pause <id>|resume <id>|run <id>]`
					};
				} catch (error) {
					return {
						kind: "error",
						text: errorMessage(error)
					};
				}
			}
		}));
		commandDisposers.push(registerHttpRoutes(ctx, {
			store,
			runner
		}));
		commandDisposers.push(ctx.interval(() => runner.tick(/* @__PURE__ */ new Date()), tickSeconds * 1e3));
		return () => {
			for (const dispose of commandDisposers) dispose();
			commandDisposers.length = 0;
		};
	}, "schedule-panel: app");
	ctx.logger.info("schedule-panel: 定时任务已启用（tick %ds）", tickSeconds);
}
function formatTaskLine(task) {
	let status;
	if (!task.enabled) status = "暂停";
	else if (task.lastStatus === "error") status = `上次失败（${task.lastError ?? "未知原因"}）`;
	else if (task.lastStatus === "success") status = `上次成功（${formatMs(task.lastDurationMs ?? 0)}）`;
	else status = "待触发";
	const lines = [`  ${task.id.slice(0, 8)}  ${task.cron}  ${status}`];
	lines.push(`     ${summarizePrompt(task.prompt)}`);
	if (task.description !== void 0) lines.push(`     ${task.description}`);
	return lines.join("\n");
}
//#endregion
export { SETTINGS_NAMESPACE, apply, inject, name };
