import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";
import { isTokenable } from "./fmt.mjs";
import { STATUS } from "../evidence/status.mjs";

/**
 * IR -> screenshot-evidence-report.md
 *
 * Written only for screenshot-only analyses, and written whether the run is
 * allowed or blocked. It exists so a reader can see the shape of the degradation
 * — which regions were looked at, what the pixels could and could not say —
 * before reading a single value.
 */
export function projectScreenshotReport(ir, hash) {
  const s = ir.screenshot;
  const out = [];
  const push = (l = "") => out.push(l);

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Screenshot evidence report — ${ir.meta.slug}`, nextAction: "nothing here can support a rebuild or an adaptation. Capture the reference as a live page for those." }));
  push();
  push("> **This analysis has no DOM.** Every value below was read from pixels. Declared styles, breakpoints, motion timing and font sources are not merely missing — they are unknowable from an image, and are reported as unknown rather than estimated.");
  push();

  if (!s) {
    push("No screenshot metadata is attached to this IR.");
    return out.join("\n");
  }

  /* --------------------------------------------------------------- images */

  push("## Images");
  push();
  push("| File | Dimensions | Viewport | Captured |");
  push("| --- | --- | --- | --- |");
  for (const image of s.images) {
    push(
      `| \`${image.file}\` | ${image.width}×${image.height} | ` +
        `${image.viewport != null ? `${image.viewport}px` : "**unknown**"} | ${image.captureDate ?? "unknown"} |`
    );
  }
  push();
  push(`Scale relative to CSS pixels: **${s.scaleKnown ? "known" : "unknown"}**`);
  if (!s.scaleKnown) {
    push();
    push("Because the scale is unknown, every pixel measurement is capped at `estimated` no matter how precisely it was measured — the number has no verified unit.");
  }
  push();

  /* -------------------------------------------------------------- regions */

  push("## Analysed regions");
  push();
  push("| Region | Kind | Coordinates | Size | Detection | Confidence | Evidence |");
  push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const region of s.regions) {
    const c = region.coordinates;
    push(
      `| \`${region.id}\` | ${region.kind} | ${c.x},${c.y} | ${c.width}×${c.height} | ` +
        `${region.detectionMethod === "inferred" ? "**inferred**" : "explicit"} | ` +
        `${region.confidence.toFixed(2)} | ${region.evidenceIds.length} |`
    );
  }
  push();

  const inferred = s.regions.filter((r) => r.detectionMethod === "inferred");
  if (inferred.length) {
    push(`${inferred.length} region(s) were detected rather than supplied. Their bounds are themselves inferences, so every measurement inside them inherits that uncertainty.`);
    push();
  }

  const detectedKinds = [...new Set(s.regions.map((r) => r.kind))];
  push(`**Detected page sections:** ${detectedKinds.join(", ") || "none"}`);
  const cards = s.regions.filter((r) => r.kind === "card");
  push(`**Detected components:** ${cards.length ? `${cards.length} card region(s)` : "none identified"}`);
  push();

  /* ------------------------------------------------------ what was found */

  const byStatus = { measured: [], observed: [], inferred: [], estimated: [], unknown: [] };
  const walk = (node, path) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (Object.hasOwn(node, "status") && Object.hasOwn(node, "confidence")) {
      (byStatus[node.status] ??= []).push({ path, value: node.value, confidence: node.confidence });
      return;
    }
    for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key);
  };
  walk(ir.tokens, "tokens");
  walk(ir.scales, "scales");
  walk(ir.layout, "layout");

  push("## Measured pixel relationships");
  push();
  if (byStatus.observed.length) {
    push("Values the image can support at `observed` — scale-independent relationships, or measurements against a known scale:");
    push();
    for (const c of byStatus.observed) push(`- \`${c.path}\` = **${c.value}** (confidence ${c.confidence.toFixed(2)})`);
  } else {
    push("No value reached `observed`. Everything measurable here is an estimate.");
  }
  push();

  push("## Estimated values");
  push();
  if (byStatus.estimated.length) {
    push("Read from pixels, but without a verified unit or with edge uncertainty. **These are approximations, not measurements.**");
    push();
    for (const c of byStatus.estimated) push(`- \`${c.path}\` ≈ **${c.value}** (confidence ${c.confidence.toFixed(2)})`);
  } else {
    push("None.");
  }
  push();

  if (byStatus.inferred.length) {
    push("## Inferred tokens");
    push();
    push("Patterns across several estimates. An inference built on estimates is weaker than either.");
    push();
    for (const c of byStatus.inferred) push(`- \`${c.path}\` = ${c.value} (confidence ${c.confidence.toFixed(2)})`);
    push();
  }

  /* ------------------------------------------------------------- unknowns */

  push("## Unknown values");
  push();
  push("Reported explicitly, because their absence is a property of the medium rather than a gap in effort. Nothing below was estimated to fill space.");
  push();
  for (const unknown of ir.unknowns ?? []) {
    push(`- \`${unknown.claim}\` — ${unknown.reason}`);
  }
  push();

  /* --------------------------------------------------- confidence by region */

  push("## Confidence by region");
  push();
  push("| Region | Evidence records | Mean confidence |");
  push("| --- | --- | --- |");
  for (const region of s.regions) {
    push(`| \`${region.id}\` | ${region.evidenceIds.length} | ${region.confidence.toFixed(2)} |`);
  }
  push();

  /* ---------------------------------------------------------- limitations */

  push("## Limitations");
  push();
  const limitations = [
    "No DOM: every value describes rendered appearance, never declared style.",
    "Single frame per image: nothing time-dependent can be observed.",
    "Edge positions are subject to antialiasing.",
    "Colour values may be altered by image compression."
  ];
  if (!s.scaleKnown) limitations.push("Image scale is unknown, so no pixel measurement carries a verified unit.");
  if (!s.viewportKnown) limitations.push("Capture viewport is unknown, so rendered widths cannot be tied to CSS widths.");
  if (inferred.length) limitations.push(`${inferred.length} region bound(s) were detected rather than supplied.`);
  if (s.rejected?.length) limitations.push(`${s.rejected.length} observation(s) were rejected as invalid.`);
  for (const l of limitations) push(`- ${l}`);
  push();

  if (s.rejected?.length) {
    push("### Rejected");
    push();
    for (const r of s.rejected) push(`- ${r.kind} \`${r.id}\` — ${r.errors.join("; ")}`);
    push();
  }

  /* ------------------------------------------- recommended capture upgrade */

  push("## Recommended capture requirements");
  push();
  push("To lift this analysis out of estimation, supply in order of value:");
  push();
  push("1. **A live URL capture.** DOM and computed styles convert almost every estimate here into an observation, and answer the questions an image structurally cannot.");
  if (!s.viewportKnown) push("2. **The capture viewport** for each image, so rendered widths can be tied to CSS widths.");
  if (!s.scaleKnown) push("3. **The device pixel ratio**, so measurements carry a verified unit.");
  push("4. **Explicit region bounds** for header, hero, content, cards and footer, rather than leaving them to be detected.");
  push("5. **Additional viewport captures** to support responsive observations — though the exact breakpoint stays unknown without stylesheet evidence.");
  push("6. **Frames capturing hover and focus states**, which cannot otherwise be observed.");
  push();

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — correct the evidence and regenerate.*");

  return out.join("\n");
}

