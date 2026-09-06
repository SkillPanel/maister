import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('validate_codex', Path(__file__).resolve().parents[1] / 'scripts/validate-codex.py')
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)


class StateContractTests(unittest.TestCase):
    canonical = {
        'orchestrator': {'options': {'sequential': False, 'html_output': True}},
        'phase_summaries': {},
        'verification_context': {'issues_found': []},
    }

    def test_partial_domain_extensions_keep_common_types(self):
        validator.validate_state_fragment({
            'orchestrator': {'options': {'sequential': True, 'docs_enabled': False}},
            'migration_context': {'rollback_plan_created': False},
            'verification_context': {'issues_found': [{'severity': 'critical'}]},
        }, self.canonical)

    def test_legacy_or_incompatible_state_is_rejected(self):
        for fragment in [
            {'options': {'sequential': True}},
            {'performance_context': {'phase_summaries': {}}},
            {'verification_context': {'issues_found': 0}},
            {'orchestrator': {'options': {'sequential': 'true'}}},
        ]:
            with self.subTest(fragment=fragment), self.assertRaises(ValueError):
                validator.validate_state_fragment(fragment, self.canonical)


if __name__ == '__main__':
    unittest.main()
