// Structural size reduction for JSON-derived plain data (no cycles, no class instances).
// Reduces the object graph BEFORE serialization so output is always valid JSON.

export const DEFAULT_JSON_INDENT = 2;
export const OMITTED_FIELD_KEY = '_omitted';
const ESSENTIAL_KEY_PATTERN = /^(id|name|display_name|type|state|status|key)$|_id$/;
const ESSENTIAL_STRING_MIN_CHARS = 200;
const JSON_LIKE_STRING_PATTERN = /^\s*[[{]/;
const MAX_SKELETON_KEY_NAMES = 50;
const SKELETON_KEY_NAME_MAX_CHARS = 100;
const HARD_CAP_MARKER = '\n\n[output cut at hard size limit]';
const FINAL_FALLBACK_VALUE = { [OMITTED_FIELD_KEY]: 'value too large to display in any reduced form' };
const MINIMAL_FALLBACK = '{}';
const MINIMAL_ARRAY_FALLBACK = '[]';

export interface ReductionProfile {
  maxArrayItems: number;
  maxStringChars: number;
  maxObjectKeys: number;
  maxDepth: number;
}

export const SUMMARY_LADDER: readonly ReductionProfile[] = [
  { maxArrayItems: 100, maxStringChars: 2_000, maxObjectKeys: 200, maxDepth: 12 },
  { maxArrayItems: 50, maxStringChars: 1_000, maxObjectKeys: 100, maxDepth: 10 },
  { maxArrayItems: 20, maxStringChars: 500, maxObjectKeys: 50, maxDepth: 8 },
  { maxArrayItems: 10, maxStringChars: 200, maxObjectKeys: 30, maxDepth: 6 },
  { maxArrayItems: 5, maxStringChars: 100, maxObjectKeys: 20, maxDepth: 4 },
];

export const RAW_LADDER: readonly ReductionProfile[] = [
  { maxArrayItems: 100, maxStringChars: 1_000, maxObjectKeys: 200, maxDepth: 12 },
  { maxArrayItems: 50, maxStringChars: 300, maxObjectKeys: 100, maxDepth: 8 },
  { maxArrayItems: 25, maxStringChars: 150, maxObjectKeys: 50, maxDepth: 6 },
  { maxArrayItems: 10, maxStringChars: 80, maxObjectKeys: 30, maxDepth: 4 },
  { maxArrayItems: 5, maxStringChars: 60, maxObjectKeys: 20, maxDepth: 3 },
];

interface ReductionStats {
  arraysCapped: number;
  itemsOmitted: number;
  stringsClipped: number;
  subtreesStubbed: number;
  keysOmitted: number;
}

export interface ReductionReport extends ReductionStats {
  reduced: boolean;
  skeleton: boolean;
  originalChars: number;
  finalChars: number;
}

export interface ReductionResult {
  text: string;
  report: ReductionReport;
}

export interface ReductionOptions {
  budgetChars: number;
  ladder: readonly ReductionProfile[];
  indent?: number;
}

function emptyStats(): ReductionStats {
  return { arraysCapped: 0, itemsOmitted: 0, stringsClipped: 0, subtreesStubbed: 0, keysOmitted: 0 };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): boolean {
  return v === null || typeof v !== 'object';
}

function clipString(s: string, maxChars: number, stats: ReductionStats): string {
  if (s.length <= maxChars) return s;
  stats.stringsClipped++;
  if (JSON_LIKE_STRING_PATTERN.test(s)) return `[JSON string omitted: ${s.length} chars]`;
  return `${s.slice(0, maxChars)}… [clipped from ${s.length} chars]`;
}

function essentialStringLimit(profile: ReductionProfile): number {
  return Math.max(profile.maxStringChars, ESSENTIAL_STRING_MIN_CHARS);
}

function stubObject(obj: Record<string, unknown>, stats: ReductionStats): Record<string, unknown> {
  stats.subtreesStubbed++;
  const stub: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (ESSENTIAL_KEY_PATTERN.test(k) && isScalar(v)) {
      stub[k] = typeof v === 'string' ? clipString(v, ESSENTIAL_STRING_MIN_CHARS, stats) : v;
    }
  }
  const omitted = Object.keys(obj).length - Object.keys(stub).length;
  if (omitted > 0) stub[OMITTED_FIELD_KEY] = `${omitted} nested field(s)`;
  return stub;
}

function reduceNode(v: unknown, profile: ReductionProfile, depth: number, stats: ReductionStats): unknown {
  if (typeof v === 'string') return clipString(v, profile.maxStringChars, stats);
  if (Array.isArray(v)) {
    if (depth >= profile.maxDepth) {
      stats.subtreesStubbed++;
      return `[array of ${v.length} items omitted]`;
    }
    const kept: unknown[] = v.slice(0, profile.maxArrayItems).map((item) => reduceNode(item, profile, depth + 1, stats));
    if (v.length > profile.maxArrayItems) {
      const omitted = v.length - profile.maxArrayItems;
      stats.arraysCapped++;
      stats.itemsOmitted += omitted;
      kept.push(`[${omitted} more items omitted — ${v.length} total]`);
    }
    return kept;
  }
  if (isPlainObject(v)) {
    if (depth >= profile.maxDepth) return stubObject(v, stats);
    const entries = Object.entries(v);
    const essentialCount = entries.filter(([k]) => ESSENTIAL_KEY_PATTERN.test(k)).length;
    let nonEssentialBudget = Math.max(0, profile.maxObjectKeys - essentialCount);
    let omittedKeys = 0;
    const out: Record<string, unknown> = Object.create(null);
    for (const [k, val] of entries) {
      const essential = ESSENTIAL_KEY_PATTERN.test(k);
      if (!essential) {
        if (nonEssentialBudget === 0) {
          omittedKeys++;
          continue;
        }
        nonEssentialBudget--;
      }
      out[k] = essential && typeof val === 'string'
        ? clipString(val, essentialStringLimit(profile), stats)
        : reduceNode(val, profile, depth + 1, stats);
    }
    if (omittedKeys > 0) {
      stats.keysOmitted += omittedKeys;
      out[OMITTED_FIELD_KEY] = `${omittedKeys} more field(s)`;
    }
    return out;
  }
  return v;
}

function skeletonOf(v: unknown, stats: ReductionStats): unknown {
  if (Array.isArray(v)) {
    const first = v[0];
    return {
      [OMITTED_FIELD_KEY]: `array of ${v.length} items too large to display`,
      first_item: isPlainObject(first) ? stubObject(first, stats) : typeof first === 'string' ? clipString(first, ESSENTIAL_STRING_MIN_CHARS, stats) : first ?? null,
    };
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    return {
      ...stubObject(v, stats),
      field_names: keys.slice(0, MAX_SKELETON_KEY_NAMES).map((k) => clipString(k, SKELETON_KEY_NAME_MAX_CHARS, stats)),
    };
  }
  return typeof v === 'string' ? clipString(v, ESSENTIAL_STRING_MIN_CHARS, stats) : v;
}

export function reduceToBudget(value: unknown, options: ReductionOptions): ReductionResult {
  const indent = options.indent ?? DEFAULT_JSON_INDENT;
  const original = JSON.stringify(value, null, indent);
  const originalChars = original.length;
  if (originalChars <= options.budgetChars) {
    return { text: original, report: { ...emptyStats(), reduced: false, skeleton: false, originalChars, finalChars: originalChars } };
  }
  for (const profile of options.ladder) {
    const stats = emptyStats();
    const text = JSON.stringify(reduceNode(value, profile, 0, stats), null, indent);
    if (text.length <= options.budgetChars) {
      return { text, report: { ...stats, reduced: true, skeleton: false, originalChars, finalChars: text.length } };
    }
  }
  const stats = emptyStats();
  const skeletonText = JSON.stringify(skeletonOf(value, stats), null, indent);
  if (skeletonText.length <= options.budgetChars) {
    return { text: skeletonText, report: { ...stats, reduced: true, skeleton: true, originalChars, finalChars: skeletonText.length } };
  }
  const fallbackText = JSON.stringify(FINAL_FALLBACK_VALUE, null, indent);
  if (fallbackText.length <= options.budgetChars) {
    return { text: fallbackText, report: { ...stats, reduced: true, skeleton: true, originalChars, finalChars: fallbackText.length } };
  }
  // For arbitrarily small budgets, use a minimal valid JSON fallback that always fits for budgetChars >= 2.
  const minimalText = Array.isArray(value) ? MINIMAL_ARRAY_FALLBACK : MINIMAL_FALLBACK;
  return { text: minimalText, report: { ...stats, reduced: true, skeleton: true, originalChars, finalChars: minimalText.length } };
}

export function clampText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const marker = `… [clipped from ${text.length} chars]`;
  return text.slice(0, Math.max(0, maxChars - marker.length)) + marker;
}

export function enforceHardCap(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const keep = Math.max(0, maxChars - HARD_CAP_MARKER.length);
  const lineBoundary = text.lastIndexOf('\n', keep);
  const cut = lineBoundary > 0 ? lineBoundary : keep;
  return text.slice(0, cut) + HARD_CAP_MARKER;
}
