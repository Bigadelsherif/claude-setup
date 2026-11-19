/**
 * The cold-load motion recorder.
 *
 * ## The problem this fixes
 *
 * The previous stage took its "cold" frame after the capture session had
 * already navigated AND waited for network idle, fonts and assets. An entrance
 * animation is finished long before that, so the first sample showed a settled
 * page and the honest conclusion — "no opening animation was detected" — was
 * drawn from a window that began after the thing it was looking for had ended.
 *
 * The fix is to start recording BEFORE the page's own scripts run. This module
 * is installed as an init script, so it executes at document-start on a fresh
 * context, schedules its own samples from that instant, and is already
 * recording while the page is still parsing.
 *
 * ## Why the diffing happens in the page
 *
 * Ten full snapshots of several hundred elements is megabytes of JSON crossing
 * the bridge for every viewport. The recorder keeps the previous frame in a
 * closure and ships only what CHANGED, plus the first and last full states.
 * That is both smaller and more useful: a change carries the timestamp of the
 * frame that caught it, which is what first-change and last-change are made of.
 *
 * ## What the timestamps do and do not mean
 *
 * A sample says "by 400ms this had changed", not "this took 400ms". The change
 * happened somewhere between the previous sample and this one. Everything
 * derived from these frames is therefore a BOUND, and is reported as one. The
 * only exact claim available is the sample offsets themselves.
 */

/** The sampling schedule, in milliseconds from document-start. */
export const FRAME_OFFSETS = Object.freeze([0, 50, 100, 200, 400, 800, 1200, 2000, 3500, 5000]);

/** Properties compared between frames. Paint-related, plus geometry. */
export const TRACKED_PROPERTIES = Object.freeze([
  "opacity", "transform", "visibility", "display",
  "clipPath", "filter", "backdropFilter",
  "color", "backgroundColor", "boxShadow"
]);

/**
 * The recorder, as source text for `addInitScript`.
 *
 * Written as a string rather than a function reference because it is serialised
 * into a browser that shares no module scope with this process. The offsets and
 * property list are interpolated so there is exactly one definition of each.
 */
