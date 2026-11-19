/**
 * Page structure — landmarks and section order, from evidence already captured.
 *
 * Section 3 of every generated prompt said "No landmark structure was captured"
 * on every page ever analysed, including pages with a `<header>`, a `<nav>` and
 * a `<footer>`. Nothing populated `a11y.landmarks`, so the renderer's other
 * branch never ran. The evidence was there the whole time, in two places the
 * projection layer never read.
 *
 * Two rules govern everything here, and both exist because the alternative is a
 * plausible page outline that nobody measured:
 *
 *   A region is present because sampled nodes resolved INTO it, never because
 *   a denominator says so. `regionAvailable` cannot answer this question: the
 *   extractor buckets with `else if` and `inPrimary` wins first, so on a page
 *   whose primary region was inferred, every header and footer node is absorbed
 *   into `main` and the header count is zero by construction. That zero is an
 *   artifact of bucketing, not a fact about the page.
 *
 *   Order is claimed only where `nth-of-type` supplies it. Sibling order across
 *   different tag names is not recoverable from a DOM path, array order is
 *   sampling-rank order, and containers carry no vertical position. So the order
 *   of `header` / `main` / `footer` is NOT measured, and is never stated.
 */

/** Distinct, and the distinctions are the point. */
export const STRUCTURE_STATE = Object.freeze({
  OBSERVED: "observed",
  INFERRED: "inferred",
  ABSENT: "absent",
  UNCAPTURED: "uncaptured",
  UNMEASURABLE: "unmeasurable"
});

/** Elements that may root an outline. A `div` sequence is not a section list. */
const LANDMARK_TAGS = new Set(["main", "header", "footer", "nav", "aside"]);

/** Regions the extractor's `regionOf` can attribute a node to. */
const REGIONS = ["header", "nav", "main", "footer", "aside"];

