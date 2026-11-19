/**
 * Safe interaction discovery: what a public page will show you if you press
 * something, and — far more importantly — what this tool refuses to press.
 *
 * Every other capture stage in this project is READ-ONLY. This one is not: it
 * changes the page. That single difference is why the safety rules here are
 * written as a closed allow-list rather than a list of things to avoid. A
 * deny-list is a bet that you thought of everything; an allow-list is a bet
 * that you thought of the safe cases, and being wrong about THAT means missing
 * a menu rather than submitting somebody's form.
 *
 * The gate refuses, in order and before anything is clicked:
 *
 *   - anything that submits — a submit control, or a control inside a form
 *   - anything near a credential field
 *   - any link that leaves the page
 *   - anything whose accessible name reads as destructive or transactional
 *   - anything not visibly present at the moment of the attempt
 *
 * A refusal is recorded with its reason. "We did not try this" and "we tried
 * and nothing happened" are different findings, and a builder reading the
 * prompt has to be able to tell them apart.
 *
 * PURE. No DOM, no browser, no clock. The page-side probe that actually clicks
 * lives in `INTERACTION_PROBE` below as a serialisable function, and every
 * decision it makes is made by the rules in this module first.
 */

export const INTERACTION_CONTRACT = "1";

/** The closed set of actions this tool will ever attempt. */
export const INTERACTION_ACTION = Object.freeze({
  OPEN_MENU: "open-menu",
  CLOSE_MENU: "close-menu",
  EXPAND_ACCORDION: "expand-accordion",
  COLLAPSE_ACCORDION: "collapse-accordion",
  CAROUSEL_NEXT: "carousel-next",
  CAROUSEL_PREV: "carousel-prev",
  OPEN_DIALOG: "open-dialog",
  CLOSE_DIALOG: "close-dialog",
  FOCUS: "focus",
  HOVER: "hover"
});

/** What happened. `NO_CHANGE` is a real result, not a failure. */
export const INTERACTION_STATUS = Object.freeze({
  COMPLETED: "completed",
  NO_CHANGE: "completed-no-observable-change",
  REFUSED: "refused",
  FAILED: "failed",
  NOT_ATTEMPTED: "not-attempted"
});

/** Whether the page was put back the way it was found. */
export const RESTORATION = Object.freeze({
  RESTORED: "restored",
  NOT_NEEDED: "not-needed",
  FAILED: "restoration-failed",
  NOT_ATTEMPTED: "not-attempted"
});

/**
 * Why an interaction was not attempted.
 *
 * Every refusal names one. A silent skip is indistinguishable from "there was
 * nothing there", which is exactly the confusion this whole system exists to
 * prevent.
 */
export const INTERACTION_REFUSAL = Object.freeze({
  SUBMITS_FORM: "target-submits-a-form",
  INSIDE_FORM: "target-sits-inside-a-form",
  CREDENTIAL_NEARBY: "target-is-near-a-credential-field",
  LEAVES_PAGE: "target-navigates-away-from-the-page",
  DESTRUCTIVE_NAME: "accessible-name-reads-as-destructive-or-transactional",
  NOT_VISIBLE: "target-was-not-visible-at-the-moment-of-the-attempt",
  NO_ACCESSIBLE_NAME: "target-has-no-accessible-name-to-record",
  BUDGET_EXHAUSTED: "interaction-budget-exhausted",
  RETRIES_EXHAUSTED: "retry-budget-exhausted-for-this-target",
  TIME_EXHAUSTED: "interaction-time-budget-exhausted",
  UNSAFE_UNKNOWN: "target-could-not-be-shown-safe",
  /* Distinct from "unsafe": nothing was wrong with this target. Discovery
   * stopped before reaching it because an earlier toggle would not toggle
   * back, and continuing would have measured a page that had drifted. */
  DISCOVERY_STOPPED: "discovery-stopped-after-a-restoration-failure"
});

export const INTERACTION_BUDGET = Object.freeze({
  maxPerViewport: 12,
  maxRetriesPerTarget: 1,
  maxTotalMs: 20_000,
  /* How long to wait for a state change to settle before reading the result. */
  settleMs: 260
});

