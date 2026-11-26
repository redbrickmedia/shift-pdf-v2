import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import {
  githubApi,
  readReviewRevision,
  receipt,
} from '../pullfrog-review-gate/gate.mjs';

export function followUpHead(
  revision,
  outcome,
  checkoutHead,
  { mode, posted } = {}
) {
  if (revision.state !== 'superseded') return;
  if (outcome === 'skipped' || checkoutHead === revision.head)
    return revision.head;
  // Native cleanup can recover from a posted review or an incremental review
  // without a verdict. An initial run that failed before posting needs help.
  if (outcome === 'failure' && mode === 'review' && posted === false)
    return revision.head;
}

async function hasPostedReview(github, snapshot) {
  const marker = receipt(snapshot);
  for (let page = 1; ; page += 1) {
    const reviews = await github.get(
      '/pulls/' + snapshot.number + '/reviews?per_page=100&page=' + page
    );
    if (
      reviews.some(
        (review) =>
          review.user?.login === 'pullfrog[bot]' &&
          review.body?.split(/\r?\n/).includes(marker)
      )
    )
      return true;
    if (reviews.length < 100) return false;
  }
}

export function followUpRequest(
  payload,
  snapshot,
  workflowRef,
  repository,
  defaultBranch
) {
  const path = workflowRef
    ?.slice((repository + '/.github/workflows/').length)
    .split('@')[0];
  if (
    workflowRef !==
      repository +
        '/.github/workflows/' +
        path +
        '@refs/heads/' +
        defaultBranch ||
    !/^[\w.-]+\.ya?ml$/.test(path) ||
    payload?.['~pullfrog'] !== true ||
    payload.event?.is_pr !== true ||
    payload.event.issue_number !== snapshot.number
  ) {
    throw new Error('Invalid native Pullfrog follow-up target.');
  }
  // Replay the original task with its original incremental baseline. Check runs,
  // progress comments, and reservation data belong to the superseded run.
  const {
    version,
    type,
    model,
    modelExplicit,
    effort,
    prompt,
    triggerer,
    baseInstructions,
    eventInstructions,
    event,
  } = payload;
  const promptJson = JSON.stringify({
    '~pullfrog': true,
    version,
    type,
    model,
    modelExplicit,
    effort,
    prompt,
    triggerer,
    baseInstructions,
    eventInstructions,
    event,
    shiftFollowUp: true,
  });
  return { path, body: { ref: defaultBranch, inputs: { prompt: promptJson } } };
}

async function main(env, command) {
  const snapshot = JSON.parse(env.PULLFROG_SNAPSHOT);
  const github = githubApi(env.GITHUB_REPOSITORY, env.GH_TOKEN);
  const context = {
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    runId: Number(env.GITHUB_RUN_ID),
  };
  const revision = await readReviewRevision(snapshot, context, github);
  if (revision.state !== 'superseded') return;

  if (command === 'plan') {
    const outcome = env.PULLFROG_REVIEW_OUTCOME;
    const checkoutHead =
      outcome === 'skipped'
        ? undefined
        : execFileSync('git', ['rev-parse', 'HEAD'], {
            encoding: 'utf8',
          }).trim();
    let head = followUpHead(revision, outcome, checkoutHead);
    if (!head && outcome === 'failure') {
      const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
      const trigger = JSON.parse(event.inputs.prompt).event?.trigger;
      const mode = await readFile(
        '.git/shift-pullfrog-runtime/review-mode',
        'utf8'
      ).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
        return trigger === 'pull_request_synchronize'
          ? 'incrementalreview'
          : 'review';
      });
      if (mode === 'review') {
        head = followUpHead(revision, outcome, checkoutHead, {
          mode,
          posted: await hasPostedReview(github, snapshot),
        });
      }
    }
    if (head) await appendFile(env.GITHUB_OUTPUT, 'head=' + head + '\n');
    return;
  }
  if (command !== 'dispatch')
    throw new Error('Unknown Pullfrog follow-up command.');
  if (revision.head !== env.PULLFROG_FOLLOW_UP_HEAD) return;
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const { path, body } = followUpRequest(
    JSON.parse(event.inputs.prompt),
    snapshot,
    env.GITHUB_WORKFLOW_REF,
    env.GITHUB_REPOSITORY,
    event.repository.default_branch
  );
  await github.request(
    '/actions/workflows/' + encodeURIComponent(path) + '/dispatches',
    { method: 'POST', body, empty: true }
  );
  console.log(
    'Dispatched a native Pullfrog review for PR #' +
      snapshot.number +
      ' at ' +
      revision.head +
      '.'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.env, process.argv[2]);
