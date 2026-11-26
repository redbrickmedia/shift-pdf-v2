import { resolve } from 'node:path';
const reviewerModel = 'opencode-go/deepseek-v4.1-flash#max';

export function configureReviewNesting(config, reviewers, assignmentPath) {
  if (
    !Array.isArray(reviewers) ||
    reviewers.some(
      (name) => typeof name !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(name)
    )
  ) {
    throw new Error('Invalid Pullfrog specialist roster');
  }
  const roster = [...new Set(reviewers)];
  config.experimental = {
    todo: true,
    ...config.experimental,
    subagent_depth: 2,
  };
  if (roster.length < 2) return;

  config.instructions = [
    ...new Set([...(config.instructions ?? []), resolve(assignmentPath)]),
  ];
  return [
    'The lead reviewer will launch ' + roster.join(', ') + ' in parallel.',
    'Include that roster in each delegation prompt. As a subagent, leave those assignments with the lead and launch only the remaining specialists your role requires.',
    'Report specialist results and coverage gaps to the lead. The lead collects all required results before submitting the review.',
    '',
  ].join('\n');
}

export function configureReviewAgents(config, reviewers, leadReviewer) {
  for (const agent of Object.values(config.agents ?? {})) {
    if (agent.mode === 'subagent') agent.model = reviewerModel;
  }
  if (!leadReviewer) return;
  const lead = config.agents?.[leadReviewer];
  if (
    reviewers.length !== 1 ||
    reviewers[0] !== leadReviewer ||
    lead?.mode !== 'subagent'
  ) {
    throw new Error(
      'Expected the sole assigned Pullfrog reviewer to be a configured subagent'
    );
  }
  lead.mode = 'primary';
  config.default_agent = leadReviewer;
}
