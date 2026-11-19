/**
 * Colour maths. Used for contrast checking and for judging whether two
 * measured colours are "the same token" or genuinely different.
 */

export function parse(value) {
  if (typeof value !== "string") return null;
  const s = value.trim().toLowerCase();

  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  const rgb = s.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  return null;
}

export function toHex(value) {
  const c = parse(value);
  if (!c) return null;
  if (c.a < 1) return value;
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** WCAG relative luminance. */
export function luminance(value) {
  const c = parse(value);
  if (!c) return null;
  const ch = [c.r, c.g, c.b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1..21. Returns null if either colour is unparseable. */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  if (a == null || b == null) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Cheap perceptual distance — good enough to decide "same token or not". */
export function distance(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  const rMean = (x.r + y.r) / 2;
  const dr = x.r - y.r;
  const dg = x.g - y.g;
  const db = x.b - y.b;
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db
  );
}

/**
 * Neutral = low absolute chroma.
 *
 * The threshold is 40/255 rather than something tighter because near-black
 * brand-ish greys carry real channel spread: #101828 has a spread of 24 and
 * reads as black, while #3538cd has 152 and reads as blue. A tight threshold
 * classifies dark text colours as "coloured" and lets them win brand-colour
 * inference — which is exactly the wrong answer.
 */
export function isNeutral(value, tolerance = 40) {
  const c = parse(value);
  if (!c) return false;
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  return max - min <= tolerance;
}

export function isLight(value) {
  const l = luminance(value);
  return l == null ? null : l > 0.5;
}
