import { stampComment } from "../ir/hash.mjs";
import { standardHeader } from "./header.mjs";
import { STATUS, STATUS_LABEL } from "../evidence/status.mjs";

/**
 * IR -> evidence-report.md
 *
 * The design spec answers "what is this page like". This answers a different
 * question: "how do you know?" — every claim grouped by the way it came to be
 * known, so provenance is readable without opening the IR.
 *
 * The grouping is the artifact. A reader scanning a spec sees forty values and
 * has to check each annotation to learn that six of them were guessed; here the
 * six are in their own section with a heading that says what that means. The
 * ordering is deliberate too: measured first, unknown last, so the document
 * degrades from strongest to weakest as you read down it rather than mixing
 * them.
 */

const GROUPS = [
  {
    status: STATUS.MEASURED,
    heading: "Measured",
    means: "Read directly off the rendered layout or computed styles. These are the values the system is most willing to stand behind."
  },
  {
    status: STATUS.OBSERVED,
    heading: "Observed",
    means: "Present in the DOM or the stylesheet and read without interpretation."
  },
  {
    status: STATUS.INFERRED,
    heading: "Inferred",
    means: "Derived from other evidence rather than read. The derivation is sound; the result is still a step removed from a measurement."
  },
  {
    status: STATUS.ESTIMATED,
    heading: "Estimated",
    means: "Reconstructed from a screenshot or a partial signal. Treat every number here as approximate — building to it exactly would be building to a guess."
  },
  {
    status: STATUS.UNKNOWN,
    heading: "Unknown",
    means: "Looked for and not established. Listed rather than omitted, because a gap you can see is worth more than a page that reads as complete."
  }
];

/** Walks the IR gathering anything shaped like a claim. */
function collectClaims(node, path = "", out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectClaims(v, `${path}[${i}]`, out));
    return out;
  }
  if ("status" in node && ("value" in node || "candidates" in node)) {
    out.push({ ...node, path: path || "$" });
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    if (k === "meta" || k === "safety" || k === "coverage" || k === "confidence") continue;
    collectClaims(v, path ? `${path}.${k}` : k, out);
  }
  return out;
}

const render = (claim) => {
  if (Array.isArray(claim.value)) return claim.value.join(", ");
  if (claim.value == null) return "*not determined*";
  return claim.unit === "px" ? `${claim.value}px` : String(claim.value);
};

export function projectEvidenceReport(ir, hash) {
  const out = [];
  const push = (l = "") => out.push(l);
  const claims = collectClaims(ir);
  const contested = claims.filter((c) => c.contested);

  push(stampComment(hash));
  push(standardHeader(ir, {
    title: `Evidence report — ${ir.meta.slug}`,
    nextAction: "read `output/design-spec.md` for what these values describe."
  }));
  push("This report does not judge the page. It records how each thing came to be known,");
  push("grouped strongest first. Confidence and coverage are reported as a pair and never");
  push("multiplied together — a confident reading of a small sample and a hesitant reading");
  push("of a large one are different situations.");
  push();

  /* ------------------------------------------------------ the groups */

  for (const group of GROUPS) {
    const members = claims.filter((c) => c.status === group.status && !c.contested);
    push(`## ${group.heading}`);
    push();
    push(`*${group.means}*`);
    push();
    if (!members.length) {
      push(`No claim in this analysis is ${group.heading.toLowerCase()}.`);
      push();
      continue;
    }
    push("| Claim | Value | Evidence |");
    push("| --- | --- | --- |");
    for (const claim of members) {
      const refs = (claim.evidence ?? []).length ? (claim.evidence ?? []).join(", ") : "—";
      push(`| \`${claim.path}\` | ${render(claim)} | ${refs} |`);
    }
    push();
  }

  /* --------------------------------------------------- contested */

  push("## Contested");
  push();
  push("*Two or more sources disagreed. Neither value is presented as settled, because");
  push("choosing one silently is how a disagreement becomes a fact.*");
  push();
  if (!contested.length) {
    push("Nothing is contested in this analysis.");
    push();
  } else {
    push("| Claim | Candidates | Preferred | Type |");
    push("| --- | --- | --- | --- |");
    for (const claim of contested) {
      const candidates = (claim.candidates ?? []).map((c) => `${c.source}: ${c.value}`).join(" vs ");
      push(`| \`${claim.path}\` | ${candidates} | ${claim.disagreement?.preferredSource ?? "*none*"} | ${claim.disagreement?.type ?? "—"} |`);
    }
    push();
  }

  /* ---------------------------------------------------- limitations */

  /* The limitations are in the header, where they are read before the tables
   * rather than after them. Repeating them here would be the same text twice
   * in one short document. */

  return out.join("\n");
}

export { STATUS_LABEL };
