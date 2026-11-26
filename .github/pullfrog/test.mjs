import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = ['pullfrog-review-gate', 'pullfrog-review-runtime'].flatMap(
  (name) => {
    const directory = new URL('./shared/' + name + '/', import.meta.url);
    return readdirSync(directory)
      .filter((file) => file.endsWith('.test.mjs'))
      .map((file) => fileURLToPath(new URL(file, directory)));
  }
);
const result = spawnSync(process.execPath, ['--test', ...tests], {
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
