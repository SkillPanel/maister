import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../helpers.mjs';

// What a project is given rests on two prose briefs. The project analyzer's
// detection decides whether an app is a web UI, and a React Native or Expo
// app is a native mobile app, never a web UI: an analyzer that counts React
// alone as a web framework hands a mobile app the web rules. Discovery's
// configuration brief turns formatter and linter configs into findings: one
// finding naming the commands that enforce them, never one standard per
// setting, because the tool already enforces each setting.

const PLUGIN = path.join(ROOT, 'plugins/maister');
const fold = text => text.replace(/\*\*/g, '').replace(/\s+/g, ' ');
const lines = rel => fs.readFileSync(path.join(PLUGIN, rel), 'utf8').split('\n');
const read = rel => fold(fs.readFileSync(path.join(PLUGIN, rel), 'utf8'));

const ANALYZER = 'agents/project-analyzer.md';
const CONFIG_BRIEF = 'skills/standards-discover/references/config-analyzer-prompt.md';

test('the project analyzer never counts React Native or Expo as a web UI', () => {
  // Every line naming React as a framework also names React Native, so the
  // line tells the two apart; a bare "React" indicator is the defect.
  const react = /\bReact\b(?! Native)/;
  const bare = lines(ANALYZER)
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => react.test(line) && !line.includes('React Native'));
  assert.deepEqual(bare.map(({ n, line }) => `${n}: ${line.trim()}`), [],
    'a line names React without telling it from React Native');
  const text = read(ANALYZER);
  assert.match(text, /React Native/, 'the analyzer names React Native');
  assert.match(text, /Expo/, 'the analyzer names Expo');
});

test('discovery records the format and lint commands, never one standard per setting', () => {
  const text = read(CONFIG_BRIEF);
  assert.ok(text.includes('the commands that enforce them'),
    'formatter and linter configs yield a finding naming the commands that enforce them');
  assert.ok(text.includes('never one standard per setting'),
    'the brief says a formatter setting is never a standard of its own');
  // The old extraction list told the scanner to record each formatter setting.
  assert.ok(!/Formatting rules \(semi, singleQuote, trailingComma, tabWidth, printWidth\)/.test(text),
    'the brief no longer lists formatter settings to extract');
});
