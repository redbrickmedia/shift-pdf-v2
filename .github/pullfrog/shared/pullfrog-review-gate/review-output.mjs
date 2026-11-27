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

function incompleteReason(body) {
  let fence;
  let htmlComment = false;
  for (const line of (body ?? '').split(/\r?\n/)) {
    const delimiter = /^[ ]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        delimiter &&
        delimiter[1][0] === fence[0] &&
        delimiter[1].length >= fence.length &&
        !delimiter[2].trim()
      )
        fence = undefined;
      continue;
    }
    if (
      !htmlComment &&
      delimiter &&
      (delimiter[1][0] !== '`' || !delimiter[2].includes('`'))
    ) {
      fence = delimiter[1];
      continue;
    }
    // This is a line-based status protocol, not Markdown rendering. Outside
    // fenced examples, an explicit warning is authoritative even in metadata
    // or an ambiguous inline span. Formatting must never hide missing coverage.
    if (/^Review incomplete:/.test(line)) return line;
    // Fences inside metadata are not examples. Delimiters inside a fenced
    // example were skipped above, so they cannot hide later real warnings.
    for (const token of line.matchAll(/<!--|-->/g)) {
      if (token[0] === '<!--' && !htmlComment) htmlComment = true;
      else if (token[0] === '-->' && htmlComment) htmlComment = false;
    }
  }
}

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

  const paragraphs = (input.body ?? '')
    .replace(REVIEWER, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^#{1,6}[\t ]+[^\r\n]*(?:\r?\n|$)/gm, '\n')
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const summary = paragraphs[0];
  const reason = incompleteReason(input.body);
  const incomplete =
    reviewIncomplete(input.body) ||
    Boolean(reason) ||
    (!input.approved && !input.comments?.length && !summary);
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
    const advisoryOnlyBody =
      !comments?.length &&
      paragraphs.length > 0 &&
      paragraphs.every((paragraph) => ADVISORY.test(paragraph));
    const requestChanges =
      review.request_changes &&
      !advisoryOnlyBody &&
      (!advisory.length || review.comments.length > 0);
    const verdict = requestChanges
      ? 'Changes requested.' +
        (review.comments?.length ? ' See the inline findings.' : '')
      : review.approved === true
        ? 'Approved.'
        : 'Review posted.';
    const body = [verdict, marker];
    if (!input.approved && !comments?.length && summary) {
      const claimed = REVIEWER.exec(input.body ?? '')?.[1];
      const noteReviewer =
        isReviewerName(claimed) &&
        (claimed === reviewer || delegatedReviewers?.has(claimed))
          ? claimed
          : reviewer;
      const note = requestChanges
        ? input.body.replace(REVIEWER, '').trim()
        : summary.length > 1200
          ? summary.slice(0, 1200).trimEnd() + '…'
          : summary;
      body.push('**Reviewer note**', note, `Reviewer: \`${noteReviewer}\``);
    }
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
