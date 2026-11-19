import { isTokenable } from "./fmt.mjs";
import { STATUS } from "../evidence/status.mjs";

/**
 * IR -> extracted-tokens.json in Design Tokens Community Group format.
 *
 * DTCG is chosen so the file is consumable by Style Dictionary and friends —
 * which is most of what "export to another stack" means in practice.
 * Provenance rides along in $extensions so a token can always be traced back
 * to the measurement that produced it.
 *
 * Estimated and unknown values are excluded by design (validation rule V4):
 * a token file is a set of commitments, and a guess does not belong in one.
 */
export function projectTokens(ir, hash) {
  const t = ir.tokens;

  const ext = (claim) => ({
    "helmy.dev": {
      status: claim.status,
      confidence: claim.confidence,
      evidence: claim.evidence ?? []
    }
  });

  const token = (claim, type, transform = (v) => v) => ({
    $value: transform(claim.value),
    $type: type,
    $extensions: ext(claim)
  });

  const out = {
    $description: `Design tokens extracted from ${ir.meta.source.value}`,
    $extensions: {
      "helmy.dev": {
        irHash: hash,
        slug: ir.meta.slug,
        capturedAt: ir.meta.capturedAt,
        viewports: ir.meta.viewports,
        excluded: "Claims with status 'estimated' or 'unknown' are omitted — a token file records commitments, not guesses."
      }
    }
  };

  /* ---------------------------------------------------------------- colour */
  const color = {};
  for (const [name, claim] of Object.entries(t.color)) {
    if (!isTokenable(claim)) continue;
    const path = name.split(".");
    let node = color;
    for (const part of path.slice(0, -1)) node = node[part] ??= {};
    node[path.at(-1)] = token(claim, "color");
  }
  if (Object.keys(color).length) out.color = color;

  /* ------------------------------------------------------------ dimension */
  const spacing = {};
  for (const [step, claim] of Object.entries(t.spacing)) {
    if (!isTokenable(claim)) continue;
    spacing[step] = token(claim, "dimension", (v) => `${v}px`);
  }
  if (Object.keys(spacing).length) out.spacing = spacing;

  const radius = {};
  for (const [name, claim] of Object.entries(t.radius)) {
    if (!isTokenable(claim)) continue;
    radius[name] = token(claim, "dimension", (v) => `${v}px`);
  }
  if (Object.keys(radius).length) out.radius = radius;

  /* ----------------------------------------------------------- typography */
  const typography = {};
  for (const [role, group] of Object.entries(t.typography)) {
    const entry = {};
    if (isTokenable(group.fontFamily)) {
      entry.fontFamily = token(group.fontFamily, "fontFamily", (v) =>
        String(v).split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""))
      );
    }
    if (isTokenable(group.fontSize)) entry.fontSize = token(group.fontSize, "dimension", (v) => `${v}px`);
    if (isTokenable(group.fontWeight)) entry.fontWeight = token(group.fontWeight, "fontWeight");
    if (isTokenable(group.lineHeightRatio)) entry.lineHeight = token(group.lineHeightRatio, "number");
    else if (isTokenable(group.lineHeight)) {
      entry.lineHeight = token(group.lineHeight, group.lineHeight.unit === "px" ? "dimension" : "number",
        (v) => (group.lineHeight.unit === "px" ? `${v}px` : v));
    }
    if (isTokenable(group.letterSpacing)) entry.letterSpacing = token(group.letterSpacing, "dimension", (v) => `${v}em`);
    if (Object.keys(entry).length) typography[role] = entry;
  }
  if (Object.keys(typography).length) out.typography = typography;

  /* ------------------------------------------------------------ elevation */
  const shadow = {};
  for (const [name, claim] of Object.entries(t.elevation)) {
    if (!isTokenable(claim)) continue;
    shadow[name] = token(claim, "shadow");
  }
  if (Object.keys(shadow).length) out.shadow = shadow;

  const border = {};
  for (const [name, claim] of Object.entries(t.border)) {
    if (!isTokenable(claim)) continue;
    border[name] = token(claim, "border");
  }
  if (Object.keys(border).length) out.border = border;

  /* --------------------------------------------------------------- motion */
  const duration = {};
  const easing = {};
  for (const [role, group] of Object.entries(t.motion)) {
    if (isTokenable(group.duration)) duration[role] = token(group.duration, "duration", (v) => `${v}ms`);
    if (isTokenable(group.easing)) easing[role] = token(group.easing, "cubicBezier");
  }
  if (Object.keys(duration).length) out.duration = duration;
  if (Object.keys(easing).length) out.easing = easing;

  /* --------------------------------------------------------------- layout */
  const container = ir.layout.containers[0];
  if (container && isTokenable(container.maxWidth)) {
    out.layout = {
      containerMaxWidth: token(container.maxWidth, "dimension", (v) => `${v}px`)
    };
    if (isTokenable(container.paddingX)) {
      out.layout.containerPaddingX = token(container.paddingX, "dimension", (v) => `${v}px`);
    }
  }

  /* --------------------------------------------------------- omitted list */
  const omitted = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node ?? {})) {
      if (value && typeof value === "object" && Object.hasOwn(value, "status")) {
        if (value.status === STATUS.ESTIMATED || value.status === STATUS.UNKNOWN) {
          omitted.push(`${prefix}${key} (${value.status})`);
        }
      } else if (value && typeof value === "object") {
        walk(value, `${prefix}${key}.`);
      }
    }
  };
  walk(t, "");
  if (omitted.length) {
    out.$extensions["helmy.dev"].omittedClaims = omitted;
  }

  return out;
}