/**
 * Words that make a control off-limits whatever its markup says.
 *
 * Matched against the ACCESSIBLE NAME, which is the label a human would act on.
 * Deliberately broad: a false refusal costs one unobserved menu, while a false
 * accept could buy something. The asymmetry is the whole point.
 */
const DESTRUCTIVE_NAME = new RegExp([
  "\\b(?:delete|remove|destroy|erase|clear all|reset)\\b",
  "\\b(?:buy|purchase|checkout|check out|order|pay|payment|subscribe|upgrade|donate)\\b",
  "\\b(?:sign ?in|log ?in|sign ?up|register|create account|continue with)\\b",
  "\\b(?:submit|send|confirm|apply|save|publish|post|share)\\b",
  "\\b(?:unsubscribe|cancel subscription|downgrade|close account)\\b"
].join("|"), "i");

/** Field types that make everything around them off-limits. */
const CREDENTIAL_TYPE = /^(?:password|email|tel|number)$/i;

const nameOf = (t) => String(t?.accessibleName ?? "").trim();

/**
 * Is this target safe to activate on a public page?
 *
 * Returns `{ safe, reason }`. Order matters: the most dangerous conditions are
 * checked first so that a target which is both inside a form AND named "Buy"
 * refuses for the form reason rather than whichever check happened to run.
 */
export function isSafeTarget(target, { action = null } = {}) {
  const refuse = (reason) => ({ safe: false, reason });
  if (!target || typeof target !== "object") return refuse(INTERACTION_REFUSAL.UNSAFE_UNKNOWN);

  /* Anything that could send data. A submit control is obvious; a control that
   * merely SITS in a form is refused too, because a button with no explicit
   * type defaults to submit and we cannot tell from the outside which handler
   * the page attached. */
  if (target.isSubmit === true) return refuse(INTERACTION_REFUSAL.SUBMITS_FORM);
  if (target.insideForm === true) return refuse(INTERACTION_REFUSAL.INSIDE_FORM);

  /* Anything near a place someone types a secret. */
  if (target.nearCredentialField === true) return refuse(INTERACTION_REFUSAL.CREDENTIAL_NEARBY);
  if (target.fieldType && CREDENTIAL_TYPE.test(String(target.fieldType))) {
    return refuse(INTERACTION_REFUSAL.CREDENTIAL_NEARBY);
  }

  /* Anything that leaves. An in-page fragment is fine; a real href is not. */
  if (target.navigates === true) return refuse(INTERACTION_REFUSAL.LEAVES_PAGE);

  const name = nameOf(target);
  /* Hover and focus do not activate anything, so an unnamed target is still a
   * legitimate observation. Activation without a name is not: there would be
   * nothing to record about what was pressed. */
  const activates = action !== INTERACTION_ACTION.HOVER && action !== INTERACTION_ACTION.FOCUS;
  if (activates && name.length === 0) return refuse(INTERACTION_REFUSAL.NO_ACCESSIBLE_NAME);
  if (name && DESTRUCTIVE_NAME.test(name)) return refuse(INTERACTION_REFUSAL.DESTRUCTIVE_NAME);

  if (target.visible === false) return refuse(INTERACTION_REFUSAL.NOT_VISIBLE);

  return { safe: true, reason: null };
}

/**
 * Which action a candidate affords, from its OBSERVED markup.
 *
 * Never guessed from appearance or class names. A control is a menu toggle
 * because it says `aria-expanded` and controls something, not because it looks
 * like a hamburger.
 */
