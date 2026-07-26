# shellcheck disable=SC1064,SC1065,SC1072,SC1073
SHELL := /bin/bash

TARGET ?= codex
ifneq ($(origin SUPPORTED_TARGETS),undefined)
$(error SUPPORTED_TARGETS is not configurable; targets are owned by plugins/maister/lib/distribution/targets.mjs)
endif
DIST_DIR ?= dist
SOURCE_DATE_EPOCH ?= $(shell git log -1 --format=%ct 2>/dev/null || date +%s)
SOURCE_COMMIT ?= $(shell git rev-parse HEAD 2>/dev/null || true)
SOURCE_VERSION ?= $(shell if test -f VERSION; then cat VERSION; else echo unknown; fi)
E3_ATTESTATION ?=
E3_OUTPUT ?=
E3_RESULT ?=
E3_TEST_COMMAND ?= make test-core test-runtime
E3_SCENARIO_VERSION ?= 1.0.0
E3_EXPIRES_AT ?=
CURRENT_TARGET_ADMISSION_REPORT ?=
CURRENT_TARGET_ADMISSION_ARCHIVE_DIR ?=
CURRENT_TARGET_ADMISSION_EVIDENCE ?=

export TARGET DIST_DIR SOURCE_DATE_EPOCH SOURCE_COMMIT SOURCE_VERSION
export E3_ATTESTATION E3_OUTPUT E3_RESULT E3_TEST_COMMAND E3_SCENARIO E3_SCENARIO_VERSION E3_EXPIRES_AT
export MAISTER_E3_ATTESTATION
export CURRENT_TARGET_ADMISSION_REPORT CURRENT_TARGET_ADMISSION_ARCHIVE_DIR CURRENT_TARGET_ADMISSION_EVIDENCE
export HOME MAISTER_ALLOW_DIRTY_LOCAL

.PHONY: check-cursor-projection test-platform-independent test-core test-slow test-runtime test-init-runtime test-pi test-targets generate-e3-attestation test-overlay test-materializer test-install test-evidence test-current-target-admission test-topology test validate package install

check-cursor-projection:
	node plugins/maister/bin/generate-cursor-skills.mjs --check

test-platform-independent:
	node --test $(filter-out tests/platform-independent/installer-transaction.test.mjs,$(wildcard tests/platform-independent/*.test.mjs))

test-core:
	node --test tests/platform-independent/overlay-contract.test.mjs tests/platform-independent/source-materializer.test.mjs tests/platform-independent/flow-skill-projection.test.mjs

test-slow: test-install

test-runtime:
	node --test tests/platform-independent/agent-execution-events.test.mjs tests/platform-independent/agent-resolver.test.mjs tests/platform-independent/agent-adapters.test.mjs tests/platform-independent/agent-gate-cli.test.mjs tests/platform-independent/agent-runtime-composition.test.mjs
	bash tests/gate-evaluator.test.sh
	$(MAKE) --no-print-directory test-init-runtime

test-init-runtime:
	node --test tests/init-runtime.test.mjs tests/init-advisor-gate.test.mjs
	bash tests/init-skill-contract.test.sh

test-pi:
	node --test tests/platform-independent/pi-managed-array.test.mjs tests/platform-independent/pi-package-projection.test.mjs tests/platform-independent/pi-native-adapter.test.mjs tests/platform-independent/pi-integration.test.mjs

generate-e3-attestation:
	node plugins/maister/bin/release-interface.mjs generate-e3

test-overlay:
	node plugins/maister/bin/release-interface.mjs validate-overlay

test-materializer:
	node --test tests/platform-independent/source-materializer.test.mjs

test-install:
	node --test tests/platform-independent/installer-transaction.test.mjs

test-targets:
	$(MAKE) --no-print-directory test-overlay TARGET=codex
	$(MAKE) --no-print-directory test-overlay TARGET=cursor
	$(MAKE) --no-print-directory test-overlay TARGET=kiro-cli
	$(MAKE) --no-print-directory test-overlay TARGET=pi
	$(MAKE) --no-print-directory test-materializer

test-evidence:
	node --test tests/platform-independent/evidence-parity-topology.test.mjs tests/platform-independent/pi-evidence.test.mjs

test-current-target-admission:
	node plugins/maister/bin/release-interface.mjs current-target-admission

test-topology:
	node plugins/maister/bin/release-interface.mjs topology

test: test-core test-runtime test-pi test-evidence test-current-target-admission test-topology

validate: check-cursor-projection
	node plugins/maister/bin/release-interface.mjs validate-overlays
	$(MAKE) --no-print-directory test

package: check-cursor-projection
	node plugins/maister/bin/release-interface.mjs package

install:
	node plugins/maister/bin/release-interface.mjs install
