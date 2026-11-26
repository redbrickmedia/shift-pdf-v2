import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configureReviewAgents,
  configureReviewNesting,
} from './reviewer-config.mjs';

test('repository specialists retain max-effort DeepSeek and bounded delegation', () => {
  const config = {
    agents: {
      ui: { mode: 'subagent', system: 'Trusted UI instructions' },
      tests: { mode: 'subagent', system: 'Trusted test instructions' },
    },
  };
  configureReviewAgents(config, ['ui', 'tests']);
  const assignment = configureReviewNesting(
    config,
    ['ui', 'tests'],
    'assignments.md'
  );
  assert.equal(config.agents.ui.model, 'opencode-go/deepseek-v4.1-flash#max');
  assert.equal(
    config.agents.tests.model,
    'opencode-go/deepseek-v4.1-flash#max'
  );
  assert.equal(config.agents.ui.system, 'Trusted UI instructions');
  assert.equal(config.experimental.subagent_depth, 2);
  assert.match(assignment, /ui, tests in parallel/);
});

test('a single configured lead becomes primary while invalid assignments fail', () => {
  const config = { agents: { domain: { mode: 'subagent' } } };
  configureReviewAgents(config, ['domain'], 'domain');
  assert.equal(config.default_agent, 'domain');
  assert.equal(config.agents.domain.mode, 'primary');
  assert.throws(
    () => configureReviewAgents(config, ['missing'], 'missing'),
    /sole assigned/
  );
});

test('repositories without specialists keep the native primary reviewer', () => {
  const config = {};
  configureReviewAgents(config, []);
  assert.equal(configureReviewNesting(config, [], 'assignments.md'), undefined);
  assert.equal(config.default_agent, undefined);
  assert.equal(config.experimental.subagent_depth, 2);
});
