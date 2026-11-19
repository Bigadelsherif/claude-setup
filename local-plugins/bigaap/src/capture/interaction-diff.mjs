/**
 * Fine-grained interaction evidence: what actually changed when a control was
 * activated, at a granularity that can see it.
 *
 * The previous diff compared the page's REGION list — box, and copy capped at
 * 240 characters. That is the right granularity for describing a page and the
 * wrong one for describing a transition. On real sites almost every menu open
 * reported "no observable change", because opening a menu changes an
 * `aria-expanded` attribute and a `display` inside one nav, and none of that
 * reaches the region list. The observer could prove it had safely pressed
 * something and could not prove what happened.
 *
 * So this compares a BOUNDED SUBTREE around the target — its ancestors for
 * context, its descendants for effect — and reports which KIND of change
 * occurred, separately:
 *
 *   state    an aria/hidden/open/checked/disabled attribute moved
 *   content  text, an image source, or a selected index moved
 *   geometry a measured box moved or resized
 *   visual   display, visibility, opacity or transform moved
 *
 * Reported separately because they are different claims. "The button's
 * aria-expanded became true" is a fact. "The menu opens" is an interpretation,
 * and this module never makes it — it reports the attribute and lets the prompt
 * layer decide what may be said.
 *
 * PURE apart from `SUBTREE_SNAPSHOT`, which is serialised into the page and
 * only reads. Nothing here clicks anything; `interact.mjs` decides what is safe
 * to press and `inspect.mjs` presses it.
 */

export const INTERACTION_DIFF_CONTRACT = "1";

/**
 * What the diff concluded. Ordered by specificity: a transition that changed an
 * ARIA state AND a box is reported as a state change, because the state is the
 * thing a builder must reproduce and the box follows from it.
 */
export const INTERACTION_RESULT = Object.freeze({
  STATE: "changed-state-observed",
  CONTENT: "changed-content-observed",
  GEOMETRY: "changed-geometry-observed",
  VISUAL: "changed-visual-observed",
  NONE: "no-observable-change",
  REFUSED: "action-refused",
  FAILED: "action-failed",
  RESTORATION_FAILED: "restoration-failed"
});

/** Bounds. A subtree walk on a real page must not become a page walk. */
export const SUBTREE_BUDGET = Object.freeze({
  maxNodes: 160,
  maxDepth: 6,
  maxAncestors: 4,
  textCap: 160,
  maxChangesReported: 40
});

/**
 * The state attributes that carry meaning for the four control types this tool
 * activates. A closed list: an open-ended attribute sweep would pick up
 * framework bookkeeping that changes on every render and report it as a
 * transition.
 */
export const STATE_ATTRIBUTES = Object.freeze([
  "aria-expanded", "aria-hidden", "aria-selected", "aria-checked",
  "aria-current", "aria-pressed", "aria-disabled",
  "hidden", "inert", "open", "checked", "selected", "disabled"
]);

/** Style properties whose change is visible without the box moving. */
export const VISUAL_PROPERTIES = Object.freeze(["display", "visibility", "opacity", "transform"]);

/* --------------------------------------------------------------- the diff */

const nodesOf = (snapshot) => (snapshot?.nodes ?? []);
const byPath = (snapshot) => new Map(nodesOf(snapshot).map((n) => [n.domPath, n]));

const num = (v) => (Number.isFinite(v) ? v : null);
const geomChanged = (a, b) => {
  if (!a || !b) return false;
  for (const k of ["width", "height", "docTop", "docLeft"]) {
    if (num(a[k]) !== num(b[k])) return true;
  }
  return false;
};

/**
 * Compare two bounded subtree snapshots.
 *
 * Returns every change it found, grouped by kind, plus a single result class.
 * A node present in one snapshot and absent from the other is itself a change —
 * that is how a menu panel appearing is detected when nothing else moves.
 */
