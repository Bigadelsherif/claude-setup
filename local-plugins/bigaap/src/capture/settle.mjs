/**
 * Mount-aware settle: observe what a page renders, not what it shipped.
 *
 * The capture this replaces waited for network idle, scrolled once in fixed
 * 800px steps, slept, and extracted. That is right for a server-rendered page
 * and wrong for one that defers mounting. Measured on a real deferred site at
 * three viewports: 1218 DOM nodes of which exactly THREE were visible, 45
 * `display-none` subtrees, zero repeat groups, and an `asset-timeout` because
 * the network never went idle. Every gate refused, correctly — the tool had
 * learned almost nothing and said so. What it could not do was look again.
 *
 * So this phase does three things the old one did not:
 *
 *   1. **Measures instead of assuming.** It snapshots visible and total node
 *      counts, hidden subtrees with their reasons, and image state, then acts on
 *      the numbers rather than following a fixed script.
 *   2. **Loops until stable, within a strict budget.** Growth is the signal that
 *      content is still arriving; two consecutive identical snapshots are the
 *      signal that it has stopped.
 *   3. **Separates the failure modes.** Images that never load is one fact;
 *      content that never mounts is a second; content deliberately hidden is a
 *      third. Conflating them is what made the original capture unreadable.
 *
 * What this phase deliberately does NOT do:
 *
 *   - It does not decide whether the capture is analysable. Coverage,
 *     observability and the mode gates own that, and they already refuse
 *     correctly. This only changes what they are given to look at.
 *   - It does not lower a threshold, fill a missing value, or infer anything.
 *     Every number it reports was counted at a moment it records.
 *   - It does not slow the ordinary path. A page that is already stable exits
 *     after one pass — the same work the previous implementation always did.
 *
 * Every dependency is injected — `snapshot`, `scrollPass`, `sleep`, `now` — so
 * the loop can be driven against scripted DOM states without a browser. The
 * algorithm is the part worth pinning; driving a real renderer proves the
 * plumbing and is exercised separately.
 */

/** How the settle phase ended. Reported, never inferred downstream. */
export const SETTLE_END = Object.freeze({
  /** The first pass changed nothing: the page was already mounted. */
  ALREADY_STABLE: "already-stable",
  /** Counts stopped changing across consecutive passes. */
  STABILISED: "stabilised",
  /** The pass budget ran out while the page was still growing. */
  PASS_BUDGET: "pass-budget-exhausted",
  /** The wall-clock budget ran out. */
  TIME_BUDGET: "time-budget-exhausted",
  /** Nothing was ever visible, so there was nothing to stabilise. */
  NOTHING_VISIBLE: "nothing-visible"
});

/**
 * What the settle phase concluded about the capture it hands on.
 *
 * `refused` means "this settle produced nothing to analyse", NOT "the analysis
 * is refused" — that decision belongs to the gates and is made later, on the
 * evidence. The two are kept apart deliberately.
 */
export const SETTLE_OUTCOME = Object.freeze({
  COMPLETE: "complete",
  RECOVERED: "recovered-with-warnings",
  REFUSED: "refused"
});

/**
 * Bounds. Strict, and small enough that an ordinary page pays almost nothing.
 *
 * `maxPasses` counts scroll passes in total, so a stable page performs exactly
 * one — the same work the previous implementation did unconditionally.
 */
export const SETTLE_BUDGET = Object.freeze({
  maxPasses: 4,
  maxMs: 25_000,
  dwellMs: 140,
  imageWaitMs: 4_000,
  /** Fraction of nodes hidden at or above which the page is hidden-dominant. */
  hiddenDominanceRatio: 0.5
});

/**
 * The page-side measurement.
 *
 * Counts what is rendered rather than what exists. A node is visible when it has
 * layout area and is not hidden by display, visibility, opacity or
 * `aria-hidden` — deliberately the same notion the extractor's coverage uses, so
 * the two numbers can be compared rather than merely coexisting.
 *
 * Hidden SUBTREES are counted rather than hidden nodes alone: 1215 hidden nodes
 * in 52 subtrees describes a page with 52 unmounted regions, which is a
 * different finding from 1215 individually hidden elements.
 */
