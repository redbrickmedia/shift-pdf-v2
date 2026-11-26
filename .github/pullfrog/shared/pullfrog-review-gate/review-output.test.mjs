import assert from 'node:assert/strict';
import test from 'node:test';
import { INCOMPLETE_MARKER, receipt } from './gate.mjs';
import { conciseReview } from './review-output.mjs';

const snapshot = {
  number: 7,
  head: 'a'.repeat(40),
  base: 'b'.repeat(40),
  mergeBase: 'c'.repeat(40),
  baseRef: 'main',
  runId: 432,
};
const opts = {
  repository: 'redbrickmedia/example',
  reviewer: 'typescript-reviewer',
  delegatedReviewers: new Set(['test-reviewer']),
};
const review = {
  pull_number: snapshot.number,
  commit_id: snapshot.head,
  approved: true,
};
const suggestion = {
  path: 'src/file with spaces.ts',
  line: 15,
  body: 'Advisory: Clarify the name.',
  suggestion: 'const nextName = value;',
};

test('preserves approval and renders suggestions as attributed review notes', () => {
  const output = conciseReview(
    { ...review, body: 'Long summary', comments: [suggestion] },
    snapshot,
    opts
  );
  assert.equal(output.approved, true);
  assert.deepEqual(output.comments, []);
  assert.match(output.body, /^Approved\./);
  assert.ok(output.body.includes(receipt(snapshot)));
  assert.ok(output.body.includes('file%20with%20spaces.ts#L15'));
  assert.match(output.body, /Reviewer: .typescript-reviewer./);
  assert.match(output.body, /const nextName = value;/);
  assert.doesNotMatch(output.body, /Long summary/);
});

test('accepts underscores in configured lead and delegated reviewer attributions', () => {
  const options = {
    ...opts,
    reviewer: 'ui_reviewer',
    delegatedReviewers: new Set(['test_reviewer']),
  };
  const comments = [
    {
      path: 'checks.ts',
      line: 3,
      body: 'Fix the error path.\nReviewer: `test_reviewer`',
    },
    {
      path: 'checks.ts',
      line: 8,
      body: 'Missing validation.\nReviewer: `unverified_agent`',
    },
  ];
  const output = conciseReview(
    { ...review, approved: false, request_changes: true, comments },
    snapshot,
    options
  );
  assert.equal(output.comments[0].body, comments[0].body);
  assert.equal(
    output.comments[1].body,
    'Missing validation.\n\nReviewer: `ui_reviewer`'
  );
});

test('publishes a complete comment-only review on Pullfrog’s own PR', () => {
  const own = { ...snapshot, ownPullRequest: true };
  const clean = conciseReview({ ...review, comments: [suggestion] }, own, opts);
  assert.equal(clean.approved, false);
  assert.equal(clean.request_changes, false);
  assert.match(clean.body, /^Review posted\./);
  assert.match(clean.body, /Advisory suggestions/);
  assert.ok(clean.body.includes(receipt(own)));
  assert.ok(!clean.body.includes(INCOMPLETE_MARKER));

  const finding = { path: 'checks.ts', line: 3, body: 'Fix the error path.' };
  const flagged = conciseReview(
    { ...review, approved: false, request_changes: true, comments: [finding] },
    own,
    opts
  );
  assert.equal(flagged.approved, false);
  assert.equal(flagged.request_changes, false);
  assert.match(flagged.comments[0].body, /Fix the error path/);
  assert.ok(flagged.body.includes(receipt(own)));
  assert.ok(!flagged.body.includes(INCOMPLETE_MARKER));
});

test('keeps actionable findings inline and recognizes only completed reviewers', () => {
  const comments = [
    {
      path: 'checks.ts',
      line: 3,
      body: 'Misses an error path.\nReviewer: `test-reviewer`',
    },
    {
      path: 'checks.ts',
      line: 8,
      body: 'Can throw.\nReviewer: `unverified-agent`',
    },
  ];
  const output = conciseReview(
    { ...review, approved: false, request_changes: true, comments },
    snapshot,
    opts
  );
  assert.equal(output.request_changes, true);
  assert.equal(output.comments[0], comments[0]);
  assert.match(output.comments[1].body, /Reviewer: .typescript-reviewer./);
  assert.doesNotMatch(output.comments[1].body, /unverified-agent/);
});

test('prevents an advisory-only request from becoming a blocking decision', () => {
  const output = conciseReview(
    {
      ...review,
      approved: false,
      request_changes: true,
      comments: [suggestion],
    },
    snapshot,
    opts
  );
  assert.equal(output.request_changes, false);
  assert.equal(output.approved, false);
  assert.match(output.body, /Advisory suggestions/);
});

test('emits a comment-only result when review coverage was incomplete', () => {
  const input = {
    ...review,
    body:
      'Review incomplete: required reviewer timed out.\n' + INCOMPLETE_MARKER,
  };
  const output = conciseReview(input, snapshot, opts);
  assert.equal(output.approved, false);
  assert.equal(output.request_changes, false);
  assert.ok(output.body.includes(receipt(snapshot)));
  assert.ok(output.body.includes(INCOMPLETE_MARKER));
  assert.match(output.body, /required reviewer timed out/);
});

test('rejects tool calls for a different PR or head', () => {
  assert.throws(
    () => conciseReview({ ...review, pull_number: 8 }, snapshot, opts),
    /differs/
  );
  assert.throws(
    () =>
      conciseReview({ ...review, commit_id: snapshot.base }, snapshot, opts),
    /differs/
  );
});

test('a superseded review anchors a fixed comment to the scheduled commit even after native checkout moves', () => {
  const options = { ...opts, superseded: true };
  for (const verdict of [
    { approved: true, commit_id: 'd'.repeat(40) },
    { request_changes: true, commit_id: undefined },
    { approved: true, commit_id: snapshot.head },
  ]) {
    const input = {
      ...review,
      approved: false,
      ...verdict,
      body: 'Previous verdict.',
      comments: [suggestion],
    };
    const output = conciseReview(input, snapshot, options);
    assert.equal(output.approved, false);
    assert.equal(output.request_changes, false);
    assert.equal(output.commit_id, snapshot.head);
    assert.deepEqual(output.comments, []);
    assert.match(output.body, /new commit during this review/);
    assert.ok(output.body.includes(receipt(snapshot)));
    assert.ok(output.body.includes(INCOMPLETE_MARKER));
    assert.doesNotMatch(output.body, /Previous verdict/);
  }
  assert.throws(
    () => conciseReview({ ...review, pull_number: 8 }, snapshot, options),
    /differs/
  );
});
