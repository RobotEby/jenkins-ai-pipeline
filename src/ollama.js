export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://ollama:11434';
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5-coder:1.5b';

export class ModelError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function chat({
  messages,
  baseUrl = OLLAMA_URL,
  model = OLLAMA_MODEL,
  timeoutMs = 120_000,
  format,
  maxTokens = 256,
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      signal,
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format,
        options: {temperature: 0, num_ctx: 8192, num_predict: maxTokens},
        keep_alive: '5m',
      }),
    });
    if (!response.ok) {
      const message =
        response.status === 404
          ? 'Modelo não encontrado.'
          : 'Modelo indisponível.';
      throw new ModelError(message, 503);
    }
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ModelError('Resposta inválida do modelo.', 502);
    }
    if (
      result.done !== true ||
      typeof result.message?.content !== 'string' ||
      !result.message.content.trim()
    ) {
      throw new ModelError('Resposta inválida do modelo.', 502);
    }
    return result.message.content;
  } catch (error) {
    if (signal.aborted)
      throw new ModelError('Tempo limite do modelo excedido.', 504);
    if (error instanceof ModelError) throw error;
    throw new ModelError('Não foi possível acessar o modelo.', 503);
  }
}