export const MOUNT_SNAPSHOT = () => {
  const all = document.querySelectorAll("body *");

  /* A TOP-DOWN walk that does not descend past a hidden element, mirroring
   * `surveyDocument` in the extractor.
   *
   * A flat scan over every node gets this badly wrong, and measurably so. On a
   * real deferred page a flat scan reported 699 of 1205 nodes visible while the
   * extractor reported 3: `opacity: 0` and `content-visibility: hidden` on an
   * ancestor leave a descendant's own computed style innocent and its rect
   * non-zero, so each child looks visible when judged alone. The extractor stops
   * at the ancestor and counts the whole subtree once. Two different numbers for
   * "visible" is exactly the kind of quietly incompatible pair this project
   * exists to avoid, so this walk is shaped like the one it must agree with. */
  const hiddenReason = (el, cs, rect) => {
    if (!cs) return "no-computed-style";
    if (cs.display === "none") return "display-none";
    if (cs.visibility === "hidden" || cs.visibility === "collapse") return "visibility-hidden";
    if (el.getAttribute("aria-hidden") === "true") return "aria-hidden";
    if (el.hasAttribute("inert")) return "inert";
    if (el.hasAttribute("hidden")) return "hidden-attr";
    if (cs.opacity !== "" && parseFloat(cs.opacity) === 0) return "opacity-zero";
    if (cs.contentVisibility === "hidden") return "content-visibility-hidden";
    if (!rect || rect.width <= 0 || rect.height <= 0) return "zero-area";
    if (rect.bottom < 0 || rect.right < 0) return "off-screen";
    return null;
  };

  let visible = 0;
  let hiddenRoots = 0;
  let hiddenNodes = 0;
  const reasons = {};

  const stack = [];
  const body = document.body;
  if (body) for (let i = body.children.length - 1; i >= 0; i--) stack.push(body.children[i]);

  let guard = 0;
  while (stack.length && guard++ < 40000) {
    const el = stack.pop();
    let cs = null, rect = null;
    try { cs = getComputedStyle(el); rect = el.getBoundingClientRect(); } catch { /* treated as hidden */ }
    const why = hiddenReason(el, cs, rect);

    if (why) {
      /* The outermost hidden element is the finding; its descendants are hidden
       * because it is. Counting them separately would report one unmounted
       * section as hundreds of findings. */
      hiddenRoots++;
      reasons[why] = (reasons[why] ?? 0) + 1;
      let size = 1;
      try { size = el.querySelectorAll("*").length + 1; } catch { /* keep 1 */ }
      hiddenNodes += size;
      continue;
    }

    visible++;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
  }

  const imgs = [...document.images];
  let loaded = 0, failed = 0, pending = 0;
  for (const img of imgs) {
    if (img.complete && img.naturalWidth > 0) loaded++;
    else if (img.complete) failed++;
    else pending++;
  }

  return {
    totalNodes: all.length,
    visibleNodes: visible,
    /* Counted from the skipped subtrees rather than derived as total minus
     * visible: the walk never enumerates what it does not descend into, so the
     * subtraction would silently include nodes nobody looked at. */
    hiddenNodes,
    hiddenSubtrees: hiddenRoots,
    hiddenByReason: reasons,
    images: { total: imgs.length, loaded, failed, pending },
    documentHeight: document.body.scrollHeight,
    viewportHeight: window.innerHeight,
    scrollY: Math.round(window.scrollY),
    maxScrollY: Math.max(0, document.body.scrollHeight - window.innerHeight)
  };
};

