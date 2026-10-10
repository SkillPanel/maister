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
 *   *Next*, *Review*, up to three risks still open, a stop first, how many fixes
 *   the run applied with up to three of them, up to three decisions the run
 *   made and one counted line for the user's own choices — within
 *   `FOCUS_LINES` lines and `FOCUS_BUDGET` characters, the decisions and then
 *   the fixes giving way to the risks; revise and stop preview what choosing
 *   them does; More details previews the full brief, risks grouped by tag.
 * - **plain** (a picker that shows labels only): the same selection carried in
 *   the question, the ask last so it stays on screen, and each option's title
 *   carrying its consequence after a dash.
 * - **more details**: the full brief, written out when More details is chosen.
 * - **request**: the driven gate request, whole — question, options, and the
 *   checkpoint beside the one-line summary older readers take.
 * - **panel**: the glance an editor extension draws above the question, fitted
 *   to the rows Claude Code allows there (`PANEL_ROWS`) — a gate's, or a
 *   question set's step and count.
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

/** How long a recommendation's reason may run in a labels-only title before it is cut. */
const REASON_MAX = 120;

/** An abbreviation whose full stop ends no sentence, read off the text before it. */
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf)$/i;

/** How many open risks a glance shows. */
const RISK_CAP = 3;

/** How many fixes the run applied a glance lists under their count. */
const FIXED_CAP = 3;

/** The heading over the choices the run made that wait for the user's approval. */
const HELD_HEADING = 'Held for your approval';

/** The heading over the fixes, which the run applied without asking and decided nothing by. */
const FIXED_HEADING = 'Fixed by the run';

/** How a risk that recommends stopping opens, wherever risks are listed. */
const STOP_MARK = 'Recommends stopping: ';

/** How many of the user's choices that differ from the recommendation are named. */
const DIFFERS_CAP = 2;

/**
 * The word after a decision an audit or a default settled. A decision the run
 * settled is followed by the title of the step that recorded it instead: one
 * word for the run would credit a fix verification applied, or a plan's wave
 * order, to whichever step that word names.
 */
const SOURCE_WORD = { audit: 'audit', default: 'default' };

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

/** What each grant an option declares does, in the words a label carries it in. */
const GRANT_WORDS = {
  push: 'pushes the branch',
  'pr-create': 'opens the pull request',
  tag: 'creates and pushes the release tag',
  'tracker-write': 'writes to the issue tracker',
  'browser-remote': 'browses named remote hosts',
  spend: 'spends budget starting and steering runs',
};

/** The cut More details' preview ends with. */
const DETAILS_CUT = 'Choose this to see the rest.';

/**
 * The rows a panel drawn above the question may fill, and how a line is
 * counted against them. Claude Code holds what an extension draws around its
 * question dialog to twelve rows, a text counting one row plus one for every
 * forty characters it runs to, and refuses a tree over that whole — drawing its
 * own dialog alone. Two rows go to the panel's border. Measured, not
 * documented, so it is re-measured when Claude Code changes; a character is a
 * UTF-16 unit, the larger of the two counts.
 */
export const PANEL_ROWS = 10;
export const ROW_CHARS = 40;

/** The rows one line of a panel costs. */
export function rowsOf(text) {
  return 1 + Math.floor(text.length / ROW_CHARS);
}

/**
 * The most rows each panel line may take, in the order lines are fitted:
 * title, headline, next, review, counts. The title has two, so a step's whole
 * title fits beside its checkpoint label rather than being cut a row short.
 */
const PANEL_SHARES = { title: 2, headline: 3, next: 2, review: 2, counts: 1 };

/** The order a panel's lines are drawn in. */
const PANEL_ORDER = ['title', 'headline', 'counts', 'next', 'review'];

/** The most rows each line of a question set's panel may take: the step, then the first question's header and the count. */
const QUESTION_SHARES = { title: 2, questions: 2 };

// ---------------------------------------------------------------------------
// the pieces every layout shares
// ---------------------------------------------------------------------------

/**
 * What answering an option grants beyond the run, in plain words — "also
 * pushes the branch and opens the pull request" — or '' when it grants nothing.
 */
export function grantsText(names) {
  const words = (Array.isArray(names) ? names : []).map(name => GRANT_WORDS[name] ?? name);
  return words.length ? `also ${andList(words)}` : '';
}

