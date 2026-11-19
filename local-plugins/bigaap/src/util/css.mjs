/**
 * CSS value parsing and normalising.
 * Everything here is lossless-or-explicit: a value that cannot be parsed
 * returns null rather than a plausible-looking number.
 */

export function px(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(-?[\d.]+)px$/);
  return m ? round(parseFloat(m[1]), 3) : null;
}

export function num(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function round(n, dp = 2) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Computed values carry rem-rounding artefacts (16.008px for a 1.0005rem).
 * Snap to a nearby integer ONLY when the drift is tiny, and always report
 * whether snapping happened so the evidence can say so.
 *
 * The tolerance is deliberately small. A looser one would round genuine
 * fractional values — a 67.2px line height from 1.05 x 64px is a real
 * measurement, not an artefact, and quietly reporting it as 67px would be
 * fabricating precision.
 */
export function snap(value, tolerance = 0.05) {
  const n = typeof value === "number" ? value : px(value);
  if (n == null) return { value: null, snapped: false, raw: value };
  const nearest = Math.round(n);
  if (nearest !== n && Math.abs(nearest - n) <= tolerance) {
    return { value: nearest, snapped: true, raw: n };
  }
  return { value: round(n, 3), snapped: false, raw: n };
}

/** "1.05" | "24px" -> { kind, value } — line-height is either a ratio or a length. */
export function lineHeight(value, fontSizePx) {
  const asPx = px(value);
  if (asPx != null) {
    return {
      kind: "length",
      px: asPx,
      ratio: fontSizePx ? round(asPx / fontSizePx, 3) : null
    };
  }
  const n = num(value);
  if (n != null && value !== "normal") {
    return { kind: "ratio", ratio: round(n, 3), px: fontSizePx ? round(n * fontSizePx, 2) : null };
  }
  return { kind: "unknown", ratio: null, px: null };
}

/** "-0.03em" | "-1.92px" -> em, given a font size. */
export function letterSpacingEm(value, fontSizePx) {
  if (typeof value !== "string") return null;
  const em = value.match(/^(-?[\d.]+)em$/);
  if (em) return round(parseFloat(em[1]), 4);
  const asPx = px(value);
  if (asPx != null && fontSizePx) return round(asPx / fontSizePx, 4);
  return null;
}

/**
 * Splits a computed box-shadow into parts.
 * Chrome serialises as "rgba(...) 0px 8px 24px 0px" — colour first.
 */
export function shadow(value) {
  if (typeof value !== "string" || value === "none") return null;
  const colorMatch = value.match(/(rgba?\([^)]+\)|#[0-9a-f]{3,8})/i);
  const color = colorMatch ? colorMatch[1] : null;
  const lengths = (value.replace(color ?? "", "").match(/-?[\d.]+px/g) ?? []).map((v) => px(v));
  return {
    color,
    offsetX: lengths[0] ?? null,
    offsetY: lengths[1] ?? null,
    blur: lengths[2] ?? null,
    spread: lengths[3] ?? null,
    inset: /inset/.test(value),
    raw: value
  };
}

/** Canonical CSS form: "0 8px 24px rgba(16, 24, 40, 0.08)" */
export function shadowToCss(parsed) {
  if (!parsed) return null;
  const part = (n) => (n === 0 ? "0" : `${n}px`);
  const bits = [part(parsed.offsetX ?? 0), part(parsed.offsetY ?? 0), part(parsed.blur ?? 0)];
  if (parsed.spread) bits.push(part(parsed.spread));
  if (parsed.color) bits.push(parsed.color);
  return (parsed.inset ? "inset " : "") + bits.join(" ");
}

export function durationMs(value) {
  if (typeof value !== "string") return null;
  const ms = value.trim().match(/^([\d.]+)ms$/);
  if (ms) return round(parseFloat(ms[1]), 2);
  const s = value.trim().match(/^([\d.]+)s$/);
  if (s) return round(parseFloat(s[1]) * 1000, 2);
  return null;
}

/** Counts grid tracks, tolerating repeat() and minmax(). */
export function gridColumnCount(template) {
  if (typeof template !== "string" || !template.trim() || template === "none") return null;
  const repeat = template.match(/^repeat\(\s*(\d+)\s*,/);
  if (repeat) return parseInt(repeat[1], 10);
  return template.trim().split(/\s+(?![^(]*\))/).length;
}

export function fontFamilyStack(value) {
  if (typeof value !== "string") return null;
  return value
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}