/**
 * One incremental scroll pass, viewport-sized, returning to the top.
 *
 * Viewport-sized rather than a fixed 800px because a lazy loader keyed to the
 * viewport can be stepped over by a smaller increment and never fire. The dwell
 * between steps is what gives a mount the chance to happen; without it this is a
 * jump to the bottom, which many loaders see as a single intersection event.
 *
 * It returns to the top because every geometric measurement downstream is taken
 * relative to the initial scroll position, and leaving the page scrolled would
 * silently move every rect the extractor reads.
 */
export const SCROLL_PASS = async (dwellMs) => {
  const nap = (ms) => new Promise((r) => setTimeout(r, ms));

  /* A visible-node count using the SAME rule as `MOUNT_SNAPSHOT`, including
   * its refusal to descend past a hidden ancestor. Duplicated here rather
   * than shared because both run page-side in separate `evaluate` calls and
   * cannot close over a common helper.
   *
   * WHY THIS EXISTS. Every snapshot the settle loop took was measured AFTER
   * this function returned to the top, so "hidden" always meant "hidden at
   * rest". On a scroll-animated page that reports content as hidden which a
   * visitor plainly sees — and on a responsive page at a narrow width it
   * cannot tell that from markup the design genuinely removes. Sampling
   * DURING the scroll is what separates the two. */
  const countVisible = () => {
    let visible = 0;
    const stack = [];
    const body = document.body;
    if (body) for (let i = body.children.length - 1; i >= 0; i--) stack.push(body.children[i]);
    let guard = 0;
    while (stack.length && guard++ < 40000) {
      const el = stack.pop();
      let cs = null, rect = null;
      try { cs = getComputedStyle(el); rect = el.getBoundingClientRect(); } catch { continue; }
      if (!cs) continue;
      if (cs.display === "none") continue;
      if (cs.visibility === "hidden" || cs.visibility === "collapse") continue;
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.hasAttribute("inert") || el.hasAttribute("hidden")) continue;
      if (cs.opacity !== "" && parseFloat(cs.opacity) === 0) continue;
      if (cs.contentVisibility === "hidden") continue;
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      visible++;
      for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]);
    }
    return visible;
  };

  const positions = [];
  const samples = [];
  const step = Math.max(200, window.innerHeight);
  const heightAtStart = document.body.scrollHeight;
  for (let y = 0; y <= heightAtStart; y += step) {
    window.scrollTo(0, y);
    positions.push(Math.round(window.scrollY));
    await nap(dwellMs);
    /* Sampled while the page is HELD at this offset, after its dwell — so a
     * reveal driven by an intersection observer or a transition has had the
     * same chance to run that the survey gives it. */
    samples.push({ scrollY: Math.round(window.scrollY), visible: countVisible() });
  }
  window.scrollTo(0, 0);
  await nap(dwellMs);
  positions.push(0);
  return { positions, step, heightAtStart, samples };
};

/** Two snapshots describe the same page when nothing countable moved. */
const sameShape = (a, b) =>
  !!a && !!b &&
  a.totalNodes === b.totalNodes &&
  a.visibleNodes === b.visibleNodes &&
  a.documentHeight === b.documentHeight;

/**
 * Runs the settle phase and returns everything it observed.
 *
 * @param {object} io
 * @param {() => Promise<object>} io.snapshot     takes a MOUNT_SNAPSHOT
 * @param {(dwellMs:number) => Promise<object>} io.scrollPass  one scroll pass
 * @param {(ms:number) => Promise<void>} io.sleep
 * @param {() => number} [io.now]
 * @param {object} [io.budget]
 * @param {(message:string) => void} [io.onProgress]
 */
