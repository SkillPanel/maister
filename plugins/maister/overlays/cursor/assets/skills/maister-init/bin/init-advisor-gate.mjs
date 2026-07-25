import crypto from "node:crypto";

import { evaluateGate } from "../../orchestrator-framework/bin/gate-evaluator.mjs";
import { recordAdvisorOutcome } from "./maister-init-runtime.mjs";

export function evaluateInitAdvisorGate({
  statePath,
  phaseId,
  gateType,
  question,
  options,
  originalRecommendation,
  policy,
  context = {},
  roleConfig,
  runtimePort,
  userPort = null,
  automaticContinuationSupported = false,
  interactive = true,
  manifestProjectRoot = null,
  now,
  wait,
}) {
  const gateContext = {
    schema_version: 1,
    phase_id: phaseId,
    gate_type: gateType,
    question,
    options,
    original_recommendation: originalRecommendation,
    policy,
    safety_classification: "configurable",
    context,
  };
  const inputDigest = crypto.createHash("sha256").update(JSON.stringify(gateContext)).digest("hex");
  const record = (result, error = null) => {
    if (!manifestProjectRoot) return;
    const attempts = result?.gate?.advisor?.attempts ?? [];
    const terminal = attempts.at(-1)?.terminal_dispatch ?? null;
    recordAdvisorOutcome(manifestProjectRoot, {
      gate: gateType,
      invoked: attempts.length > 0,
      decision_recorded: result?.gate?.status === "decided" && attempts.length > 0,
      logical_role_id: attempts.length > 0 ? "maister:advisor" : null,
      actor: result?.gate?.final_actor ?? null,
      model: terminal?.policy?.model ?? null,
      dispatch_id: terminal?.dispatch_id ?? attempts.at(-1)?.dispatch_id ?? null,
      input_digest: inputDigest,
      selected_option: result?.gate?.selected_option ?? null,
      confidence: result?.gate?.confidence ?? null,
      result_status: result?.directive ?? "failed",
      retry_count: attempts.length,
      failure_details: error?.message ?? result?.gate?.error ?? null,
      fallback: Boolean(error) || attempts.length === 0,
    });
  };
  return evaluateGate({
    statePath,
    gateContext,
    roleConfig,
    runtimePort,
    userPort,
    automaticContinuationSupported,
    interactive,
    ...(now ? { now } : {}),
    ...(wait ? { wait } : {}),
  }).then((result) => {
    record(result);
    return result;
  }).catch((error) => {
    record(null, error);
    throw error;
  });
}
