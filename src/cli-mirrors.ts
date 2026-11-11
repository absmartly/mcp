// Mirrors of @absmartly/cli 1.17.1 command-layer helpers that the package does
// not export (its exports map only reaches core/*/index.js). Each function
// names the CLI module it follows; keep them in step when bumping the CLI, or
// drop them once the CLI exports the originals.
import type { ApiClientLike } from "./api-client-like.js";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const DAYS_PER_WEEK = 7;
const DUPLICATE_COLUMNS_ERROR = "Duplicate column names in query result; retry with raw: true";

// ─── lib/utils/date-parser.js ────────────────────────────────────────────────

const RELATIVE_DATE = /^(\d+)\s*(m|min|minutes?|h|hours?|d|days?|w|weeks?|mo|months?|y|years?)\s*(ago)?$/i;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T[\d:.-]+Z$/;
const UNIT_MS: Record<string, number> = {
  m: MS_PER_MINUTE, min: MS_PER_MINUTE, minute: MS_PER_MINUTE, minutes: MS_PER_MINUTE,
  h: MS_PER_HOUR, hour: MS_PER_HOUR, hours: MS_PER_HOUR,
  d: MS_PER_DAY, day: MS_PER_DAY, days: MS_PER_DAY,
  w: MS_PER_WEEK, week: MS_PER_WEEK, weeks: MS_PER_WEEK,
  mo: DAYS_PER_MONTH * MS_PER_DAY, month: DAYS_PER_MONTH * MS_PER_DAY, months: DAYS_PER_MONTH * MS_PER_DAY,
  y: DAYS_PER_YEAR * MS_PER_DAY, year: DAYS_PER_YEAR * MS_PER_DAY, years: DAYS_PER_YEAR * MS_PER_DAY,
};

function calendarKeyword(input: string, now: Date): number | null {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (input) {
    case "month-start": return new Date(year, month, 1).getTime();
    case "last-month-start": return new Date(year, month - 1, 1).getTime();
    case "last-month-end": return new Date(year, month, 1).getTime() - 1;
    case "year-start": return new Date(year, 0, 1).getTime();
    case "last-year-start": return new Date(year - 1, 0, 1).getTime();
    case "last-year-end": return new Date(year, 0, 1).getTime() - 1;
    default: return null;
  }
}

/** A CLI date flag (7d, 2w ago, month-start, 2026-01-01, ISO datetime, epoch ms) as epoch ms. */
export function parseCliDate(value: string | number | undefined, now: Date = new Date()): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") return value;
  const asNumber = parseInt(value, 10);
  if (!isNaN(asNumber) && asNumber > 0 && value === String(asNumber)) return asNumber;
  const lower = value.trim().toLowerCase();
  const calendar = calendarKeyword(lower, now);
  if (calendar !== null) return calendar;
  if (lower === "now") return now.getTime();
  if (lower === "today" || lower === "yesterday") {
    const day = lower === "today" ? now.getDate() : now.getDate() - 1;
    return new Date(now.getFullYear(), now.getMonth(), day).getTime();
  }
  const relative = RELATIVE_DATE.exec(lower);
  if (relative && UNIT_MS[relative[2]]) return now.getTime() - parseInt(relative[1], 10) * UNIT_MS[relative[2]];
  const isoDate = ISO_DATE.exec(value);
  const t = isoDate
    ? new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])).getTime()
    : ISO_DATETIME.test(value) ? new Date(value).getTime() : NaN;
  if (isNaN(t)) {
    throw new Error(`Invalid date "${value}": use a relative date (7d, 2w ago, today), month-start/last-month-end/year-start, an ISO date or datetime, or epoch ms`);
  }
  return t;
}

// ─── core/events/json-filter.js ──────────────────────────────────────────────

export interface ColumnarFilterOptions {
  match?: string;
  topLevel?: boolean;
  maxDepth?: number;
}

interface Columnar { columnNames: string[]; rows: unknown[][] }

function isColumnar(data: unknown): data is Columnar {
  const d = data as Partial<Columnar> | null;
  return !!d && Array.isArray(d.columnNames) && Array.isArray(d.rows);
}

