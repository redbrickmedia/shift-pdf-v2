import { writeFile } from 'node:fs/promises';
import { conciseReview } from '../review-output.mjs';

const reviewModePath = new URL('../review-mode', import.meta.url);

export default {
  id: 'shift-pullfrog-review-output',
  async setup(ctx) {
    const reviewers = new Set();
    await ctx.tool.hook('execute.after', async ({ tool, status, input }) => {
      if (status !== 'completed') return;
      if (tool === 'subagent' && typeof input?.agent === 'string')
        reviewers.add(input.agent);
      if (
        /(?:^|[/:._-])select_mode$/.test(tool) &&
        /^(Review|IncrementalReview)$/i.test(input?.mode)
      ) {
        // Pullfrog accepts the first mode selection and refuses later switches.
        await writeFile(reviewModePath, input.mode.toLowerCase(), {
          flag: 'wx',
        }).catch((error) => {
          if (error.code !== 'EEXIST')
            console.warn('Could not record the native Pullfrog review mode.');
        });
      }
    });
    await ctx.tool.hook('execute.before', async (event) => {
      if (/(?:^|[/:._-])reopen_current$/.test(event.tool))
        throw new Error('Review runs must never reopen a closed PR');
      const checkout = /(?:^|[/:._-])checkout_pr$/.test(event.tool);
      const publish = /(?:^|[/:._-])create_pull_request_review$/.test(
        event.tool
      );
      if (!checkout && !publish) return;
      if (!process.env.PULLFROG_CONTEXT_URL)
        throw new Error('Missing the live Pullfrog review guard');
      const guard = await fetch(process.env.PULLFROG_CONTEXT_URL, {
        signal: AbortSignal.timeout(35_000),
      });
      if (guard.status === 410)
        throw new Error('The PR closed; this review has been stopped');
      if (guard.status !== 204 && (!publish || guard.status !== 412))
        throw new Error('The review revision is no longer eligible');
      if (!publish) return;
      event.input = conciseReview(
        event.input,
        JSON.parse(process.env.PULLFROG_SNAPSHOT),
        {
          repository: process.env.GITHUB_REPOSITORY,
          reviewer: process.env.PULLFROG_LEAD_REVIEWER || 'pullfrog',
          delegatedReviewers: reviewers,
          superseded: guard.status === 412,
        }
      );
    });
  },
};
