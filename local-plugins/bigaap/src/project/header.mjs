/**
 * The opening block on every human-readable artifact.
 *
 * Eight facts, in a fixed order, before any content. The order is the argument:
 * a reader learns what was looked at, how, and how well it was established
 * BEFORE they read a single conclusion. Putting confidence at the bottom — or
 * in a linked file — means the conclusions get read first and the caveats get
 * read never.
 *
 * What is deliberately absent is an overall quality verdict. There is no line
 * saying "quality: good". Coverage and confidence are reported side by side and
 * never multiplied, because a confident reading of a small sample and a hesitant
 * reading of a large one are different situations that one number would merge.
 *
 * `nextAction` is the last line rather than the first because it is only useful
 * once the reader knows what they are holding.
 */

/** Renders the eight-field header. Every field is stated, including absences. */
export function standardHeader(ir, {
  title,
  mode = null,
  nextAction = null,
  limitations = [],
  extra = []
} = {}) {
  const source = ir?.meta?.source ?? {};
  const coverage = ir?.coverage?.coverageFactor;
  const confidence = ir?.confidence?.provenance;
  const out = [];
  const push = (l = "") => out.push(l);

  push(`# ${title}`);
  push();
  push(`**What was analyzed:** \`${source.value ?? "not recorded"}\`  `);
  /* The evaluator emits `requestedMode`; `mode` was never a field on it, so
   * this fell through to "not recorded" on every run that had one (def_0046). */
  push(`**Requested mode:** ${mode ?? ir?.modeEvaluation?.requestedMode ?? "not recorded"}  `);
  push(`**Source kind:** ${source.kind ?? "not recorded"}  `);
  push(`**Evidence status:** ${evidenceStatusLine(ir)}  `);
  push(`**Coverage:** ${ratio(coverage)} · **Confidence:** ${ratio(confidence)}  `);
  for (const line of extra) push(`${line}  `);
  push(`**Generated:** ${ir?.meta?.capturedAt ?? "not recorded"}`);
  push();

  push("**Limitations:**");
  push();
  for (const l of standardLimitations(ir, limitations)) push(`- ${l}`);
  push();

  if (nextAction) {
    push(`**Next:** ${nextAction}`);
    push();
  }
  return out.join("\n");
}

/**
 * Coverage and confidence are ratios or they are absent.
 *
 * `not measured` rather than `0`. Zero coverage would be a claim that nothing
 * was reached, which is much stronger than not having looked.
 */
const ratio = (n) => (typeof n === "number" ? n.toFixed(2) : "not measured");

/** One line summarising how the claims in this artifact came to be known. */
function evidenceStatusLine(ir) {
  const kind = ir?.meta?.source?.kind;
  if (kind === "screenshots") {
    return "estimated throughout — every value was read from a screenshot, and none of it is a measurement";
  }
  const unknowns = (ir?.unknowns ?? []).length;
  const contested = (ir?.contestedClaims ?? []).length;
  const parts = ["measured and observed where the extractor reached"];
  if (unknowns) parts.push(`${unknowns} unknown`);
  if (contested) parts.push(`${contested} contested`);
  return parts.join(", ");
}

/**
 * The limitations that apply to everything this tool writes, plus any the
 * caller adds.
 *
 * Stated on every artifact rather than once in a README, because artifacts get
 * read individually and copied out of the directory that would have explained
 * them.
 */
export function standardLimitations(ir, extra = []) {
  const limits = [...extra];
  if (ir?.meta?.source?.kind === "screenshots") {
    limits.push("Every value came from screenshots and is estimated. Nothing here is a measurement.");
  }
  if ((ir?.unknowns ?? []).length) {
    limits.push(`${ir.unknowns.length} thing(s) were looked for and not established. They are listed rather than omitted.`);
  }
  const coverage = ir?.coverage?.coverageFactor;
  if (typeof coverage === "number" && coverage < 1) {
    limits.push(`The capture reached ${(coverage * 100).toFixed(0)}% of what it tried to read. Claims about what was not reached are absent, not negative.`);
  }
  limits.push("No tolerance in this system is validated. Nothing here rests on a certified threshold.");
  limits.push("There is no overall quality verdict, by construction — coverage and confidence are reported separately and never merged.");
  return limits;
}

/** The header fields, so the registry and the validator agree on what to require. */
export const HEADER_FIELDS = Object.freeze([
  "What was analyzed",
  "Requested mode",
  "Source kind",
  "Evidence status",
  "Coverage",
  "Generated",
  "Limitations",
  "Next"
]);
