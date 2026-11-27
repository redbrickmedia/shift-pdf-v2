import { readReviewRevision } from '../pullfrog-review-gate/gate.mjs';

// The installation token stays in the trusted guard process. The agent receives
// only its existing local guard URL, never a new GitHub credential.
export function reviewLifecycle(
  snapshot,
  context,
  github,
  cancellationGithub,
  onCancelError = () => {}
) {
  let closed = false;
  let cancelled = false;
  let pending;
  return {
    refresh() {
      if (pending) return pending;
      pending = (async () => {
        const revision = closed
          ? { state: 'closed' }
          : await readReviewRevision(snapshot, context, github);
        if (revision.state !== 'closed') return revision;
        // Closing ends this review even if someone subsequently reopens the PR.
        closed = true;
        if (!cancelled) {
          try {
            await cancellationGithub.request(
              '/actions/runs/' + context.runId + '/cancel',
              { method: 'POST', empty: true }
            );
            cancelled = true;
          } catch {
            // Remain closed to tools and retry on the next poll. A transport
            // failure must never restore the ability to publish or reopen.
            onCancelError();
          }
        }
        return { state: 'closed' };
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

export function watchReviewLifecycle(
  lifecycle,
  timers = { setInterval, clearInterval }
) {
  const poll = () => lifecycle.refresh().catch(() => {});
  const timer = timers.setInterval(poll, 15_000);
  timer.unref?.();
  void poll();
  return () => timers.clearInterval(timer);
}
