/**
 * Repeated structures — element groups that repeat, reported as themselves.
 *
 * The IR models one card and one button. Everything else the repeat detector
 * found was used for scoring and then discarded, so a page whose content region
 * holds 112 repeat groups produced a prompt naming two things. Some of those
 * groups are genuinely useful to a builder: `div.PricingProductFeature` repeats
 * 57 times at a known size in a known region, and is the semantic unit the
 * component resolver deliberately declines to ascend to.
 *
 * **These are not components, and the distinction is enforced structurally.**
 * They live in their own IR field, never in `ir.components`, so the component
 * gate cannot see them — not because a check rejects them, but because they are
 * never in the collection it reads. A repeated structure carries geometry,
 * repetition and region. It never carries a surface, and nothing here may be
 * read as one.
 */

/** Signatures that name a tag and nothing else cannot address anything. */
const BARE_TAG = /^[a-z][a-z0-9]*$/i;

const isAncestorPath = (a, b) => !!a && !!b && b !== a && b.startsWith(`${a}>`);

/**
 * The outermost member of each nested family.
 *
 * A card and the div that paints it are one structure seen at two depths, and
 * they repeat exactly as often as each other. Listing both would report the
 * same thing twice under different names. Equal instance count plus an ancestor
 * relationship is the signal; the containing member wins.
 */
function collapseNested(repeats) {
  return repeats.filter((r) => !repeats.some((other) =>
    other !== r &&
    other.count === r.count &&
    isAncestorPath(other.sampleDomPath, r.sampleDomPath)
  ));
}

/**
 * @param {object} raw            the extractor's output
 * @param {object[]} components   the accepted components, excluded from the list
 * @returns {object|null}
 */
export function deriveRepeatedStructures(raw, components = []) {
  const repeats = raw?.repeats ?? [];
  if (!repeats.length) return null;

  /* The selectors already reported as components. A structure that IS the
   * component is not a second finding about the page. */
  const claimed = new Set();
  for (const c of components ?? []) {
    for (const s of c.selectors ?? []) claimed.add(String(s).replace(/^[a-z]+/i, ""));
    if (c.stableSelector) claimed.add(String(c.stableSelector).replace(/^[a-z]+/i, ""));
  }
  const isClaimed = (signature) => {
    const bare = String(signature).replace(/^[a-z]+/i, "");
    return claimed.has(bare);
  };

  const items = collapseNested(repeats)
    .filter((r) => !BARE_TAG.test(String(r.signature ?? "")))
    .filter((r) => !isClaimed(r.signature))
    .map((r) => ({
      signature: r.signature ?? null,
      instances: r.count ?? null,
      region: r.region ?? null,
      inPrimaryRegion: r.inPrimary === true,
      sample: r.sampleRect
        ? { width: r.sampleRect.width ?? null, height: r.sampleRect.height ?? null }
        : null,
      /* Reported so a reader can see this is not a surface claim. A group with
       * painted members still gets no surface here: resolving WHICH element
       * paints and what it paints is the component resolver's job, and it ran
       * on one group only. */
      paintedMembers: r.paintedCount ?? 0,
      /* `stableSelector` is absent from every capture in this repository, so
       * the honest answer is usually "not measured" rather than "no". */
      selectorStability: r.stableSelector
        ? "measured-stable"
        : (r.namesAreGenerated === true ? "generated-names" : "not-measured")
    }))
    .sort((a, b) => (b.instances ?? 0) - (a.instances ?? 0));

  return {
    items,
    /* Scope, so no reader turns a capped sample into a page census. The two
     * counts below measure DIFFERENT SETS and must never be divided into one
     * another: p30 serialises 8 while its primary region holds 7, because a nav
     * group is serialised and is not in the primary region. */
    scope: {
      serialised: repeats.length,
      cap: 15,
      capped: repeats.length >= 15,
      inPrimaryRegion: raw?.primaryRegion?.repeatGroups ?? null,
      walkTruncated: raw?.coverage?.truncated === true,
      listed: items.length
    }
  };
}
