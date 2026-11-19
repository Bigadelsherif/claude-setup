/**
 * Pixel comparison — secondary, and residue-only.
 *
 * Runs after the IR comparison and reports only what the IR could not explain.
 * If the container is 100px too wide, everything to its right differs;
 * reporting that as forty pixel findings would bury the one correction that
 * fixes them all.
 *
 * A pixel difference is never a defect on its own. Every finding is
 * `informational` unless a named promotion rule fires — and the rules are
 * conditions, not thresholds on a number.
 */

import { CATEGORY, SEVERITY } from "./compare.mjs";

/** Promotion rules. Each is a condition with a name, not a magnitude. */
export const PROMOTION = Object.freeze({
  OVERFLOW_PAST_VIEWPORT: "content-overflows-the-viewport",
  TEXT_CLIPPED: "text-is-clipped",
  STACKING_INVERTED: "stacking-order-inverted"
});

/**
 * Regions the IR differences already explain.
 *
 * Each difference declares the area it would affect. Anything inside those
 * areas is attributed, not residue.
 */
export function attributedRegions(differences, { viewport }) {
  const regions = [];
  for (const d of differences) {
    if (d.category === CATEGORY.LAYOUT && /container|grid/.test(d.dimension)) {
      /* A container or grid change relocates everything. Marking the whole
       * viewport "attributed" would be technically true and useless: residue
       * would always be empty, and a genuine pixel-only defect would be hidden
       * behind a layout difference that has nothing to do with it. Global
       * geometry differences therefore SUPPRESS the pixel pass rather than
       * absorb it — the residue question is asked again once layout agrees. */
      regions.push({
        differenceId: d.id, dimension: d.dimension,
        box: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        suppressesPixelComparison: true,
        why: "a container or grid geometry change relocates all content; pixel comparison is not meaningful until layout agrees"
      });
    } else if (d.category === CATEGORY.COLOR) {
      regions.push({
        differenceId: d.id, dimension: d.dimension, box: null,
        why: "a token colour change affects every element using that role; matched by colour rather than by box"
      });
    } else if (d.category === CATEGORY.COMPONENTS) {
      regions.push({
        differenceId: d.id, dimension: d.dimension, box: null,
        why: "a component-scoped change affects each instance"
      });
    }
  }
  return regions;
}

/**
 * Classifies pixel clusters into attributed and residue.
 *
 * `clusters` come from whatever diff backend is in use; this module does not
 * decode images. Keeping the arithmetic out of here is what lets the pixel
 * backend be replaced without touching the reporting rules.
 */
export function classifyClusters(clusters, attributed, { viewport, maskedSelectors = [] }) {
  const inBox = (c, box) => box &&
    c.x < box.x + box.width && c.x + c.width > box.x &&
    c.y < box.y + box.height && c.y + c.height > box.y;

  const out = { attributed: [], residue: [], masked: [] };

  for (const cluster of clusters) {
    if (cluster.masked) { out.masked.push(cluster); continue; }

    const owner = attributed.find((a) => inBox(cluster, a.box));
    if (owner) {
      out.attributed.push({ ...cluster, attributedTo: owner.differenceId, why: owner.why });
      continue;
    }

    const promotions = [];
    if (cluster.x + cluster.width > viewport.width) promotions.push(PROMOTION.OVERFLOW_PAST_VIEWPORT);
    if (cluster.clipsText) promotions.push(PROMOTION.TEXT_CLIPPED);
    if (cluster.stackingInverted) promotions.push(PROMOTION.STACKING_INVERTED);

    out.residue.push({
      ...cluster,
      severity: promotions.length ? SEVERITY.MEDIUM : SEVERITY.INFORMATIONAL,
      promotions,
      note: promotions.length
        ? `Promoted above informational by: ${promotions.join(", ")}.`
        : "Reported as informational. A pixel difference is not a design defect on its own."
    });
  }

  out.maskedSelectors = maskedSelectors;
  return out;
}

/**
 * The normalisation contract a capture must satisfy before its screenshot may
 * be diffed. Recorded with every screenshot so a comparison can prove it was
 * met rather than assume it.
 */
export function normalisationContract(meta) {
  const required = ["viewportWidth", "viewportHeight", "devicePixelRatio", "fontsReady", "networkIdle", "animationsFrozen"];
  const missing = required.filter((k) => meta?.[k] == null);
  return {
    satisfied: missing.length === 0,
    missing,
    devicePixelRatio: meta?.devicePixelRatio ?? null,
    note: "A 1x and a 2x screenshot are not comparable and must not be silently rescaled."
  };
}

/**
 * Intrinsic visual findings — single-render properties of the target.
 *
 * Measured correction to the plan. A comparative pixel diff between the
 * controlled reference and the fidelity target produced 42 clusters purely
 * because the copy differs: comparative diffing assumes equivalent content, and
 * an independent implementation does not have it. Overflow, clipping and
 * stacking inversion are not comparative properties — they hold or fail on one
 * render — so they are checked on the target alone and are immune to content
 * differences.
 */
export function intrinsicFindings(checks, { referenceChecks = null } = {}) {
  const findings = (checks?.findings ?? []).map((f) => ({
    ...f,
    severity: SEVERITY.MEDIUM,
    promotions: [f.rule],
    comparative: false,
    note: "An intrinsic property of the target's own render. No reference comparison was needed."
  }));

  /* When the reference exhibits the same rule, the target is not worse than the
   * thing it is copying, and the finding is demoted rather than dropped. */
  const referenceRules = new Set((referenceChecks?.findings ?? []).map((f) => f.rule));
  for (const f of findings) {
    if (referenceRules.has(f.rule)) {
      f.severity = SEVERITY.INFORMATIONAL;
      f.note = "The reference exhibits the same condition, so this is not a divergence from it.";
    }
  }

  return {
    findings,
    checkedElements: checks?.checkedElements ?? 0,
    referenceCheckedElements: referenceChecks?.checkedElements ?? null
  };
}

/** Builds the pixel section of a comparison report. */
export function pixelReport({ classified, contract, ran, suppressedBy = null }) {
  if (suppressedBy) {
    return {
      ran: false,
      suppressed: true,
      suppressedBy: suppressedBy.map((s) => ({ differenceId: s.differenceId, dimension: s.dimension })),
      reason:
        "A global geometry difference relocates all content, so a pixel diff would report the whole page. " +
        "Pixel comparison is deferred until the layout difference is corrected.",
      residue: [], attributed: [], masked: []
    };
  }
  if (!ran) {
    return {
      ran: false,
      reason: contract?.satisfied === false
        ? `normalisation contract unmet: missing ${contract.missing.join(", ")}`
        : "pixel comparison was not requested",
      residue: [], attributed: [], masked: []
    };
  }
  return {
    ran: true,
    devicePixelRatio: contract.devicePixelRatio,
    attributed: classified.attributed,
    residue: classified.residue,
    masked: classified.masked,
    maskedSelectors: classified.maskedSelectors,
    statement:
      `${classified.residue.length} pixel difference(s) could not be attributed to an IR difference. ` +
      `${classified.attributed.length} were attributed and are not reported as separate findings.`
  };
}