export function actionFor(target) {
  if (!target) return null;
  const role = String(target.role ?? "").toLowerCase();
  const tag = String(target.tag ?? "").toLowerCase();
  const expanded = target.ariaExpanded;
  const hasPopup = String(target.ariaHasPopup ?? "").toLowerCase();

  /* `aria-haspopup` is checked FIRST because it is the more specific signal: it
   * names WHAT the control opens. `aria-expanded` on its own says only that
   * something is disclosed, which is true of a menu button and an accordion
   * header alike — reading it first would file every menu as an accordion. */
  if (hasPopup === "dialog") return INTERACTION_ACTION.OPEN_DIALOG;
  if (hasPopup === "menu" || hasPopup === "listbox" || hasPopup === "tree" || hasPopup === "grid" || hasPopup === "true") {
    return expanded === "true" ? INTERACTION_ACTION.CLOSE_MENU : INTERACTION_ACTION.OPEN_MENU;
  }
  /* A plain <button> has an implicit button role, so it must be recognised
   * alongside an explicit `role="button"`. Without this a form's submit button
   * derives NO action and is reported "not-attempted" — which reads as though
   * it were harmless, when in fact it is the most dangerous control on the
   * page and should be reported as REFUSED with its reason. */
  if (tag === "summary" || tag === "button" || role === "button") {
    if (expanded === "true") return INTERACTION_ACTION.COLLAPSE_ACCORDION;
    if (expanded === "false") return INTERACTION_ACTION.EXPAND_ACCORDION;
  }
  if (target.carouselDirection === "next") return INTERACTION_ACTION.CAROUSEL_NEXT;
  if (target.carouselDirection === "prev") return INTERACTION_ACTION.CAROUSEL_PREV;
  if (role === "dialog" || tag === "dialog") return INTERACTION_ACTION.CLOSE_DIALOG;
  return null;
}

/**
 * Turn observed candidates into a bounded, ordered plan.
 *
 * Deterministic: candidates are ordered by document position, refusals are
 * decided before the budget is spent, and the same input always yields the same
 * plan. Every candidate appears in the output — a target cut by the budget is
 * REFUSED with a reason, never dropped, so the count of "things we did not try"
 * is always visible.
 */
export function planInteractions({ candidates, budget = INTERACTION_BUDGET } = {}) {
  const b = { ...INTERACTION_BUDGET, ...budget };
  const ordered = [...(candidates ?? [])].sort((a, c) =>
    (a.geometry?.top ?? 0) - (c.geometry?.top ?? 0) ||
    (a.geometry?.left ?? 0) - (c.geometry?.left ?? 0) ||
    String(a.domPath).localeCompare(String(c.domPath)));

  const plan = [];
  let spent = 0;
  for (const target of ordered) {
    const action = actionFor(target);
    const entry = {
      sequence: plan.length,
      domPath: target.domPath,
      tag: target.tag ?? null,
      role: target.role ?? null,
      accessibleName: nameOf(target) || null,
      geometry: target.geometry ?? null,
      action,
      attempt: false,
      refusalReason: null
    };

    if (!action) {
      /* Nothing in the markup says this affords an interaction. Not a refusal —
       * there is simply no action to attempt. */
      entry.refusalReason = null;
      plan.push(entry);
      continue;
    }

    const safety = isSafeTarget(target, { action });
    if (!safety.safe) {
      entry.refusalReason = safety.reason;
      plan.push(entry);
      continue;
    }

    if (spent >= b.maxPerViewport) {
      entry.refusalReason = INTERACTION_REFUSAL.BUDGET_EXHAUSTED;
      plan.push(entry);
      continue;
    }

    entry.attempt = true;
    spent++;
    plan.push(entry);
  }
  return plan;
}

/**
 * Build the interaction evidence record from an executed plan.
 *
 * `results` maps domPath -> what the probe observed. A planned attempt with no
 * result becomes a stated failure rather than vanishing.
 */