export function recorderSource({
  offsets = FRAME_OFFSETS,
  properties = TRACKED_PROPERTIES,
  maxElements = 500
} = {}) {
  return `(() => {
  if (window.__bigaapMotion) return;
  var OFFSETS = ${JSON.stringify(offsets)};
  var PROPS = ${JSON.stringify(properties)};
  var MAX = ${maxElements};
  var t0 = (performance && performance.now) ? performance.now() : 0;

  var store = {
    contract: "cold-load-1",
    startedAt: Date.now(),
    initial: null,
    settled: null,
    firstSeen: {},
    changes: [],
    frames: [],
    media: null,
    navigation: null,
    firstFrameVisible: null,
    truncated: false,
    error: null
  };
  window.__bigaapMotion = store;

  function domPath(el) {
    var parts = [], node = el;
    while (node && node.nodeType === 1 && parts.length < 12) {
      var parent = node.parentElement;
      if (!parent) break;
      var idx = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(node.tagName.toLowerCase() + ":nth-child(" + idx + ")");
      node = parent;
    }
    return parts.join(">");
  }

  function snapshot() {
    var out = {};
    var all;
    try { all = document.querySelectorAll("body *"); } catch (e) { return out; }
    var limit = Math.min(all.length, MAX);
    if (all.length > MAX) store.truncated = true;
    for (var i = 0; i < limit; i++) {
      var el = all[i];
      var box;
      try { box = el.getBoundingClientRect(); } catch (e) { continue; }
      /* A zero-area element cannot show a visible change. Excluding it keeps
       * the record about things a viewer could actually see move. */
      if (box.width < 2 || box.height < 2) continue;
      var cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      var rec = {
        tag: el.tagName.toLowerCase(),
        boundingBox: {
          x: Math.round((box.x + (window.scrollX || 0)) * 10) / 10,
          y: Math.round((box.y + (window.scrollY || 0)) * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10
        }
      };
      for (var p = 0; p < PROPS.length; p++) rec[PROPS[p]] = cs[PROPS[p]];
      out[domPath(el)] = rec;
    }
    return out;
  }

  function boxChanged(a, b) {
    if (!a || !b) return Boolean(a) !== Boolean(b);
    return Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1
        || Math.abs(a.width - b.width) > 1 || Math.abs(a.height - b.height) > 1;
  }

  var previous = null;

  function frame(offset) {
    var at = ((performance && performance.now) ? performance.now() : 0) - t0;
    var now;
    try { now = snapshot(); } catch (e) { store.error = String(e && e.message || e); return; }

    var changedCount = 0;
    if (previous === null) {
      store.initial = now;
      /* Was anything painted at all when we first looked? A page that is blank
       * at frame 0 and full at frame 400 has not necessarily animated — it may
       * simply have rendered. The two are told apart downstream, but only if
       * this is recorded. */
      var visible = 0;
      for (var k in now) if (now[k].visibility !== "hidden" && now[k].display !== "none" && now[k].opacity !== "0") visible++;
      store.firstFrameVisible = visible;
    } else {
      for (var path in now) {
        var a = previous[path], b = now[path];
        if (!a) {
          /* The element was not there a frame ago.
           *
           * On a page whose DOM is built by script — and that is most of them —
           * frame 0 fires while readyState is still "loading" and the body is
           * empty. Skipping new elements meant the entire page was invisible to
           * this recorder, and the honest-looking conclusion "nothing changed"
           * was drawn from a comparison that never included anything.
           *
           * An appearance is recorded, and the first state seen is kept as that
           * element's starting point. Appearing is NOT by itself animation —
           * that distinction is made downstream, where an element that appeared
           * and then never changed is discarded. */
          if (!store.firstSeen[path]) store.firstSeen[path] = { atMs: Math.round(at), state: b };
          store.changes.push({ domPath: path, property: "appeared", from: null, to: null, atMs: Math.round(at) });
          changedCount++;
          continue;
        }
        for (var i = 0; i < PROPS.length; i++) {
          var prop = PROPS[i];
          if (a[prop] !== b[prop]) {
            store.changes.push({ domPath: path, property: prop, from: a[prop], to: b[prop], atMs: Math.round(at) });
            changedCount++;
          }
        }
        if (boxChanged(a.boundingBox, b.boundingBox)) {
          store.changes.push({ domPath: path, property: "boundingBox", from: a.boundingBox, to: b.boundingBox, atMs: Math.round(at) });
          changedCount++;
        }
      }
    }

    previous = now;
    store.settled = now;
    store.frames.push({
      offsetMs: offset,
      atMs: Math.round(at),
      readyState: document.readyState,
      elementCount: Object.keys(now).length,
      changedCount: changedCount
    });
  }

  for (var f = 0; f < OFFSETS.length; f++) {
    (function (ms) { setTimeout(function () { frame(ms); }, ms); })(OFFSETS[f]);
  }

  /* Collected once, at the end: what could be responsible for motion this
   * apparatus cannot read, and whether the page came from cache. */
  setTimeout(function () {
    try {
      store.media = {
        video: document.querySelectorAll("video").length,
        canvas: document.querySelectorAll("canvas").length,
        iframe: document.querySelectorAll("iframe").length,
        svgAnimate: document.querySelectorAll("animate, animateTransform, animateMotion").length
      };
      var nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || null;
      if (nav) {
        store.navigation = {
          type: nav.type || null,
          transferSize: typeof nav.transferSize === "number" ? nav.transferSize : null,
          encodedBodySize: typeof nav.encodedBodySize === "number" ? nav.encodedBodySize : null,
          domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
          loadEvent: Math.round(nav.loadEventEnd || 0)
        };
      }
    } catch (e) { store.error = String(e && e.message || e); }
  }, OFFSETS[OFFSETS.length - 1] + 20);
})();`;
}

/* ─────────────────────────────── derivation ─────────────────────────────── */

const isPresent = (v) => v !== null && v !== undefined && v !== "";

/**
 * Whether the page was served from cache.
 *
 * `transferSize === 0` on a non-navigation-preload response means the bytes did
 * not cross the network. It is reported rather than acted on: a cached load is
 * still a real load, but if no animation was seen it is one of the first things
 * a reader should be told.
 */