/** Filters the rows of a columnar result on one column (events json-values/json-layouts --match/--top-level/--max-depth). */
export function filterColumnarRows(data: unknown, column: string, opts: ColumnarFilterOptions): unknown {
  if (opts.match === undefined && opts.topLevel !== true && opts.maxDepth === undefined) return data;
  let regex: RegExp | undefined;
  if (opts.match !== undefined) {
    try {
      regex = new RegExp(opts.match, "i");
    } catch (e) {
      throw new Error(`Invalid match regex: ${(e as Error).message}`);
    }
  }
  if (opts.maxDepth !== undefined && (!Number.isInteger(opts.maxDepth) || opts.maxDepth < 1)) {
    throw new Error("maxDepth must be a positive integer");
  }
  if (!isColumnar(data)) return data;
  const index = data.columnNames.indexOf(column);
  if (index === -1) return data;
  const depthLimit = opts.topLevel ? 1 : opts.maxDepth;
  const rows = data.rows.filter((row) => {
    const cell = String(row[index] ?? "");
    if (regex && !regex.test(cell)) return false;
    return depthLimit === undefined || cell.split("/").length <= depthLimit;
  });
  return { ...data, rows };
}

/** A columnar result ({ columnNames, rows }) as row objects (core/events/events.js columnarToRows; not in the CLI 1.7 datasources index). */
export function columnarToRows(data: unknown): unknown[] {
  if (isColumnar(data)) {
    // Unlike the CLI, refuse repeated names (e.g. "select a.id, b.id"): row objects would keep only the last value.
    if (data.rows.length > 0 && new Set(data.columnNames).size !== data.columnNames.length) {
      throw new Error(DUPLICATE_COLUMNS_ERROR);
    }
    return data.rows.map((row) => Object.fromEntries(data.columnNames.map((name, i) => [name, row[i]])));
  }
  if (Array.isArray(data)) return data;
  return data !== null && data !== undefined && typeof data === "object" ? [data] : [];
}

// ─── core/users/filter.js ────────────────────────────────────────────────────

export const USER_FILTER_SCAN_PAGE_SIZE = 200;

export interface UserFilterParams {
  department?: string;
  role?: string;
  jobTitle?: string;
  email?: string;
  name?: string;
  contains?: boolean;
}

export const USER_FILTER_KEYS = ["department", "role", "jobTitle", "email", "name"] as const;

