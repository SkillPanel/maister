# The delivery scope

A design ends by saying where the work lands: which repositories change, what changes in each,
and in what order. The delivery scope is that answer written down for a machine as well as a
person. Product design's hand-off writes it as `outputs/delivery-scope.yml` in its task
directory, exposed as the workflow output `delivery_scope`. Whatever plans the delivery reads it
to start one development run per member in scope, a member's run after the runs it depends on.

Every discovery path ends with one. A run with nothing to scope still writes the file, so a reader
never has to tell "no scope" from "a scope nobody wrote".

## The shape

```yaml
version: 1
members:
  - name: api
    statement: "Add the guest-sharing endpoint and its permission check"
    depends_on: []
  - name: web
    statement: "Add the share dialog and the guest calendar view"
    depends_on: [api]
out_of_scope:
  - {name: mobile, reason: "Guests use the web view; the app is unchanged"}
```

| Key | Rule |
|---|---|
| `version` | The bare number `1`. A later shape raises it; a reader refuses a version it does not know rather than guessing |
| `members` | A list with at least one entry, in the order a person would read the work |
| `members[].name` | The member the work lands in — see *Where the names come from* |
| `members[].statement` | One line: the work in that member, in plain words |
| `members[].depends_on` | A list, possibly empty, of other in-scope member names whose work this member's work needs first. No cycles, and no member names itself |
| `out_of_scope` | A list, possibly empty |
| `out_of_scope[].name` | A member left out |
| `out_of_scope[].reason` | One line: why it is left out |

No name appears twice across the two lists. The file is written in the YAML subset the workflow
engine reads (the grammar reference beside the engine skill, § 2): no block scalars, no anchors,
a flow collection or a quoted scalar on one line.

## Where the names come from

**In a workspace** — the project root holds the workspace manifest, `.maister/umbrella.yml` — the
names are the keys of the manifest's `members:` map, spelled exactly as there. Every member the
manifest declares appears exactly once, in scope or out of it, so the operator who approves the
scope sees what was left out and why.

**In a single repository** — no manifest — the scope has one member: the repository's directory
name (the top level of its git checkout, or the project root when it is not one), the feature in
one line as its statement, `depends_on: []`, and `out_of_scope: []`.

## Approval

The scope is approved with the product brief, which carries it as a layer in plain sentences —
each member in scope with what changes there and what it waits for, then each member left out with
its reason. Revising that layer rewrites the brief and the file together, so the two never
disagree.