export function diffSubtrees(before, after, budget = SUBTREE_BUDGET) {
  const b = { ...SUBTREE_BUDGET, ...budget };
  const changes = { state: [], content: [], geometry: [], visual: [], structure: [] };

  if (!before || !after) {
    return {
      $interactionDiff: INTERACTION_DIFF_CONTRACT,
      result: INTERACTION_RESULT.FAILED,
      reason: "a snapshot was missing on one side of the transition",
      changes, counts: countOf(changes), signals: signalsOf(changes)
    };
  }

  const beforeMap = byPath(before);
  const afterMap = byPath(after);

  /* Nodes that appeared or vanished. Bounded, and reported as structure rather
   * than folded into "visual" — a panel that did not exist before is a
   * different fact from one that was merely hidden. */
  for (const [path, node] of afterMap) {
    if (!beforeMap.has(path)) {
      changes.structure.push({ domPath: path, change: "appeared", tag: node.tag, role: node.role ?? null });
    }
  }
  for (const [path, node] of beforeMap) {
    if (!afterMap.has(path)) {
      changes.structure.push({ domPath: path, change: "disappeared", tag: node.tag, role: node.role ?? null });
    }
  }

  for (const [path, beforeNode] of beforeMap) {
    const afterNode = afterMap.get(path);
    if (!afterNode) continue;

    /* ---- state: the signal geometry cannot see ---- */
    for (const attr of STATE_ATTRIBUTES) {
      const from = beforeNode.states?.[attr] ?? null;
      const to = afterNode.states?.[attr] ?? null;
      if (from !== to) changes.state.push({ domPath: path, attribute: attr, from, to });
    }

    /* ---- content: text, image source, selected index ---- */
    if ((beforeNode.text ?? null) !== (afterNode.text ?? null)) {
      changes.content.push({
        domPath: path, property: "text",
        from: beforeNode.text ?? null, to: afterNode.text ?? null
      });
    }
    if ((beforeNode.src ?? null) !== (afterNode.src ?? null)) {
      changes.content.push({ domPath: path, property: "src", from: beforeNode.src ?? null, to: afterNode.src ?? null });
    }
    if ((beforeNode.accessibleName ?? null) !== (afterNode.accessibleName ?? null)) {
      changes.content.push({
        domPath: path, property: "accessibleName",
        from: beforeNode.accessibleName ?? null, to: afterNode.accessibleName ?? null
      });
    }
    if ((beforeNode.childCount ?? null) !== (afterNode.childCount ?? null)) {
      changes.content.push({
        domPath: path, property: "childCount",
        from: beforeNode.childCount ?? null, to: afterNode.childCount ?? null
      });
    }
    if ((beforeNode.visibleDescendants ?? null) !== (afterNode.visibleDescendants ?? null)) {
      changes.content.push({
        domPath: path, property: "visibleDescendants",
        from: beforeNode.visibleDescendants ?? null, to: afterNode.visibleDescendants ?? null
      });
    }

    /* ---- visual: painted difference with the box unmoved ---- */
    for (const prop of VISUAL_PROPERTIES) {
      const from = beforeNode.style?.[prop] ?? null;
      const to = afterNode.style?.[prop] ?? null;
      if (from !== to) changes.visual.push({ domPath: path, property: prop, from, to });
    }

    /* ---- geometry ---- */
    if (geomChanged(beforeNode.geometry, afterNode.geometry)) {
      changes.geometry.push({
        domPath: path,
        from: beforeNode.geometry ?? null,
        to: afterNode.geometry ?? null
      });
    }
  }

  for (const key of Object.keys(changes)) {
    if (changes[key].length > b.maxChangesReported) {
      changes[key] = changes[key].slice(0, b.maxChangesReported);
    }
  }

  return {
    $interactionDiff: INTERACTION_DIFF_CONTRACT,
    result: classify(changes),
    reason: null,
    changes,
    counts: countOf(changes),
    signals: signalsOf(changes),
    /* Focus and hover are recorded by the caller, not derived here — they are
     * properties of the browser, not of the subtree. */
    focus: focusDelta(before, after),
    scroll: {
      before: { scrollY: before.scrollY ?? null, viewportWidth: before.viewportWidth ?? null, viewportHeight: before.viewportHeight ?? null },
      after: { scrollY: after.scrollY ?? null, viewportWidth: after.viewportWidth ?? null, viewportHeight: after.viewportHeight ?? null }
    }
  };
}

/**
 * Which single class describes this transition.
 *
 * State first, deliberately. When a menu opens, `aria-expanded` flips AND a
 * panel appears AND boxes move; the attribute is the thing a builder must
 * reproduce, and the rest follows from it. Reporting "geometry changed" for
 * that transition would be true and useless.
 */
function classify(changes) {
  if (changes.state.length) return INTERACTION_RESULT.STATE;
  /* A node appearing or vanishing is a content-level fact about what the page
   * now holds, not merely a repaint. */
  if (changes.structure.length || changes.content.length) return INTERACTION_RESULT.CONTENT;
  if (changes.geometry.length) return INTERACTION_RESULT.GEOMETRY;
  if (changes.visual.length) return INTERACTION_RESULT.VISUAL;
  return INTERACTION_RESULT.NONE;
}

const countOf = (changes) => ({
  state: changes.state.length,
  content: changes.content.length,
  geometry: changes.geometry.length,
  visual: changes.visual.length,
  structure: changes.structure.length,
  total: Object.values(changes).reduce((n, list) => n + list.length, 0)
});

/** Which signals fired, as booleans, so a caller can test one without counting. */
const signalsOf = (changes) => ({
  state: changes.state.length > 0,
  content: changes.content.length > 0,
  geometry: changes.geometry.length > 0,
  visual: changes.visual.length > 0,
  structure: changes.structure.length > 0
});

/**
 * Focus movement, kept apart from every other signal.
 *
 * A focus change describes the page WHILE something is focused. It is never
 * resting-page evidence, and folding it into the general change signal would
 * make every click look like a state transition, since clicking focuses.
 */
function focusDelta(before, after) {
  const from = before?.activeElement ?? null;
  const to = after?.activeElement ?? null;
  return {
    changed: from !== to,
    from,
    to,
    note: "focus is a transient browser state, not a property of the resting page"
  };
}

