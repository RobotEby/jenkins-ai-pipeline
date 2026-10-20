import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {
  collectReviewInput,
  relevantFile,
  review,
  validateReview,
} from '../scripts/review.js';
import {serve, body, reply} from './helpers.js';

function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'pipeline-review-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Tests');
  const write = (name, text) => {
    mkdirSync(dirname(join(cwd, name)), {recursive: true});
    writeFileSync(join(cwd, name), text);
  };
  const commit = () => {
    git('add', '.');
    git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  return {cwd, git, write, commit};
}

test('snapshot inclui código versionado e exclui segredos, gerados e arquivos não versionados', t => {
  const r = repo(t);
  r.write('src/app.js', 'const value = 1;');
  r.write('.env', 'PASSWORD=hidden');
  r.write('credentials.json', '{"password":"hidden"}');
  r.write('dist/bundle.js', 'generated');
  r.write('package-lock.json', '{"lockfileVersion":3}');
  r.commit();
  r.write('src/untracked.js', 'untracked');
  const input = collectReviewInput({cwd: r.cwd, baseCommit: ''});
  assert.deepEqual(input.files, ['src/app.js']);
  assert.equal(input.mode, 'snapshot');
  assert.doesNotMatch(input.text, /hidden|generated|untracked/);
  assert.equal(relevantFile('config/private-key.json'), false);
});

test('diff cobre todos os commits desde o último sucesso, incluindo exclusões', t => {
  const r = repo(t);
  r.write('src/a.js', 'old');
  r.write('src/remove.js', 'remove me');
  r.write('src/unchanged.js', 'same');
  const baseCommit = r.commit();
  r.write('src/a.js', 'new');
  r.commit();
  unlinkSync(join(r.cwd, 'src/remove.js'));
  r.commit();
  const input = collectReviewInput({cwd: r.cwd, baseCommit});
  assert.deepEqual(input.files, ['src/a.js', 'src/remove.js']);
  assert.equal(input.mode, 'diff');
  assert.match(input.text, /-old/);
  assert.match(input.text, /\+new/);
  assert.match(input.text, /deleted file/);
  assert.equal(
    collectReviewInput({cwd: r.cwd, baseCommit: 'a'.repeat(40)}).mode,
    'snapshot',
  );
});

test('entrada é limitada e tokens conhecidos são removidos', t => {
  const r = repo(t);
  r.write(
    'src/a.js',
    `const token = 'ghp_${'a'.repeat(36)}';\n${'x'.repeat(15_000)}`,
  );
  r.commit();
  const input = collectReviewInput({cwd: r.cwd, baseCommit: ''});
  assert.equal(input.text.length, 12_000);
  assert.equal(input.partial, true);
  assert.match(input.text, /TOKEN REMOVIDO/);
  assert.doesNotMatch(input.text, /ghp_/);
});

test('validação rejeita formatos errados e arquivos inventados', () => {
  for (const value of [
    null,
    {},
    {summary: '', findings: []},
    {
      summary: 'Resumo',
      findings: [{file: 'invented.js', severity: 'alta', suggestion: 'fix'}],
    },
    {
      summary: 'Resumo',
      findings: [{file: 'app.js', severity: 'unknown', suggestion: 'fix'}],
    },
  ]) {
    assert.throws(() => validateReview(value, ['app.js']));
  }
});

test('revisão usa saída estruturada e trata resposta inválida como indisponível', async t => {
  const r = repo(t);
  r.write('src/app.js', 'console.log("hello");');
  r.commit();
  let content = JSON.stringify({summary: 'Código simples.', findings: []});
  const baseUrl = await serve(t, async (request, response) => {
    const input = await body(request);
    assert.equal(input.format.type, 'object');
    assert.equal(input.options.temperature, 0);
    reply(response, {done: true, message: {content}});
  });
  assert.equal(
    (await review({cwd: r.cwd, baseCommit: '', baseUrl})).status,
    'completed',
  );
  content = 'not JSON';
  assert.equal(
    (await review({cwd: r.cwd, baseCommit: '', baseUrl})).status,
    'unavailable',
  );
  assert.equal(
    (await review({cwd: r.cwd, baseCommit: '', baseUrl: 'http://127.0.0.1:1'}))
      .status,
    'unavailable',
  );
});
