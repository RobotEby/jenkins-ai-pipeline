import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareModel} from '../scripts/prepare-model.js';
import {smoke} from '../scripts/smoke.js';
import {createServer} from '../src/server.js';
import {serve, body, reply} from './helpers.js';

test('preparação reutiliza modelo disponível sem novo download', async t => {
  const calls = [];
  const baseUrl = await serve(t, (request, response) => {
    calls.push(request.url);
    reply(response, {models: [{name: 'test:latest'}]});
  });
  assert.deepEqual(await prepareModel({baseUrl, model: 'test'}), {
    model: 'test',
    downloaded: false,
  });
  assert.deepEqual(calls, ['/api/tags']);
});

test('preparação aguarda Ollama e baixa modelo ausente', async t => {
  let tags = 0;
  let pull;
  const baseUrl = await serve(t, async (request, response) => {
    if (request.url === '/api/tags') {
      tags++;
      reply(response, {models: []}, tags === 1 ? 503 : 200);
    } else {
      assert.equal(request.url, '/api/pull');
      pull = await body(request);
      response.end('{"status":"pulling manifest"}\n{"status":"success"}\n');
    }
  });
  assert.equal(
    (await prepareModel({baseUrl, model: 'test:1b', delayMs: 1})).downloaded,
    true,
  );
  assert.deepEqual(pull, {model: 'test:1b'});
});

test('preparação informa indisponibilidade e download reprovado', async t => {
  await assert.rejects(
    prepareModel({baseUrl: 'http://127.0.0.1:1', attempts: 1}),
    /não ficou disponível/,
  );
  const baseUrl = await serve(t, (request, response) =>
    reply(
      response,
      request.url === '/api/tags' ? {models: []} : {error: 'not found'},
    ),
  );
  await assert.rejects(prepareModel({baseUrl, model: 'missing'}), /baixar/);
});

test('smoke exige commit correto e inferência funcional', async t => {
  let available = true;
  const upstream = await serve(t, (_request, response) =>
    reply(
      response,
      {done: true, message: {content: 'OK'}},
      available ? 200 : 503,
    ),
  );
  const baseUrl = await serve(
    t,
    createServer({baseUrl: upstream, model: 'test', commit: 'abc'}),
  );
  await smoke({baseUrl, model: 'test', commit: 'abc', attempts: 1});
  await assert.rejects(
    smoke({baseUrl, model: 'test', commit: 'wrong', attempts: 1}),
    /commit/,
  );
  available = false;
  await assert.rejects(
    smoke({baseUrl, model: 'test', commit: 'abc', attempts: 1}),
    /modelo falhou/,
  );
});

test('smoke usa o mesmo modelo padrão do servidor', async t => {
  const upstream = await serve(t, (_request, response) =>
    reply(response, {done: true, message: {content: 'OK'}}),
  );
  const baseUrl = await serve(
    t,
    createServer({baseUrl: upstream, commit: 'abc'}),
  );
  await smoke({baseUrl, commit: 'abc', attempts: 1});
});

test('smoke informa status e erro da API quando a inferência falha', async t => {
  const upstream = await serve(t, (_request, response) =>
    reply(response, {error: 'model not found'}, 404),
  );
  const baseUrl = await serve(
    t,
    createServer({baseUrl: upstream, model: 'test', commit: 'abc'}),
  );
  await assert.rejects(
    smoke({baseUrl, model: 'test', commit: 'abc', attempts: 1}),
    /HTTP 503: Modelo não encontrado/,
  );
});
