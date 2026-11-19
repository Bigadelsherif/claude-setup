import { standardHeader } from "./header.mjs";
import { adapterFor, unsupportedStackGuidance, ADAPTER_CONTRACT } from "../prompts/stack-adapter.mjs";

/**
 * IR + stack -> implementation-notes.md
 *
 * A companion to an implementation prompt, and deliberately NOT part of it.
 *
 * The prompt says what to build, and every value in it is traceable to
 * evidence. These notes say how the chosen stack tends to express those things
 * — which is useful, and is not a finding about the reference. Keeping them in
 * separate files is what stops "Tailwind rounds to the nearest step in its
 * spacing scale" from being read as something that was measured on the page.
 *
 * So this file makes no claims about the reference at all. It states what the
 * prompt already established, names what the stack cannot express exactly, and
 * says explicitly what it does not decide.
 */

export function projectImplementationNotes(ir, hash, options = {}) {
  const stack = options.stack ?? "next-tailwind";
  const adapter = adapterFor(stack);
  const out = [];
  const push = (l = "") => out.push(l);

  push(standardHeader(ir, {
    title: `Implementation notes — ${stack}`,
    nextAction: "read the implementation prompt first. Come back here when a measured value does not map cleanly onto the stack.",
    limitations: [
      `Written for \`${stack}\`. Nothing here transfers to another stack.`,
      "These notes contain no findings about the reference. They describe how the chosen stack expresses values that were measured elsewhere."
    ]
  }));
  push("> **These notes contain no findings.** Everything measured about the reference is in");
  push("> the implementation prompt and the design spec. This file describes how the chosen");
  push("> stack tends to express those values, which is a fact about the stack and not about");
  push("> the page. The two are kept in separate files so the distinction survives being read");
  push("> quickly.");
  push();

  /* ------------------------------------------------------------ stack */

  push("## Stack");
  push();
  if (!adapter) {
    const guidance = unsupportedStackGuidance(stack);
    push(`**${guidance.statement}**`);
    push();
    push("What is still valid:");
    push();
    for (const item of guidance.whatIsStillValid) push(`- ${item}`);
    push();
    push("Guidance that holds regardless of framework:");
    push();
    for (const item of guidance.safeGuidance) push(`- ${item}`);
    push();
    push(`> ${guidance.doNotInfer} Implemented adapters: ${guidance.supportedInstead.join(", ")}.`);
    push();

    /* The contract's sections still appear, each saying it has no adapter
     * content. An absent section would read as "nothing to say here", which is
     * a different claim from "no adapter was written for this stack". */
    push("## Token mapping");
    push();
    push(`No token mapping is generated for \`${stack}\`. The measured values in the`);
    push("accompanying prompt are literal and stack-independent; express them directly.");
    push();
    push("## What this stack cannot express exactly");
    push();
    push(`Unknown — nothing here was checked against \`${stack}\`. Where a measured value does`);
    push("not fit your system, record the substitution rather than making it silently.");
    push();
  } else {
    push(`**${adapter.label}**`);
    push();
    push("This adapter is implemented and its guidance was written against the framework's");
    push("actual behaviour. Everything below is a fact about the stack, not about the reference.");
    push();

    push("## Token mapping");
    push();
    push("| Area | How this stack expresses it | Exactness |");
    push("| --- | --- | --- |");
    for (const m of adapter.mapping) {
      push(`| ${m.area} | ${m.how} | ${m.exact} |`);
    }
    push();
    const cautions = adapter.mapping.filter((m) => m.caution);
    if (cautions.length) {
      push("Where each one goes wrong:");
      push();
      for (const m of cautions) push(`- **${m.area}.** ${m.caution}`);
      push();
    }

    push("### Motion");
    push();
    push(adapter.motion.rule);
    push();

    push("## What this stack cannot express exactly");
    push();
    for (const item of adapter.cannotExpressExactly) push(`- ${item}`);
    push();
    push("Where a measured value cannot be expressed exactly, record the substitution rather");
    push("than making it quietly. A substituted value that nobody wrote down is");
    push("indistinguishable from a measured one six weeks later.");
    push();

    push("### What this adapter is responsible for");
    push();
    push("| Area | What it covers |");
    push("| --- | --- |");
    for (const c of ADAPTER_CONTRACT) push(`| ${c.label} | ${c.describe} |`);
    push();
  }

  /* ------------------------------------------- what this does not decide */

  push("## What this does not decide");
  push();
  push("- **Component boundaries.** The inventory records what was found on the page, not how");
  push("  it should be split into files.");
  push("- **State management, data fetching, routing.** Nothing was measured about any of them.");
  push("- **Anything not in the evidence.** Where the analysis says unknown, this file has no");
  push("  opinion to add — an opinion here would be a guess wearing the same typeface as a");
  push("  measurement.");
  push();

  /* The limitations are in the header, where they are read before the notes
   * rather than after them. The one that is specific to this file — that
   * expressing an estimate precisely does not make it precise — is added
   * there through `limitations`. */

  return out.join("\n");
}


