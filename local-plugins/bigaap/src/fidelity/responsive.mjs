/**
 * Responsive comparison — the one comparison computed ACROSS viewports.
 *
 * Every other category compares a reference and a target at the same width.
 * This one compares how each side CHANGES between widths, which is a different
 * question and needs a different rule:
 *
 *   A value that differs between 1440 and 375 is not a defect. It is the point.
 *
 * So nothing here compares a reference value at one viewport against a target
 * value at another. What is compared is the reference's progression against the
 * target's progression: if the reference's grid steps 3 → 2 → 1 and the
 * target's steps 3 → 2 → 1, the target is faithful even though every individual
 * number differs across the row.
 */

import { SEVERITY } from "./compare.mjs";

/** The five outcomes a responsive dimension can have. */
export const RESPONSIVE_OUTCOME = Object.freeze({
  /** Both sides transform the same way. The transformation is the design. */
  EXPECTED_TRANSFORMATION: "expected-responsive-transformation",
  /** The target's progression differs from the reference's. */
  UNEXPECTED_DIFFERENCE: "unexpected-target-difference",
  /** One or both sides did not record the evidence this dimension needs. */
  UNAVAILABLE_EVIDENCE: "unavailable-evidence",
  /** A viewport in the series was paired with the wrong reference and blocked. */
  VIEWPORT_MISMATCH: "viewport-mismatch",
  /** The content mode makes the comparison meaningless rather than merely absent. */
  CONTENT_MODE_LIMITATION: "content-mode-limitation"
});

export const RESPONSIVE_DIMENSIONS = Object.freeze([
  "container-behavior", "grid-column-changes", "stacking-behavior",
  "section-ordering", "typography-changes", "spacing-changes",
  "navigation-transformation", "tap-target-dimensions",
  "overflow-behavior", "image-aspect-ratio-behavior"
]);

/**
 * A progression is the sequence of a value across viewports, widest first.
 *
 * `steps` records where the value CHANGES, which is what a responsive design
 * actually specifies — a breakpoint is a change, not a value.
 */
export function progressionOf(series, read) {
  const points = series
    .filter((s) => !s.blocked)
    .map((s) => ({ viewport: s.viewport, value: read(s) }))
    .sort((a, b) => b.viewport - a.viewport);

  const available = points.filter((p) => p.value != null);
  if (!available.length) return { points, available: 0, steps: [], signature: null };

  const steps = [];
  for (let i = 1; i < available.length; i++) {
    const prev = available[i - 1];
    const curr = available[i];
    if (String(prev.value) !== String(curr.value)) {
      steps.push({ from: prev.viewport, to: curr.viewport, fromValue: prev.value, toValue: curr.value });
    }
  }

  return {
    points,
    available: available.length,
    steps,
    /* Two progressions with the same signature transform the same way. */
    signature: steps.map((s) => `${s.from}>${s.to}:${s.fromValue}->${s.toValue}`).join("|") || "constant"
  };
}

function dimension({ name, reference, target, blockedViewports, contentModeLimited, severityIfDifferent = SEVERITY.MEDIUM, describe }) {
  /* A blocked viewport invalidates the whole progression rather than being
   * skipped, and that strictness is deliberate. Transformations cluster at the
   * narrow end: if 375px is missing, the remaining 1440/1024/768 points are all
   * constant, and comparing them would report "expected transformation" for a
   * navigation that was never observed changing. Discarding usable evidence is
   * the lesser error against asserting agreement from the three widths where
   * nothing happens. */
  if (blockedViewports?.length) {
    return {
      dimension: name,
      outcome: RESPONSIVE_OUTCOME.VIEWPORT_MISMATCH,
      blockedViewports,
      referenceProgression: reference?.signature ?? null,
      targetProgression: target?.signature ?? null,
      severity: SEVERITY.INFORMATIONAL,
      detail:
        `Viewport(s) ${blockedViewports.join(", ")} were blocked, so the progression is incomplete and is not ` +
        "compared. The remaining points are not compared either: responsive transformations cluster at the narrow " +
        "end, so a series missing a viewport can read as constant when it is not."
    };
  }
  if (contentModeLimited) {
    return {
      dimension: name,
      outcome: RESPONSIVE_OUTCOME.CONTENT_MODE_LIMITATION,
      severity: SEVERITY.INFORMATIONAL,
      referenceProgression: reference?.signature ?? null,
      targetProgression: target?.signature ?? null,
      detail: contentModeLimited
    };
  }
  if (!reference || !target || reference.available < 2 || target.available < 2) {
    return {
      dimension: name,
      outcome: RESPONSIVE_OUTCOME.UNAVAILABLE_EVIDENCE,
      severity: SEVERITY.INFORMATIONAL,
      referenceProgression: reference?.signature ?? null,
      targetProgression: target?.signature ?? null,
      detail:
        `Fewer than two viewports carry this evidence (reference ${reference?.available ?? 0}, ` +
        `target ${target?.available ?? 0}); a progression needs at least two points.`
    };
  }

  const same = reference.signature === target.signature;
  return {
    dimension: name,
    outcome: same ? RESPONSIVE_OUTCOME.EXPECTED_TRANSFORMATION : RESPONSIVE_OUTCOME.UNEXPECTED_DIFFERENCE,
    severity: same ? SEVERITY.INFORMATIONAL : severityIfDifferent,
    referenceProgression: reference.signature,
    targetProgression: target.signature,
    referencePoints: reference.points,
    targetPoints: target.points,
    referenceSteps: reference.steps,
    targetSteps: target.steps,
    detail: describe
      ? describe({ same, reference, target })
      : same
        ? `Both sides transform identically: ${reference.signature}.`
        : `The reference transforms as ${reference.signature}; the target transforms as ${target.signature}.`
  };
}

