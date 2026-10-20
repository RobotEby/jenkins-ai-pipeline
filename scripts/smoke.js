import {setTimeout as sleep} from 'node:timers/promises';

export async function smoke({
  baseUrl = 'http://127.0.0.1:3000',
  commit = process.env.EXPECTED_COMMIT || process.env.APP_COMMIT,
  model = process.env.OLLAMA_MODEL,
  attempts = 30,
  delayMs = 1000,
  timeoutMs = 120_000,
} = {}) {
  let healthy = false;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const health = await response.json();
      if (response.ok && health.status === 'ok' && health.commit === commit) {
        healthy = true;
        break;
      }
    } catch {
      /* Waiting for the HTTP process to start. */
    }
    if (attempt + 1 < attempts) await sleep(delayMs);
  }
  if (!healthy)
    throw new Error(
      'Health check falhou ou o commit implantado é diferente do esperado.',
    );
  const response = await fetch(`${baseUrl}/chat`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({message: 'Responda apenas com a palavra OK.'}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (
    !response.ok ||
    typeof body.reply !== 'string' ||
    !body.reply.trim() ||
    body.model !== model
  ) {
    throw new Error('A chamada real ao modelo falhou.');
  }
}

if (import.meta.main) {
  try {
    await smoke();
    console.log('Health check e inferência concluídos.');
  } catch {
    console.error('Verificação da API falhou.');
    process.exitCode = 1;
  }
}
