import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const pullfrogReviewer = 226033991;
const nativeReviewTriggers = new Set([
  'pull_request_opened',
  'pull_request_ready_for_review',
  'pull_request_review_requested',
  'pull_request_synchronize',
]);
const manualReviewTrigger = 'pull_request_review_requested';
const reviewComment = /^\s*@pullfrog\s+review(?:\s|$)/i;
export const INCOMPLETE_MARKER = '<!-- shift-pullfrog-incomplete -->';
export const isSha = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function matchesTarget(pr, target, repositoryId) {
  return (
    pr.number === target.number &&
    pr.state === 'open' &&
    !pr.draft &&
    pr.head?.repo?.id === repositoryId &&
    pr.base?.repo?.id === repositoryId &&
    isSha(pr.head.sha) &&
    isSha(pr.base.sha) &&
    (target.baseRef === undefined || pr.base.ref === target.baseRef)
  );
}

export function receipt(snapshot) {
  const baseRef = Buffer.from(snapshot.baseRef).toString('base64url');
  return (
    '<!-- shift-pullfrog:v1:' +
    [
      'native-' + snapshot.runId,
      snapshot.head,
      snapshot.mergeBase,
      baseRef,
    ].join(':') +
    ' -->'
  );
}

export function reviewIncomplete(body) {
  return body?.split(/\r?\n/).includes(INCOMPLETE_MARKER) ?? false;
}

export function directRequest(event, actorId, ref, defaultBranch) {
  if (
    actorId !== String(pullfrogReviewer) ||
    ref !== 'refs/heads/' + defaultBranch
  )
    return;
  let payload;
  try {
    payload = JSON.parse(event.inputs?.prompt);
  } catch {
    return;
  }
  const request = payload?.event;
  if (
    payload?.['~pullfrog'] === true &&
    request?.trigger === 'issue_comment_created' &&
    request.is_pr === true &&
    positive(request.issue_number) &&
    ['write', 'maintain', 'admin', 'owner'].includes(
      request.authorPermission
    ) &&
    typeof payload.prompt === 'string' &&
    reviewComment.test(payload.prompt)
  ) {
    return request.issue_number;
  }
}

export async function planNativeReview(event, context, github) {
  const {
    repositoryId,
    repository,
    actorId,
    ref,
    defaultBranch,
    eventName,
    runId,
  } = context;
  if (
    eventName !== 'workflow_dispatch' ||
    actorId !== String(pullfrogReviewer) ||
    ref !== 'refs/heads/' + defaultBranch ||
    event.repository?.id !== repositoryId ||
    event.repository.full_name !== repository ||
    !positive(runId)
  ) {
    return {
      disposition: 'declined',
      reason: 'This is not an authenticated native Pullfrog dispatch.',
    };
  }
  let payload;
  try {
    payload = JSON.parse(event.inputs?.prompt);
  } catch {
    return {
      disposition: 'general',
      reason: 'No native review context for this prompt.',
    };
  }
  const prEvent = payload?.event;
  const explicitComment =
    prEvent?.trigger === 'issue_comment_created' &&
    typeof payload.prompt === 'string' &&
    reviewComment.test(payload.prompt);
  if (
    payload?.['~pullfrog'] !== true ||
    prEvent?.is_pr !== true ||
    (!nativeReviewTriggers.has(prEvent.trigger) && !explicitComment)
  ) {
    return {
      disposition: 'general',
      reason: 'This native request does not need PR review context.',
    };
  }
  if (
    !positive(prEvent.issue_number) ||
    (explicitComment && !directRequest(event, actorId, ref, defaultBranch))
  ) {
    return {
      disposition: 'declined',
      reason: 'This PR review request is missing an authorized target.',
    };
  }
  const number = prEvent.issue_number;
  const pr = await github.get('/pulls/' + number);
  if (!matchesTarget(pr, { number }, repositoryId)) {
    return {
      disposition: 'declined',
      reason: 'This PR is outside Shift’s trusted review context.',
    };
  }

  const head = pr.head.sha;
  const base = pr.base.sha;
  const comparison = await github.get(
    '/compare/' + base + '...' + head + '?per_page=1'
  );
  const mergeBase = comparison.merge_base_commit?.sha;
  if (!isSha(mergeBase))
    throw new Error('GitHub did not provide a valid merge base.');
  const automatic =
    payload.shiftFollowUp === true ||
    (!explicitComment && prEvent.trigger !== manualReviewTrigger);
  return {
    disposition: 'review',
    snapshot: {
      number,
      head,
      base,
      mergeBase,
      baseRef: pr.base.ref,
      runId,
      ...(pr.user?.id === pullfrogReviewer && { ownPullRequest: true }),
    },
    group: automatic
      ? ['shift-pullfrog', number, head, base].join('-')
      : undefined,
  };
}