/**
 * IR -> estimated-tokens.json
 *
 * Generated ONLY on explicit request. A token file is a set of commitments and
 * an estimate is not one, so the default for screenshot analysis is to emit no
 * token file at all. When one is requested, every entry is stamped with its
 * source, status, confidence, region and limitations, and the filename itself
 * refuses to be mistaken for `extracted-tokens.json`.
 */
export function projectEstimatedTokens(ir, hash) {
  const out = {
    $description: `ESTIMATED tokens from screenshot analysis of ${ir.meta.source.value}`,
    $warning:
      "Every value here was read from pixels, not from declared styles. These are estimates. Do not treat this file as a token system, and do not rename it to extracted-tokens.json.",
    $extensions: {
      "helmy.dev": {
        irHash: hash,
        slug: ir.meta.slug,
        sourceKind: "screenshot",
        scaleKnown: ir.screenshot?.scaleKnown ?? false,
        viewportKnown: ir.screenshot?.viewportKnown ?? false,
        capturedAt: ir.meta.capturedAt
      }
    }
  };

  const regionById = new Map((ir.screenshot?.regions ?? []).map((r) => [r.id, r]));

  const emit = (category, name, claim) => {
    if (!isTokenable(claim)) return;
    if (claim.status === STATUS.MEASURED || claim.status === STATUS.OBSERVED) {
      // Even an observed screenshot value is a rendered appearance, never a
      // declared token. It is emitted, but never as if it were exact.
    }
    (out[category] ??= {})[name] = {
      $value: claim.value,
      $type: category === "color" ? "color" : "dimension",
      $extensions: {
        "helmy.dev": {
          sourceKind: "screenshot",
          status: claim.status,
          confidence: claim.confidence,
          evidence: claim.evidence ?? [],
          region: resolveRegion(claim, regionById),
          limitations: [
            "Read from pixels rather than declared style.",
            ...(ir.screenshot?.scaleKnown ? [] : ["Image scale unknown; value has no verified unit."])
          ]
        }
      }
    };
  };

  for (const [name, claim] of Object.entries(ir.tokens.color ?? {})) emit("color", name, claim);
  for (const [name, claim] of Object.entries(ir.tokens.radius ?? {})) emit("radius", name, claim);
  for (const [name, claim] of Object.entries(ir.tokens.spacing ?? {})) emit("spacing", name, claim);

  const omitted = (ir.unknowns ?? []).map((u) => `${u.claim} — ${u.reason}`);
  out.$extensions["helmy.dev"].omitted = omitted;

  return out;
}

function resolveRegion(claim, regionById) {
  for (const region of regionById.values()) {
    if ((claim.evidence ?? []).some((id) => region.evidenceIds.includes(id))) {
      return { id: region.id, kind: region.kind, coordinates: region.coordinates };
    }
  }
  return null;
}
