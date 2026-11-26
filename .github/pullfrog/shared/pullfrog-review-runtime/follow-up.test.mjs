import assert from 'node:assert/strict';
import test from 'node:test';
import { followUpHead, followUpRequest } from './follow-up.mjs';

test('a skipped review or a checkout already on the new head needs explicit follow-up', () => {
  const previous = 'a'.repeat(40);
  const next = 'b'.repeat(40);
  const revision = { state: 'superseded', head: next };
  assert.equal(followUpHead(revision, 'success', next), next);
  assert.equal(followUpHead(revision, 'failure', next), next);
  assert.equal(followUpHead(revision, 'skipped'), next);
  assert.equal(followUpHead(revision, 'success', previous), undefined);
  assert.equal(followUpHead({ state: 'current' }, 'skipped'), undefined);
  assert.equal(
    followUpHead({ state: 'ineligible' }, 'failure', next),
    undefined
  );
});

test('a failed initial review on the previous checkout needs follow-up unless it posted a review', () => {
  const previous = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const revision = { state: 'superseded', head };
  assert.equal(
    followUpHead(revision, 'failure', previous, {
      mode: 'review',
      posted: false,
    }),
    head
  );
  assert.equal(
    followUpHead(revision, 'failure', previous, {
      mode: 'review',
      posted: true,
    }),
    undefined
  );
  assert.equal(
    followUpHead(revision, 'failure', previous, {
      mode: 'incrementalreview',
      posted: false,
    }),
    undefined
  );
  assert.equal(
    followUpHead(revision, 'success', previous, {
      mode: 'review',
      posted: false,
    }),
    undefined
  );
});

test('follow-up is a fresh dispatch with the original request and incremental baseline', () => {
  const repository = 'redbrickmedia/example';
  const defaultBranch = 'main';
  const ref =
    repository + '/.github/workflows/pullfrog.yml@refs/heads/' + defaultBranch;
  const snapshot = { number: 7 };
  const original = {
    '~pullfrog': true,
    version: 1,
    prompt: '',
    baseInstructions: 'Repository rules.',
    eventInstructions: 'Review incrementally.',
    event: {
      trigger: 'pull_request_synchronize',
      is_pr: true,
      issue_number: 7,
      before_sha: 'a'.repeat(40),
    },
  };
  const request = followUpRequest(
    {
      ...original,
      checkRun: { id: 15 },
      progressComment: { id: 16 },
      xrepoGrant: 'previous-run',
    },
    snapshot,
    ref,
    repository,
    defaultBranch
  );
  assert.equal(request.path, 'pullfrog.yml');
  assert.equal(request.body.ref, defaultBranch);
  assert.deepEqual(JSON.parse(request.body.inputs.prompt), {
    ...original,
    shiftFollowUp: true,
  });
  assert.throws(
    () =>
      followUpRequest(original, { number: 8 }, ref, repository, defaultBranch),
    /Invalid/
  );
  assert.throws(
    () =>
      followUpRequest(
        original,
        snapshot,
        ref.replace('refs/heads/main', 'refs/heads/topic'),
        repository,
        defaultBranch
      ),
    /Invalid/
  );
});