function hasCompleteReview(review, snapshot) {
  if (
    review.user?.id !== pullfrogReviewer ||
    review.commit_id !== snapshot.head ||
    !['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED'].includes(review.state) ||
    reviewIncomplete(review.body)
  )
    return false;
  return (
    review.body?.split(/\r?\n/).some((line) => {
      const shared = /^<!-- shift-pullfrog:v1:native-([1-9]\d*):/.exec(line);
      return shared && line === receipt({ ...snapshot, runId: shared[1] });
    }) ?? false
  );
}

export async function checkReview(snapshot, context, github, automatic) {
  const revision = await readReviewRevision(snapshot, context, github);
  if (revision.state !== 'current' || !automatic) return revision.state;
  // Run under the revision's concurrency group so the preceding review is visible.
  for (let page = 1; ; page++) {
    const reviews = await github.get(
      '/pulls/' + snapshot.number + '/reviews?per_page=100&page=' + page
    );
    if (reviews.some((review) => hasCompleteReview(review, snapshot)))
      return 'duplicate';
    if (reviews.length < 100) return 'current';
  }
}

export async function readReviewRevision(
  snapshot,
  { repositoryId, runId },
  github
) {
  if (
    !positive(snapshot.number) ||
    ![snapshot.head, snapshot.base, snapshot.mergeBase].every(isSha) ||
    typeof snapshot.baseRef !== 'string' ||
    !snapshot.baseRef ||
    !positive(runId) ||
    snapshot.runId !== runId
  )
    throw new Error('Invalid Pullfrog review snapshot.');
  const pr = await github.get('/pulls/' + snapshot.number);
  if (
    pr.number === snapshot.number &&
    pr.state === 'closed' &&
    pr.head?.repo?.id === repositoryId &&
    pr.base?.repo?.id === repositoryId
  )
    return { state: 'closed' };
  if (!matchesTarget(pr, snapshot, repositoryId))
    return { state: 'ineligible' };
  if (pr.head.sha !== snapshot.head)
    return { state: 'superseded', head: pr.head.sha };
  return { state: pr.base.sha === snapshot.base ? 'current' : 'ineligible' };
}

export function githubApi(repository, token) {
  if (!/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository) || !token)
    throw new Error('Missing GitHub repository or token.');
  async function request(path, { method = 'GET', body, empty = false } = {}) {
    const result = await fetch(
      'https://api.github.com/repos/' + repository + path,
      {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(20_000),
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    );
    if (!result.ok)
      throw new Error(
        'GitHub ' +
          method +
          ' ' +
          path.split('?')[0] +
          ' failed (' +
          result.status +
          ').'
      );
    return empty ? undefined : result.json();
  }
  return { get: (path) => request(path), request };
}

async function main(env, command) {
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const context = {
    repository: env.GITHUB_REPOSITORY,
    repositoryId: Number(env.GITHUB_REPOSITORY_ID),
    defaultBranch: event.repository?.default_branch,
    eventName: env.GITHUB_EVENT_NAME,
    actorId: env.GITHUB_ACTOR_ID,
    runId: Number(env.GITHUB_RUN_ID),
    ref: env.GITHUB_REF,
  };
  if (!positive(context.repositoryId) || !context.defaultBranch)
    throw new Error('Invalid Pullfrog review context.');
  const github = githubApi(context.repository, env.GH_TOKEN);
  if (command === 'check') {
    const state = await checkReview(
      JSON.parse(env.PULLFROG_SNAPSHOT),
      context,
      github,
      env.PULLFROG_AUTOMATIC === 'true'
    );
    console.log('Pullfrog review revision: ' + state);
    await appendFile(env.GITHUB_OUTPUT, 'state=' + state + '\n');
  } else {
    const { disposition, reason, snapshot, group } = await planNativeReview(
      event,
      context,
      github
    );
    if (reason) console.log(reason);
    const outputs = snapshot
      ? {
          disposition,
          snapshot: JSON.stringify(snapshot),
          number: snapshot.number,
          head: snapshot.head,
          group: group ?? '',
        }
      : { disposition };
    await appendFile(
      env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => key + '=' + value + '\n')
        .join('')
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main(process.env, process.argv[2]);
