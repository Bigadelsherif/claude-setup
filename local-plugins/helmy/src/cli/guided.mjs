/**
 * Guided input collection.
 *
 * Two modes, and the difference between them is the whole design.
 *
 * **Interactive** asks, shows the default, validates the answer, and lets you
 * cancel. **Non-interactive** never asks — it reports `requires-user-input`
 * with the exact missing fields and a command that would supply them.
 *
 * What neither does is invent. If `adapt` needs a product name and nobody
 * supplied one, there is no default that would be honest: the tool does not
 * know what your product is, and a placeholder would flow into a prompt that
 * reads exactly as confident as one written from a real answer.
 *
 * The IO is injectable so this is testable without a terminal. A prompt layer
 * that can only be exercised by a human is a prompt layer nobody exercises.
 */

import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { MODES } from "./catalog.mjs";

/** A sentinel a user can type to stop. Cancelling is not failing. */
export const CANCEL_WORDS = Object.freeze(["cancel", "quit", "abort", "\u0003"]);

export class Cancelled extends Error {
  constructor(field) {
    super(`cancelled at \`${field}\``);
    this.name = "Cancelled";
    this.field = field;
  }
}

/**
 * What each mode needs before it can run.
 *
 * `required` blocks the run; `guided` is asked for interactively when absent
 * but does not block. Separating them matters: `adapt` cannot run without a
 * brief, and would run perfectly well without a stack override.
 *
 * `nonBlocking` names guided fields that must never turn into a hard stop.
 * `productName` is one: a brief already carries the product name, so demanding
 * it separately would refuse a run over a value the required input contains.
 */
export const MODE_INPUTS = Object.freeze({
  analyze: {
    required: ["reference"],
    guided: ["inputType", "viewports"],
    describe: "Explain the reference. Produces no implementation guidance, and needs no target brief.",
    forbids: []
  },
  recreate: {
    required: ["reference"],
    guided: ["inputType", "viewports", "states", "stack"],
    describe: "Reproduce the measured system. Needs enough evidence that a rebuild prompt is more than a guess.",
    /* A screenshot-only capture is `estimated` by construction and ceiling-
     * capped. `recreate` asks for precision that kind of evidence cannot carry,
     * and no amount of recapturing screenshots changes that. */
    forbids: [{ when: (v) => v.inputType === "screenshots", why: "Screenshot evidence is estimated by construction and ceiling-capped. `recreate` asks for a precision this input kind cannot support, and recapturing more screenshots would not change that.", remedy: "Capture the reference as a live page, or use `analyze`, which screenshots do support." }]
  },
  adapt: {
    required: ["reference", "brief"],
    guided: ["inputType", "briefPath", "productName", "stack"],
    nonBlocking: ["productName", "stack"],
    nonBlocking: ["productName", "stack"],
    describe: "Reuse the measured structure for a DIFFERENT product. Requires a valid target brief.",
    forbids: []
  },
  extend: {
    required: ["reference", "brief"],
    guided: ["inputType", "briefPath", "productName"],
    nonBlocking: ["productName"],
    nonBlocking: ["productName"],
    describe: "Add to the measured system. Requires a brief and enough system variation to extend from.",
    forbids: []
  },
  improve: {
    required: ["reference"],
    guided: ["inputType", "viewports", "states"],
    describe: "Critique what the reference does. Observation, critique and proposal stay structurally separate.",
    forbids: []
  }
});

/**
 * The questions, in the order a person would sensibly answer them.
 *
 * `validate` returns `{ ok }` or `{ ok: false, reason }`. A question with no
 * validator would accept anything, which is how a typo becomes a capture of
 * the wrong page.
 *
 * `flag` is the real CLI flag, stated rather than derived from the key. An
 * earlier version derived it and produced `--brief-path`, which does not
 * exist — an example command that does not run is worse than none, because it
 * costs the reader a failed attempt to discover that.
 */
