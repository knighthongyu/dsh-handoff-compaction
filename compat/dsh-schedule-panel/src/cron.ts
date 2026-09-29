/**
 * 最小 cron 解析与匹配 —— 标准 5 字段（分 时 日 月 周）。
 *
 * 支持通配与常见写法：`*`、`/n`（步长）、`a-b`（范围）、`a,b,c`（列表）以及
 * 具体数值。周：0/7 = 周日，1-6 = 周一~周六。解析失败抛 CronParseError。
 *
 * 本插件的定时精度到分钟：tick 每秒扫描，命中当前分钟区间即触发一次，靠
 * `lastTriggerMinute` 防止一分钟内重复触发。
 */

/** 单个字段的取值集合（用于匹配判定）。 */
type Field = Set<number>

/** 解析后的 cron 各字段。 */
export interface CronSchedule {
  readonly minute: Field
  readonly hour: Field
  readonly day: Field
  readonly month: Field
  readonly weekday: Field
}

/** 解析失败的错误类型，便于客户端给出中文提示。 */
export class CronParseError extends Error {
  constructor(readonly fieldIndex: number, message: string) {
    super(message)
    this.name = 'CronParseError'
  }
}

const FIELD_NAMES = ['分', '时', '日', '月', '周'] as const

function parseField(raw: string, min: number, max: number, fieldIndex: number): Field {
  const field: Set<number> = new Set()
  const pushValue = (value: number): void => {
    if (value < min || value > max) {
      throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 越界：期望 ${min}–${max}`)
    }
    field.add(value)
  }

  for (const token of raw.split(',')) {
    const t = token.trim()
    if (t === '') {
      throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段为空`)
    }
    // 步长：*/n 或 a-b/n
    const stepMatch = /^(.*)(?:\/(\d+))?$/.exec(t)
    if (!stepMatch) {
      throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段格式无效：${raw}`)
    }
    const base = stepMatch[1]
    const step = stepMatch[2] !== undefined ? Number.parseInt(step, 10) : 1
    if (step <= 0 || !Number.isInteger(step)) {
      throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 步长无效：${raw}`)
    }

    if (base === '*') {
      for (let v = min; v <= max; v += step) pushValue(v)
    } else if (/^\d+$/.test(base)) {
      // 单值或 a-b 范围
      const dashMatch = /^(\d+)-(\d+)$/.exec(base)
      if (dashMatch) {
        const lo = Number.parseInt(dashMatch[1], 10)
        const hi = Number.parseInt(dashMatch[2], 10)
        if (lo > hi) {
          throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 范围起点大于终点：${raw}`)
        }
        for (let v = lo; v <= hi; v += step) pushValue(v)
      } else {
        pushValue(Number.parseInt(base, 10))
      }
    } else {
      throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段格式无效：${raw}`)
    }
  }
  if (field.size === 0) {
    throw new CronParseError(fieldIndex, `${FIELD_NAMES[fieldIndex]} 字段解析结果为空`)
  }
  return field
}

/** 解析 5 字段 cron 表达式。 */
export function parseCron(input: string): CronSchedule {
  const fields = input.trim().split(/\s+/u).filter((f) => f !== '')
  if (fields.length < 5) {
    throw new CronParseError(0, `cron 需要 5 个字段（分 时 日 月 周），实际 ${fields.length} 个`)
  }
  if (fields.length > 5) {
    throw new CronParseError(0, `cron 字段过多（最多 5 个：分 时 日 月 周），实际 ${fields.length} 个`)
  }
  const [minute, hour, day, month, weekday] = fields
  return {
    minute: parseField(minute, 0, 59, 0),
    hour: parseField(hour, 0, 23, 1),
    day: parseField(day, 1, 31, 2),
    month: parseField(month, 1, 12, 3),
    // 周：允许 0-7，7 与 0 都视为周日（见 cronMatches 的处理）。
    weekday: parseField(weekday, 0, 7, 4),
  }
}

/** cronMatches 命中判定：处理「日/周至少满足其一」的经典约定。 */
export function cronMatches(schedule: CronSchedule, now: Date): boolean {
  const minute = now.getMinutes()
  const hour = now.getHours()
  const day = now.getDate()
  const month = now.getMonth() + 1
  // Date 周日为 0；cron 周 0/7 均为周日，归一化后比较。
  let weekday = now.getDay()
  const { weekday: cronWeekday } = schedule

  if (!schedule.minute.has(minute)) return false
  if (!schedule.hour.has(hour)) return false
  if (!schedule.month.has(month)) return false
  if (!schedule.day.has(day)) return false

  // 日与周：二者都限制时，满足其一即命中（cron 通用约定）。
  const dayMatch = schedule.day.has(day)
  const weekdayMatch = cronWeekday.has(weekday) || cronWeekday.has(weekday === 0 ? 7 : 0)
  if (schedule.day.size === 1 && cronWeekday.size === 1) {
    // 两者都被精确限定时取“与”（更严格），与多数实现一致。
    return dayMatch && weekdayMatch
  }
  return dayMatch || weekdayMatch
}

/** 计算 cron 之后的下一次触发时间（分钟对齐）；若解析的表达式永不命中返回 undefined。 */
export function nextRun(schedule: CronSchedule, from: Date): Date | undefined {
  // 从“下一分钟”开始逐分钟扫描，最多 366 天（约 176k 分钟），覆盖绝大多数场景。
  let cursor = new Date(from.getTime())
  cursor.setSeconds(0, 0)
  cursor.setMinutes(cursor.getMinutes() + 1)
  const limit = from.getTime() + 366 * 24 * 60 * 60 * 1000
  while (cursor.getTime() < limit) {
    const m = cursor.getMinutes()
    const h = cursor.getHours()
    const d = cursor.getDate()
    const mo = cursor.getMonth() + 1
    let wd = cursor.getDay()
    if (
      schedule.minute.has(m) &&
      schedule.hour.has(h) &&
      schedule.month.has(mo) &&
      schedule.day.has(d)
    ) {
      const weekdayOk = schedule.weekday.has(wd) || schedule.weekday.has(wd === 0 ? 7 : 0)
      const dayMatch = schedule.day.has(d)
      const weekdayMatch = weekdayOk
      if (schedule.day.size === 1 && schedule.weekday.size === 1) {
        if (dayMatch && weekdayMatch) return new Date(cursor.getTime())
      } else if (dayMatch || weekdayMatch) {
        return new Date(cursor.getTime())
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return undefined
}

/** 友好的下次触发时间文本（相对“几小时/几分钟/明天”等）。 */
export function formatNextRun(next: Date | undefined, now: Date): string {
  if (!next) return '永不'
  const diff = next.getTime() - now.getTime()
  const totalMinutes = Math.round(diff / 60000)
  if (totalMinutes <= 0) return '即将（本分钟）'
  if (totalMinutes < 60) return `约 ${totalMinutes} 分钟后`
  const hours = Math.floor(totalMinutes / 60)
  if (hours < 24) return `约 ${hours} 小时${totalMinutes % 60 > 0 ? `(${Math.round((totalMinutes % 60) / 10)} 分钟)` : ''}`
  const days = Math.floor(hours / 24)
  if (days < 7) return `约 ${days} 天后`
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')} ${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
}