export function cacheVerdict(navigation) {
  if (!navigation) return { restoredFromCache: null, why: "no navigation timing entry was available" };
  if (navigation.type === "back_forward") return { restoredFromCache: true, why: "navigation type was back_forward" };
  if (navigation.transferSize === 0 && (navigation.encodedBodySize ?? 0) > 0) {
    return { restoredFromCache: true, why: "the document transferred 0 bytes but had a body, so it came from cache" };
  }
  if (typeof navigation.transferSize === "number") {
    return { restoredFromCache: false, why: "the document transferred " + navigation.transferSize + " bytes" };
  }
  return { restoredFromCache: null, why: "transfer size was not reported" };
}

/**
 * Turn a recorder payload into an opening sequence.
 *
 * Pure. Every refusal below is reachable from a fixture, which is the only way
 * to know the refusals work.
 */
export function deriveColdLoad({ payload, viewport, budget = {} } = {}) {
  const offsets = budget.offsets ?? FRAME_OFFSETS;
  const windowMs = offsets[offsets.length - 1];

  if (!payload || typeof payload !== "object") {
    return {
      status: "failed",
      reason: "the cold-load recorder produced no payload; the init script may not have run",
      windowMs, frames: [], participants: [], orderEstablished: false, staggerEstablished: false,
      notDetected: null
    };
  }
  if (isPresent(payload.error)) {
    return {
      status: "failed",
      reason: "the cold-load recorder failed inside the page: " + payload.error,
      windowMs, frames: payload.frames ?? [], participants: [], orderEstablished: false, staggerEstablished: false,
      notDetected: null
    };
  }

  const frames = payload.frames ?? [];
  const changes = payload.changes ?? [];
  const initial = payload.initial ?? {};
  const settled = payload.settled ?? {};

  /* Group changes by element. */
  const byElement = new Map();
  for (const c of changes) {
    if (!isPresent(c?.domPath)) continue;
    const e = byElement.get(c.domPath) ?? { domPath: c.domPath, props: new Set(), first: Infinity, last: -Infinity, samples: [] };
    e.props.add(c.property);
    e.first = Math.min(e.first, c.atMs);
    e.last = Math.max(e.last, c.atMs);
    e.samples.push(c);
    byElement.set(c.domPath, e);
  }

  const firstSeen = payload.firstSeen ?? {};
  const participants = [];
  let appearedOnly = 0;
  let qualified = 0;
  let n = 0;
  const cap = budget.maxParticipants ?? 40;
  for (const [domPath, e] of byElement) {
    if (n >= cap) { qualified++; continue; }

    /* Appearing is not animating.
     *
     * An element that showed up and then held still was rendered, not
     * animated, and calling that an entrance would invent the very thing this
     * pass exists to avoid inventing. Only an element that changed a tracked
     * property AFTER it existed is a participant. */
    const realProps = [...e.props].filter((p) => p !== "appeared");
    if (!realProps.length) { appearedOnly++; continue; }

    /* Its starting state is where it was first seen, which on a
     * script-rendered page is not frame 0. */
    const before = initial[domPath] ?? firstSeen[domPath]?.state ?? null;
    const after = settled[domPath] ?? null;
    if (!before || !after) continue;

    const realChanges = e.samples.filter((c) => c.property !== "appeared");
    e.first = Math.min(...realChanges.map((c) => c.atMs));
    e.last = Math.max(...realChanges.map((c) => c.atMs));
    e.props = new Set(realProps);

    /* The bound: the change began after the sample before `first`, and had
     * finished by `last`. Neither is a duration. */
    const priorOffset = [...offsets].filter((o) => o < e.first).pop() ?? 0;
    const stillChanging = e.last >= windowMs - 1;

    participants.push({
      elementId: "m_" + String(participants.length + 1).padStart(4, "0"),
      domPath,
      selectorAdmissible: true,
      order: participants.length,
      firstSeenMs: priorOffset,
      settledMs: e.last,
      firstChangeMs: e.first,
      lastChangeMs: e.last,
      changeWindowMs: { earliestStart: priorOffset, latestEnd: e.last },
      initial: stateOf(before),
      settled: stateOf(after),
      changedProperties: [...e.props],
      declarations: {},
      /* Sampled bounds, never an exact duration. */
      timingSource: "sampled-bounds",
      approximateDurationMs: Math.max(0, e.last - priorOffset),
      stillChanging,
      staggerMsFromPrevious: null,
      evidenceStatus: "approximate",
      trigger: triggerFor({ first: e.first, last: e.last, stillChanging, windowMs })
    });
    n++;
  }

  /* Order and stagger ARE establishable here: ten timestamped samples order
   * events between them, and the gap between two elements' first changes is a
   * measured offset. Both are still bounds, and are labelled as such. */
  participants.sort((a, b) => a.firstChangeMs - b.firstChangeMs || a.domPath.localeCompare(b.domPath));
  participants.forEach((p, i) => {
    p.order = i;
    p.staggerMsFromPrevious = i === 0 ? null : p.firstChangeMs - participants[i - 1].firstChangeMs;
  });
  const distinctStarts = new Set(participants.map((p) => p.firstChangeMs));

  if (!participants.length) {
    return {
      status: "none-detected", reason: null, windowMs, frames,
      participants: [], orderEstablished: false, staggerEstablished: false,
      notDetected: notDetectedReport({ payload, frames, windowMs, viewport, appearedOnly })
    };
  }

  return {
    status: "detected", reason: null, windowMs, frames, participants,
    orderEstablished: distinctStarts.size > 1,
    staggerEstablished: distinctStarts.size > 1,
    /* A cap that silently drops participants would understate the sequence and
     * give no sign it had done so. If it bit, say so and say by how much. */
    participantsTruncated: qualified > 0,
    participantsNotListed: qualified,
    participantCap: cap,
    notDetected: null
  };
}