export const QUESTIONS = Object.freeze({
  inputType: {
    flag: "--input-type",
    ask: "Is the reference a live URL or a set of screenshots?",
    choices: ["url", "screenshots"],
    validate: (v) => ["url", "screenshots"].includes(v)
      ? { ok: true }
      : { ok: false, reason: "answer `url` or `screenshots`" }
  },
  url: {
    flag: "--url",
    ask: "Reference URL",
    validate: (v) => {
      if (!v) return { ok: false, reason: "a URL is required" };
      try {
        const u = new URL(v);
        if (!/^https?:$/.test(u.protocol)) return { ok: false, reason: "only http and https are supported" };
        return { ok: true };
      } catch { return { ok: false, reason: "that is not a URL" }; }
    }
  },
  screenshots: {
    flag: "--screenshots",
    ask: "Path to the reference screenshots",
    validate: (v) => !v ? { ok: false, reason: "a path is required" }
      : existsSync(v) ? { ok: true } : { ok: false, reason: `${v} does not exist` }
  },
  mode: {
    flag: "--for",
    ask: "Which mode?",
    choices: MODES,
    validate: (v) => MODES.includes(v) ? { ok: true } : { ok: false, reason: `one of ${MODES.join(", ")}` }
  },
  viewports: {
    flag: "--viewports",
    ask: "Viewport widths, comma-separated",
    parse: (v) => String(v).split(",").map((x) => Number(x.trim())).filter(Boolean),
    validate: (v) => {
      const list = Array.isArray(v) ? v : [];
      if (!list.length) return { ok: false, reason: "at least one width" };
      const bad = list.find((w) => !Number.isFinite(w) || w < 240 || w > 4096);
      return bad ? { ok: false, reason: `${bad} is outside 240–4096` } : { ok: true };
    }
  },
  states: {
    flag: "--states",
    ask: "Interaction states, comma-separated",
    parse: (v) => String(v).split(",").map((x) => x.trim()).filter(Boolean),
    validate: (v) => Array.isArray(v) && v.length ? { ok: true } : { ok: false, reason: "at least one state" }
  },
  briefPath: {
    flag: "--brief",
    ask: "Path to your target brief",
    validate: (v) => !v
      ? { ok: false, reason: "a path is required — write `input/target-brief.json` in the workspace, or `.helmy-analyzer/target-brief.json` in the project. Nothing here will invent one" }
      : existsSync(v) ? { ok: true } : { ok: false, reason: `${v} does not exist` }
  },
  productName: {
    flag: "--product",
    ask: "What is YOUR product called?",
    validate: (v) => v && String(v).trim().length > 1
      ? { ok: true }
      : { ok: false, reason: "a name is required — nothing here will invent one" }
  },
  stack: {
    flag: "--stack",
    ask: "Target stack adapter",
    choices: ["next-tailwind"],
    validate: (v) => v === "next-tailwind"
      ? { ok: true }
      : { ok: false, reason: "`next-tailwind` is the only implemented adapter" }
  },
  contentMode: {
    flag: "--content-mode",
    ask: "Content relationship between reference and target",
    choices: ["independent-content", "equivalent-content"],
    validate: (v) => ["independent-content", "equivalent-content"].includes(v)
      ? { ok: true } : { ok: false, reason: "independent-content or equivalent-content" }
  },
  outputDir: {
    flag: "--out",
    ask: "Where should artifacts be written?",
    validate: (v) => v ? { ok: true } : { ok: false, reason: "a directory is required" }
  },
  runFidelity: {
    flag: "--fidelity",
    ask: "Run a fidelity comparison afterwards?",
    choices: ["yes", "no"],
    parse: (v) => /^y(es)?$/i.test(String(v).trim()),
    validate: (v) => typeof v === "boolean" ? { ok: true } : { ok: false, reason: "yes or no" }
  }
});

/** Reads a line from stdin. Replaced wholesale in tests. */
/**
 * The reader for interactive answers.
 *
 * Questions go to stderr, never stdout. The same command may be run with
 * `--json`, and stdout then belongs entirely to the machine-readable result —
 * a prompt written there produces output that no parser can read, which is a
 * silent corruption rather than a visible failure.
 */
export function stdinAsker({ input = process.stdin, output = process.stderr } = {}) {
  return async (promptText) => {
    const rl = createInterface({ input, output });
    try {
      return await new Promise((resolve) => rl.question(promptText, resolve));
    } finally {
      rl.close();
    }
  };
}

/**
 * Whether prompting is possible at all.
 *
 * A non-TTY stdin means nobody is there to answer, so asking would hang. The
 * default is therefore non-interactive unless the caller opts in AND there is
 * a terminal — `--interactive` in a pipeline should not deadlock the pipeline.
 */
/**
 * How a default is described at the prompt.
 *
 * `argument` has no label because an explicitly-supplied value is never
 * re-asked: if you see a default, you did not type it on this run.
 */
const ORIGIN_LABEL = Object.freeze({
  "workspace-config": "workspace",
  "project-config": "project default",
  "preferences": "your preference",
  "tool-default": "tool default"
});

export const canPrompt = ({ interactive = false, isTTY = process.stdin.isTTY } = {}) =>
  interactive === true && isTTY === true;

/**
 * Collects the inputs a mode needs.
 *
 * Returns `{ collected, cancelled, missing }`. It never throws for a missing
 * answer — a missing answer is a result, not an exception, because the caller
 * turns it into `requires-user-input` with the fields named.
 */