/** Comma-separated values: trimmed, blanks dropped, deduplicated case-insensitively. */
export function parseFilterValues(input: string | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of (input ?? "").split(",")) {
    const v = raw.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

function requiredFilterValues(param: string, raw: string): string[] {
  const values = parseFilterValues(raw);
  if (values.length === 0) throw new Error(`${param} was given no usable values (got "${raw}").`);
  return values;
}

type Row = Record<string, unknown>;

/** Role names or IDs to role IDs; an unknown ID or name, or an ambiguous name, is an error. */
export async function resolveRoleIds(client: ApiClientLike, values: string[]): Promise<number[]> {
  const ids: number[] = [];
  const add = (id: number) => { if (!ids.includes(id)) ids.push(id); };
  const numeric = values.filter((v) => String(Number(v)) === v.trim()).map(Number);
  const names = values.filter((v) => String(Number(v)) !== v.trim());
  if (numeric.length > 0) {
    const found = await client.listRoles({ ids: numeric.join(","), items: USER_FILTER_SCAN_PAGE_SIZE } as any) as Row[];
    const foundIds = new Set(found.map((r) => Number(r.id)));
    const missing = numeric.filter((id) => !foundIds.has(id));
    if (missing.length > 0) throw new Error(`No role found with ID ${missing.join(", ")}.`);
    numeric.forEach(add);
  }
  for (const value of names) {
    const roles = await client.listRoles({ search: value, items: USER_FILTER_SCAN_PAGE_SIZE } as any) as Row[];
    const exact = roles.filter((r) => String(r.name ?? "").toLowerCase() === value.toLowerCase());
    if (exact.length === 0) throw new Error(`No role found matching name "${value}". Use a numeric role ID, or check the name.`);
    if (exact.length > 1) throw new Error(`Multiple roles match name "${value}": ${exact.map((r) => `${r.id} ${r.name}`).join(", ")}. Use a numeric role ID.`);
    add(Number(exact[0].id));
  }
  return ids;
}

/** A --role write value as the users create/update `roles` payload. */
export async function resolveRolesPayload(client: ApiClientLike, raw: string): Promise<Array<{ role_id: number }>> {
  const ids = await resolveRoleIds(client, requiredFilterValues("role", raw));
  return ids.map((role_id) => ({ role_id }));
}

export function hasUserFilters(params: Record<string, unknown>): boolean {
  return USER_FILTER_KEYS.some((key) => typeof params[key] === "string" && (params[key] as string).trim() !== "");
}

function userGlobalRoleIds(user: Row): number[] {
  const entries = Array.isArray(user.user_team_roles) ? user.user_team_roles : [];
  return entries.flatMap((entry: any) => (Array.isArray(entry?.role_ids) ? entry.role_ids.map(Number).filter(Number.isFinite) : []));
}

function matchesField(candidate: string, values: string[] | undefined, contains: boolean): boolean {
  if (!values) return true;
  const c = candidate.toLowerCase();
  return values.some((v) => (contains ? c.includes(v.toLowerCase()) : c === v.toLowerCase()));
}

/** Every user matching the client-side filters (OR within a field, AND across fields), scanning all pages. */
export async function filterAllUsers(client: ApiClientLike, params: UserFilterParams, nativeOptions: Record<string, unknown>): Promise<Row[]> {
  const department = params.department ? requiredFilterValues("department", params.department) : undefined;
  const jobTitle = params.jobTitle ? requiredFilterValues("jobTitle", params.jobTitle) : undefined;
  const email = params.email ? requiredFilterValues("email", params.email) : undefined;
  const name = params.name ? requiredFilterValues("name", params.name) : undefined;
  const roleIds = params.role ? await resolveRoleIds(client, requiredFilterValues("role", params.role)) : undefined;
  const contains = params.contains === true;
  const all: Row[] = [];
  for (let page = 1; ; page++) {
    const batch = await client.listUsers({ ...nativeOptions, page, items: USER_FILTER_SCAN_PAGE_SIZE } as any) as Row[];
    all.push(...batch);
    if (batch.length < USER_FILTER_SCAN_PAGE_SIZE) break;
  }
  return all.filter((u) =>
    matchesField(String(u.department ?? ""), department, contains)
    && matchesField(String(u.job_title ?? ""), jobTitle, contains)
    && matchesField(String(u.email ?? ""), email, contains)
    && matchesField([u.first_name, u.last_name].filter((x) => typeof x === "string" && x).join(" "), name, contains)
    && (!roleIds || roleIds.some((id) => userGlobalRoleIds(u).includes(id))));
}

// ─── core/metrics/filter.js ──────────────────────────────────────────────────

const OUTLIER_METHODS = ["unlimited", "quantile", "stdev", "fixed"];
const IMPACT_DIRECTIONS = ["positive", "negative", "unknown"];
export const METRIC_FILTER_KEYS = [
  "metricType", "goal", "outlierLimiting", "outlierMethod", "hasPropertyFilter",
  "propertyFilterPath", "propertyFilterContains", "impactDirection", "cuped",
] as const;

export function hasMetricFilters(params: Record<string, unknown>): boolean {
  return METRIC_FILTER_KEYS.some((key) => params[key] !== undefined && params[key] !== "");
}

const csv = (value: unknown): string[] | undefined => {
  const parts = typeof value === "string" ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  return parts.length > 0 ? parts : undefined;
};
const lc = (value: unknown) => String(value ?? "").toLowerCase();
const isLimited = (method: unknown) => lc(method) !== "" && lc(method) !== "unlimited";
const nonEmpty = (value: unknown) => value !== null && value !== undefined && String(value).trim() !== "";

function filterText(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  try { return JSON.stringify(raw); } catch { return ""; }
}

function hasLeafContent(node: unknown): boolean {
  if (node === null || node === undefined) return false;
  if (Array.isArray(node)) return node.some(hasLeafContent);
  if (typeof node === "object") return Object.values(node).some(hasLeafContent);
  return true;
}

function hasMeaningfulPropertyFilter(raw: unknown): boolean {
  const t = filterText(raw).trim();
  if (t === "" || t === "null") return false;
  let parsed: any;
  try { parsed = JSON.parse(t); } catch { return true; }
  const inner = parsed && typeof parsed === "object" && !Array.isArray(parsed) && "filter" in parsed ? parsed.filter : parsed;
  return hasLeafContent(inner);
}

function varPaths(raw: unknown): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(filterText(raw)); } catch { return []; }
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "var") {
          if (typeof value === "string") out.push(value);
          else if (value && typeof value === "object" && typeof (value as any).path === "string") out.push((value as any).path);
        }
        walk(value);
      }
    }
  };
  walk(parsed);
  return out;
}

