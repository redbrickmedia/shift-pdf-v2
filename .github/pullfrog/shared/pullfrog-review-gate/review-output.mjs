import {
  INCOMPLETE_MARKER,
  isSha,
  receipt,
  reviewIncomplete,
} from './gate.mjs';

const safePath = (path) =>
  typeof path === 'string' &&
  path.length > 0 &&
  path
    .split('/')
    .every(
      (part) =>
        part &&
        part !== '.' &&
        part !== '..' &&
        !/[\\\u0000-\u001f\u007f]/.test(part)
    );

const ADVISORY = /^Advisory:\s*/i;
const REVIEWER = /(?:^|\n)Reviewer: `([^`\r\n]+)`\s*$/;

export function isReviewerName(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9_-]*$/.test(value);
}

function formatAdvisory(
  { path, line, side, body, suggestion },
  snapshot,
  repository
) {
  const message =
    body?.replace(ADVISORY, '').trim().replace(/\r?\n/g, ' ') ||
    'Suggested edit.';
  const revision = side === 'LEFT' ? snapshot.mergeBase : snapshot.head;
  let location = '';
  if (safePath(path) && Number.isSafeInteger(line) && line > 0) {
    const filename = path
      .split('/')
      .at(-1)
      .replace(/[\[\]]/g, '\\$&');
    const urlPath = path.split('/').map(encodeURIComponent).join('/');
    location = `[${filename}:${line}](<https://github.com/${repository}/blob/${revision}/${urlPath}#L${line}>) `;
  }
  const edit =
    suggestion === ''
      ? ' Suggested edit: remove this code.'
      : suggestion
        ? '\n\n' +
          suggestion
            .split(/\r?\n/)
            .map((line) => '      ' + line)
            .join('\n')
        : '';
  return `- ${location}${message}${edit}`;
}

export function conciseReview(
  input,
  snapshot,
  {
    repository,
    reviewer = 'pullfrog',
    delegatedReviewers,
    superseded = false,
  } = {}
) {
  if (
    !repository ||
    !/^[a-z\d_.-]+\/[a-z\d_.-]+$/i.test(repository) ||
    typeof snapshot.baseRef !== 'string' ||
    !snapshot.baseRef ||
    !isReviewerName(reviewer) ||
    !Number.isSafeInteger(snapshot.number) ||
    snapshot.number < 1 ||
    ![snapshot.head, snapshot.base, snapshot.mergeBase].every(isSha) ||
    input.pull_number !== snapshot.number ||
    (!superseded && input.commit_id !== snapshot.head)
  ) {
    throw new Error(
      'Pullfrog review target differs from the admitted snapshot'
    );
  }

  const marker = receipt(snapshot);
  if (superseded) {
    // A native comment on the reviewed commit lets Pullfrog close this run and detect the newer head.
    return {
      pull_number: snapshot.number,
      commit_id: snapshot.head,
      approved: false,
      request_changes: false,
      comments: [],
      body: [
        'Review incomplete: the PR received a new commit during this review. The latest revision needs a fresh review.',
        marker,
        INCOMPLETE_MARKER,
      ].join('\n\n'),
    };
  }

  const incomplete =
    reviewIncomplete(input.body) ||
    (!input.approved && !input.comments?.length);
  const isAdvisory = ({ body }) =>
    (!incomplete && input.approved === true && !input.request_changes) ||
    ADVISORY.test(body ?? '');
  const comments = input.comments?.map((comment) => {
    const claimed = REVIEWER.exec(comment.body ?? '')?.[1];
    if (
      isReviewerName(claimed) &&
      (claimed === reviewer || delegatedReviewers?.has(claimed))
    )
      return comment;
    const message = comment.body?.replace(REVIEWER, '').trimEnd();
    const body = [message, `Reviewer: \`${reviewer}\``]
      .filter(Boolean)
      .join('\n\n');
    return { ...comment, body };
  });
  const advisory = comments?.filter(isAdvisory) ?? [];
  // Native inline threads count against Pullfrog's next approval. Put advisory
  // notes in the review body so they stay visible without opening a thread.
  const review = {
    ...input,
    ...(comments && {
      comments: comments.filter((comment) => !isAdvisory(comment)),
    }),
    ...(snapshot.ownPullRequest && { approved: false, request_changes: false }),
  };
  if (!incomplete) {
    const requestChanges =
      review.request_changes &&
      (!advisory.length || review.comments.length > 0);
    const verdict = requestChanges
      ? 'Changes requested. See the inline findings.'
      : review.approved === true
        ? 'Approved.'
        : 'Review posted.';
    const body = [verdict, marker];
    if (advisory.length) {
      body.push(
        '**Advisory suggestions**',
        advisory
          .map((comment) => formatAdvisory(comment, snapshot, repository))
          .join('\n')
      );
    }
    const reviewBody = body.join('\n\n');
    // A contradictory advisory-only request cannot become a blocking review.
    if (review.request_changes && !requestChanges) {
      return { ...review, request_changes: false, body: reviewBody };
    }
    return { ...review, body: reviewBody };
  }

  const reason = input.body
    ?.split(/\r?\n/)
    .find((line) => line.startsWith('Review incomplete: '));
  return {
    ...review,
    approved: false,
    request_changes: false,
    body: [
      reason?.slice(0, 160) ?? 'Review incomplete. See the run details.',
      marker,
      INCOMPLETE_MARKER,
    ].join('\n\n'),
  };
}