export function interactionEvidenceFrom({ viewportWidth, plan, results = new Map(), budget = INTERACTION_BUDGET } = {}) {
  /* Did an earlier toggle refuse to toggle back? Everything planned after that
   * point was abandoned deliberately, not found wanting. */
  const stoppedEarly = [...results.values()].some((r) => r && r.restored === false);

  const states = plan.map((item, i) => {
    const r = results.get(item.domPath) ?? null;

    let status = INTERACTION_STATUS.NOT_ATTEMPTED;
    let restoration = RESTORATION.NOT_ATTEMPTED;
    let refusalReason = item.refusalReason;

    if (item.refusalReason) {
      status = INTERACTION_STATUS.REFUSED;
      restoration = RESTORATION.NOT_NEEDED;
    } else if (item.attempt) {
      if (!r) {
        /* Planned, permitted, and never reached. Reporting this as "could not
         * be shown safe" would blame the target for a decision taken about an
         * entirely different control. */
        status = INTERACTION_STATUS.FAILED;
        refusalReason = stoppedEarly
          ? INTERACTION_REFUSAL.DISCOVERY_STOPPED
          : INTERACTION_REFUSAL.UNSAFE_UNKNOWN;
      } else if (r.error) {
        status = INTERACTION_STATUS.FAILED;
      } else {
        status = r.changed ? INTERACTION_STATUS.COMPLETED : INTERACTION_STATUS.NO_CHANGE;
        restoration = r.restored === true ? RESTORATION.RESTORED
          : r.restored === false ? RESTORATION.FAILED
          : RESTORATION.NOT_NEEDED;
      }
    }

    return {
      interactionId: `i-${viewportWidth}-${String(i).padStart(3, "0")}`,
      sequence: item.sequence,
      action: item.action,
      target: {
        domPath: item.domPath,
        tag: item.tag,
        role: item.role,
        accessibleName: item.accessibleName,
        geometry: item.geometry
      },
      viewportWidth,
      status,
      restoration,
      refusalReason: status === INTERACTION_STATUS.REFUSED || status === INTERACTION_STATUS.FAILED
        ? (refusalReason ?? r?.error ?? null)
        : null,
      /* Before/after provenance. An interaction claim without both sides is not
       * a claim about a transition — it is a claim about one moment. */
      before: r?.before ?? null,
      after: r?.after ?? null,
      scrollY: r?.scrollY ?? null,
      scrollState: r?.scrollState ?? null,
      affectedRegions: r?.affectedRegions ?? [],
      /* The fine-grained verdict and the exact changes behind it. `resultClass`
       * is what a prompt may cite; `changes` is what it must cite it FROM. */
      resultClass: r?.resultClass ?? null,
      signals: r?.signals ?? null,
      changes: r?.changes ?? null,
      changeCounts: r?.changeCounts ?? null,
      /* Focus is carried apart from every other signal: it describes the page
       * while something is focused and is never resting-page evidence. */
      focus: r?.focus ?? null,
      observedAt: r?.observedAt ?? null,
      /* Said in the record so no downstream reader has to infer it. */
      scope: "interacted",
      note: "This describes the page while this control was activated. It is not evidence about the resting page, and it must not be used to satisfy an above-fold or resting-page claim."
    };
  });

  const counts = {
    candidates: states.length,
    attempted: states.filter((s) => s.status === INTERACTION_STATUS.COMPLETED || s.status === INTERACTION_STATUS.NO_CHANGE || s.status === INTERACTION_STATUS.FAILED).length,
    completed: states.filter((s) => s.status === INTERACTION_STATUS.COMPLETED).length,
    noChange: states.filter((s) => s.status === INTERACTION_STATUS.NO_CHANGE).length,
    refused: states.filter((s) => s.status === INTERACTION_STATUS.REFUSED).length,
    failed: states.filter((s) => s.status === INTERACTION_STATUS.FAILED).length,
    restorationFailed: states.filter((s) => s.restoration === RESTORATION.FAILED).length,
    byAction: {},
    byRefusal: {}
  };
  for (const s of states) {
    if (s.action) counts.byAction[s.action] = (counts.byAction[s.action] ?? 0) + 1;
    if (s.refusalReason) counts.byRefusal[s.refusalReason] = (counts.byRefusal[s.refusalReason] ?? 0) + 1;
  }

  return {
    $interactionContract: INTERACTION_CONTRACT,
    viewportWidth,
    budget: { ...budget },
    states,
    counts,
    /* A page whose state could not be put back is not safe to keep reading. */
    captureCompromised: counts.restorationFailed > 0
  };
}