/** Applies the metrics list client-side filters (metricType, goal, outlier*, *PropertyFilter*, impactDirection, cuped). */
export function filterMetrics(metrics: Row[], params: Record<string, unknown>): Row[] {
  const metricType = csv(params.metricType)?.map((t) => t.toLowerCase());
  const goal = csv(params.goal);
  const outlierMethod = csv(params.outlierMethod)?.map((m) => m.toLowerCase());
  const propertyFilterPath = csv(params.propertyFilterPath)?.map((p) => p.toLowerCase());
  const impactDirection = csv(params.impactDirection)?.map((d) => d.toLowerCase());
  const contains = typeof params.propertyFilterContains === "string" && params.propertyFilterContains.trim() !== ""
    ? params.propertyFilterContains.trim().toLowerCase() : undefined;
  const badMethods = outlierMethod?.filter((m) => !OUTLIER_METHODS.includes(m)) ?? [];
  if (badMethods.length > 0) throw new Error(`Invalid outlierMethod value(s): ${badMethods.join(", ")}. Must be one of: ${OUTLIER_METHODS.join(", ")}.`);
  const badDirections = impactDirection?.filter((d) => !IMPACT_DIRECTIONS.includes(d)) ?? [];
  if (badDirections.length > 0) throw new Error(`Invalid impactDirection value(s): ${badDirections.join(", ")}. Must be one of: ${IMPACT_DIRECTIONS.join(", ")}.`);
  const bool = (key: string) => (typeof params[key] === "boolean" ? params[key] as boolean : undefined);
  const outlierLimiting = bool("outlierLimiting");
  const hasPropertyFilter = bool("hasPropertyFilter");
  const cuped = bool("cuped");
  return metrics.filter((m) => {
    if (metricType && !metricType.includes(lc(m.type))) return false;
    if (impactDirection && !impactDirection.includes(lc(m.effect))) return false;
    if (goal) {
      const ids = [m.goal_id, m.denominator_goal_id].filter((v) => v !== null && v !== undefined).map(String);
      const names = [(m.goal as Row | undefined)?.name, (m.denominator_goal as Row | undefined)?.name]
        .filter((v): v is string => typeof v === "string").map((n) => n.toLowerCase());
      if (!goal.some((token) => (/^\d+$/.test(token) ? ids.includes(token) : names.some((n) => n.includes(token.toLowerCase()))))) return false;
    }
    if (outlierLimiting !== undefined && (isLimited(m.outlier_limit_method) || isLimited(m.denominator_outlier_limit_method)) !== outlierLimiting) return false;
    if (outlierMethod) {
      const methods = [lc(m.outlier_limit_method), lc(m.denominator_outlier_limit_method)].filter(Boolean);
      if (!methods.some((x) => outlierMethod.includes(x))) return false;
    }
    if (cuped !== undefined && (nonEmpty(m.vr_lookback_interval) || nonEmpty(m.denominator_vr_lookback_interval)) !== cuped) return false;
    if (hasPropertyFilter !== undefined
      && (hasMeaningfulPropertyFilter(m.property_filter) || hasMeaningfulPropertyFilter(m.denominator_property_filter)) !== hasPropertyFilter) return false;
    if (propertyFilterPath) {
      const paths = [...varPaths(m.property_filter), ...varPaths(m.denominator_property_filter)].map((p) => p.toLowerCase());
      if (!propertyFilterPath.some((t) => paths.some((p) => p.includes(t)))) return false;
    }
    if (contains && !`${filterText(m.property_filter)} ${filterText(m.denominator_property_filter)}`.toLowerCase().includes(contains)) return false;
    return true;
  });
}

