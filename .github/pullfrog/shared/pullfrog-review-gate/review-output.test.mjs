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

test('a complete body-only native comment stays a comment and keeps its concise reason', () => {
  const summary =
    'No code issues found. The branch needs a rebase before it can merge.';
  const output = conciseReview(
    {
      ...review,
      approved: false,
      comments: [],
      body: summary + '\n\nLong implementation walkthrough.',
    },
    snapshot,
    opts
  );
  assert.equal(output.approved, false);
  assert.notEqual(output.request_changes, true);
  assert.match(output.body, /^Review posted\./);
  assert.ok(output.body.includes(summary));
  assert.ok(output.body.includes(receipt(snapshot)));
  assert.match(output.body, /Reviewer: `typescript-reviewer`/);
  assert.ok(!output.body.includes(INCOMPLETE_MARKER));
  assert.doesNotMatch(output.body, /Long implementation walkthrough/);
});

test('a body-only request for changes keeps its verdict without claiming inline findings', () => {
  const output = conciseReview(
    {
      ...review,
      approved: false,
      request_changes: true,
      body: 'The rollout is missing a required deployment step.',
    },
    snapshot,
    opts
  );
  assert.equal(output.approved, false);
  assert.equal(output.request_changes, true);
  assert.match(output.body, /^Changes requested\./);
  assert.match(output.body, /missing a required deployment step/);
  assert.doesNotMatch(output.body, /inline findings/);
  assert.ok(!output.body.includes(INCOMPLETE_MARKER));
});

test('headed body-only comments retain text with or without a blank line after the heading', () => {
  for (const separator of ['\n', '\n\n', '\r\n', '\r\n\r\n']) {
    const output = conciseReview(
      {
        ...review,
        approved: false,
        body:
          '# Review' + separator + 'The branch needs a rebase before merge.',
      },
      snapshot,
      opts
    );
    assert.match(output.body, /The branch needs a rebase before merge/);
    assert.ok(!output.body.includes(INCOMPLETE_MARKER));
    assert.equal(output.approved, false);
  }
});

test('an advisory opening cannot clear a later blocking finding or discard its details', () => {
  const body =
    'Advisory: Clarify the wording.\n\n## Required change\nThe rollout is missing a required deployment step.\n\nThe recovery path must also restore the prior configuration.';
  const output = conciseReview(
    { ...review, approved: false, request_changes: true, comments: [], body },
    snapshot,
    opts
  );
  assert.equal(output.request_changes, true);
  assert.equal(output.approved, false);
  assert.ok(output.body.includes(body));
  assert.ok(!output.body.includes(INCOMPLETE_MARKER));
});

test('an advisory-only body cannot turn a native comment into a blocking review', () => {
  const output = conciseReview(
    {
      ...review,
      approved: false,
      request_changes: true,
      body: 'Advisory: Clarify the wording.',
    },
    snapshot,
    opts
  );
  assert.equal(output.approved, false);
  assert.equal(output.request_changes, false);
  assert.match(output.body, /Clarify the wording/);
  assert.ok(!output.body.includes(INCOMPLETE_MARKER));
});

test('empty native comments and explicitly incomplete coverage remain incomplete', () => {
  for (const body of [
    undefined,
    '',
    '  ',
    '<!-- metadata only -->',
    '# Review',
    'Review incomplete: required reviewer timed out.',
  ]) {
    const output = conciseReview(
      { ...review, approved: false, body },
      snapshot,
      opts
    );
    assert.equal(output.approved, false);
    assert.equal(output.request_changes, false);
    assert.ok(output.body.includes(INCOMPLETE_MARKER));
  }
});

test('quoting an incomplete-review diagnostic later in an approval does not change its verdict', () => {
  const output = conciseReview(
    {
      ...review,
      body: 'Review complete.\n\n```text\nReview incomplete: example diagnostic.\n```',
    },
    snapshot,
    opts
  );
  assert.equal(output.approved, true);
  assert.ok(!output.body.includes(INCOMPLETE_MARKER));
});

