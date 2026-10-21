import test from 'node:test';
import assert from 'node:assert/strict';
import {deploy} from '../scripts/deploy.js';

function scenario({
  previous = true,
  failCandidate = false,
  failDeploy = false,
  failRollback = false,
  appEnv = ['APP_COMMIT=old-commit'],
} = {}) {
  const calls = [];
  const reports = [];
  let deployed = false;
  const run = (args, env) => {
    calls.push({args, env});
    if (args[0] === 'inspect')
      return JSON.stringify([{Image: 'sha256:old', Config: {Env: appEnv}}]);
    if (args.includes('ps'))
      return deployed ? 'app-new' : previous ? 'app-old' : '';
    if (args.includes('up')) {
      deployed = true;
      return '';
    }
    if (args[0] === 'exec') {
      if (args[3].includes('candidate') && failCandidate)
        throw new Error('candidate failed');
      if (
        args[3] === 'app-new' &&
        args[2] === 'EXPECTED_COMMIT=new-commit' &&
        failDeploy
      )
        throw new Error('deploy failed');
      if (
        args[3] === 'app-new' &&
        args[2] === 'EXPECTED_COMMIT=old-commit' &&
        failRollback
      )
        throw new Error('rollback failed');
    }
    return '';
  };
  return {
    calls,
    reports,
    options: {
      image: 'app:new',
      commit: 'new-commit',
      buildNumber: '1',
      project: 'test-pipeline',
      run,
      report: async value => reports.push(value),
    },
  };
}

test('valida candidata, implanta e verifica antes de registrar sucesso', async () => {
  const s = scenario();
  await deploy(s.options);
  assert.equal(s.reports.at(-1).status, 'deployed');
  const firstUp = s.calls.findIndex(({args}) => args.includes('up'));
  const candidateCheck = s.calls.findIndex(({args}) => args[0] === 'exec');
  assert.ok(candidateCheck < firstUp);
  assert.ok(
    s.calls.some(
      ({args}) => args[0] === 'rm' && args[2] === 'test-pipeline-candidate-1',
    ),
  );
});

test('candidata reprovada não altera aplicação atual', async () => {
  const s = scenario({failCandidate: true});
  await assert.rejects(deploy(s.options), /preservada/);
  assert.equal(s.reports.at(-1).status, 'candidate_failed');
  assert.ok(!s.calls.some(({args}) => args.includes('up')));
});

test('falha após troca restaura imagem anterior e mantém build reprovado', async () => {
  const s = scenario({failDeploy: true});
  await assert.rejects(deploy(s.options), /reprovada/);
  assert.equal(s.reports.at(-1).status, 'rolled_back');
  assert.deepEqual(
    s.calls
      .filter(({args}) => args.includes('up'))
      .map(({env}) => env.APP_IMAGE),
    ['app:new', 'sha256:old'],
  );
});

test('falha da recuperação exige intervenção e primeira implantação remove aplicação inválida', async () => {
  const rollback = scenario({failDeploy: true, failRollback: true});
  await assert.rejects(deploy(rollback.options), /intervenção manual/);
  assert.equal(rollback.reports.at(-1).status, 'rollback_failed');
  const first = scenario({previous: false, failDeploy: true});
  await assert.rejects(deploy(first.options));
  assert.equal(first.reports.at(-1).status, 'failed_first_deploy');
  assert.ok(
    first.calls.some(
      ({args}) => args.includes('--stop') && args.includes('--force'),
    ),
  );
});

test('sem commit da aplicação atual, não inicia implantação', async () => {
  const s = scenario({appEnv: []});
  await assert.rejects(deploy(s.options), /commit anterior/);
  assert.ok(
    !s.calls.some(({args}) => args[0] === 'run' || args.includes('up')),
  );
  assert.equal(s.reports.length, 0);
});
