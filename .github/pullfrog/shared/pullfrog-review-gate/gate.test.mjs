import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkReview,
  INCOMPLETE_MARKER,
  planNativeReview,
  readReviewRevision,
  receipt,
} from './gate.mjs';

const repo = { id: 42, full_name: 'shift/sample' };
const head = 'a'.repeat(40);
const base = 'b'.repeat(40);
const mergeBase = 'c'.repeat(40);
const pr = {
  number: 7,
  state: 'open',
  draft: false,
  head: { sha: head, repo },
  base: { sha: base, ref: 'release', repo },
};
const context = {
  repositoryId: repo.id,
  repository: repo.full_name,
  defaultBranch: 'main',
  ref: 'refs/heads/main',
  eventName: 'workflow_dispatch',
  actorId: '226033991',
  runId: 313,
};
const snapshot = {
  number: 7,
  head,
  base,
  baseRef: 'release',
  mergeBase,
  runId: 313,
};

function event(trigger, fields = {}, prompt) {
  return {
    repository: repo,
    inputs: {
      prompt: JSON.stringify({
        '~pullfrog': true,
        prompt,
        event: { is_pr: true, issue_number: 7, trigger, ...fields },
      }),
    },
  };
}

function github(pullRequest = pr) {
  return {
    async get(path) {
      if (path === '/pulls/7') return pullRequest;
      assert.equal(path, '/compare/' + base + '...' + head + '?per_page=1');
      return { merge_base_commit: { sha: mergeBase } };
    },
  };
}

test('native review and re-review resolve a current release-branch snapshot without another reviewer', async () => {
  for (const trigger of [
    'pull_request_opened',
    'pull_request_ready_for_review',
    'pull_request_review_requested',
    'pull_request_synchronize',
  ]) {
    const plan = await planNativeReview(event(trigger), context, github());
    assert.equal(plan.disposition, 'review');
    assert.deepEqual(plan.snapshot, snapshot);
    assert.equal(
      plan.group,
      trigger === 'pull_request_review_requested'
        ? undefined
        : ['shift-pullfrog', snapshot.number, head, base].join('-')
    );
  }
  assert.match(receipt(snapshot), /native-313/);
});

test('only authenticated app dispatches and authorized direct review requests receive Shift context', async () => {
  const comment = event(
    'issue_comment_created',
    { authorPermission: 'write' },
    '@pullfrog review this'
  );
  const direct = await planNativeReview(comment, context, github());
  assert.deepEqual(direct.snapshot, snapshot);
  assert.equal(direct.group, undefined);
  comment.inputs.prompt = JSON.stringify({
    ...JSON.parse(comment.inputs.prompt),
    shiftFollowUp: true,
  });
  assert.ok((await planNativeReview(comment, context, github())).group);
  const noLookup = {
    get() {
      assert.fail('An unrecognized dispatch must not query the PR');
    },
  };
  assert.equal(
    (
      await planNativeReview(
        event(
          'issue_comment_created',
          { authorPermission: 'read' },
          '@pullfrog review'
        ),
        context,
        noLookup
      )
    ).disposition,
    'declined'
  );
  assert.equal(
    (
      await planNativeReview(
        event('pull_request_opened'),
        { ...context, actorId: '1' },
        noLookup
      )
    ).disposition,
    'declined'
  );
  assert.equal(
    (
      await planNativeReview(
        event(
          'issue_comment_created',
          { authorPermission: 'write' },
          '@pullfrog summarize this'
        ),
        context,
        noLookup
      )
    ).disposition,
    'general'
  );
});