test('incomplete diagnostics after prose stay incomplete while fenced examples do not', () => {
  for (const separator of ['\n', '\r\n']) {
    const body = [
      '## Coverage',
      'Reviewed the general changes.',
      '',
      'Review incomplete: the specialist timed out.',
    ].join(separator);
    const output = conciseReview({ ...review, body }, snapshot, opts);
    assert.equal(output.approved, false);
    assert.ok(output.body.includes(INCOMPLETE_MARKER));
    assert.match(output.body, /specialist timed out/);
  }
  for (const fence of ['```', '````', '~~~']) {
    const body = `Review complete.\n\n${fence}text\nReview incomplete: example diagnostic.\n${fence}`;
    const output = conciseReview({ ...review, body }, snapshot, opts);
    assert.equal(output.approved, true);
    assert.ok(!output.body.includes(INCOMPLETE_MARKER));
  }
  const body =
    'Review complete.\n\n````text\n```\nReview incomplete: example diagnostic.\n````\n\nReview incomplete: missing specialist.';
  const output = conciseReview({ ...review, body }, snapshot, opts);
  assert.equal(output.approved, false);
  assert.match(output.body, /missing specialist/);
  assert.doesNotMatch(output.body, /example diagnostic/);
});

test('body-only notes retain exactly one trusted reviewer attribution and blocking details', () => {
  for (const claimed of [
    'test-reviewer',
    'typescript-reviewer',
    'unverified-agent',
  ]) {
    for (const request_changes of [true, false]) {
      const body =
        'A required deployment step is missing.\n\nPreserve the recovery configuration.\n\nReviewer: `' +
        claimed +
        '`';
      const output = conciseReview(
        { ...review, approved: false, request_changes, body },
        snapshot,
        opts
      );
      assert.equal(output.approved, false);
      assert.equal(output.request_changes, request_changes);
      assert.equal((output.body.match(/Reviewer:/g) ?? []).length, 1);
      const expected = claimed === 'test-reviewer' ? claimed : opts.reviewer;
      assert.ok(output.body.includes('Reviewer: `' + expected + '`'));
      assert.doesNotMatch(output.body, /unverified-agent/);
      assert.match(output.body, /required deployment step/);
      if (request_changes)
        assert.match(output.body, /Preserve the recovery configuration/);
    }
  }
});

test('HTML comment examples cannot hide a real diagnostic between fenced blocks', () => {
  const body =
    'Reviewed the changes.\n\n```html\n<!--\n```\n\nReview incomplete: specialist timed out.\n\n```html\n-->\n```';
  const output = conciseReview({ ...review, body }, snapshot, opts);
  assert.equal(output.approved, false);
  assert.ok(output.body.includes(INCOMPLETE_MARKER));
  assert.match(output.body, /specialist timed out/);
  const metadata =
    'Reviewed the changes.\n\n<!--\n```\nReview incomplete: historical metadata.\n-->\n\n```text <!--\nReview incomplete: example.\n```';
  const complete = conciseReview({ ...review, body: metadata }, snapshot, opts);
  assert.equal(complete.approved, true);
  assert.ok(!complete.body.includes(INCOMPLETE_MARKER));
});

test('inline code comment delimiters cannot hide a subsequent real diagnostic', () => {
  for (const example of [
    '`<!--`',
    '``<!-- ` literal``',
    '`<!--\ncontinued code`',
    '\\`literal tick and `<!--`',
  ]) {
    const body =
      'Reviewed ' +
      example +
      ' handling.\n\nReview incomplete: specialist timed out.';
    const output = conciseReview({ ...review, body }, snapshot, opts);
    assert.equal(output.approved, false, example);
    assert.ok(output.body.includes(INCOMPLETE_MARKER));
    assert.match(output.body, /specialist timed out/);
  }
  for (const body of [
    'Reviewed changes.\n\n<!-- ` metadata -->\n\nReview incomplete: missing specialist.',
    'Reviewed `unmatched code\n\nReview incomplete: missing specialist.',
  ])
    assert.equal(
      conciseReview({ ...review, body }, snapshot, opts).approved,
      false
    );
  const code =
    'Reviewed `an example\nReview incomplete: quoted example.\nend of example`.';
  assert.equal(
    conciseReview({ ...review, body: code }, snapshot, opts).approved,
    true
  );
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