// ─── commands/statistics/index.js (buildConfigFromOptions) ───────────────────

const RECURRENCE_ALIASES: Record<string, "day" | "week" | "month"> = {
  d: "day", day: "day", daily: "day", w: "week", week: "week", weekly: "week", m: "month", month: "month", monthly: "month",
};
const PARTICIPANT_RATE = /^(\d+(?:\.\d+)?)\s*\/\s*(\w+)$/;

function participantsPerWeek(value: string | number): number {
  if (typeof value === "number") return value;
  const match = PARTICIPANT_RATE.exec(value);
  if (!match) {
    const n = Number(value);
    if (!isNaN(n)) return n;
    throw new Error(`Invalid participants "${value}": use <number>/<day|week|month> (e.g. 1000/week)`);
  }
  const unit = RECURRENCE_ALIASES[match[2].toLowerCase()];
  if (!unit) throw new Error(`Invalid participants unit "${match[2]}": use day, week or month`);
  const count = Number(match[1]);
  return unit === "day" ? count * DAYS_PER_WEEK : unit === "month" ? (count / DAYS_PER_MONTH) * DAYS_PER_WEEK : count;
}

/** The statistics power-matrix flags as the API configuration body. */
export function buildPowerMatrixConfig(params: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => { if (value !== undefined && value !== "") config[key] = value; };
  set("analysis_type", params.analysisType);
  set("metric_type", params.metricType);
  set("metric_mean", params.metricMean === undefined ? undefined : Number(params.metricMean));
  set("metric_variance", params.metricVariance === undefined ? undefined : Number(params.metricVariance));
  set("metric_custom_statistics_type", params.metricCustomStatisticsType);
  set("alpha", params.alpha === undefined ? undefined : Number(params.alpha));
  set("powers", params.powers);
  set("split", params.split);
  set("sample_sizes", params.sampleSizes);
  set("minimum_detectable_effects", params.minimumDetectableEffects);
  if (params.twoSided === true) config.two_sided = true;
  set("group_sequential_futility_type", params.futilityType);
  set("group_sequential_first_analysis_interval", params.firstAnalysis);
  set("group_sequential_min_analysis_interval", params.minAnalysisInterval);
  if (params.participants !== undefined) config.participants_per_week = participantsPerWeek(params.participants as string | number);
  return config;
}

// ─── commands/events/summary.js + core/events/summary.js ─────────────────────

const MAX_SUMMARY_RANGE_MS = 100 * MS_PER_DAY;
const UNOWNED_TEAM = { id: -1, name: "Unowned" };
type Period = "day" | "week" | "month";
type EventTypeFilter = "all" | "goal" | "exposure";
interface SummaryEvent { date: number; team_id: number; count: number; type: string }
interface TeamCounts { goal: number; exposure: number; total: number }
interface AggregatedRow { date: number; teams: Map<number, TeamCounts>; totalGoal: number; totalExposure: number; total: number }

export const SUMMARY_PERIODS: readonly Period[] = ["day", "week", "month"];
export const SUMMARY_EVENT_TYPES: readonly EventTypeFilter[] = ["all", "goal", "exposure"];
export const SUMMARY_GROUP_BY = ["total", "team"] as const;

export function checkSummaryRange(from: number | undefined, to: number | undefined): void {
  if (from === undefined || to === undefined) return;
  if (from > to) throw new Error("`from` must be less than or equal to `to`");
  if (to - from > MAX_SUMMARY_RANGE_MS) throw new Error("Date range too large - maximum is 100 days");
}

