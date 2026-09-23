"""Validate Codex metadata and the shared YAML state examples (Python 3.11+, PyYAML)."""
import json
from pathlib import Path
import re
import sys
import tomllib

import yaml


def validate_state_fragment(fragment, canonical):
    """Domain examples extend the framework without relocating or retyping fields."""
    if not isinstance(fragment, dict):
        raise ValueError('state must be a mapping')
    if 'options' in fragment:
        raise ValueError('options must live under orchestrator.options')
    for key, value in fragment.items():
        if key.endswith('_context') and isinstance(value, dict) and 'phase_summaries' in value:
            raise ValueError('phase_summaries must live at the root')

    def compare(actual, expected, location):
        if expected is not None and not isinstance(actual, type(expected)):
            raise ValueError(f'{location} must be {type(expected).__name__}')
        if isinstance(expected, dict):
            for key in actual.keys() & expected.keys():
                compare(actual[key], expected[key], f'{location}.{key}')

    compare(fragment, canonical, 'state')


def yaml_blocks(path):
    return [yaml.safe_load(block) for block in re.findall(r'^```yaml\n(.*?)^```', path.read_text(), re.M | re.S)]


def main():
    root = Path(__file__).resolve().parents[1]
    plugin = root / 'plugins/maister-codex'
    skills = plugin / 'skills'
    framework = skills / 'maister-orchestrator-framework/references/orchestrator-patterns.md'
    canonical = next(block for block in yaml_blocks(framework) if isinstance(block, dict) and 'orchestrator' in block)
    validate_state_fragment(canonical, canonical)
    for name in ('performance', 'migration', 'research', 'product-design'):
        skill = skills / f'maister-{name}/SKILL.md'
        fragments = [
            block for block in yaml_blocks(skill)
            if isinstance(block, dict) and ('orchestrator' in block or 'options' in block)
        ]
        if not fragments:
            raise ValueError(f'{skill}: missing state extension example')
        for fragment in fragments:
            validate_state_fragment(fragment, canonical)
    for skill in skills.iterdir():
        if not skill.is_dir():
            continue
        text = (skill / 'SKILL.md').read_text()
        metadata = yaml.safe_load(text.split('---', 2)[1])
        if metadata.get('name') != skill.name or not isinstance(metadata.get('description'), str) or not metadata['description'].strip():
            raise ValueError(f'{skill}: invalid skill metadata')
    for file in plugin.rglob('*.yaml'):
        yaml.safe_load(file.read_text())
    for file in plugin.rglob('*.toml'):
        data = tomllib.loads(file.read_text())
        if data.get('name') != file.stem or not all(isinstance(data.get(key), str) and data[key].strip() for key in ('description', 'developer_instructions')):
            raise ValueError(f'{file}: invalid agent metadata')
    for file in plugin.rglob('*.json'):
        json.loads(file.read_text())
    manifests = [
        root / '.claude-plugin/marketplace.json',
        root / 'plugins/maister/.claude-plugin/plugin.json',
        root / 'plugins/maister-copilot/.claude-plugin/plugin.json',
        plugin / '.codex-plugin/plugin.json',
    ]
    versions = []
    for file in manifests:
        data = json.loads(file.read_text())
        versions.append(data.get('version', data.get('metadata', {}).get('version')))
    if not all(versions) or len(set(versions)) != 1:
        raise ValueError(f'Manifest versions disagree: {versions}')
    print('Codex metadata, state examples, and release versions are valid')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, IndexError, OSError, yaml.YAMLError) as error:
        sys.exit(str(error))
