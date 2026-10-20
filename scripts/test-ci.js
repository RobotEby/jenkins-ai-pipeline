import {mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {writeReport} from './reports.js';

await mkdir('reports', {recursive: true});
const result = spawnSync(
  process.execPath,
  [
    '--test',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    '--test-reporter-destination=reports/tests.xml',
    'test/*.test.js',
  ],
  {stdio: 'inherit'},
);
const passed = result.status === 0 && !result.error;
await writeReport('tests', {
  status: passed ? 'passed' : 'failed',
  exitCode: result.status,
});
process.exitCode = passed ? 0 : 1;