function bucketStart(date: number, period: Period): number {
  const d = new Date(date);
  if (period === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (period === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
}

function isoWeek(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 3 - ((utc.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(utc.getUTCFullYear(), 0, 1);
  return { year: utc.getUTCFullYear(), week: Math.floor((utc.getTime() - yearStart) / MS_PER_DAY / DAYS_PER_WEEK) + 1 };
}

function periodLabel(date: number, period: Period): string {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  if (period === "month") return `${d.getFullYear()}-${month}`;
  if (period === "week") {
    const { year, week } = isoWeek(d);
    return `${year}-W${String(week).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${month}-${String(d.getDate()).padStart(2, "0")}`;
}

function aggregate(events: SummaryEvent[], period: Period, eventType: EventTypeFilter, cumulative: boolean): AggregatedRow[] {
  const byDate = new Map<number, AggregatedRow>();
  for (const ev of events) {
    if (eventType !== "all" && ev.type !== eventType) continue;
    const date = bucketStart(ev.date, period);
    let row = byDate.get(date);
    if (!row) byDate.set(date, row = { date, teams: new Map(), totalGoal: 0, totalExposure: 0, total: 0 });
    const team = row.teams.get(ev.team_id) ?? { goal: 0, exposure: 0, total: 0 };
    row.teams.set(ev.team_id, team);
    if (ev.type === "goal") { team.goal += ev.count; row.totalGoal += ev.count; } else { team.exposure += ev.count; row.totalExposure += ev.count; }
    team.total += ev.count;
    row.total += ev.count;
  }
  const rows = [...byDate.values()].sort((a, b) => a.date - b.date);
  if (!cumulative) return rows;
  const running: AggregatedRow = { date: 0, teams: new Map(), totalGoal: 0, totalExposure: 0, total: 0 };
  return rows.map((row) => {
    running.totalGoal += row.totalGoal;
    running.totalExposure += row.totalExposure;
    running.total += row.total;
    for (const [id, cur] of row.teams) {
      const prev = running.teams.get(id) ?? { goal: 0, exposure: 0, total: 0 };
      running.teams.set(id, { goal: prev.goal + cur.goal, exposure: prev.exposure + cur.exposure, total: prev.total + cur.total });
    }
    return { date: row.date, teams: new Map(running.teams), totalGoal: running.totalGoal, totalExposure: running.totalExposure, total: running.total };
  });
}

export interface SummaryOptions { period: Period; eventType: EventTypeFilter; groupBy: "total" | "team"; cumulative: boolean; transpose: boolean }

/** The events summary payload rolled up by period and team, as `abs events summary -o json` prints it. */
export function summarizeEvents(payload: { teams?: Array<{ id: number; name: string }>; events?: SummaryEvent[] }, options: SummaryOptions): Record<string, unknown> {
  const events = payload.events ?? [];
  const usedTeamIds = new Set(events.map((e) => e.team_id));
  const teams = [...(payload.teams ?? []), UNOWNED_TEAM].filter((t) => usedTeamIds.has(t.id));
  const rows = aggregate(events, options.period, options.eventType, options.cumulative);
  const header = { period: options.period, eventType: options.eventType, cumulative: options.cumulative, teams };
  if (!(options.transpose && options.groupBy === "team")) {
    return {
      ...header,
      transposed: false,
      rows: rows.map((r) => ({
        date: r.date,
        period: periodLabel(r.date, options.period),
        ...(options.groupBy === "team" ? {
          teams: Object.fromEntries([...r.teams].map(([id, v]) => [String(id), { name: teams.find((t) => t.id === id)?.name ?? null, ...v }])),
        } : {}),
        totalGoal: r.totalGoal,
        totalExposure: r.totalExposure,
        total: r.total,
      })),
    };
  }
  return {
    ...header,
    transposed: true,
    periods: rows.map((r) => ({ date: r.date, period: periodLabel(r.date, options.period), totalGoal: r.totalGoal, totalExposure: r.totalExposure, total: r.total })),
    rows: teams.map((t) => {
      const periods: Record<string, TeamCounts & { date: number }> = {};
      const sums = { goal: 0, exposure: 0, total: 0 };
      for (const r of rows) {
        const c = r.teams.get(t.id) ?? { goal: 0, exposure: 0, total: 0 };
        sums.goal += c.goal; sums.exposure += c.exposure; sums.total += c.total;
        periods[periodLabel(r.date, options.period)] = { date: r.date, ...c };
      }
      return { team_id: t.id, name: t.name, periods, totalGoal: sums.goal, totalExposure: sums.exposure, total: sums.total };
    }),
  };
}