function stateOf(rec) {
  if (!rec) return null;
  const s = { boundingBox: rec.boundingBox ?? null };
  for (const p of TRACKED_PROPERTIES) s[p] = rec[p] ?? null;
  return s;
}

/**
 * A trigger for a change seen during a cold load with no scrolling.
 *
 * Nothing scrolled, nothing was hovered, nothing was clicked. The only action
 * in the window is the load itself, and the control is the tail of the window:
 * a change that stopped before the window closed is bounded to the load. One
 * that is still going at 5000ms is continuous, and is refused a load claim.
 */
function triggerFor({ first, last, stillChanging, windowMs }) {
  if (stillChanging) {
    return {
      classification: "unverified", trigger: null,
      controlObservationId: "window-tail", controlResult: "same-change",
      reason: "the element was still changing when the " + windowMs + "ms window closed, so this is continuous motion rather than an entrance bounded by load"
    };
  }
  return {
    classification: "verified",
    trigger: first >= 2000 ? "delayed-page-load" : "page-load",
    controlObservationId: "window-tail",
    controlResult: "no-change",
    reason: null
  };
}

/**
 * Why nothing was found — the report the brief requires.
 *
 * Every field here is a thing a reader would otherwise have to guess at, and
 * each is measured rather than asserted.
 */
export function notDetectedReport({ payload, frames, windowMs, viewport, appearedOnly = 0 }) {
  const cache = cacheVerdict(payload?.navigation ?? null);
  const media = payload?.media ?? {};
  const first = frames[0] ?? null;

  const mediaSuspects = [];
  if (media.video) mediaSuspects.push(media.video + " <video> element(s)");
  if (media.canvas) mediaSuspects.push(media.canvas + " <canvas> element(s) — canvas drawing is not readable as CSS state");
  if (media.iframe) mediaSuspects.push(media.iframe + " <iframe> element(s) — cross-origin content cannot be sampled");
  if (media.svgAnimate) mediaSuspects.push(media.svgAnimate + " SMIL animation element(s)");

  return {
    observationWindowMs: windowMs,
    sampleOffsetsMs: frames.map((f) => f.offsetMs),
    framesCaptured: frames.length,
    viewport,
    restoredFromCache: cache.restoredFromCache,
    cacheEvidence: cache.why,
    contentVisibleAtFirstFrame: payload?.firstFrameVisible ?? null,
    readyStateAtFirstFrame: first?.readyState ?? null,
    elementsAtFirstFrame: first?.elementCount ?? null,
    elementRecordTruncated: payload?.truncated === true,
    observableProperties: [...TRACKED_PROPERTIES, "boundingBox"],
    possibleUnreadableMotion: mediaSuspects,
    elementsThatAppearedWithoutChanging: appearedOnly,
    whyAttributionFailed: appearedOnly > 0
      ? appearedOnly + " element(s) appeared during the window but never changed a tracked property afterwards. That is rendering, not animation, and it is not reported as an entrance."
      : "no tracked property changed on any element between the samples above, so there was no observed change to attribute to anything"
  };
}
