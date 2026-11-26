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
  let codeSpan;
  const lines = (body ?? '').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) codeSpan = undefined;
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
      codeSpan = undefined;
      continue;
    }
    // Comment delimiters inside fenced examples are literal text. Only track
    // metadata comments after the fence checks, across lines when necessary.
    let visible = '';
    let offset = 0;
    while (offset < line.length) {
      if (codeSpan) {
        const close = [...line.slice(offset).matchAll(/`+/g)].find(
          (match) => match[0].length === codeSpan
        );
        if (!close) break;
        offset += close.index + close[0].length;
        codeSpan = undefined;
        continue;
      }
      const token = htmlComment ? undefined : /<!--|`+/g;
      if (token) token.lastIndex = offset;
      const next = token?.exec(line);
      const boundary = htmlComment
        ? line.indexOf('-->', offset)
        : (next?.index ?? -1);
      if (boundary < 0) {
        if (!htmlComment) visible += line.slice(offset);
        break;
      }
      if (!htmlComment) visible += line.slice(offset, boundary);
      if (next?.[0].startsWith('`')) {
        const ticks = next[0];
        let slashes = 0;
        while (line[boundary - slashes - 1] === '\\') slashes++;
        // A code span must have an exact-length closing run in this paragraph.
        // Unmatched and escaped ticks stay literal rather than hiding warnings.
        const tail = [line.slice(boundary + ticks.length)];
        for (const following of lines.slice(index + 1)) {
          if (!following.trim() || /^[ ]{0,3}(?:`{3,}|~{3,})/.test(following))
            break;
          tail.push(following);
        }
        if (
          slashes % 2 === 0 &&
          [...tail.join('\n').matchAll(/`+/g)].some(
            (match) => match[0].length === ticks.length
          )
        )
          codeSpan = ticks.length;
        else visible += ticks;
        offset = boundary + ticks.length;
        continue;
      }
      offset = boundary + (htmlComment ? 3 : 4);
      htmlComment = !htmlComment;
    }
    if (/^Review incomplete:/.test(visible)) return visible;
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
