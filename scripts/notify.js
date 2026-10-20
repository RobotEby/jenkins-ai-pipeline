import {setTimeout as sleep} from 'node:timers/promises';
import {readReport, writeReport} from './reports.js';

function short(value, limit) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, limit);
}

export function notificationPayload({
  result,
  commit,
  buildUrl,
  testSummary,
  tests,
  review,
  deployment,
}) {
  const lines = [
    `**CI/CD: ${short(result || 'UNKNOWN', 30)}**`,
    `Commit: ${short(commit || 'não disponível', 40)}`,
    `Testes: ${short(testSummary || tests?.status || 'não executados', 140)}`,
    `Implantação: ${short(deployment?.status || 'não executada', 100)}`,
    `IA: ${short(review?.status || 'não executada', 40)}${review?.partial ? ' (análise parcial)' : ''}`,
    short(review?.summary || 'Sem revisão disponível.', 350),
    ...(review?.findings || [])
      .slice(0, 3)
      .map(
        finding =>
          `• ${short(finding.severity, 10)} | ${short(finding.file, 100)}: ${short(finding.suggestion, 160)}`,
      ),
    `Build: ${short(buildUrl || 'não disponível', 350)}`,
  ];
  return {
    content: lines.join('\n').slice(0, 2000),
    allowed_mentions: {parse: []},
  };
}

export async function sendNotification(
  webhookUrl,
  payload,
  {attempts = 3, timeoutMs = 10_000, delayMs = 1000} = {},
) {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (attempt + 1 === attempts) break;
      await sleep(delayMs);
      continue;
    }
    if (response.ok) {
      await response.body?.cancel();
      return;
    }
    if (response.status !== 429 && response.status < 500) {
      await response.body?.cancel();
      throw new Error(
        `Discord rejeitou a notificação (HTTP ${response.status}).`,
      );
    }
    let waitMs = delayMs;
    if (response.status === 429) {
      try {
        const body = await response.json();
        if (Number.isFinite(body.retry_after))
          waitMs = Math.ceil(body.retry_after * 1000);
      } catch {
        /* A response without `retry_after` uses the default interval. */
      }
    } else {
      await response.body?.cancel();
    }
    if (attempt + 1 === attempts || waitMs > 30_000) break;
    await sleep(Math.max(0, waitMs));
  }
  throw new Error(
    'Não foi possível entregar a notificação após tentativas limitadas.',
  );
}

if (import.meta.main) {
  try {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (!webhookUrl)
      throw new Error('Credencial discord-webhook-url não configurada.');
    const url = new URL(webhookUrl);
    if (
      url.protocol !== 'https:' ||
      ![
        'discord.com',
        'discordapp.com',
        'canary.discord.com',
        'ptb.discord.com',
      ].includes(url.hostname) ||
      !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+$/.test(url.pathname)
    ) {
      throw new Error('Configure uma URL HTTPS de webhook do Discord válida.');
    }
    const [tests, review, deployment] = await Promise.all(
      ['tests', 'review', 'deployment'].map(readReport),
    );
    const payload = notificationPayload({
      result: process.env.BUILD_RESULT,
      commit: process.env.GIT_COMMIT,
      buildUrl: process.env.BUILD_URL,
      testSummary: process.env.TEST_SUMMARY,
      tests,
      review,
      deployment,
    });
    await sendNotification(webhookUrl, payload);
    await writeReport('notification', {status: 'sent'});
    console.log('Relatório enviado ao Discord.');
  } catch {
    await writeReport('notification', {status: 'failed'});
    console.error(
      'Notificação não entregue. Verifique a credencial discord-webhook-url, a rede e os limites do Discord.',
    );
    process.exitCode = 1;
  }
}
