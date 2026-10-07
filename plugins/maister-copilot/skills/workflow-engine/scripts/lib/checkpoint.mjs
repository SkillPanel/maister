/**
 * The checkpoint's projections: what each surface shows, rendered from the one
 * structured object `gate-brief` builds and from nothing else.
 *
 * Why this module exists. A gate used to be rendered three ways from state by
 * three code paths — the in-session question, its previews and the driven line —
 * and a fourth surface would have needed a fourth. Each renderer chose for
 * itself what to show, and the choices drifted: the question grew to eight lines
 * with paths while the preview filled its whole 2,000 characters with every risk.
 * Now `gate-brief` decides *what* the checkpoint is, once, as data
 * (`buildCheckpoint`), and this module decides only *how* each surface lays it
 * out. A surface added later — a cockpit card, an editor panel — reads the same
 * object and makes its own layout, and no surface re-derives anything from state.
 *
 * The surfaces and their budgets:
 *
 * - **rich** (a picker that shows option previews): the question is the one-line
 *   ask; the continue option's preview is the checkpoint at a glance — *Done*,
 *   *Next*, *Review*, up to three decisions the run made and one counted line for
 *   the user's own choices, never a risk — within `FOCUS_LINES` lines and
 *   `FOCUS_BUDGET` characters; revise and stop preview what choosing them does;
 *   More details previews the full brief, risks grouped by tag.
 * - **plain** (a picker that shows labels only): the same selection carried in
 *   the question, the ask last so it stays on screen, and each option's title
 *   carrying its consequence after a dash.
 * - **more details**: the full brief, written out when More details is chosen.
 * - **request**: the driven gate request, whole — question, options, and the
 *   checkpoint beside the one-line summary older readers take.
 *
 * Pure: no I/O, no imports. Zero dependencies, Node >= 20.
 */

/** Most lines, and characters, of the continue option's preview. */
export const FOCUS_LINES = 9;
export const FOCUS_BUDGET = 900;

/** Most lines of the revise and the stop previews. */
export const REVISE_LINES = 8;
export const STOP_LINES = 7;

/** Most characters of any preview; Claude Code withholds a longer one whole. */
export const PREVIEW_BUDGET = 2000;

/** How many decisions the run made a glance shows, and how long each may run. */
const DECIDED_CAP = 3;
const DECISION_MAX = 110;

/** How many of the user's choices that differ from the recommendation are named. */
const DIFFERS_CAP = 2;

/** The word after a decision, naming who settled it. */
const SOURCE_WORD = { run: 'analysis', audit: 'audit', default: 'default' };

/** Who settled a group of decisions, as a heading names them. */
const SOURCE_HEADING = { run: 'the run', audit: 'the audit' };

/** Where the recommended option says so, in its label. */
const RECOMMENDED_MARK = ' (Recommended)';

/** The id of the request for the full brief, which is never an answer. */
export const MORE_DETAILS_ID = 'more-details';

/** What a question says when every option slot is taken. */
export const DETAILS_TYPED = 'Type "details" for the full brief.';

/** How many options each profile's tool lists. */
const PICKER_SLOTS = { rich: 4, plain: Infinity };

/** The fewest options a picker lists; a revise with fewer suggestions asks for its note typed. */
const PICKER_MIN = 2;

/** The order options are listed in, after the recommended one: on, back, out. */
const EFFECT_ORDER = { continue: 0, revise: 1, stop: 2 };

/** What More details says it does. */
const DETAILS_DESCRIPTION = 'Shows the full brief, risks included, then asks this again. Nothing is recorded.';

/** The cut More details' preview ends with. */
const DETAILS_CUT = 'Choose this to see the rest.';

// ---------------------------------------------------------------------------
// the pieces every layout shares
// ---------------------------------------------------------------------------

