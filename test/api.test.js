import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../src/server.js';
import {serve, body, reply} from './helpers.js';

const post = (url, value) =>
  fetch(`${url}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(value),
  });

test('health informa o commit sem consultar o modelo', async t => {
  const url = await serve(
    t,
    createServer({commit: 'abc123', baseUrl: 'http://127.0.0.1:1'}),
  );
  const response = await fetch(`${url}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'ok', commit: 'abc123'});
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/chat`)).status, 405);
});

test('chat encaminha mensagens sem manter histórico', async t => {
  const requests = [];
  const upstream = await serve(t, async (request, response) => {
    assert.equal(request.url, '/api/chat');
    requests.push(await body(request));
    reply(response, {done: true, message: {content: 'Olá!'}});
  });
  const url = await serve(
    t,
    createServer({baseUrl: upstream, model: 'local-test'}),
  );
  for (const message of ['Primeira', 'Segunda']) {
    const response = await post(url, {message});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      reply: 'Olá!',
      model: 'local-test',
    });
  }
  assert.deepEqual(
    requests.map(entry => entry.messages),
    [
      [{role: 'user', content: 'Primeira'}],
      [{role: 'user', content: 'Segunda'}],
    ],
  );
  assert.equal(requests[0].stream, false);
});

test('rejeita entradas inválidas e corpo maior que 16 KB', async t => {
  const url = await serve(t, createServer());
  for (const value of [
    null,
    [],
    {},
    {message: ''},
    {message: '  '},
    {message: 3},
  ]) {
    assert.equal((await post(url, value)).status, 400);
  }
  assert.equal(
    (await fetch(`${url}/chat`, {method: 'POST', body: '{}'})).status,
    415,
  );
  assert.equal(
    (
      await fetch(`${url}/chat`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: '{',
      })
    ).status,
    400,
  );
  assert.equal((await post(url, {message: 'ç'.repeat(9000)})).status, 413);
});

test('retorna 503 quando Ollama não está disponível', async t => {
  const url = await serve(t, createServer({baseUrl: 'http://127.0.0.1:1'}));
  assert.equal((await post(url, {message: 'oi'})).status, 503);
});

test('modelo ausente no Ollama vira 503 com mensagem própria', async t => {
  let status = 404;
  const upstream = await serve(t, (_request, response) =>
    reply(response, {error: 'model not found'}, status),
  );
  const url = await serve(t, createServer({baseUrl: upstream}));
  let response = await post(url, {message: 'oi'});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {error: 'Modelo não encontrado.'});
  status = 500;
  response = await post(url, {message: 'oi'});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {error: 'Modelo indisponível.'});
});

test('retorna 504 no timeout de inferência', async t => {
  const upstream = await serve(t, () => {});
  const url = await serve(t, createServer({baseUrl: upstream, timeoutMs: 30}));
  assert.equal((await post(url, {message: 'oi'})).status, 504);
});

test('rejeita respostas inválidas ou incompletas do modelo', async t => {
  let responseBody;
  const upstream = await serve(t, (_request, response) =>
    reply(response, responseBody),
  );
  const url = await serve(t, createServer({baseUrl: upstream}));
  for (responseBody of [
    {done: true},
    {done: false, message: {content: 'partial'}},
    {done: true, message: {content: ''}},
  ]) {
    assert.equal((await post(url, {message: 'oi'})).status, 502);
  }
});
