import http from 'node:http';
import {chat, DEFAULT_MODEL, ModelError} from './ollama.js';

const MAX_BODY = 16 * 1024;

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ModelError('Corpo excede 16 KB.', 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BODY) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ModelError('JSON inválido.', 400));
      }
    });
    request.on('error', () =>
      reject(new ModelError('Requisição interrompida.', 400)),
    );
    request.on('aborted', () =>
      reject(new ModelError('Requisição interrompida.', 400)),
    );
  });
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function createServer({
  baseUrl = process.env.OLLAMA_URL,
  model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
  commit = process.env.APP_COMMIT || 'development',
  timeoutMs = 120_000,
} = {}) {
  const server = http.createServer(async (request, response) => {
    const path = request.url.split('?')[0];
    try {
      if (path === '/health' && request.method === 'GET') {
        json(response, 200, {status: 'ok', commit});
        return;
      }
      if (path === '/chat' && request.method === 'POST') {
        if (
          request.headers['content-type']
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        ) {
          throw new ModelError('Use Content-Type: application/json.', 415);
        }
        const body = await readJson(request);
        if (
          !body ||
          Array.isArray(body) ||
          typeof body.message !== 'string' ||
          !body.message.trim()
        ) {
          throw new ModelError('message deve ser um texto não vazio.', 400);
        }
        const reply = await chat({
          baseUrl,
          model,
          timeoutMs,
          messages: [{role: 'user', content: body.message}],
        });
        json(response, 200, {reply, model});
        return;
      }
      if (path === '/health' || path === '/chat') {
        response.setHeader('Allow', path === '/health' ? 'GET' : 'POST');
        json(response, 405, {error: 'Método não permitido.'});
        return;
      }
      json(response, 404, {error: 'Rota não encontrada.'});
    } catch (error) {
      if (response.destroyed) return;
      if (error.status === 413) response.setHeader('Connection', 'close');
      json(response, error instanceof ModelError ? error.status : 500, {
        error: error instanceof ModelError ? error.message : 'Erro interno.',
      });
    }
  });
  server.requestTimeout = 150_000;
  server.headersTimeout = 10_000;
  return server;
}

if (import.meta.main) {
  const server = createServer();
  server.listen(3000, '0.0.0.0', () =>
    console.log('API ouvindo na porta 3000.'),
  );
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}