/**
 * Compares responsive behaviour across the viewport series.
 *
 * @param {Array} series  one entry per viewport: { viewport, blocked, referenceIR, targetIR, referenceProbe, targetProbe, contentMode }
 */
export function compareResponsive(series) {
  const blockedViewports = series.filter((s) => s.blocked).map((s) => s.viewport);
  const usable = series.filter((s) => !s.blocked);

  const grid = (s, side) => {
    const ir = side === "reference" ? s.referenceIR : s.targetIR;
    return (ir?.layout?.grids ?? [])[0] ?? null;
  };
  const container = (s, side) => {
    const ir = side === "reference" ? s.referenceIR : s.targetIR;
    return (ir?.layout?.containers ?? []).find((c) => c.role === "page") ?? null;
  };
  const probe = (s, side) => (side === "reference" ? s.referenceProbe : s.targetProbe) ?? null;

  const prog = (side, read) => progressionOf(usable, (s) => read(s, side));

  /* A dimension whose evidence comes only from the comparative pixel channel
   * would be content-mode limited. None of the ten are, so this stays null —
   * recorded rather than omitted so the classification is visibly reachable. */
  const contentModeLimitedFor = (name) =>
    name === "image-aspect-ratio-behavior" && usable.every((s) => s.contentMode?.comparativePixelAllowed === false)
      ? null   /* aspect ratio is read from layout, not from pixels; not limited */
      : null;

  const dims = [];

  dims.push(dimension({
    name: "container-behavior",
    reference: prog("reference", (s, side) => {
      const c = container(s, side);
      return c ? `${c.maxWidth?.value ?? "?"}/${c.paddingX?.value ?? "?"}` : null;
    }),
    target: prog("target", (s, side) => {
      const c = container(s, side);
      return c ? `${c.maxWidth?.value ?? "?"}/${c.paddingX?.value ?? "?"}` : null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("container-behavior"),
    severityIfDifferent: SEVERITY.HIGH
  }));

  dims.push(dimension({
    name: "grid-column-changes",
    reference: prog("reference", (s, side) => grid(s, side)?.columns?.value ?? null),
    target: prog("target", (s, side) => grid(s, side)?.columns?.value ?? null),
    blockedViewports, contentModeLimited: contentModeLimitedFor("grid-column-changes"),
    severityIfDifferent: SEVERITY.HIGH,
    describe: ({ same, reference, target }) => same
      ? `Both grids step ${reference.points.map((p) => p.value).join(" → ")} from ${reference.points.map((p) => p.viewport).join(" → ")}px.`
      : `The reference grid steps ${reference.points.map((p) => p.value).join(" → ")} and the target steps ${target.points.map((p) => p.value).join(" → ")} across ${reference.points.map((p) => p.viewport).join(" → ")}px.`
  }));

  dims.push(dimension({
    name: "stacking-behavior",
    reference: prog("reference", (s, side) => {
      const p = probe(s, side);
      return p?.stackables?.length ? p.stackables.map((x) => x.flexDirection).join(",") : null;
    }),
    target: prog("target", (s, side) => {
      const p = probe(s, side);
      return p?.stackables?.length ? p.stackables.map((x) => x.flexDirection).join(",") : null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("stacking-behavior"),
    severityIfDifferent: SEVERITY.HIGH
  }));

  dims.push(dimension({
    name: "section-ordering",
    reference: prog("reference", (s, side) => probe(s, side)?.sectionOrder?.join(">") ?? null),
    target: prog("target", (s, side) => probe(s, side)?.sectionOrder?.join(">") ?? null),
    blockedViewports, contentModeLimited: contentModeLimitedFor("section-ordering"),
    severityIfDifferent: SEVERITY.MEDIUM
  }));

  dims.push(dimension({
    name: "typography-changes",
    reference: prog("reference", (s, side) => {
      const ir = side === "reference" ? s.referenceIR : s.targetIR;
      return ir?.tokens?.typography?.body?.fontSize?.value ?? null;
    }),
    target: prog("target", (s, side) => {
      const ir = side === "reference" ? s.referenceIR : s.targetIR;
      return ir?.tokens?.typography?.body?.fontSize?.value ?? null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("typography-changes"),
    severityIfDifferent: SEVERITY.MEDIUM
  }));

  dims.push(dimension({
    name: "spacing-changes",
    reference: prog("reference", (s, side) => {
      const ir = side === "reference" ? s.referenceIR : s.targetIR;
      return ir?.scales?.spacingBaseUnit?.value ?? null;
    }),
    target: prog("target", (s, side) => {
      const ir = side === "reference" ? s.referenceIR : s.targetIR;
      return ir?.scales?.spacingBaseUnit?.value ?? null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("spacing-changes"),
    severityIfDifferent: SEVERITY.MEDIUM
  }));

  dims.push(dimension({
    name: "navigation-transformation",
    reference: prog("reference", (s, side) => {
      const n = probe(s, side)?.nav;
      return n ? `${n.flexDirection}/${n.linkWidthRatio}` : null;
    }),
    target: prog("target", (s, side) => {
      const n = probe(s, side)?.nav;
      return n ? `${n.flexDirection}/${n.linkWidthRatio}` : null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("navigation-transformation"),
    severityIfDifferent: SEVERITY.HIGH,
    describe: ({ same, reference, target }) => same
      ? `Navigation transforms identically on both sides: ${reference.signature}.`
      : `The reference navigation transforms as ${reference.signature}; the target as ${target.signature}. ` +
        "A navigation that never changes shape is not responding to the viewport at all."
  }));

  dims.push(dimension({
    name: "tap-target-dimensions",
    reference: prog("reference", (s, side) => probe(s, side)?.tapTargets?.minHeight ?? null),
    target: prog("target", (s, side) => probe(s, side)?.tapTargets?.minHeight ?? null),
    blockedViewports, contentModeLimited: contentModeLimitedFor("tap-target-dimensions"),
    severityIfDifferent: SEVERITY.HIGH,
    describe: ({ same, reference, target }) => {
      const narrowest = target.points[target.points.length - 1];
      const suffix = narrowest && narrowest.value != null && narrowest.value < 44
        ? ` At ${narrowest.viewport}px the target's smallest tap target is ${narrowest.value}px, below the 44px guideline.`
        : "";
      return (same
        ? `Both sides size tap targets identically across the series: ${reference.signature}.`
        : `The reference sizes tap targets as ${reference.signature}; the target as ${target.signature}.`) + suffix;
    }
  }));

  dims.push(dimension({
    name: "overflow-behavior",
    reference: prog("reference", (s, side) => {
      const o = probe(s, side)?.overflow;
      return o ? String(o.overflows) : null;
    }),
    target: prog("target", (s, side) => {
      const o = probe(s, side)?.overflow;
      return o ? String(o.overflows) : null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("overflow-behavior"),
    severityIfDifferent: SEVERITY.HIGH
  }));

  dims.push(dimension({
    name: "image-aspect-ratio-behavior",
    reference: prog("reference", (s, side) => {
      const m = probe(s, side)?.media;
      return m?.length ? m.map((x) => x.aspect).join(",") : null;
    }),
    target: prog("target", (s, side) => {
      const m = probe(s, side)?.media;
      return m?.length ? m.map((x) => x.aspect).join(",") : null;
    }),
    blockedViewports, contentModeLimited: contentModeLimitedFor("image-aspect-ratio-behavior"),
    severityIfDifferent: SEVERITY.MEDIUM
  }));

  const unexpected = dims.filter((d) => d.outcome === RESPONSIVE_OUTCOME.UNEXPECTED_DIFFERENCE);
  const compared = dims.filter((d) =>
    d.outcome === RESPONSIVE_OUTCOME.EXPECTED_TRANSFORMATION ||
    d.outcome === RESPONSIVE_OUTCOME.UNEXPECTED_DIFFERENCE);
  const unresolved = dims
    .filter((d) => !compared.includes(d))
    .map((d) => `${d.dimension} (${d.outcome})`);

  const severityDistribution = { critical: 0, high: 0, medium: 0, low: 0, informational: 0 };
  for (const d of unexpected) severityDistribution[d.severity]++;

  return {
    viewportsCompared: usable.map((s) => s.viewport),
    viewportsBlocked: blockedViewports,
    dimensions: dims,
    category: {
      category: "responsive",
      score: compared.length === 0 ? null : Number(((compared.length - unexpected.length) / compared.length).toFixed(3)),
      evidenceCoverage: Number((compared.length / RESPONSIVE_DIMENSIONS.length).toFixed(3)),
      mismatchCount: unexpected.length,
      severityDistribution,
      unresolvedClaims: unresolved,
      confidence: compared.length ? 0.9 : null,
      blockers: blockedViewports.map((v) => `${v}px was blocked and is excluded from every progression`),
      limitations: [
        "Progressions are compared as signatures: two sides agree when they change at the same widths by the same amounts.",
        "A value that differs between viewports is never treated as a defect — that is the transformation being measured."
      ]
    },
    /* Never a composite, and never an average of the per-viewport scores. */
    compositeScore: null
  };
}
