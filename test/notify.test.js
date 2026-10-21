import test from 'node:test';
import assert from 'node:assert/strict';
import {
  notificationPayload,
  sendNotification,
  validateWebhookUrl,
} from '../scripts/notify.js';
import {serve, body, reply} from './helpers.js';

test('mensagem é limitada, inclui resultados e desabilita menções', () => {
  const payload = notificationPayload({
    result: 'FAILURE',
    commit: 'abc',
    buildUrl: 'http://localhost:8080/job/test/1/',
    tests: {status: 'failed'},
    deployment: {status: 'rolled_back'},
    review: {
      status: 'completed',
      partial: true,
      summary: '@everyone'.repeat(500),
      findings: Array(5).fill({
        file: 'a'.repeat(500),
        severity: 'alta',
        suggestion: 'x'.repeat(2000),
      }),
    },
  });
  assert.ok(payload.content.length <= 2000);
  assert.match(payload.content, /FAILURE/);
  assert.match(payload.content, /failed/);
  assert.match(payload.content, /rolled_back/);
  assert.match(payload.content, /análise parcial/);
  assert.match(payload.content, /http:\/\/localhost:8080/);
  assert.deepEqual(payload.allowed_mentions, {parse: []});
});

test('notificação confirma entrega e repete 429 e erro temporário', async t => {
  let calls = 0;
  const payload = notificationPayload({result: 'SUCCESS'});
  const baseUrl = await serve(t, async (request, response) => {
    calls++;
    assert.match(request.url, /wait=true/);
    assert.deepEqual(await body(request), payload);
    if (calls === 1) reply(response, {retry_after: 0.001}, 429);
    else if (calls === 2) reply(response, {}, 503);
    else reply(response, {id: 'delivered'});
  });
  await sendNotification(`${baseUrl}/webhook`, payload, {delayMs: 1});
  assert.equal(calls, 3);
});

test('não repete credencial inválida nem expõe URL secreta', async t => {
  let calls = 0;
  const baseUrl = await serve(t, (_request, response) => {
    calls++;
    reply(response, {}, 401);
  });
  await assert.rejects(
    sendNotification(`${baseUrl}/secret-token`, {}, {delayMs: 1}),
    error => {
      assert.match(error.message, /401/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('limita tentativas e timeout sem revelar credenciais', async t => {
  const baseUrl = await serve(t, () => {});
  await assert.rejects(
    sendNotification(
      `${baseUrl}/secret`,
      {},
      {attempts: 2, timeoutMs: 20, delayMs: 1},
    ),
    /tentativas limitadas/,
  );
});

test('aceita apenas URLs HTTPS de webhook do Discord', () => {
  for (const value of [
    'https://discord.com/api/webhooks/123/token',
    'https://ptb.discord.com/api/v10/webhooks/123/token',
  ]) {
    assert.equal(validateWebhookUrl(value), value);
  }
  for (const value of [
    undefined,
    '',
    'not a url',
    'http://discord.com/api/webhooks/123/token',
    'https://discord.com.evil.example/api/webhooks/123/token',
    'https://evil.example/api/webhooks/123/token',
    'https://discord.com/api/webhooks/abc/token',
    'https://discord.com/api/webhooks/123/token/extra',
  ]) {
    assert.throws(() => validateWebhookUrl(value), value);
  }
});