/** `A`, `A and B`, `A, B and C`. */
function andList(names) {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** `text` cut at a word to at most `max` characters, an ellipsis marking the cut. */
function clip(text, max) {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const word = cut.lastIndexOf(' ');
  return `${(word > max / 2 ? cut.slice(0, word) : cut).trimEnd()}…`;
}

/**
 * A step's title as a sentence names it: its first letter lower-cased unless
 * it opens an acronym, and no article in front. An article fits only some
 * titles — "the specification", but never "the choosing the checks" or "the
 * publish" — and the words alone cannot tell which ("Failing test" against
 * "Running tests"), so every generated sentence names a step the way a
 * definition's own labels do: "Runs verification next", "Continue to
 * choosing the checks".
 */
export function lowered(title) {
  if (title.length > 1 && title[1] === title[1].toUpperCase() && /[A-Z]/.test(title[1])) return title;
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/** The *Next* text: the node that runs and the work skipped on the way, or where the run is instead. */
function nextText(next) {
  if (!next) return 'unknown — the workflow changed since this run started';
  if (next.waiting?.length) return `waiting on ${andList(next.waiting.map(each => each.title))}`;
  const skipped = next.skipped?.length ? ` (skipping ${andList(next.skipped.map(each => each.title))})` : '';
  return `${next.end ? 'end of the run' : next.title}${skipped}`;
}

/**
 * The *Review* text: the files to open, each by its path inside the task
 * folder. `companion` says how an HTML companion is named — "beside it" on a
 * surface that can be short, its file name on one that is read whole.
 */
function reviewText(review, companion) {
  if (!review?.length) return '';
  const name = html => html.split('/').pop();
  return review.map(each => {
    if (!each.html) return each.path;
    const beside = each.html.split('/').slice(0, -1).join('/') === each.path.split('/').slice(0, -1).join('/');
    if (companion === 'beside') return `${each.path} (HTML beside it)`;
    return `${each.path} (HTML: ${beside ? name(each.html) : each.html})`;
  }).join(', ');
}

/** The decisions the run, the audits and the defaults settled, in that order. */
function decided(checkpoint) {
  const groups = checkpoint.decisions ?? {};
  return ['run', 'audit', 'default'].flatMap(by => (groups[by] ?? []).map(item => ({ ...item, by })));
}

/**
 * The heading over the decisions shown, naming every source among them: an
 * audit's findings under "Decided by the run" credited the run with what the
 * audit settled. "Decided by the run and the audit", "Taken by default", or
 * either with ", or by default" when defaults sit beside them.
 */
function decidedHeading(items) {
  const sources = ['run', 'audit'].filter(by => items.some(item => item.by === by));
  const defaults = items.some(item => item.by === 'default');
  if (!sources.length) return 'Taken by default';
  return `Decided by ${andList(sources.map(by => SOURCE_HEADING[by]))}${defaults ? ', or by default' : ''}`;
}

/** One decision line: its text, cut, and the word for who settled it. */
function decisionLine(item, max = DECISION_MAX) {
  const suffix = ` — ${SOURCE_WORD[item.by] ?? item.by}`;
  return `- ${clip(item.decision, Math.max(20, max))}${suffix}`;
}

/**
 * The user's own choices in one line: how many, and the ones that differ from
 * the recommendation, at most `DIFFERS_CAP` of them named. '' when the user
 * made none in this stretch.
 */
export function choicesLine(checkpoint) {
  const operator = checkpoint.decisions?.operator;
  const count = operator?.count ?? 0;
  if (!count) return '';
  const made = `You made ${count} ${count === 1 ? 'choice' : 'choices'}`;
  const differs = operator.not_recommended ?? [];
  if (!differs.length) return operator.all_recommended === false ? `${made}.` : `${made}, all as recommended.`;
  const named = differs.slice(0, DIFFERS_CAP).map(each => each.decision).join('; ');
  const verb = differs.length === 1 ? 'differs' : 'differ';
  return `${made}; ${differs.length} ${verb} from the recommendation: ${named.replace(/\.$/, '')}.`;
}

/**
 * The checkpoint at a glance, as lines: *Done*, *Next*, *Review*, the
 * decisions the run made and the user's own choices counted. No risk of any
 * tag: those are one focus away, in More details. Within `lines` and `budget`,
 * the decisions are cut, then dropped from the end with a count, and last the
 * *Done* sentence is cut; *Next* is never cut.
 */
function glance(checkpoint, { companion, lines = FOCUS_LINES, budget = FOCUS_BUDGET, markdown = false }) {
  const items = decided(checkpoint);
  const review = reviewText(checkpoint.review, companion);
  const choices = choicesLine(checkpoint);
  const view = { shown: Math.min(items.length, DECIDED_CAP), item: DECISION_MAX, done: Infinity };
  const draw = () => {
    const out = [];
    if (checkpoint.headline) out.push(`Done: ${clip(checkpoint.headline, view.done)}`);
    out.push(`Next: ${nextText(checkpoint.next)}`);
    if (review) out.push(`Review: ${review}`);
    if (view.shown > 0) {
      const rest = items.length - view.shown;
      out.push(`${decidedHeading(items)}${rest > 0 ? ` (+${rest} more under More details)` : ''}:`);
      out.push(...items.slice(0, view.shown).map(item => decisionLine(item, view.item)));
    } else if (items.length) {
      out.push(`${decidedHeading(items)}: ${items.length} ${items.length === 1 ? 'decision' : 'decisions'}, under More details.`);
    }
    // A line straight after a bullet continues that bullet where the preview is
    // read as markdown, so the user's own choices read as part of the last
    // decision; a blank line keeps them a line of their own.
    if (choices) out.push(...(markdown && out.at(-1).startsWith('- ') ? ['', choices] : [choices]));
    return out;
  };
  let out = draw();
  const fits = () => out.length <= lines && out.join('\n').length <= budget;
  while (!fits() && view.item > 40) {
    view.item -= 10;
    out = draw();
  }
  while (!fits() && view.shown > 0) {
    view.shown--;
    out = draw();
  }
  if (!fits() && checkpoint.headline) {
    view.done = Math.max(40, checkpoint.headline.length - (out.join('\n').length - budget));
    out = draw();
  }
  return out;
}

/** The option the checkpoint recommends. */
function recommendedOption(checkpoint) {
  return checkpoint.options.find(option => option.recommended) ?? null;
}

/** The reason Stop is recommended, or ''. */
function stopReason(checkpoint) {
  const stop = checkpoint.risks?.stop ?? [];
  return stop.length ? stop[0].risk : '';
}

/** The stop option's preview: why, when it is recommended; what stays; what does not run. */
function stopLines(checkpoint, option) {
  const out = [];
  const why = option.recommended ? stopReason(checkpoint) : '';
  if (why) {
    out.push(`Why stop: ${why}`);
    if (checkpoint.headline) out.push(`Done: ${checkpoint.headline}`);
  }
  out.push('Ends the run here.');
  const kept = [...(option.keeps ?? [])];
  if (checkpoint.run?.dashboard) kept.push('the dashboard');
  if (kept.length) out.push(`Kept: ${andList(kept)}.`);
  const notRun = option.not_run;
  if (notRun?.next) {
    const later = notRun.remaining > 1 ? ` and ${notRun.remaining - 1} later ${notRun.remaining - 1 === 1 ? 'phase' : 'phases'}` : '';
    out.push(`Not run: ${lowered(notRun.next)}${later}.`);
  }
  out.push('Start a new run from these files to pick up later.');
  return out.slice(0, STOP_LINES);
}

/** How often a gate has sent the run back, said as a count of what happened. */
function revisedSoFar(revision) {
  const done = (revision?.n ?? 1) - 1;
  if (done < 1) return '';
  return ` Revised ${done === 1 ? 'once' : `${done} times`} so far here.`;
}

/** What a revise re-runs, and how often this checkpoint has sent the run back. */
function rerunsLine(option) {
  const names = andList((option.reruns ?? []).map(each => each.title));
  return `Re-runs: ${names || 'the earlier phases'}, then asks this checkpoint again.${revisedSoFar(option.revision)}`;
}

/**
 * The revise option's preview: what re-runs, then the notes it suggests, each
 * whole — a note is what the re-run is told, and the preview has the room.
 */
function reviseLines(option) {
  const out = [rerunsLine(option)];
  const suggestions = option.suggestions ?? [];
  if (suggestions.length) {
    out.push('Suggested notes:');
    out.push(...suggestions.slice(0, REVISE_LINES - 2).map(each => `- ${each.note}`));
  } else {
    out.push('No suggested notes: you type what should change.');
  }
  return out;
}

/**
 * The question a revise asks next, before anything is written: what should
 * change, with what re-runs and how often this checkpoint has sent the run
 * back, so the user deciding on a note knows what it costs. The suggestions
 * are offered, never recommended and never pre-chosen: a user who came to type
 * a note should not have to untick one first. Where options carry a
 * description, the label is the short form and the description the rest;
 * where they carry only a title, the title is the note whole.
 *
 * A picker lists two options at the least, so with fewer suggestions the
 * question has none and asks for the note typed, naming the one suggestion
 * there is so it can be sent with a word.
 */
function noteQuestion(option, profile) {
  const suggestions = option.suggestions ?? [];
  if (suggestions.length < PICKER_MIN) {
    const ask = suggestions.length
      ? `The run suggests: ${suggestions[0].note.replace(/\.$/, '')}. Type "yes" to send it, or type your own change.`
      : 'Type the change.';
    return { header: 'Revise', question: `What should change? ${rerunsLine(option)} ${ask}`, multi_select: false, options: [] };
  }
  return {
    header: 'Revise',
    question: `What should change? ${rerunsLine(option)}`,
    multi_select: true,
    options: suggestions.map(each => (profile === 'rich'
      ? { label: each.label, description: each.description }
      : { label: each.note })),
  };
}

// ---------------------------------------------------------------------------
// more details: the full brief
// ---------------------------------------------------------------------------

/**
 * The full brief, risks included: the *Done* sentence; each closed node's
 * summary under its title; every decision with who settled it; the user's
 * choices; risks grouped as Open (a stop first), Trade-offs accepted and
 * Follow-ups; and every file to review with what it holds. Markdown, blocks
 * apart by a blank line. Unclipped: the caller clips the preview.
 */
export function moreDetails(checkpoint) {
  const blocks = [];
  if (checkpoint.headline) blocks.push(`Done: ${checkpoint.headline}`);
  for (const closed of checkpoint.closed ?? []) blocks.push(`**${closed.title}**\n${closed.summary}`);
  const items = decided(checkpoint);
  if (items.length) {
    blocks.push([`**${decidedHeading(items)}**`, ...items.map(item => `- ${item.decision}${item.rationale ? ` — ${item.rationale}` : ''} — ${SOURCE_WORD[item.by] ?? item.by}`)].join('\n'));
  }
  const choices = choicesLine(checkpoint);
  if (choices) {
    const differs = checkpoint.decisions.operator.not_recommended ?? [];
    blocks.push(['**Your choices**', choices, ...differs.map(each => `- ${each.question ? `${each.question}: ` : ''}${each.answer ?? each.decision}${each.recommended ? ` (recommended: ${each.recommended})` : ''}`)].join('\n'));
  }
  const risks = checkpoint.risks ?? {};
  const riskLine = risk => `- ${risk.risk}${risk.change ? ` → ${risk.change}` : ''}`;
  const open = [...(risks.stop ?? []).map(risk => ({ ...risk, risk: `Recommends stopping: ${risk.risk}` })), ...(risks.open ?? [])];
  if (open.length) blocks.push(['**Open**', ...open.map(riskLine)].join('\n'));
  if (risks.tradeoff?.length) blocks.push(['**Trade-offs accepted**', ...risks.tradeoff.map(riskLine)].join('\n'));
  if (risks.followup?.length) blocks.push(['**Follow-ups**', ...risks.followup.map(riskLine)].join('\n'));
  if (risks.resolved?.length) blocks.push(['**Settled**', ...risks.resolved.map(riskLine)].join('\n'));
  if (checkpoint.review?.length) {
    blocks.push(['**Files**', ...checkpoint.review.map(each => `- ${each.path}${each.label ? ` — ${each.label}` : ''}${each.html ? ` (HTML: ${each.html})` : ''}`)].join('\n'));
  }
  blocks.push(`Next: ${nextText(checkpoint.next)}`);
  return blocks.join('\n\n');
}

/** The full brief cut to the preview budget, the cut saying how to see the rest. */
function detailsPreview(checkpoint) {
  const text = moreDetails(checkpoint);
  if (text.length <= PREVIEW_BUDGET) return text;
  const room = PREVIEW_BUDGET - DETAILS_CUT.length - 3;
  return `${clip(text, room)}\n\n${DETAILS_CUT}`;
}

// ---------------------------------------------------------------------------
// the pickers
// ---------------------------------------------------------------------------

/** The checkpoint's options in picker order: the recommended first, then on, back, out. */
function ordered(checkpoint) {
  const rank = option => EFFECT_ORDER[option.effect] ?? EFFECT_ORDER.stop;
  const sorted = checkpoint.options
    .map((option, index) => ({ option, index }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.index - b.index)
    .map(({ option }) => option);
  return [...sorted.filter(option => option.recommended), ...sorted.filter(option => !option.recommended)];
}

/** What a picker keeps of an option beyond its words: the fields a revise is answered with. */
function answerFields(option, profile) {
  if (option.effect !== 'revise') return {};
  return {
    note: true,
    reruns: option.reruns ?? [],
    revision: option.revision ?? null,
    suggestions: option.suggestions ?? [],
    note_question: noteQuestion(option, profile),
  };
}

/**
 * The picker for a tool that shows option previews. The question is the
 * one-line ask; every option carries a preview, because once one does the tool
 * shows no option's description.
 */
export function richPicker(checkpoint) {
  const options = ordered(checkpoint).map(option => {
    let lines;
    if (option.effect === 'continue') lines = glance(checkpoint, { companion: 'beside', markdown: true });
    else if (option.effect === 'revise') lines = reviseLines(option);
    else lines = stopLines(checkpoint, option);
    return {
      id: option.id,
      label: `${option.label}${option.recommended ? RECOMMENDED_MARK : ''}`,
      description: option.consequence,
      recommended: option.recommended,
      ...answerFields(option, 'rich'),
      preview: clip(lines.join('\n'), PREVIEW_BUDGET),
    };
  });
  return withDetails('rich', checkpoint.ask, options, { preview: detailsPreview(checkpoint) });
}

/**
 * The picker for a tool that shows labels only. The question carries the
 * glance, then the ask last, so the ask and the options stay on screen on a
 * short pane; each title carries what choosing it does after a dash.
 */
export function plainPicker(checkpoint) {
  const question = [...glance(checkpoint, { companion: 'name', lines: Infinity, budget: Infinity }), checkpoint.ask].join('\n');
  const options = ordered(checkpoint).map(option => ({
    id: option.id,
    label: `${plainTitle(checkpoint, option)}${option.recommended ? RECOMMENDED_MARK : ''}`,
    recommended: option.recommended,
    ...answerFields(option, 'plain'),
  }));
  return withDetails('plain', question, options, {});
}

/** An option's title on a labels-only picker: its label and, after a dash, what it does. */
function plainTitle(checkpoint, option) {
  if (option.effect === 'continue') return option.label;
  if (option.effect === 'revise') {
    // "it" only when the label already names the one node that re-runs:
    // "Revise the decisions — re-runs it" hid that the decision areas are asked again.
    const names = (option.reruns ?? []).map(each => lowered(each.title));
    const own = names.length === 1 && option.label.toLowerCase().includes(names[0].toLowerCase());
    return `${option.label} — re-runs ${own ? 'it' : andList(names)} with your note`;
  }
  const why = option.recommended ? stopReason(checkpoint) : '';
  return `${option.label} — ${why ? clip(why, 70) : 'keeps everything written so far'}`;
}

/**
 * The options with More details last, never recommended, while the tool has a
 * slot free — otherwise the question asks for "details" to be typed.
 */
function withDetails(profile, question, options, more) {
  if (!options.length) return { question, options, details: 'none' };
  if (options.length < PICKER_SLOTS[profile]) {
    const details = { id: MORE_DETAILS_ID, label: 'More details', recommended: false, details: true };
    if (profile === 'rich') Object.assign(details, { description: DETAILS_DESCRIPTION, ...more });
    return { question, options: [...options, details], details: 'option' };
  }
  return { question: `${question} ${DETAILS_TYPED}`, options, details: 'typed' };
}

// ---------------------------------------------------------------------------
// the driven request
// ---------------------------------------------------------------------------

/**
 * The gate request a driver suspends on, whole: the question is the ask; the
 * options carry their labels, what each does, the recommendation and a revise's
 * suggestions; `context.summary` is the one-line form older readers take and
 * must keep getting; `context.artifacts` the files to review; and
 * `context.checkpoint` the object itself, kept with the request so the gate's
 * history shows what was asked. The writer adds the version, the time asked and
 * the empty answer — a caller that sent them would be refused.
 */
export function requestOf(checkpoint, summary) {
  return {
    node: checkpoint.node,
    kind: checkpoint.kind,
    question: checkpoint.ask,
    context: {
      summary,
      artifacts: (checkpoint.review ?? []).map(each => each.path),
      checkpoint,
    },
    options: ordered(checkpoint).map(option => ({
      id: option.id,
      label: option.label,
      effect: option.effect,
      description: option.consequence,
      ...(option.recommended ? { recommended: true } : {}),
      // A request suggestion is the gate contract's `{label, note, recommended}`:
      // the note already carries the concern and the change, so the picker's
      // `description` stays in session and a contract reader refuses no key.
      ...(option.effect === 'revise'
        ? {
          note: true,
          suggestions: (option.suggestions ?? []).map(({ label, note, recommended }) => ({ label, note, recommended })),
        }
        : {}),
    })),
    multi_select: false,
  };
}
