import {setTimeout as sleep} from 'node:timers/promises';
import {OLLAMA_MODEL, OLLAMA_URL} from '../src/ollama.js';
import {writeReport} from './reports.js';

export async function prepareModel({
  baseUrl = OLLAMA_URL,
  model = OLLAMA_MODEL,
  attempts = 30,
  delayMs = 2000,
  pullTimeoutMs = 1_200_000,
} = {}) {
  let models;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!Array.isArray(body.models)) throw new Error();
      models = body.models;
      break;
    } catch {
      if (attempt + 1 < attempts) await sleep(delayMs);
    }
  }
  if (!models) throw new Error('Ollama não ficou disponível.');
  const canonicalName = model.includes(':') ? model : `${model}:latest`;
  if (
    models.some(
      entry => entry.name === canonicalName || entry.model === canonicalName,
    )
  )
    return {model, downloaded: false};
  const response = await fetch(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    // Streamed progress keeps fetch's 300 s header and idle timeouts from aborting long downloads.
    body: JSON.stringify({model}),
    signal: AbortSignal.timeout(pullTimeoutMs),
  });
  const last = (await response.text()).trim().split('\n').at(-1);
  if (!response.ok || JSON.parse(last).status !== 'success')
    throw new Error('Falha ao baixar o modelo.');
  return {model, downloaded: true};
}

if (import.meta.main) {
  try {
    const result = await prepareModel();
    await writeReport('model', {status: 'ready', ...result});
    console.log(`Modelo pronto: ${result.model}.`);
  } catch (error) {
    await writeReport('model', {status: 'unavailable'});
    console.error(
      `Preparação do modelo falhou; verifique o serviço Ollama e o nome do modelo. ${error.message}`,
    );
    process.exitCode = 1;
  }
}
