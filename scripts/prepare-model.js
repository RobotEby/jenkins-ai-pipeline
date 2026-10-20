import {setTimeout as sleep} from 'node:timers/promises';
import {DEFAULT_MODEL} from '../src/ollama.js';
import {writeReport} from './reports.js';

export async function prepareModel({
  baseUrl = process.env.OLLAMA_URL || 'http://ollama:11434',
  model = process.env.OLLAMA_MODEL || DEFAULT_MODEL,
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
    body: JSON.stringify({model, stream: false}),
    signal: AbortSignal.timeout(pullTimeoutMs),
  });
  if (!response.ok || (await response.json()).status !== 'success')
    throw new Error('Falha ao baixar o modelo.');
  return {model, downloaded: true};
}

if (import.meta.main) {
  try {
    const result = await prepareModel();
    await writeReport('model', {status: 'ready', ...result});
    console.log(`Modelo pronto: ${result.model}.`);
  } catch {
    await writeReport('model', {status: 'unavailable'});
    console.error(
      'Preparação do modelo falhou; verifique o serviço Ollama e o nome do modelo.',
    );
    process.exitCode = 1;
  }
}