const segmentsOf = (path) => String(path ?? "").split(">");
const nthOf = (seg) => {
  const m = String(seg ?? "").match(/nth-of-type\((\d+)\)/);
  return m ? Number(m[1]) : null;
};
const tagOf = (seg) =>
  String(seg ?? "").replace(/:nth-of-type\(\d+\)/, "").replace(/[.#[].*$/, "");

/**
 * How each landmark region stands, one entry per region.
 *
 * `main` is the only region whose absence can be asserted under truncation,
 * because the extractor resolves it with a document-wide
 * `querySelector("main, [role=main]")` rather than from the sampled set. Every
 * other region's absence is only supportable when the walk finished — a region
 * the walk never reached is unknown, not missing.
 */
function deriveLandmarks({ sampledByRegion, primaryRegion, truncated, hiddenDominant }) {
  const out = [];

  for (const region of REGIONS) {
    const sampled = Number(sampledByRegion?.[region] ?? 0);

    if (region === "main") {
      /* `exists` is the document-wide query's answer and is independent of the
       * node budget, so it outranks the sampled count in both directions. */
      if (primaryRegion?.exists === true || sampled > 0) {
        out.push({
          region, state: STRUCTURE_STATE.OBSERVED, sampled,
          basis: primaryRegion?.exists === true
            ? "a `main` or `[role=main]` element was found by a document-wide query"
            : `${sampled} sampled node(s) resolved to a \`main\` ancestor`
        });
      } else if (primaryRegion?.exists === false) {
        out.push({
          region, state: STRUCTURE_STATE.ABSENT, sampled: 0,
          basis: "the whole document was searched for `main` or `[role=main]` and none exists; this does not depend on how much of the page was sampled"
        });
      } else {
        out.push({
          region, state: STRUCTURE_STATE.UNMEASURABLE, sampled: 0,
          basis: "no primary-region resolution was recorded for this capture"
        });
      }
      continue;
    }

    if (sampled > 0) {
      out.push({
        region, state: STRUCTURE_STATE.OBSERVED, sampled,
        basis: `${sampled} sampled node(s) resolved to ${region === "aside" ? "an" : "a"} \`${region}\` ancestor`
      });
    } else if (truncated) {
      out.push({
        region, state: STRUCTURE_STATE.UNCAPTURED, sampled: 0,
        basis: "no sampled node resolved to this region, and the walk was truncated before it finished — absence here is unknown, not established"
      });
    } else if (hiddenDominant) {
      /* The walk finished, and finishing is not the same as looking.
       *
       * `absent` used to require only `!truncated`, because the node budget was
       * the one known way to under-sample. A page that hides itself is another:
       * alethia.earth skipped 1202 of 1205 nodes in 52 hidden or collapsed
       * subtrees, satisfied `!truncated`, and had every landmark reported
       * absent — including a header and footer nobody had opened a subtree to
       * look for (def_0051). */
      out.push({
        region, state: STRUCTURE_STATE.UNCAPTURED, sampled: 0,
        basis: "no sampled node resolved to this region, and hidden or collapsed subtrees outnumbered the visible nodes — this region was not observable in this capture, which is not the same as absent from the page"
      });
    } else {
      out.push({
        region, state: STRUCTURE_STATE.ABSENT, sampled: 0,
        basis: "the walk completed, examined more of the page than it skipped, and no sampled node resolved to this region"
      });
    }
  }

  return out;
}

/** Where the content lives, and whether the page said so or we worked it out. */
function deriveContentRegion(primaryRegion) {
  if (!primaryRegion) {
    return { state: STRUCTURE_STATE.UNMEASURABLE, selector: null, kind: null,
      visibleDescendants: null,
      basis: "no primary region was resolved for this capture" };
  }
  if (primaryRegion.kind === "explicit-main") {
    return {
      state: STRUCTURE_STATE.OBSERVED,
      selector: primaryRegion.selector ?? null,
      kind: primaryRegion.kind,
      visibleDescendants: primaryRegion.visibleDescendants ?? null,
      basis: "the page declares its content region with `main` or `[role=main]`"
    };
  }
  return {
    state: STRUCTURE_STATE.INFERRED,
    selector: primaryRegion.selector ?? null,
    kind: primaryRegion.kind ?? null,
    visibleDescendants: primaryRegion.visibleDescendants ?? null,
    basis: primaryRegion.kind === "inferred-largest-block"
      ? "the page declares no content landmark; this is the largest visible block outside header, footer and nav"
      : "the page declares no content landmark and no better candidate was found"
  };
}

/**
 * An ordered section list, or a stated reason there is none.
 *
 * Every condition below removes a way of being wrong, and all of them have to
 * hold. Two containers under one landmark root, diverging at a single segment,
 * all sharing one tag, each carrying an `nth-of-type`. Mixed tags mean the
 * order between them is not recoverable; a non-landmark root means the sequence
 * is a run of layout divs rather than the page's sections.
 */
function deriveOutline({ containers, truncated }) {
  const usable = (containers ?? []).filter((c) => c?.domPath);
  const refuse = (reason) => ({
    state: STRUCTURE_STATE.UNMEASURABLE, root: null, rootRegion: null,
    partial: false, sections: [], reason
  });

  if (usable.length < 2) {
    return refuse("fewer than two containers carry a DOM path, so no sequence exists to order");
  }

  const candidates = [];

  for (const region of REGIONS) {
    const inRegion = usable.filter((c) => c.region === region);
    if (inRegion.length < 2) continue;

    const paths = inRegion.map((c) => segmentsOf(c.domPath));
    let i = 0;
    while (paths.every((p) => p[i] !== undefined && p[i] === paths[0][i])) i++;
    if (i === 0) continue;

    /* The segment BEFORE the divergence is the root the sections sit in. */
    const rootTag = tagOf(paths[0][i - 1]);
    if (!LANDMARK_TAGS.has(rootTag)) continue;

    const bySibling = new Map();
    let ordersMissing = false;
    for (const c of inRegion) {
      const seg = segmentsOf(c.domPath)[i];
      if (seg === undefined) continue;
      const order = nthOf(seg);
      if (order === null) { ordersMissing = true; continue; }
      const key = `${tagOf(seg)}#${order}`;
      if (!bySibling.has(key)) {
        bySibling.set(key, { order, tag: tagOf(seg), contains: [] });
      }
      const entry = bySibling.get(key);
      if (!entry.contains.includes(c.selector)) entry.contains.push(c.selector);
    }

    if (ordersMissing) continue;
    if (bySibling.size < 2) continue;

    const tags = new Set([...bySibling.values()].map((s) => s.tag));
    if (tags.size !== 1) continue;

    candidates.push({
      root: paths[0].slice(0, i).join(">"),
      rootRegion: region,
      rootTag,
      sections: [...bySibling.values()].sort((a, b) => a.order - b.order)
    });
  }

  if (!candidates.length) {
    return refuse(
      "no set of containers forms an ordered sequence of same-tag siblings beneath a landmark element; " +
      "the order of anything below is therefore not established by this capture"
    );
  }

  /* The longest sequence is the page's section list; ties keep the first. */
  candidates.sort((a, b) => b.sections.length - a.sections.length);
  const best = candidates[0];

  return {
    state: STRUCTURE_STATE.OBSERVED,
    root: best.root,
    rootRegion: best.rootRegion,
    rootTag: best.rootTag,
    /* A truncated walk may have missed sections entirely. What it found is
     * still in the order it found them; it is simply not the whole list. */
    partial: truncated === true,
    sections: best.sections,
    reason: null
  };
}

/**
 * @param {object} raw  the extractor's output
 * @returns {object|null} `null` when there is no DOM to read structure from
 */
export function deriveStructure(raw) {
  if (!raw || !raw.coverage) return null;

  const truncated = raw.coverage.truncated === true;
  const primaryRegion = raw.primaryRegion ?? null;

  /* Read from the capture rather than from the assessed coverage, so structure
   * derivation does not depend on the order the pipeline runs its stages in. */
  const hiddenSkipped = raw.coverage.hiddenNodesSkipped ?? 0;
  const nodesVisible = raw.coverage.nodesVisible ?? 0;
  const hiddenDominant = hiddenSkipped > 0 && hiddenSkipped > nodesVisible;

  return {
    landmarks: deriveLandmarks({
      sampledByRegion: raw.coverage.sampledByRegion,
      primaryRegion,
      truncated,
      hiddenDominant
    }),
    contentRegion: deriveContentRegion(primaryRegion),
    outline: deriveOutline({ containers: raw.layout?.containers, truncated }),
    limits: {
      truncated,
      nodeCap: raw.coverage.nodeCap ?? null,
      /* Stated so a reader of `uncaptured` can see which of the two ways of
       * not-having-looked applied. */
      hiddenDominant,
      hiddenNodesSkipped: hiddenSkipped,
      nodesVisible,
      /* Stated so no reader upgrades a sectioning `<header>` into a site
       * banner: `regionOf` walks to the nearest `HEADER` or `role=banner` and
       * reports both as "header". The two are different things and this capture
       * does not tell them apart. */
      headerRoleAmbiguous: true
    }
  };
}
