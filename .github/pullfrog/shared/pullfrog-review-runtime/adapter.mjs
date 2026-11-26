import { realpath, appendFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadAdapter(root, path) {
  if (
    typeof path !== 'string' ||
    !path.startsWith('.github/pullfrog/') ||
    !/^[\w./-]+\.mjs$/.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Invalid trusted Pullfrog adapter path');
  }
  const trusted = await realpath(root);
  const file = await realpath(resolve(trusted, path));
  const inside = relative(trusted, file);
  if (inside.startsWith('..') || isAbsolute(inside))
    throw new Error('Adapter must be inside the trusted checkout');
  return import(pathToFileURL(file).href);
}

export async function planAdapter(adapter, snapshot, trusted) {
  const plan = snapshot
    ? await adapter.plan(snapshot, trusted)
    : await adapter.planGeneral(trusted);
  if (!plan) return;
  if (
    typeof plan.sparse !== 'string' ||
    !plan.sparse ||
    (snapshot &&
      (!Array.isArray(plan.policy?.guidance) ||
        !Array.isArray(plan.policy?.reviewers)))
  )
    throw new Error('Invalid repository review plan');
  return plan;
}

if (
  process.argv[2] === 'plan' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const adapter = await loadAdapter(
    process.cwd(),
    process.env.PULLFROG_ADAPTER
  );
  const plan = await planAdapter(
    adapter,
    process.env.PULLFROG_SNAPSHOT
      ? JSON.parse(process.env.PULLFROG_SNAPSHOT)
      : undefined,
    process.env.GITHUB_SHA
  );
  if (!plan && process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      'Skipped Pullfrog review because trusted repository guidance differs.\n'
    );
  }
  await appendFile(
    process.env.GITHUB_OUTPUT,
    'ready=' +
      Boolean(plan) +
      '\nsparse=' +
      JSON.stringify(plan?.sparse ?? '') +
      '\n'
  );
}
