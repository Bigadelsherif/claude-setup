import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";
import { coveragePercent } from "./fmt.mjs";
import { displaySelector } from "../component/display-name.mjs";

/**
 * IR -> blocked-prompt.md
 *
 * Written in place of rebuild-prompt.md when the safety gate refuses.
 *
 * This file is the whole point of the gate. Silently emitting a plausible
 * prompt from insufficient evidence is worse than emitting nothing, because a
 * plausible prompt gets used. This says exactly what was analysed, what was
 * expected, what is missing, and what to do next.
 */
export function projectBlockedPrompt(ir, hash) {
  const s = ir.safety;
  const c = ir.coverage;
  const v = ir.verification;
  const out = [];
  const push = (l = "") => out.push(l);

  push(stampComment(hash));
  push(standardHeader(ir, { title: `Prompt generation blocked — ${ir.meta.slug}`, nextAction: "read the blockers below. Each says whether recapturing would change the verdict." }));
  push();
  push(`> **No rebuild prompt was generated for this capture.**`);
  push(`> Status: \`${s.status}\` · overall confidence ${ir.confidence.overall.toFixed(2)} · contentReached ${c?.contentReached?.toFixed(2) ?? "n/a"}`);
  push();
  push(
    "The analysis validated cleanly — every claim carries evidence and a status. " +
      "That is not sufficient. A valid IR describes what was measured; it does not " +
      "prove that what was measured is what you asked about."
  );
  push();

  /* ------------------------------------------------------ why blocked */

  push("## 1. Why generation was blocked");
  push();
  for (const b of s.blockers) {
    push(`### \`${b.code}\``);
    push();
    push(b.message);
    push();
    push(`**Remedy:** ${b.remedy}`);
    push();
  }

  /* -------------------------------------------------- region analysed */

  push("## 2. Which region was analysed");
  push();
  if (v?.analysedRegion) {
    push(
      `The dominant repeated structure was \`${v.analysedRegion.signature}\`, appearing ` +
        `**${v.analysedRegion.count} times** in the **${v.analysedRegion.region}** region.`
    );
  } else {
    push("No repeated structure was detected anywhere on the page.");
  }
  push();
  push("Sampling distribution:");
  push();
  push("| Region | Coverage |");
  push("| --- | --- |");
  push(`| Content (main) | ${coveragePercent(c?.mainCoverage, c?.regionSampled?.main)} |`);
  push(`| Header / nav | ${coveragePercent(c?.headerCoverage, c?.regionSampled?.header)} |`);
  push(`| Footer | ${coveragePercent(c?.footerCoverage, c?.regionSampled?.footer)} |`);
  push();
  if (c?.truncated) {
    push(`The node walk stopped at the ${c.nodeCap ?? "configured"}-node budget, so nothing above is a page-wide figure.`);
    push();
  }
  /* The case this document exists for most often: a page that hid itself, where
   * the region table above is a table about three nodes (def_0050). */
  if (c?.observability && c.observability.status !== "full") {
    push(`**The page was not fully observable — observability \`${c.observability.status}\`.** ${c.observability.reason}`);
    push();
    push(
      "Nothing above is a page-wide figure, and no region reported without sampled nodes is " +
        "known to be absent from the page."
    );
    push();
  }

  /* -------------------------------------------------- region expected */

  push("## 3. Which region was expected");
  push();
  if (v?.expectedRegion) {
    push(
      `The primary content region is \`${v.expectedRegion.selector}\` ` +
        `(${v.expectedRegion.kind}), holding ${v.expectedRegion.visibleDescendants} visible descendants.`
    );
    push();
    push(
      `Of ${c?.nodesSampled ?? 0} sampled nodes, ` +
        `**${Math.round((c?.contentShare ?? 0) * (c?.nodesSampled ?? 0))}** fell inside it.`
    );
  } else {
    push("No primary content region could be identified on this page.");
  }
  push();

  /* ------------------------------------------------- evidence missing */

  push("## 4. What evidence is missing");
  push();
  const missing = [];
  if ((c?.repeatGroupsInMain ?? 0) === 0) {
    missing.push("No repeated component group inside the content region — so no component anatomy could be resolved.");
  }
  if (!Object.keys(ir.tokens.elevation ?? {}).length) {
    missing.push("No elevation/shadow tokens — the sampled region uses none.");
  }
  if (!Object.keys(ir.tokens.border ?? {}).length) {
    missing.push("No authored border tokens — every observed border resolved to `currentColor`.");
  }
  if ((c?.stylesheets?.blocked ?? 0) > 0) {
    missing.push(`${c.stylesheets.blocked} stylesheet(s) unreachable by cross-origin policy; their declarations are absent.`);
  }
  for (const candidate of ir.componentCandidates ?? []) {
    /* The readable identity, for the same reason as the blocker detail: a
     * rejected candidate named by 326 characters of utility classes tells a
     * reader nothing about which element was rejected (def_0054). */
    missing.push(`Component \`${displaySelector(candidate) ?? candidate.selectors.join(", ")}\` rejected: ${candidate.rejectedBecause.join("; ")}.`);
  }
  if (!missing.length) missing.push("Coverage is below threshold across the board rather than in one specific category.");

  for (const m of missing) push(`- ${m}`);
  push();

  /* ------------------------------------------------------ what to do */

  push("## 5. What you can do next");
  push();

  const actions = [];
  if ((c?.contentReached ?? 0) === 0) {
    actions.push({
      title: "Give the capture a selector hint",
      body: "Re-run pointing the extractor at the content region explicitly, so sampling starts there instead of inferring it."
    });
  }
  if (c?.overlays > 0 || c?.consentBanners > 0) {
    actions.push({
      title: "Dismiss overlays before capture",
      body: `${c.overlays} overlay(s) and ${c.consentBanners} consent element(s) were present. Dismiss them, then re-capture.`
    });
  }
  if ((c?.visibleSampledPercent ?? 1) < 0.5) {
    actions.push({
      title: "Raise the node budget",
      body: `Only ${((c.visibleSampledPercent ?? 0) * 100).toFixed(1)}% of visible nodes were sampled. A larger budget will reach more of the page.`
    });
  }
  if ((c?.stylesheets?.blocked ?? 0) > 0) {
    actions.push({
      title: "Accept the stylesheet gap",
      body: "Cross-origin stylesheets cannot be read from the page. Computed styles still capture their effect; only authored declarations and custom properties are lost."
    });
  }
  actions.push({
    title: "Try a different viewport",
    body: "Content hidden behind a responsive breakpoint at this width may render at another."
  });
  actions.push({
    title: "Check browser state",
    body: "If the page requires a session, capture through a logged-in browser context — you must sign in yourself."
  });

  for (const a of actions) {
    push(`### ${a.title}`);
    push();
    push(a.body);
    push();
  }

  /* --------------------------------------------------- what is usable */

  push("## 6. What is still usable");
  push();
  push("`partial-design-spec.md` contains everything that WAS measured, clearly marked as partial. It is safe to read, and safe to use for:");
  push();
  push("- understanding the page's declared token system, where reachable");
  push("- reading the type and spacing scales as observed in the sampled region");
  push("- auditing what the extractor could and could not reach");
  push();
  push("It is **not** safe to use as the basis for a rebuild, because the component and layout claims may describe page furniture rather than content.");
  push();

  push("---");
  push();
  push("*Generated from `analysis/ir.json`. Do not edit — fix the capture and re-run.*");

  return out.join("\n");
}