/**
 * The page-side probe.
 *
 * Serialised into the browser. It gathers CANDIDATES and reports what it sees;
 * it does not decide what is safe — `isSafeTarget` does that, out here, against
 * the records this returns. Keeping the decision outside the page is what makes
 * the safety rules testable without a browser.
 */
/**
 * Activate one target, by DOM path, in the page.
 *
 * Deliberately minimal: it locates the element, re-checks the two conditions
 * that could have changed since the plan was made (still present, still
 * visible), and dispatches a plain click. It runs no page script of its own
 * beyond this, evaluates nothing supplied from outside, and never touches a
 * form. The safety DECISION was already taken by `isSafeTarget`; this only
 * carries it out.
 */
export const INTERACTION_ACTIVATE = (domPath) => {
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

  try {
    const el = find(domPath);
    if (!el) return { ok: false, error: "target-not-found-at-activation-time" };

    /* Re-checked here because the page has had time to move since the plan was
     * built. A control that scrolled away or was hidden is not clicked. */
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0
      || rect.width <= 0 || rect.height <= 0) {
      return { ok: false, error: "target-not-visible-at-activation-time" };
    }
    /* Last line of defence: if the element turns out to sit in a form after
     * all, refuse in the page rather than trust the earlier read. */
    if (el.closest && el.closest("form")) return { ok: false, error: "target-sits-inside-a-form" };

    el.click();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  }
};

export const INTERACTION_CANDIDATES = () => {
  const CAP = 60;
  const out = [];

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

  const nameOfEl = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.slice(0, 120);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const ref = document.getElementById(labelledBy);
      if (ref) return (ref.textContent || "").trim().slice(0, 120);
    }
    const title = el.getAttribute("title");
    if (title) return title.slice(0, 120);
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
  };

  let nodes = [];
  try {
    nodes = [...document.querySelectorAll(
      "button,summary,[role=button],[aria-expanded],[aria-haspopup],[data-carousel],dialog,[role=dialog]"
    )].slice(0, CAP * 2);
  } catch { return []; }

  for (const el of nodes) {
    if (out.length >= CAP) break;
    let cs;
    try { cs = getComputedStyle(el); } catch { continue; }
    const rect = el.getBoundingClientRect();
    const visible = cs.display !== "none" && cs.visibility !== "hidden"
      && Number(cs.opacity) !== 0 && rect.width > 0 && rect.height > 0;

    const form = el.closest ? el.closest("form") : null;
    const type = (el.getAttribute("type") || "").toLowerCase();
    const href = el.getAttribute("href");

    /* A credential field anywhere in the same form makes the whole form
     * off-limits, not just the field. */
    let nearCredential = false;
    try {
      const scope = form || el.parentElement;
      if (scope) nearCredential = Boolean(scope.querySelector("input[type=password],input[type=email],input[autocomplete*=cc-],input[name*=card]"));
    } catch { nearCredential = true; }

    const label = (el.getAttribute("aria-label") || "").toLowerCase();
    const carouselDirection =
      /next|forward/.test(label) ? "next"
      : /prev|previous|back/.test(label) ? "prev"
      : (el.getAttribute("data-carousel") || "").toLowerCase() || null;

    out.push({
      domPath: path(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      accessibleName: nameOfEl(el),
      ariaExpanded: el.getAttribute("aria-expanded"),
      ariaHasPopup: el.getAttribute("aria-haspopup"),
      ariaControls: el.getAttribute("aria-controls"),
      carouselDirection: carouselDirection === "next" || carouselDirection === "prev" ? carouselDirection : null,
      isSubmit: type === "submit" || type === "image" || el.tagName.toLowerCase() === "input",
      insideForm: Boolean(form),
      nearCredentialField: nearCredential,
      /* Any href that is not a same-page fragment leaves. */
      navigates: Boolean(href && !/^#/.test(href)),
      fieldType: type || null,
      visible,
      geometry: {
        top: Math.round(rect.top + window.scrollY),
        left: Math.round(rect.left + window.scrollX),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });
  }
  return out;
};
