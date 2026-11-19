/**
 * Primary-region verification — stage 4 of the pipeline.
 *
 * Runs BEFORE synthesis. Coverage assessment answers "how much did we see";
 * this answers the sharper question "did we see the right thing at all".
 *
 * The Stripe run motivated it: every claim was individually defensible, and the
 * whole analysis described a navigation menu. No amount of per-claim rigour
 * catches that — it has to be checked at the level of region selection.
 */

const check = (id, passed, detail, severity = "high") => ({ id, passed, detail, severity });

/**
 * Region verification for a screenshot capture.
 *
 * The DOM checks have nothing to inspect, so the equivalent question is asked
 * of the image: were content regions analysed, are their bounds trustworthy,
 * and is the scale known.
 */
export function verifyScreenshotRegions(evidence, coverage) {
  const regions = evidence.regions ?? [];
  const contentKinds = new Set(["main-content", "card", "hero", "form"]);
  const contentRegions = regions.filter((r) => contentKinds.has(r.kind));
  const explicit = regions.filter((r) => r.detectionMethod === "explicit");
  const checks = [];

  checks.push(check("regions-supplied", regions.length > 0, `${regions.length} valid region(s).`));
  checks.push(check("content-regions", contentRegions.length > 0,
    contentRegions.length
      ? `${contentRegions.length} region(s) cover page content.`
      : "No analysed region covers page content."));
  checks.push(check("region-bounds-trustworthy", explicit.length > 0,
    `${explicit.length} of ${regions.length} region(s) had supplied bounds; the rest were detected.`,
    "medium"));
  checks.push(check("scale-known", evidence.scaleKnown === true,
    evidence.scaleKnown
      ? "Image scale is known, so pixel measurements carry a unit."
      : "Image scale is unknown, so pixel measurements are estimates.",
    "medium"));
  checks.push(check("no-rejected-observations", (evidence.rejected?.length ?? 0) === 0,
    `${evidence.rejected?.length ?? 0} observation(s) rejected as invalid.`,
    "medium"));
  checks.push(check("content-reached", (coverage?.contentReached ?? 0) > 0,
    coverage?.contentReachedReason ?? "Coverage did not report contentReached.", "critical"));

  const failures = checks.filter((c) => !c.passed && c.severity !== "info");
  const criticalFailures = failures.filter((c) => c.severity === "critical" || c.severity === "high");

  return {
    passed: criticalFailures.length === 0,
    checks,
    failures: failures.map((f) => f.id),
    criticalFailures: criticalFailures.map((f) => f.id),
    analysedRegion: contentRegions.length
      ? { signature: contentRegions[0].kind, region: contentRegions[0].id, count: contentRegions.length }
      : null,
    expectedRegion: { selector: "main-content", kind: "screenshot-region", visibleDescendants: regions.length }
  };
}

export function verifyPrimaryRegion(raw, coverage) {
  const primary = raw.primaryRegion ?? null;
  const repeats = raw.repeats ?? [];
  const cov = raw.coverage ?? {};
  const checks = [];

  /* 1 — does a content region exist at all */
  checks.push(
    check(
      "main-exists",
      !!primary,
      primary
        ? primary.exists
          ? `<main> found: \`${primary.selector}\``
          : `No <main>; content region inferred as \`${primary.selector}\` (${primary.kind})`
        : "No primary region could be identified.",
      primary?.exists ? "info" : "medium"
    )
  );

  /* 2 — does it contain anything visible */
  const visibleDescendants = primary?.visibleDescendants ?? 0;
  checks.push(
    check(
      "main-has-visible-descendants",
      visibleDescendants > 0,
      `${visibleDescendants} visible descendants in the content region.`
    )
  );

  /* 3 — repeated groups inside the content region */
  const repeatsInPrimary = repeats.filter((r) => r.inPrimary || r.region === "main");
  checks.push(
    check(
      "repeat-groups-in-main",
      repeatsInPrimary.length > 0,
      repeatsInPrimary.length
        ? `${repeatsInPrimary.length} repeat group(s) inside the content region.`
        : "No repeated component groups were found inside the content region."
    )
  );

  /* 4 — substantial text or media */
  const textLength = primary?.textLength ?? 0;
  const mediaCount = primary?.mediaCount ?? 0;
  const substantial = textLength >= 200 || mediaCount >= 3;
  checks.push(
    check(
      "substantial-content",
      substantial,
      `Content region holds ${textLength} characters of text and ${mediaCount} media element(s).`
    )
  );

  /* 5 — was the content region actually sampled */
  const sampledInPrimary = cov.sampledInPrimary ?? 0;
  checks.push(
    check(
      "content-region-sampled",
      sampledInPrimary > 0,
      `${sampledInPrimary} of ${cov.nodesSampled ?? 0} sampled nodes fell inside the content region.`
    )
  );

  /* 6 — is the largest repeat group inside the content region */
  const largest = repeats[0] ?? null;
  checks.push(
    check(
      "largest-repeat-in-content",
      !!largest && (largest.inPrimary || largest.region === "main"),
      largest
        ? `Largest group \`${largest.signature}\` (${largest.count}x) is in the ${largest.region} region${largest.inPrimary ? " (inside content)" : ""}.`
        : "No repeat group was detected anywhere."
    )
  );

  /* 7 — is the run dominated by navigation or hidden structure */
  const navRepeats = repeats.filter(
    (r) => r.region === "nav" || r.region === "header" || r.inNavContainer
  ).length;
  const navDominated = repeats.length > 0 && navRepeats / repeats.length >= 0.8;
  checks.push(
    check(
      "not-nav-dominated",
      !navDominated,
      navDominated
        ? `${navRepeats} of ${repeats.length} repeat groups are navigation structures.`
        : `${navRepeats} of ${repeats.length} repeat groups are navigation structures.`
    )
  );

  /* 8 — content actually reached, per coverage */
  checks.push(
    check(
      "content-reached",
      (coverage?.contentReached ?? 0) > 0,
      coverage?.contentReachedReason ?? "Coverage did not report contentReached.",
      "critical"
    )
  );

  const failures = checks.filter((c) => !c.passed && c.severity !== "info");
  const criticalFailures = failures.filter((c) => c.severity === "critical" || c.severity === "high");

  return {
    passed: criticalFailures.length === 0,
    checks,
    failures: failures.map((f) => f.id),
    criticalFailures: criticalFailures.map((f) => f.id),
    analysedRegion: largest
      ? { signature: largest.signature, region: largest.region, count: largest.count }
      : null,
    expectedRegion: primary
      ? { selector: primary.selector, kind: primary.kind, visibleDescendants }
      : null
  };
}
