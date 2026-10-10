# The decision areas

A brainstorm ends with alternatives grouped by decision area: the separate choices the problem
holds, each with its own question, its own ranked alternatives and its own recommendation. The
decision areas file is that grouping written down for a machine as well as a person. The solution
brainstormer writes it as `decision-areas.json` beside its markdown — research's
`outputs/solution-exploration.md`, product design's `analysis/alternatives.md` — and the brainstorm
node declares it as its `decision_areas` artifact. The convergence node reads it through the
engine's `area-brief` verb, which asks each area from the file: in the terminal one area at a
time, and for a cockpit every area in one question set, each carrying its full write-up.

The verb renders and never writes words of its own. Every content sentence a user sees comes from
the file; the verb adds only the fixed labels listed under *What the verb adds*. That is what lets
the terminal and a cockpit show the same text, and what lets a change in that text be reviewed.

The markdown stays the document a person reads. The file carries the same areas, the same
alternatives in the same order and the same recommendations, so the two never disagree.

## The shape

```json
{"version": 1,
 "source": {"path": "outputs/solution-exploration.md", "sha256": "<64 lowercase hex digits>"},
 "areas": [{"id": "storage", "area": "Storage", "question": "Where do shared calendars live?",
   "why": "It fixes what a later migration costs.", "depends_on": [],
   "recommendation": {"alternative": "same-db", "reason": "No new service to run"},
   "alternatives": [
     {"id": "same-db", "title": "Same database", "description": "Add a sharing table beside the calendars.", "pros": ["No new service"], "cons": ["Couples the schemas"], "key_pro": "No new service", "key_con": "Couples the schemas"},
     {"id": "own-service", "title": "Own service", "description": "Run sharing as its own service.", "pros": ["Scales alone"], "cons": ["One more deploy"], "key_pro": "Scales alone", "key_con": "One more deploy"}]}]}
```

| Key | Rule |
|---|---|
| `version` | The bare number `1`; any other value is refused |
| `source` | `{path, sha256}`, both required |
| `source.path` | The markdown the file was written from, relative to the task directory, `/`-separated, no `..`, not absolute |
| `source.sha256` | 64 lowercase hex digits: the SHA-256 of that file's bytes as written |
| `areas` | A non-empty list, in the order the areas are asked |
| `areas[].id` | A slug, `^[a-z][a-z0-9-]*$`, unique in the file |
| `areas[].area` | The area's name, one line |
| `areas[].question` | The area's question, one line, in the task's words |
| `areas[].why` | Why the decision matters, text |
| `areas[].depends_on` | Optional. Area ids, each listed **earlier** in `areas`, no duplicates, never the area's own id |
| `areas[].alternatives` | At least 2, in the brainstormer's rank order, strongest first |
| `alternatives[].id` | A slug, unique in its area; `other` and `more-details` are reserved |
| `alternatives[].title` | One line |
| `alternatives[].description` | Text, two to three sentences (guidance, not checked) |
| `alternatives[].pros` / `cons` | Non-empty lists of text, strongest first |
| `alternatives[].key_pro` / `key_con` | One line each: the short forms an option's description shows |
| `areas[].recommendation` | A required key: `{alternative, reason}`, or `null` when the area is left open |
| `recommendation.alternative` | An alternative id of this area |
| `recommendation.reason` | One line |

The keys are closed at every level: a key the table does not name is a fault, not something a
reader skips. `recommendation` is required even when it is `null`, so "left open" is told apart
from "forgot". An area left open is asked with no option marked and no default.

**Plain text.** Every string in the file is plain text. Inline code in backticks is allowed — the
`rich` profile keeps it, the plain profile drops the backticks — but no bold and no list markers:
the verb adds its own emphasis and its own lists, and a string that carries either renders twice
over. This is guidance, not checked.

## Who writes it

The solution brainstormer, at the path its caller passes as `areas_output_path` (beside its
markdown by default). It writes the file after the markdown is final, stamps `source` with the
markdown's path and the SHA-256 of its bytes, and writes it again whenever the markdown is revised
in place. A brainstorm that cannot write the file says so; the brainstorm node then records the
artifact absent with that reason, and convergence asks as it did before the file existed.

## Who reads it