export async function collectInputs({
  mode,
  resolution,
  interactive = false,
  isTTY = process.stdin.isTTY,
  ask = null,
  log = console.log
} = {}) {
  const spec = MODE_INPUTS[mode];
  if (!spec) return { collected: {}, cancelled: false, missing: [], unknownMode: true };

  const prompting = canPrompt({ interactive, isTTY });
  const asker = ask ?? (prompting ? stdinAsker() : null);
  const collected = {};
  const missing = [];

  /* Which concrete key stands for `reference` depends on the input type, which
   * may itself be one of the things being collected. */
  const inputTypeOf = () => collected.inputType ?? resolution.values.inputType ?? "url";
  const referenceKey = () => (inputTypeOf() === "screenshots" ? "screenshots" : "url");

  const wanted = [];
  for (const need of spec.guided) {
    wanted.push(need === "inputType" ? "inputType" : need);
  }
  /* The reference itself is always wanted, under whichever key applies. */
  if (!wanted.includes("url") && !wanted.includes("screenshots")) wanted.push("__reference__");

  for (const rawKey of wanted) {
    const key = rawKey === "__reference__" ? referenceKey() : rawKey;
    const question = QUESTIONS[key];
    if (!question) continue;

    const current = collected[key] ?? resolution.values[key];
    const record = resolution.records[key];
    const alreadyGood = current !== undefined && current !== null &&
      (question.validate ? question.validate(current).ok : true);

    /* An explicitly-supplied value is never re-asked: you already answered it.
     *
     * Everything else IS asked when prompting, with the resolved value shown as
     * the default — that is what makes it guided. Skipping any key that merely
     * had a value would mean interactive mode never asked about anything with a
     * default, which is nearly everything. */
    if (alreadyGood && (record?.explicit || !prompting)) {
      collected[key] = current;
      continue;
    }

    if (!prompting) {
      if (!alreadyGood && !(spec.nonBlocking ?? []).includes(key)) {
        missing.push({
          field: key,
          question: question.ask,
          reason: question.validate ? (question.validate(current).reason ?? "not supplied") : "not supplied",
          choices: question.choices ?? null,
          flag: question.flag
        });
      }
      continue;
    }

    /* Interactive: ask, show the default, validate, allow cancel. */
    let attempts = 0;
    for (;;) {
      /* The default is shown WITH where it came from. A bare `[1440]` tells you
       * what will happen if you press Enter but not whether that width is your
       * project's decision or the tool's guess — and those deserve different
       * amounts of scrutiny from whoever is sitting there. */
      const origin = ORIGIN_LABEL[resolution.records[key]?.source] ?? null;
      const shownValue = Array.isArray(current) ? current.join(",") : current;
      const shown = current !== undefined && current !== null
        ? ` [${shownValue}${origin ? ` · ${origin}` : ""}]`
        : "";
      const choices = question.choices ? ` (${question.choices.join(" / ")})` : "";
      const answer = String(await asker(`${question.ask}${choices}${shown}: `) ?? "").trim();

      if (CANCEL_WORDS.includes(answer.toLowerCase())) {
        return { collected, cancelled: true, cancelledAt: key, missing };
      }
      if (answer === "") {
        if (current !== undefined && current !== null) {
          collected[key] = current; /* Enter accepted the shown default */
          break;
        }
        log("  a value is required; there is no default to accept");
        if (++attempts >= 3) {
          missing.push({ field: key, question: question.ask, reason: "no value supplied and no default available", choices: question.choices ?? null, flag: question.flag });
          break;
        }
        continue;
      }

      const parsed = question.parse ? question.parse(answer) : answer;
      const check = question.validate ? question.validate(parsed) : { ok: true };
      if (check.ok) { collected[key] = parsed; break; }

      log(`  ${check.reason}`);
      if (++attempts >= 3) {
        missing.push({ field: key, question: question.ask, reason: check.reason, choices: question.choices ?? null, flag: question.flag });
        break;
      }
    }
  }

  return { collected, cancelled: false, missing, referenceKey: referenceKey() };
}

/**
 * Builds the example command a non-interactive caller needs.
 *
 * Concrete rather than generic: a user reading "supply the missing fields" has
 * to work out how, and the tool already knows.
 */
export function exampleCommand({ mode, missing, workspace = null, project = null }) {
  const parts = [`helmy ${mode}`];
  if (workspace) parts.push(`--workspace ${workspace}`);
  for (const m of missing) {
    const placeholder = m.choices ? m.choices[0] : `<${m.field}>`;
    parts.push(`${m.flag} ${placeholder}`);
  }
  return parts.join(" ");
}
