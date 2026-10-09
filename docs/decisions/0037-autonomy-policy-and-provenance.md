# ADR-0037 — The engine records the autonomy policy it applied and who answered each gate

**Status**: Accepted · **Date**: 2026-10-09 · **Sources**: `plugins/maister/skills/workflow-engine/scripts/lib/policy.mjs` (`loadPolicy`, `policyHash`, `triageFor`); `scripts/lib/state.mjs` (the freeze seed, the gate triage and settlement pass, `warnSkippedAsked`); `scripts/lib/items.mjs` (`gateAnswer`, `withProvenance`, `withPersonActor`); `scripts/lib/gate-brief.mjs` (`buildCheckpoint`, the request's `triage`); `scripts/lib/graph.mjs` (`skipGuardAsks`, `OPTION_GRANTS`); `scripts/lib/complete.mjs` (`unfinished`); `scripts/lib/prior-context.mjs` (`RECORD_ONLY`); `plugins/maister/skills/umbrella/scripts/lib/manifest.mjs` (`auto-low-retired`); `references/grammar.md` § 6, § 7, § 14; `SKILL.md` Step 4, § Gates, § Writing state; `tests/engine/policy.test.mjs`, `policy-hash.test.mjs`, `triage.test.mjs`, `provenance.test.mjs`, `skip-guard.test.mjs`, `same-questions.test.mjs`, `umbrella-auto-low.test.mjs`; ADR-0030, ADR-0033, ADR-0034

## TL;DR
A run could not say which rules decided how much a person had to see at a gate, or who gave the
answer it recorded. The engine now reads an optional autonomy policy, records its canonical hash
at the freeze, and writes a raise-only `triage` on a gate's answer only when the policy classifies
the gate and the hash still matches. Every answer carries its provenance, and a terminal answer
names its person. A gate guarded by a value the run itself found is asked unless it only confirms.
The grant set grows to six names, and `umbrella validate` warns on the retired `auto-low` tier.
With no policy file, every built-in asks exactly what it asked before.

## ADR-0037: The engine records the autonomy policy it applied and who answered each gate {#adr-0037}

### Status
Accepted. It amends ADR-0033's grant set: `OPTION_GRANTS` is `push`, `pr-create`, `tag`,
`tracker-write`, `browser-remote` and `spend`, in that order. No built-in uses a new name, so no
built-in hash moves.
- `orchestrator.policy_hash` is a new writer-owned key, written once at the freeze.
- A decision item may carry `actor`, `on_behalf_of`, `policy`, `evidence`, `override_of` and
  `triage`; a gate gains settlement items; the checkpoint fills `approves` (ADR-0030) and counts
  operator answers by actor kind.
- Validation gains `skip-guard-not-pure:<node>`; the state writer gains `skip-guard-skipped:<node>`,
  `policy-hash-mismatch:<node>`, `policy-refused:<path>:<reason>` and
  `provenance-unusable:<node>:<key>`. All five are warnings.

### Context
A driver that answers gates for an operator, and an operator reviewing a run afterwards, both
need the same two facts: which rules classed each decision, and who decided it. Neither was in
state. A class written without the rules that produced it cannot be checked later, and an answer
with no actor reads the same whether a person or a delegate gave it.

Separately, a gate guarded by a value a task node records could vanish on a finding nobody chose.
That is harmless for a gate that only confirms the work, and wrong for one that decides where the
run goes or what the answer grants.

### Decision
**The policy.** An optional file, `policy/autonomy-policy.json` in the engine skill's folder. None
ships. Without it the built-in `{"version": 1}` applies, and it classifies nothing. A file that
exists but cannot be applied — unreadable, not JSON, a version other than 1, a shape fault or a
failed cross-check — is refused whole. The built-in default applies, and the run warns
`policy-refused:<path>:<reason>[ at <dotted path>]`. A file is never half-read.

**The hash.** `sha256:` over the whole parsed file: keys sorted by code unit at every depth,
arrays in order, no whitespace, unknown keys included. It is the hash of the policy applied, so a
refused file records the default's. The freeze records it as `orchestrator.policy_hash`. A patch
value is ignored with a note, and no later write moves it.

**Triage.** `{version: 1, class, family, floor?, band?, raised_by?}`, `family` always written, the class one of
`decide-alone` < `record` < `consult` < `approve`. A row's family gives the starting class. A
floor or a band only raises it, and `raised_by` says which. Triage is written only under a policy
that classifies the gate and whose hash equals the run's, and only on a write that judges the
gate. There are two such writes: one whose patch records the gate's answer, and the
re-validation that closes a driven gate's index row. The answer item gets the gate's triage. Each
classified value the chosen continue sets gets a settlement item after it. The request ends with
`triage`, and the checkpoint's `approves` lists the classified values. A mismatch, or a run with no
recorded hash, classifies nothing and warns `policy-hash-mismatch:<gate>`.

**Provenance.** The five keys are copied onto the decision item from every answer path: flat gate
answers, question-set folds, `gate-revise`, and a driven answer's request file. The orchestrator
copies the answer file's `answer` block into the request whole, less `grants`. A terminal answer
gains `actor: {kind: person, id: <answered_by>}`; the engine gives a driven answer none. The keys
are record-only and never reach a delegate's prior context. The checkpoint counts operator answers
by actor kind, `unknown` for one with none. Held provenance follows a re-sent in-node answer only
when it is the same answer, and a request file's block only when it holds the gate's answer. A
re-sent gate answer is not matched to the held one, so provenance it does not repeat is not kept;
a driven gate answer gets it back from its request file on the next write. A value whose
map keys the state file cannot carry is left off the decision with a `provenance-unusable` warning,
never a refusal, and `grants` sent on any decision is dropped.

**The skip-guard rule.** A gate whose guard reads a value a non-gate node records is skipped by
its guard only when it is a pure confirmation: one continue, with no `sets` and no `grants`.
Otherwise it is asked whatever its guard reads. One predicate decides it for validation, the
ready set, the brief, revise, `run-complete` and the state writer. Nothing is refused.

**`auto-low`.** No writer chooses it. `umbrella validate` warns `auto-low-retired` on a member, the
defaults or a chain node that sets it, keeps the value and refuses nothing.

### Considered Options

| Option | Why not |
|---|---|
| Classify on every write | A write that does not judge the gate would re-derive a class it never decided, and repeat the mismatch warning on every write |
| Keep a marker in state for which writes judge a gate | The answer in the patch and the index row the write closes already say it |
| Hash the loader's normalised reading | Two files that read alike would share a hash while differing on disk; the file as written is what an auditor holds |
| Refuse a run whose policy file is refused | A broken policy would stop every run; the built-in default asks everything, which is safe |
| Let a policy lower a class | A floor that can be lowered is not a floor; raise-only keeps a stricter reading safe to apply |
| Refuse a gate that breaks the skip-guard rule | Existing definitions would stop validating; asking the gate is safe and the warning names the fix |
| Refuse `auto-low` | A workspace that validated before would fail; the value is kept and the warning names the offered tiers |

### Consequences
- Under the built-in default, no asked question, option, picker or checkpoint text changes. The
  record gains the `policy_hash` line, `actor` on terminal answers, any provenance a driver sent,
  `decisions.operator.actors` when there are operator answers, and `actor_kind` on each
  `not_recommended` entry.
- A run frozen before this change has no `policy_hash`, so it gets no triage on resume, even
  under a classifying policy.
- A reader of a gate's answer takes the last decision carrying an `option`, so settlement items
  never read as the answer.
- A driver that drops provenance from the answer block leaves `actor` absent, and the checkpoint
  counts that answer as `unknown`.
- Any further grant name is again a grammar change, appended to the set so no hash moves.