/** An option's label with what answering it grants after a dash. */
function grantedLabel(checkpoint, option) {
  const granted = grantsText(checkpoint.grants?.[option.id]);
  return granted ? `${option.label} — ${granted}` : option.label;
}

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
 * A recommendation's reason as a labels-only title carries it: whole when it
 * fits `REASON_MAX`, else the sentences that fit, else cut at a word. A cut at
 * a fixed width took the last few words of a one-line reason; More details
 * carries the reason whole.
 */
function reasonText(text) {
  if (text.length <= REASON_MAX) return text;
  const ends = [...text.slice(0, REASON_MAX).matchAll(/[.!?](?=\s)/g)]
    .filter(end => !ABBREVIATION.test(text.slice(0, end.index)));
  return ends.length ? text.slice(0, ends.at(-1).index + 1) : clip(text, REASON_MAX);
}

/** `text` as a sentence of its own: a capital first letter and a closing stop. */
function sentenceOf(text) {
  const opened = text.trim().charAt(0).toUpperCase() + text.trim().slice(1);
  return /[.!?]$/.test(opened) ? opened : `${opened}.`;
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

/**
 * The decisions the run, the audits and the defaults settled, in that order,
 * each with its `source`: the step that settled it for the run's own, read off
 * the closed steps it came from, else the word for who did.
 */
function decided(checkpoint) {
  const groups = checkpoint.decisions ?? {};
  const titles = new Map((checkpoint.closed ?? []).map(each => [each.node, each.title]));
  const source = (by, item) => (by === 'run'
    ? (titles.has(item.node) ? lowered(titles.get(item.node)) : null)
    : SOURCE_WORD[by] ?? by);
  return ['run', 'audit', 'default'].flatMap(by => (groups[by] ?? []).map(item => ({ ...item, by, source: source(by, item) })));
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

/** A fix as a reader shows it: what was wrong, and what changed after the arrow. */
function fixText(fix) {
  if (fix.finding && fix.change) return `${fix.finding.replace(/\.$/, '')} → ${fix.change}`;
  return fix.finding ?? fix.change ?? '';
}

/**
 * One decision line: its text, cut, and where it was settled. A decision that
 * carries its class names it after the text, then the first sentence of why.
 */
function decisionLine(item, max = DECISION_MAX) {
  const suffix = item.source ? ` — ${item.source}` : '';
  const room = Math.max(20, max);
  if (!item.class) return `- ${clip(item.decision, room)}${suffix}`;
  const lead = item.rationale ? `: ${clip(leadOf(item.rationale), room)}` : '';
  return `- ${clip(item.decision, room)} (${item.class})${lead}${suffix}`;
}

/** A text's first sentence, or the whole text when it has no sentence end. */
function leadOf(text) {
  const end = [...String(text).matchAll(/[.!?](?=\s|$)/g)].find(each => !ABBREVIATION.test(text.slice(0, each.index)));
  return end ? text.slice(0, end.index + 1) : String(text);
}

/**
 * The choices the run made that wait for the user's approval, each with the
 * step that holds it: `source` is that step's title, as a decision's is.
 */
function heldOf(checkpoint) {
  const titles = new Map((checkpoint.closed ?? []).map(each => [each.node, each.title]));
  return (checkpoint.held ?? []).map(item => ({ ...item, source: titles.has(item.node) ? lowered(titles.get(item.node)) : null }));
}

/** One held line at a glance: the question, the choice made, and the step. */
function heldLine(item, max) {
  const room = Math.max(20, max);
  const asked = item.question ? `${clip(item.question, room)}: ` : '';
  return `- ${asked}${clip(item.decision, room)}${item.source ? ` — ${item.source}` : ''}`;
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

/** The risks still open, a stop first, each marked as More details marks it. */
function openRisks(checkpoint) {
  const risks = checkpoint.risks ?? {};
  return [...(risks.stop ?? []).map(risk => ({ ...risk, risk: `${STOP_MARK}${risk.risk}` })), ...(risks.open ?? [])];
}

/**
 * The checkpoint at a glance, as lines: *Done*, *Next* — one line for each of
 * `ways` when there are several, named by its label — *Review*, the risks
 * still open — a stop first — how many fixes the run applied and up to three
 * of them, the decisions the run made and the user's own choices counted. An open
 * risk is what the user weighs before going on, so it comes ahead of the fixes
 * and the decisions and outlasts them; a fix changed the work without the user
 * choosing it, so it outlasts what was decided. A trade-off, a follow-up and a
 * settled risk are one focus away, in More details. Within `lines` and
 * `budget`, the items are cut while the text runs long, then the decisions
 * dropped from the end down to their count, then the fixes, then the risks
 * down to one, then the *Done* sentence is cut, then the one risk left
 * gives way to a count, and last the choices held for the user's approval —
 * listed after *Review*, ahead of everything else — down to one and a count;
 * *Next* is never cut.
 */
function glance(checkpoint, { companion, lines = FOCUS_LINES, budget = FOCUS_BUDGET, markdown = false, ways = waysOf(checkpoint) }) {
  const items = decided(checkpoint);
  const held = heldOf(checkpoint);
  const fixes = checkpoint.fixes ?? [];
  const nexts = ways.length > 1
    ? ways.map(option => `Next (${lowered(option.label)}): ${nextText(option.next)}`)
    : [`Next: ${nextText(ways.length === 1 ? ways[0].next : checkpoint.next)}`];
  const risks = openRisks(checkpoint);
  const review = reviewText(checkpoint.review, companion);
  const choices = choicesLine(checkpoint);
  const view = { held: held.length, fixes: Math.min(fixes.length, FIXED_CAP), shown: Math.min(items.length, DECIDED_CAP), risks: Math.min(risks.length, RISK_CAP), item: DECISION_MAX, done: Infinity };
  const draw = () => {
    const out = [];
    if (checkpoint.headline) out.push(`Done: ${clip(checkpoint.headline, view.done)}`);
    out.push(...nexts);
    if (review) out.push(`Review: ${review}`);
    if (held.length) {
      const rest = held.length - view.held;
      out.push(`${HELD_HEADING}${rest > 0 ? ` (+${rest} more under More details)` : ''}:`);
      out.push(...held.slice(0, view.held).map(item => heldLine(item, view.item)));
    }
    if (view.risks > 0) {
      const rest = risks.length - view.risks;
      out.push(`Open risks${rest > 0 ? ` (+${rest} more under More details)` : ''}:`);
      out.push(...risks.slice(0, view.risks).map(risk => `- ${clip(risk.risk, Math.max(20, view.item))}`));
    } else if (risks.length) {
      out.push(`Open risks: ${risks.length}, under More details.`);
    }
    if (view.fixes > 0) {
      const rest = fixes.length - view.fixes;
      out.push(`${FIXED_HEADING}: ${fixes.length}${rest > 0 ? ` (+${rest} more under More details)` : ''}`);
      out.push(...fixes.slice(0, view.fixes).map(fix => `- ${clip(fixText(fix), Math.max(20, view.item))}`));
    } else if (fixes.length) {
      out.push(`${FIXED_HEADING}: ${fixes.length}, under More details.`);
    }
    if (view.shown > 0) {
      const rest = items.length - view.shown;
      out.push(`${decidedHeading(items)}${rest > 0 ? ` (+${rest} more under More details)` : ''}:`);
      out.push(...items.slice(0, view.shown).map(item => decisionLine(item, view.item)));
    } else if (items.length) {
      out.push(`${decidedHeading(items)}: ${items.length} ${items.length === 1 ? 'decision' : 'decisions'}, under More details.`);
    }
    if (choices) out.push(choices);
    // A line straight after a bullet continues that bullet where the preview is
    // read as markdown, so the decisions' heading read as part of the last risk
    // or fix and the user's own choices as part of the last decision; a blank
    // line keeps each a line of its own.
    if (!markdown) return out;
    return out.flatMap((line, index) => (index > 0 && !line.startsWith('- ') && out[index - 1].startsWith('- ') ? ['', line] : [line]));
  };
  let out = draw();
  const long = () => out.join('\n').length > budget;
  const fits = () => out.length <= lines && !long();
  // Cutting an item saves characters, never a line: it answers the character
  // budget alone, and a glance with too many lines drops items instead.
  while (long() && view.item > 40) {
    view.item -= 10;
    out = draw();
  }
  while (!fits() && view.shown > 0) {
    view.shown--;
    out = draw();
  }
  while (!fits() && view.fixes > 0) {
    view.fixes--;
    out = draw();
  }
  while (!fits() && view.risks > 1) {
    view.risks--;
    out = draw();
  }
  if (!fits() && checkpoint.headline) {
    view.done = Math.max(40, checkpoint.headline.length - (out.join('\n').length - budget));
    out = draw();
  }
  if (!fits() && view.risks > 0) {
    view.risks = 0;
    out = draw();
  }
  // The choices waiting for approval give way last, and never to none: the
  // user continuing approves them, so at least one stays named.
  while (!fits() && view.held > 1) {
    view.held--;
    out = draw();
  }
  return out;
}

/**
 * The continue options walked on their own answers — those that set the gate's
 * values — each of which names where it leads when there are several, in the
 * order the pickers list them: a *Next* line for the skip path read first while
 * the recommended continue was listed first.
 */
function waysOf(checkpoint) {
  return ordered(checkpoint).filter(option => option.effect === 'continue' && option.next !== undefined);
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

/** How often a gate has been asked again, said as a count of what happened. */
function revisedSoFar(revision) {
  const done = (revision?.n ?? 1) - 1;
  if (done < 1) return '';
  return ` Asked again ${done === 1 ? 'once' : `${done} times`} so far here.`;
}

/** What a revise re-runs, and how often this checkpoint has been asked again. */
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
 * The full brief, risks included: the *Done* sentence; the choices held for
 * the user's approval, each with its class and why; each closed node's
 * summary under its title; every fix the run applied; every decision with who
 * settled it; the user's choices; risks grouped as Open (a stop first),
 * Trade-offs accepted and Follow-ups; every file to review with what it
 * holds; and where the run goes, with the reason a recommended continue
 * gave. Markdown, blocks apart by a blank line. Unclipped: the caller clips
 * the preview.
 */
export function moreDetails(checkpoint) {
  const blocks = [];
  if (checkpoint.headline) blocks.push(`Done: ${checkpoint.headline}`);
  const held = heldOf(checkpoint);
  if (held.length) {
    blocks.push([`**${HELD_HEADING}**`, ...held.map(item => `- ${item.question ? `${item.question}: ` : ''}${item.decision}${item.class ? ` (${item.class})` : ''}${item.rationale ? ` — ${item.rationale}` : ''}${item.source ? ` — ${item.source}` : ''}`)].join('\n'));
  }
  for (const closed of checkpoint.closed ?? []) blocks.push(`**${closed.title}**\n${closed.summary}`);
  const fixes = checkpoint.fixes ?? [];
  if (fixes.length) blocks.push([`**${FIXED_HEADING}**`, ...fixes.map(fix => `- ${fixText(fix)}`)].join('\n'));
  const items = decided(checkpoint);
  if (items.length) {
    blocks.push([`**${decidedHeading(items)}**`, ...items.map(item => `- ${item.decision}${item.class ? ` (${item.class})` : ''}${item.rationale ? ` — ${item.rationale}` : ''}${item.source ? ` — ${item.source}` : ''}`)].join('\n'));
  }
  const choices = choicesLine(checkpoint);
  if (choices) {
    const differs = checkpoint.decisions.operator.not_recommended ?? [];
    blocks.push(['**Your choices**', choices, ...differs.map(each => `- ${each.question ? `${each.question}: ` : ''}${each.answer ?? each.decision}${each.recommended ? ` (recommended: ${each.recommended})` : ''}`)].join('\n'));
  }
  const risks = checkpoint.risks ?? {};
  const riskLine = risk => `- ${risk.risk}${risk.change ? ` → ${risk.change}` : ''}`;
  const open = openRisks(checkpoint);
  if (open.length) blocks.push(['**Open**', ...open.map(riskLine)].join('\n'));
  if (risks.tradeoff?.length) blocks.push(['**Trade-offs accepted**', ...risks.tradeoff.map(riskLine)].join('\n'));
  if (risks.followup?.length) blocks.push(['**Follow-ups**', ...risks.followup.map(riskLine)].join('\n'));
  if (risks.resolved?.length) blocks.push(['**Settled**', ...risks.resolved.map(riskLine)].join('\n'));
  if (checkpoint.review?.length) {
    blocks.push(['**Files**', ...checkpoint.review.map(each => `- ${each.path}${each.label ? ` — ${each.label}` : ''}${each.html ? ` (HTML: ${each.html})` : ''}`)].join('\n'));
  }
  const ways = waysOf(checkpoint);
  const nexts = ways.length > 1 ? ways.map(option => `Next (${lowered(option.label)}): ${nextText(option.next)}`) : [`Next: ${nextText(checkpoint.next)}`];
  // The reason the recommended continue is the one marked, whole: a labels-only
  // title may carry only its first sentences.
  const reasoned = (checkpoint.options ?? []).find(option => option.recommended && option.reason);
  if (reasoned) nexts.push(`Recommended (${lowered(reasoned.label)}): ${sentenceOf(reasoned.reason)}`);
  blocks.push(nexts.join('\n'));
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
// the panel above the question
// ---------------------------------------------------------------------------

/**
 * The checkpoint as a panel an editor extension draws above the question:
 * `{question, glance}`. `question` is the rich picker's, the one a session asks
 * with, so the extension knows the question the panel belongs to by comparing
 * it. `glance` is plain one-line text fitted to `PANEL_ROWS` — the checkpoint
 * and what it closes, the *Done* sentence, how many choices are held for
 * approval (at the head of the counts, so a cut never drops them), how much was decided, how much the
 * run fixed and how much is open, *Next* and *Review* — each line cut to the
 * rows left for it, so the extension draws it as it stands and counts nothing. It stays visible
 * whichever option is in focus, which the preview beside an option does not.
 */
export function panelOf(checkpoint) {
  const progress = checkpoint.progress ?? {};
  const closing = checkpoint.closed?.[0]?.title ?? checkpoint.header;
  const risks = checkpoint.risks ?? {};
  const open = (risks.stop?.length ?? 0) + (risks.open?.length ?? 0);
  const fixed = (checkpoint.fixes ?? []).length;
  const held = (checkpoint.held ?? []).length;
  const review = (checkpoint.review ?? []).map(each => each.path).join(', ');
  const wanted = {
    title: `Checkpoint ${progress.checkpoint}/${progress.checkpoints_max} · ${closing}`,
    headline: checkpoint.headline ?? '',
    next: `Next: ${nextText(checkpoint.next)}`,
    review: review ? `Review: ${review}` : '',
    counts: `${held ? `Held: ${held} · ` : ''}Decided: ${decided(checkpoint).length}${fixed ? ` · fixed: ${fixed}` : ''} · open risks: ${open}`,
  };
  const fitted = fittedLines(wanted, PANEL_SHARES);
  return {
    question: richPicker(checkpoint).question,
    glance: PANEL_ORDER.filter(key => Object.hasOwn(fitted, key)).map(key => fitted[key]),
    checkpoint: { index: progress.checkpoint, total: progress.checkpoints_max },
    open_risks: open,
    parts: partsOf(checkpoint, { closing, open, fixed, held }),
  };
}

/**
 * Each of `wanted`'s texts on one line, in `shares`' order, cut to the rows
 * its share and the panel's rows left allow; a text that is empty, or finds
 * no row left, is left out.
 */
function fittedLines(wanted, shares) {
  const fitted = {};
  let left = PANEL_ROWS;
  for (const [key, share] of Object.entries(shares)) {
    const text = String(wanted[key] ?? '').replace(/\s+/g, ' ').trim();
    const rows = Math.min(share, left);
    if (!text || rows < 1) continue;
    // The longest line that costs `rows` rows is one character short of their width.
    fitted[key] = clip(text, rows * ROW_CHARS - 1);
    left -= rowsOf(fitted[key]);
  }
  return fitted;
}

/**
 * A question set's panel, the one a pending set shows above its question: the
 * step asking and where it stands among the run's phases, then the first
 * question's header and how many questions the set holds — never an option or
 * an answer, which the question itself carries. `title` is the asking step's
 * title and `position` its `{index, total}` among the phases, counted as the
 * status line counts them. Fitted to `PANEL_ROWS` as a gate's panel is, as a glance and as
 * labelled parts; `question` is the first question's text, so an extension
 * knows the question the panel belongs to by comparing it.
 */
export function questionPanelOf(checkpoint, { title: named, position }) {
  const questions = checkpoint.questions ?? [];
  const count = questions.length;
  const one = text => String(text ?? '').replace(/\s+/g, ' ').trim();
  const step = position?.index ? `Phase ${position.index} of ${position.total}` : 'Questions';
  const title = one(named ?? checkpoint.header);
  const header = one(questions[0]?.header);
  const counted = `${count} ${count === 1 ? 'question' : 'questions'}`;
  const glance = fittedLines({ title: `${step} · ${title}`, questions: header ? `${header} · ${counted}` : counted }, QUESTION_SHARES);
  const parts = [];
  let left = PANEL_ROWS;
  for (const [key, label, text] of [['title', step, title], ['questions', header || 'Questions', counted]]) {
    const rows = Math.min(QUESTION_SHARES[key], left);
    if (rows < 1) continue;
    const room = rows * ROW_CHARS - 1 - label.length - 1;
    const part = { key, label, text: clip(text, Math.max(0, room)), ...(key === 'questions' ? { count } : {}) };
    parts.push(part);
    left -= rowsOf(`${part.label} ${part.text}`);
  }
  return {
    kind: 'question',
    question: questions[0]?.question ?? checkpoint.ask,
    glance: ['title', 'questions'].filter(key => Object.hasOwn(glance, key)).map(key => glance[key]),
    position: position ?? null,
    questions: count,
    parts,
  };
}

/**
 * The same panel as labelled parts, for an extension that styles a label apart
 * from its text: `{key, label, text}` each, in `PANEL_ORDER`, and the review
 * part as files, `{label, path}` each (the path task-folder relative), with
 * `more` counting the files left out. The counts part carries the decisions as
 * its text, the open risks as words and a number, and `fixed`, how many fixes
 * the run applied, which an extension names only when it is not 0, and
 * `held`, how many choices wait for approval, present only when some do and
 * drawn at the head of the line. Fitted as
 * the glance is — a part costs the rows of its label, a space and its text,
 * the review part's files separated by two spaces — so a panel drawn from them
 * holds to `PANEL_ROWS`.
 */
function partsOf(checkpoint, { closing, open, fixed, held }) {
  const progress = checkpoint.progress ?? {};
  const one = text => String(text ?? '').replace(/\s+/g, ' ').trim();
  const wanted = {
    title: { label: `Checkpoint ${progress.checkpoint} of ${progress.checkpoints_max}`, text: one(closing) },
    headline: { label: 'Done', text: one(checkpoint.headline) },
    next: { label: 'Next', text: one(nextText(checkpoint.next)) },
    review: { label: 'Review', files: (checkpoint.review ?? []).map(each => ({ label: baseName(each.path), path: each.path })) },
    counts: { label: 'Decided', text: String(decided(checkpoint).length), risks: open ? `${open} open ${open === 1 ? 'risk' : 'risks'}` : 'no open risks' },
  };
  const fitted = {};
  let left = PANEL_ROWS;
  for (const [key, share] of Object.entries(PANEL_SHARES)) {
    const rows = Math.min(share, left);
    const part = wanted[key];
    if (rows < 1) continue;
    const room = rows * ROW_CHARS - 1 - part.label.length - 1;
    if (key === 'review') {
      const files = [];
      let more = part.files.length;
      for (const file of part.files) {
        const tail = more > 1 ? `  +${more - 1} more` : '';
        const used = [...files, file].map(each => each.label).join('  ').length + tail.length;
        if (used > room) break;
        files.push(file);
        more -= 1;
      }
      if (!files.length) continue;
      fitted.review = { key, label: part.label, files, more };
      left -= rowsOf(`${part.label} ${files.map(each => each.label).join('  ')}${more ? `  +${more} more` : ''}`);
      continue;
    }
    if (key === 'counts') {
      fitted.counts = { key, label: part.label, text: part.text, risks: part.risks, open, fixed, ...(held ? { held } : {}) };
      left -= rowsOf(`${held ? `Held: ${held} · ` : ''}${part.label} ${part.text}${fixed ? ` · ${fixed} fixed` : ''} · ${part.risks}`);
      continue;
    }
    if (!part.text && key !== 'title') continue;
    fitted[key] = { key, label: part.label, text: clip(part.text, Math.max(0, room)) };
    left -= rowsOf(`${part.label} ${fitted[key].text}`);
  }
  return PANEL_ORDER.filter(key => Object.hasOwn(fitted, key)).map(key => fitted[key]);
}

/** A task-folder path's last segment, the name a file is known by in a short list. */
function baseName(file) {
  const parts = String(file).split('/').filter(part => part !== '');
  return parts.length ? parts[parts.length - 1] : String(file);
}

// ---------------------------------------------------------------------------
// the pickers
// ---------------------------------------------------------------------------

/** The checkpoint's options in picker order: the recommended first, then on, back, out. */
function ordered(checkpoint) {
  const rank = option => EFFECT_ORDER[option.effect] ?? EFFECT_ORDER.stop;
  const sorted = (checkpoint.options ?? [])
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
    if (option.effect === 'continue') lines = glance(checkpoint, { companion: 'beside', markdown: true, ways: option.next !== undefined ? [option] : [] });
    else if (option.effect === 'revise') lines = reviseLines(option);
    else lines = stopLines(checkpoint, option);
    return {
      id: option.id,
      label: `${grantedLabel(checkpoint, option)}${option.recommended ? RECOMMENDED_MARK : ''}`,
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
 * short pane; each title carries what choosing it does after a dash. The tool
 * prints text as typed, so it is drawn from the checkpoint `unmarked`, before
 * anything is cut: a cut item never keeps half a pair of backticks.
 */
export function plainPicker(checkpoint) {
  const shown = unmarkedAll(checkpoint);
  const question = [...glance(shown, { companion: 'name', lines: Infinity, budget: Infinity }), shown.ask].join('\n');
  const options = ordered(shown).map(option => ({
    id: option.id,
    label: `${plainTitle(shown, option)}${option.recommended ? RECOMMENDED_MARK : ''}`,
    recommended: option.recommended,
    ...answerFields(option, 'plain'),
  }));
  return withDetails('plain', question, options, {});
}

/** An inline code span: a run of backticks, the code, and a run of the same length. */
const CODE_SPAN = /(?<!`)(`+)([^`\n][^\n]*?)(?<!`)\1(?!`)/g;

/**
 * `text` with the backticks of each inline code span dropped and the code
 * kept — "Preserve `list()`" reads "Preserve list()" — and the one space a
 * span may pad its code with on each side. A backtick with no partner is left
 * as it is.
 */
export function unmarked(text) {
  return text.replace(CODE_SPAN, (span, ticks, code) => code.replace(/^ ([^]*[^ ][^]*) $/, '$1'));
}

/** `value` with every string in it `unmarked`; ids and paths carry no backticks, so they pass as they are. */
function unmarkedAll(value) {
  if (typeof value === 'string') return unmarked(value);
  if (Array.isArray(value)) return value.map(unmarkedAll);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, unmarkedAll(field)]));
  return value;
}

/** An option's title on a labels-only picker: its label and, after a dash, what it does. */
function plainTitle(checkpoint, option) {
  if (option.effect === 'continue') {
    const label = grantedLabel(checkpoint, option);
    return option.reason ? `${label} — ${reasonText(option.reason)}` : label;
  }
  if (option.effect === 'revise') {
    // "it" only when the label already names the one node that re-runs:
    // "Revise the decisions — re-runs it" hid that the decision areas are asked again.
    const names = (option.reruns ?? []).map(each => lowered(each.title));
    const own = names.length === 1 && option.label.toLowerCase().includes(names[0].toLowerCase());
    return `${option.label} — re-runs ${own ? 'it' : andList(names)} with your note`;
  }
  const why = option.recommended ? stopReason(checkpoint) : '';
  return `${option.label} — ${why ? reasonText(why) : 'keeps everything written so far'}`;
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
 * history shows what was asked. What an option grants travels in the
 * checkpoint alone: the request's options keep their plain labels and their
 * keys, and a cockpit shows the grant from `checkpoint.grants` its own way. The writer adds the version, the time asked and
 * the empty answer — a caller that sent them would be refused.
 *
 * `reask` is the revise option an earlier request was answered with but no
 * note: the same gate is asked again, every option still offered, and the
 * question opens with a sentence saying that revise needs one.
 */
export function requestOf(checkpoint, summary, reask = null) {
  return {
    node: checkpoint.node,
    kind: checkpoint.kind,
    question: flowLine(reask === null ? checkpoint.ask : `${reaskLine(reask)} ${checkpoint.ask}`),
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

/**
 * The sentence a re-asked request opens with: the revise needs a note. The
 * option is named in typographic quotes: the question is one flow-safe line.
 */
function reaskLine(option) {
  return `“${option.label}” needs a note saying what should change. Choose it again with one, or choose another option.`;
}

/**
 * `text` as a driven request carries it: one line, no ASCII double quote. A
 * driver writes the request's question as a flow scalar, which refuses both,
 * so every line break folds to a space and every `"` becomes `'`, as the
 * one-line summary beside it does.
 */
export function flowLine(text) {
  return String(text).replace(/\s*[\r\n]+\s*/g, ' ').replace(/"/g, "'").trim();
}
