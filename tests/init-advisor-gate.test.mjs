import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { stringifyCanonicalYaml } from "../plugins/maister/skills/orchestrator-framework/bin/orchestrator-state-schema.mjs";
import { evaluateInitAdvisorGate } from "../plugins/maister/skills/init/bin/init-advisor-gate.mjs";

const digest = (value) => value.repeat(64).slice(0, 64);
const policy = {
	execution_profile_id: "codex.read-only",
	tools: ["read", "search"],
	filesystem: "read-only",
	network: "restricted",
	model: "test-model",
	reasoning_effort: "high",
	timeout_ms: 900000,
	output_schema_id: "maister.gate-decision.v1",
	concurrency_class: "read-only-concurrent",
	max_parallel: 1,
};

function stateFile(root) {
	const file = path.join(root, "orchestrator-state.yml");
	fs.writeFileSync(
		file,
		stringifyCanonicalYaml({
			orchestrator: {
				schema_version: 2,
				revision: 0,
				initial_phase: "phase-1",
				current_phase: "phase-1",
				completed_phases: [],
				failed_phases: [],
				gate_history: [],
				work: {},
				dispatch_outbox: [],
			},
			task: { id: "init-advisor-test" },
			phases: [{ id: "phase-1", status: "in_progress" }],
		}),
	);
	return file;
}

function runtimePort() {
	return {
		async resolveAgent({ logical_role_id, dispatch_id }) {
			return {
				schema_version: 1,
				dispatch_id,
				requested_logical_role_id: logical_role_id,
				role_id: "advisor",
				role_source_digest: digest("a"),
				target: "codex",
				representation: "codex-prompt-schema",
				adapter_id: "codex.exec",
				native_role_external_id: null,
				host: "codex",
				host_version: "test",
				policy,
				provenance: {
					receipt_id: "receipt",
					receipt_path: "/tmp/receipt.json",
					projection_schema_version: 1,
					projector_version: "test",
					canonical_set_digest: digest("a"),
					manifest_digest: digest("b"),
					projected_tree_digest: digest("c"),
				},
			};
		},
		async dispatchAgent({ plan, task }) {
			assert.equal(task.actor, "advisor");
			return {
				schema_version: 1,
				status: "succeeded",
				dispatch_id: plan.dispatch_id,
				requested_logical_role_id: plan.requested_logical_role_id,
				role_id: plan.role_id,
				target: plan.target,
				adapter_id: plan.adapter_id,
				native_role_external_id: null,
				observed_native_role_external_id: null,
				host: plan.host,
				host_version: plan.host_version,
				policy: plan.policy,
				provenance: plan.provenance,
				output: {
					selected_option: "Continue",
					rationale: "The safe path is to continue.",
					confidence: "high",
					escalate_to_user: false,
				},
				native_observations: {},
				error: null,
			};
		},
		readExecutionEventStream({ dispatchId }) {
			return {
				complete: true,
				events: [
					{
						event_type: "dispatch_terminal",
						dispatch_id: dispatchId,
						result: {
							status: "completed",
							data: {
								output: {
									selected_option: "Continue",
									rationale: "The safe path is to continue.",
									confidence: "high",
									escalate_to_user: false,
								},
							},
						},
						error: null,
					},
				],
			};
		},
	};
}

test("init Advisor wrapper invokes the common runtime and persists a terminal decision", async () => {
	const root = fs.mkdtempSync(
		path.join(fs.realpathSync(os.tmpdir()), "maister-init-advisor-"),
	);
	try {
		const result = await evaluateInitAdvisorGate({
			statePath: stateFile(root),
			phaseId: "phase-1",
			gateType: "phase-exit",
			question: "Continue?",
			options: ["Continue", "Pause"],
			originalRecommendation: "Continue",
			policy: "fully_automatic",
			context: {
				task_path: root,
				phase_summaries: {},
				artifact_paths: [],
				implementation_approval: {},
			},
			roleConfig: {
				advisor: { logical_role_id: "maister:advisor", max_attempts: 1 },
				arbiter: { logical_role_id: "maister:advisor", max_attempts: 1 },
				arbiter_enabled_on_disagreement: true,
				backoff_ms: 0,
			},
			runtimePort: runtimePort(),
			automaticContinuationSupported: true,
			interactive: false,
		});
		assert.equal(result.directive, "continue");
		assert.equal(result.gate.final_actor, "advisor");
		assert.equal(result.gate.advisor.response.selected_option, "Continue");
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});