/**
 * The page-side subtree reader.
 *
 * Reads only. Bounded by node count, depth and ancestor count so a subtree walk
 * on a real page cannot become a page walk. Text is capped and every attribute
 * value is truncated, for the same reason every other survey in this project
 * caps them: an unbounded read becomes an unbounded artifact.
 */
export const SUBTREE_SNAPSHOT = (arg) => {
  const { domPath, budget } = arg;
  const B = budget;

  const path = (el) => {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 12) {
      const parent = node.parentElement;
      const index = parent ? [...parent.children].indexOf(node) + 1 : 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }
    return parts.join(">");
  };

  const find = (p) => {
    const parts = String(p).split(">");
    let node = document.body;
    for (const part of parts) {
      const m = /^([a-z0-9-]+):nth-child\((\d+)\)$/i.exec(part.trim());
      if (!m || !node) return null;
      const child = node.children[Number(m[2]) - 1];
      if (!child || child.tagName.toLowerCase() !== m[1].toLowerCase()) return null;
      node = child;
    }
    return node === document.body ? null : node;
  };

  const STATE_ATTRS = [
    "aria-expanded", "aria-hidden", "aria-selected", "aria-checked",
    "aria-current", "aria-pressed", "aria-disabled",
    "hidden", "inert", "open", "checked", "selected", "disabled"
  ];

  const bounded = (s, n) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : null);

  /* Only same-origin-safe, non-secret attribute values, truncated. A class list
   * can carry state (`is-open`); it can also carry a build hash, so it is
   * bounded rather than trusted. */
  const safeUrl = (raw) => {
    try {
      const u = new URL(raw, location.href);
      u.search = ""; u.hash = ""; u.username = ""; u.password = "";
      return u.toString();
    } catch { return null; }
  };

  const describe = (el, depth) => {
    let cs;
    try { cs = getComputedStyle(el); } catch { return null; }
    const rect = el.getBoundingClientRect();
    const states = {};
    for (const attr of STATE_ATTRS) {
      if (el.hasAttribute && el.hasAttribute(attr)) states[attr] = el.getAttribute(attr) === "" ? "true" : bounded(el.getAttribute(attr), 40);
      else if (attr in el && typeof el[attr] === "boolean") states[attr] = el[attr] ? "true" : null;
      else states[attr] = null;
    }
    const tag = el.tagName.toLowerCase();
    const src = tag === "img" ? safeUrl(el.getAttribute("src") || "") : null;

    let visibleDescendants = 0;
    try {
      for (const d of el.querySelectorAll("*")) {
        const dcs = getComputedStyle(d);
        if (dcs.display !== "none" && dcs.visibility !== "hidden" && Number(dcs.opacity) !== 0) visibleDescendants++;
        if (visibleDescendants > 500) break;
      }
    } catch { visibleDescendants = -1; }

    return {
      domPath: path(el),
      depth,
      tag,
      role: el.getAttribute ? el.getAttribute("role") : null,
      accessibleName: bounded(
        (el.getAttribute && el.getAttribute("aria-label"))
        || (el.getAttribute && el.getAttribute("title"))
        || el.textContent || "", 120),
      states,
      text: bounded(el.textContent || "", B.textCap),
      src,
      style: {
        display: cs.display, visibility: cs.visibility,
        opacity: cs.opacity, transform: cs.transform,
        position: cs.position, width: cs.width, height: cs.height
      },
      geometry: {
        docTop: Math.round(rect.top + window.scrollY),
        docLeft: Math.round(rect.left + window.scrollX),
        viewTop: Math.round(rect.top),
        viewLeft: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      classes: bounded(typeof el.className === "string" ? el.className : "", 160),
      childCount: el.children ? el.children.length : 0,
      visibleDescendants
    };
  };

  const target = find(domPath);
  if (!target) return { ok: false, error: "target-not-found", nodes: [] };

  const nodes = [];
  const seen = new Set();
  const push = (el, depth) => {
    if (nodes.length >= B.maxNodes) return;
    const rec = describe(el, depth);
    if (!rec || seen.has(rec.domPath)) return;
    seen.add(rec.domPath);
    nodes.push(rec);
  };

  /* Ancestors give context: a menu button's `aria-expanded` may flip while the
   * panel that opens is its sibling, reachable only through the parent. */
  let anc = target.parentElement;
  let up = 0;
  while (anc && anc !== document.body && up < B.maxAncestors) {
    push(anc, -(up + 1));
    anc = anc.parentElement;
    up++;
  }

  push(target, 0);

  const walk = (el, depth) => {
    if (depth >= B.maxDepth || nodes.length >= B.maxNodes) return;
    for (const child of el.children ?? []) {
      push(child, depth + 1);
      walk(child, depth + 1);
    }
  };
  walk(target, 0);

  /* An ancestor's other subtrees matter too — the panel a button controls is
   * frequently a sibling. One level of sibling breadth, bounded. */
  if (target.parentElement) {
    for (const sib of target.parentElement.children) {
      if (sib === target) continue;
      push(sib, 1);
      walk(sib, 1);
    }
  }

  return {
    ok: true,
    nodes,
    activeElement: document.activeElement && document.activeElement !== document.body
      ? path(document.activeElement) : null,
    scrollY: Math.round(window.scrollY),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  };
};