test('ineligible native reviews are declined while same-repo bot PRs can be reviewed', async () => {
  const fork = { ...pr, head: { ...pr.head, repo: { id: 43 } } };
  assert.equal(
    (
      await planNativeReview(
        event('pull_request_opened'),
        context,
        github(fork)
      )
    ).disposition,
    'declined'
  );
  assert.equal(
    (
      await planNativeReview(
        event('pull_request_opened'),
        context,
        github({ ...pr, draft: true })
      )
    ).disposition,
    'declined'
  );
  const own = { ...pr, user: { id: 226033991 } };
  const plan = await planNativeReview(
    event('pull_request_opened'),
    context,
    github(own)
  );
  assert.equal(plan.disposition, 'review');
  assert.deepEqual(plan.snapshot, { ...snapshot, ownPullRequest: true });
});

test('a push supersedes an in-flight snapshot and only the first automated dispatch reviews the new revision', async () => {
  const next = 'd'.repeat(40);
  const reviews = [];
  const pushed = { ...pr, head: { ...pr.head, sha: next } };
  const afterPush = {
    async get(path) {
      if (path === '/pulls/7') return pushed;
      if (path === '/compare/' + base + '...' + next + '?per_page=1') {
        return { merge_base_commit: { sha: mergeBase } };
      }
      assert.equal(path, '/pulls/7/reviews?per_page=100&page=1');
      return reviews;
    },
  };
  assert.equal(
    await checkReview(snapshot, context, afterPush, true),
    'superseded'
  );
  const automatic = event('pull_request_synchronize', { before_sha: head });
  const catchUp = event('pull_request_synchronize', {
    before_sha: head,
    silent: true,
  });
  const contexts = [314, 315, 316].map((runId) => ({ ...context, runId }));
  const plans = await Promise.all(
    [automatic, catchUp, catchUp].map((request, index) =>
      planNativeReview(request, contexts[index], afterPush)
    )
  );
  assert.equal(new Set(plans.map((plan) => plan.group)).size, 1);
  assert.ok(plans[0].group);
  const first = plans[0].snapshot;
  const approved = {
    state: 'APPROVED',
    user: { id: 226033991 },
    commit_id: next,
    body: receipt(first),
  };
  reviews.push(
    { ...approved, commit_id: head },
    { ...approved, user: { id: 99 } },
    { ...approved, body: receipt({ ...first, baseRef: 'other' }) },
    { ...approved, state: 'DISMISSED' },
    {
      ...approved,
      state: 'COMMENTED',
      body: receipt(first) + '\n' + INCOMPLETE_MARKER,
    }
  );
  assert.equal(
    await checkReview(first, contexts[0], afterPush, true),
    'current'
  );
  reviews.push(approved);
  for (const index of [1, 2]) {
    assert.equal(
      await checkReview(
        plans[index].snapshot,
        contexts[index],
        afterPush,
        true
      ),
      'duplicate'
    );
  }
  assert.equal(
    await checkReview(plans[2].snapshot, contexts[2], afterPush, false),
    'current'
  );
  reviews[reviews.length - 1] = { ...approved, state: 'COMMENTED' };
  assert.equal(
    await checkReview(first, contexts[0], afterPush, true),
    'duplicate'
  );
});

test('the publish guard distinguishes a push from a retarget, base update, or closed PR', async () => {
  assert.deepEqual(await readReviewRevision(snapshot, context, github()), {
    state: 'current',
  });
  const pushed = { ...pr, head: { ...pr.head, sha: mergeBase } };
  assert.deepEqual(
    await readReviewRevision(snapshot, context, github(pushed)),
    {
      state: 'superseded',
      head: mergeBase,
    }
  );
  for (const ineligible of [
    { ...pushed, base: { ...pr.base, ref: 'main' } },
    { ...pushed, state: 'closed' },
    { ...pushed, draft: true },
    { ...pushed, head: { ...pushed.head, repo: { id: 43 } } },
    { ...pr, base: { ...pr.base, sha: mergeBase } },
  ]) {
    assert.deepEqual(
      await readReviewRevision(snapshot, context, github(ineligible)),
      { state: 'ineligible' }
    );
  }
  await assert.rejects(
    readReviewRevision(snapshot, { ...context, runId: 314 }, github()),
    /Invalid Pullfrog/
  );
});