The `area-brief` verb, from the convergence node that asks the areas. It finds the file through
that node's `with: decision_areas` reference to the brainstorm node's declared artifact — never
by guessing a path — and judges the file whole before it renders any area of it.

## The check

The check reads the whole file and reports the **first** fault as one line,
`<reason> at <dotted.path>`, with the root shown as `(root)` — for example
`unknown-key at areas.1.alternatives.0.summary`, or `version at version`. A file with any fault
is refused whole: no area is ever rendered from it. The reasons are a closed set:

| Reason | Meaning |
|---|---|
| `not-json` | The bytes do not parse as JSON |
| `wrong-type` | A value has the wrong type — a list where text belongs, text where an object belongs |
| `version` | `version` is not the bare number `1` |
| `missing-key` | A required key is absent |
| `unknown-key` | A key the shape does not name |
| `empty` | A string, list or object that must hold something is empty |
| `not-one-line` | A one-line value holds a line break |
| `bad-id` | An area or alternative id is not a slug |
| `duplicate` | An id repeats where it must be unique, or `depends_on` names an area twice |
| `too-few` | An area has fewer than two alternatives |
| `reserved-id` | An alternative is named `other` or `more-details` |
| `unknown-alternative` | `recommendation.alternative` names no alternative of its area |
| `unknown-area` | `depends_on` names an area id the file does not hold |
| `depends-order` | `depends_on` names the area itself or an area listed after it |
| `bad-path` | `source.path` is absolute, holds `..`, or is not `/`-separated |
| `bad-digest` | `source.sha256` is not 64 lowercase hex digits |

A file that passes is then checked for freshness: the SHA-256 of `source.path`'s bytes must equal
`source.sha256`. A markdown edited after the stamp makes the file stale, and a stale file is
never briefed — its areas may no longer say what the document says.

**An unknown version.** A later shape raises `version`. A reader refuses a version it does not
know as `version at version` rather than guessing at its keys; the convergence node then composes
the areas from the markdown, as it does for a file that is missing, invalid or stale. None of
these stops the run: each is a warning, and the node carries on without the file.

## What the verb adds

These labels and separators are the only text the verb adds. Everything else comes from the file.

**The question** (every form):

- the first line `<area>: <question>`;
- `Why it matters:` followed by `why`;
- `Depends on:` followed by the names of the areas in `depends_on`, ending with a stop — only
  when the area depends on another;
- one line per alternative in rank order: `<title>`, the separator ` — `, then
  `Pro: <key_pro>`, the separator ` · `, then `Con: <key_con>`.

**The options.**

- The recommended alternative comes first, its label the title followed by `(Recommended)`.
- In the `rich` profile its description is the recommendation's reason; every other alternative's
  description is `Pro: <key_pro> · Con: <key_con>`. At most three alternatives are offered, the
  recommended one and then the rank order. When more exist, the question ends with
  `Also considered — type one to choose it:` and the titles left out, comma-separated.
- In the plain profile every alternative is offered, labels only, and the question ends with
  `Recommended:` followed by `<title> — <reason>`, closed by a stop only when the reason has none.
- The last option is `More details`, with the description
  "Shows every alternative in full, then asks this again. Nothing is recorded." Choosing it shows
  the write-up and asks the same area again; it is never recorded as an answer.

**The previews** (the `rich` profile). An alternative's preview is its title, its description, a
`**Pros**` list and a `**Cons**` list; the recommended one adds `**Why recommended**:` followed by
the reason. The More details preview is the write-up, cut to the preview budget and closed with
`Choose this to see the rest.`

**The write-up** — what More details shows, and what a cockpit question carries as its details:
the area name in bold, the question, the `Why it matters:` line and, when set, the `Depends on:`
line; then each alternative in rank order — its title in bold, followed by `(Recommended)` on the
recommended one, its description, then `Pros:` and `Cons:` as lists. It ends with `Recommended:`
followed by `<title> — <reason>` when the area has a recommendation. The write-up is never
clipped, and it is the same text in the terminal and in a cockpit request.

**Question ids.** Each area is asked and recorded as `convergence-decisions-<area id>`, in every
mode, so a re-ask after a revise lands on the same id.

No schema file ships with the shape; this page and the engine's check are the whole of it.