export async function mountAwareSettle({
  snapshot, scrollPass, sleep, now = () => Date.now(),
  budget = SETTLE_BUDGET, onProgress = null
} = {}) {
  const b = { ...SETTLE_BUDGET, ...budget };
  const startedAt = now();
  const say = (m) => onProgress?.(m);

  const initial = await snapshot();
  const passes = [];
  let previous = initial;
  let current = initial;
  let endedBy = null;

  /* A pending image is worth a bounded wait before concluding anything: a late
   * image changes layout, and layout is what the geometry pass reads. The wait
   * is capped and its outcome recorded either way — a timeout here is a fact
   * about the page, not a reason to abandon the capture. This is also the point
   * at which "images did not load" stops being confused with "content did not
   * mount": they are measured separately from here on. */
  let imageWaitMs = 0;
  if ((initial.images?.pending ?? 0) > 0) {
    const waitStart = now();
    say(`waiting up to ${b.imageWaitMs}ms for ${initial.images.pending} pending image(s)`);
    while (now() - waitStart < b.imageWaitMs) {
      await sleep(Math.min(250, b.imageWaitMs));
      current = await snapshot();
      if ((current.images?.pending ?? 0) === 0) break;
    }
    imageWaitMs = now() - waitStart;
    previous = current;
  }

  for (let pass = 1; pass <= b.maxPasses; pass++) {
    if (now() - startedAt > b.maxMs) { endedBy = SETTLE_END.TIME_BUDGET; break; }

    say(`settle pass ${pass} of ${b.maxPasses}`);
    const scroll = await scrollPass(b.dwellMs);
    await sleep(b.dwellMs);
    /* Re-probe after every recovery action, so each pass is judged on a fresh
     * measurement rather than on the one that motivated it. */
    const after = await snapshot();

    passes.push({
      pass,
      scrollPositions: scroll?.positions ?? [],
      scrollStep: scroll?.step ?? null,
      before: {
        totalNodes: previous.totalNodes,
        visibleNodes: previous.visibleNodes,
        documentHeight: previous.documentHeight
      },
      after: {
        totalNodes: after.totalNodes,
        visibleNodes: after.visibleNodes,
        documentHeight: after.documentHeight
      },
      growth: {
        totalNodes: after.totalNodes - previous.totalNodes,
        visibleNodes: after.visibleNodes - previous.visibleNodes,
        documentHeight: after.documentHeight - previous.documentHeight
      },
      images: after.images ?? null,
      /* Per-step visibility sampled while the page was held at each offset. */
      samples: scroll?.samples ?? [],
      elapsedMs: now() - startedAt
    });

    const stable = sameShape(previous, after);
    previous = after;
    current = after;

    if (stable) {
      endedBy = pass === 1 ? SETTLE_END.ALREADY_STABLE : SETTLE_END.STABILISED;
      break;
    }
    if (pass === b.maxPasses) endedBy = SETTLE_END.PASS_BUDGET;
  }

  if (!endedBy) endedBy = SETTLE_END.PASS_BUDGET;
  if (current.visibleNodes === 0) endedBy = SETTLE_END.NOTHING_VISIBLE;

  const hiddenRatio = current.totalNodes > 0 ? current.hiddenNodes / current.totalNodes : 0;
  const hiddenDominant = hiddenRatio >= b.hiddenDominanceRatio;
  const imagesUnresolved = (current.images?.pending ?? 0) > 0;

  /* ── hidden at rest, versus never seen at all ──────────────────────────
   *
   * `hiddenRatio` above is measured at scrollY 0 and answers "how much of the
   * DOM is not rendering right now". That is a real fact and stays exactly as
   * it was — same numerator, same denominator, same 0.5 bar.
   *
   * It is the wrong question for "could this page be captured", and measuring
   * a real responsive site shows why: the same 4019-node document reports 47%
   * hidden at 1440, 53% at 768 and 81% at 375, because the design removes
   * desktop markup as the viewport narrows. A high ratio at 375 is the
   * SIGNATURE OF WORKING RESPONSIVE CSS, not of a failed capture — and the
   * 764 nodes still rendering there formed a complete page with a header,
   * nav, hero, five sections and a footer.
   *
   * So a second quantity is measured, against the SAME bar: how much of the
   * document was never visible at ANY sampled scroll offset. That is the
   * honest "we could not see this page" signal — unmounted content, a blank
   * render, a bot wall — and it is what sufficiency should rest on. Nothing
   * here is relaxed; a different question is asked. */
  const scrollSamples = passes.flatMap((p) => p.samples ?? []);
  const peakVisibleDuringScroll = scrollSamples.length
    ? Math.max(initial.visibleNodes, current.visibleNodes, ...scrollSamples.map((s) => s.visible))
    : Math.max(initial.visibleNodes, current.visibleNodes);

  /* Content hidden at the top that a scroll brought into view. Positive means
   * the page reveals on scroll; zero means what you see at rest is all there
   * is to see. */
  const scrollRevealedNodes = Math.max(0, peakVisibleDuringScroll - current.visibleNodes);

  const neverVisibleRatio = current.totalNodes > 0
    ? Math.max(0, current.totalNodes - peakVisibleDuringScroll) / current.totalNodes
    : 0;
  const unobservedDominant = neverVisibleRatio >= b.hiddenDominanceRatio;

  /* `complete` requires that nothing was left unresolved. Anything short of it
   * is `recovered-with-warnings`: the capture is usable and carries a named
   * reason it may be partial. `refused` is reserved for having nothing at all,
   * which no downstream reader should be able to mistake for an empty page. */
  let outcome = SETTLE_OUTCOME.COMPLETE;
  if (current.visibleNodes === 0) {
    outcome = SETTLE_OUTCOME.REFUSED;
  } else if (
    hiddenDominant || imagesUnresolved ||
    endedBy === SETTLE_END.PASS_BUDGET || endedBy === SETTLE_END.TIME_BUDGET
  ) {
    outcome = SETTLE_OUTCOME.RECOVERED;
  }

  return {
    $settleContract: "1",
    outcome,
    endedBy,
    passCount: passes.length,
    elapsedMs: now() - startedAt,
    imageWaitMs,
    budget: b,
    initial: {
      totalNodes: initial.totalNodes,
      visibleNodes: initial.visibleNodes,
      hiddenNodes: initial.hiddenNodes,
      hiddenSubtrees: initial.hiddenSubtrees,
      hiddenByReason: initial.hiddenByReason ?? {},
      images: initial.images ?? null,
      documentHeight: initial.documentHeight
    },
    final: {
      totalNodes: current.totalNodes,
      visibleNodes: current.visibleNodes,
      hiddenNodes: current.hiddenNodes,
      hiddenSubtrees: current.hiddenSubtrees,
      hiddenByReason: current.hiddenByReason ?? {},
      images: current.images ?? null,
      documentHeight: current.documentHeight,
      scrollY: current.scrollY ?? null
    },
    growth: {
      totalNodes: current.totalNodes - initial.totalNodes,
      visibleNodes: current.visibleNodes - initial.visibleNodes,
      documentHeight: current.documentHeight - initial.documentHeight
    },
    hiddenDominant,
    hiddenRatio: Math.round(hiddenRatio * 1000) / 1000,
    /* Measured DURING the scroll, not at rest — see the note above. */
    peakVisibleDuringScroll,
    scrollRevealedNodes,
    neverVisibleRatio: Math.round(neverVisibleRatio * 1000) / 1000,
    unobservedDominant,
    scrollSamples: scrollSamples.slice(0, 48),
    imagesUnresolved,
    passes,
    /* Stated rather than left to a reader's arithmetic. Content that never
     * mounted and images that never loaded are different findings needing
     * different responses, and the capture this replaces reported only the
     * second one. */
    note: current.visibleNodes === 0
      ? "Nothing was visible at any point. This is a mounting failure, not an empty page."
      : hiddenDominant
        ? "Hidden nodes outnumber visible ones after recovery. Content exists that this capture could not observe; absence of anything unlisted is unknown rather than established."
        : imagesUnresolved
          ? "Images were still pending when the budget expired. Layout that depends on them may not be final."
          : "The page stopped changing within budget."
  };
}
