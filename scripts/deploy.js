import {execFileSync} from 'node:child_process';
import {OLLAMA_MODEL, OLLAMA_URL} from '../src/ollama.js';
import {writeReport} from './reports.js';

function docker(args, env = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 2 * 1024 * 1024,
    env: {...process.env, ...env},
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export async function deploy({
  image = process.env.APP_IMAGE,
  commit = process.env.GIT_COMMIT,
  buildNumber = process.env.BUILD_NUMBER || 'manual',
  project = process.env.COMPOSE_PROJECT_NAME || 'jenkins-ai-pipeline',
  baseUrl = OLLAMA_URL,
  model = OLLAMA_MODEL,
  run = docker,
  report = value => writeReport('deployment', value),
} = {}) {
  if (
    !image ||
    !commit ||
    !/^[a-zA-Z0-9_.-]+$/.test(buildNumber) ||
    !/^[a-z0-9][a-z0-9_-]*$/.test(project)
  ) {
    throw new Error('Configuração de implantação inválida.');
  }
  const compose = [
    'compose',
    '--project-name',
    project,
    '--file',
    'compose.yaml',
  ];
  const candidate = `${project}-candidate-${buildNumber}`;
  const verify = (container, expectedCommit) =>
    run([
      'exec',
      '-e',
      `EXPECTED_COMMIT=${expectedCommit}`,
      container,
      'node',
      'scripts/smoke.js',
    ]);
  const previousContainer = run([...compose, 'ps', '-q', 'app']);
  let previousImage;
  let previousCommit;
  if (previousContainer) {
    const [previous] = JSON.parse(run(['inspect', previousContainer]));
    previousImage = previous.Image;
    previousCommit = previous.Config.Env.find(entry =>
      entry.startsWith('APP_COMMIT='),
    )?.slice('APP_COMMIT='.length);
    if (!previousCommit)
      throw new Error(
        'Não foi possível identificar o commit anterior para recuperação.',
      );
  }
  const metadata = {image, commit, previousImage: previousImage || null};
  await report({...metadata, status: 'checking_candidate'});
  console.log('Verificando imagem candidata com inferência real.');
  try {
    run([
      'run',
      '-d',
      '--name',
      candidate,
      '--network',
      `${project}_default`,
      '-e',
      `OLLAMA_URL=${baseUrl}`,
      '-e',
      `OLLAMA_MODEL=${model}`,
      image,
    ]);
    verify(candidate, commit);
  } catch (error) {
    console.error(error.stderr?.trim() || error.message);
    await report({...metadata, status: 'candidate_failed'});
    throw new Error('Imagem candidata reprovada; aplicação atual preservada.');
  } finally {
    try {
      run(['rm', '-f', candidate]);
    } catch {
      console.error('Não foi possível remover o contêiner candidato.');
    }
  }
  const up = targetImage =>
    run(
      [
        ...compose,
        'up',
        '-d',
        '--no-deps',
        '--wait',
        '--wait-timeout',
        '60',
        'app',
      ],
      {APP_IMAGE: targetImage},
    );
  try {
    await report({...metadata, status: 'deploying'});
    console.log('Atualizando aplicação e verificando a implantação.');
    up(image);
    verify(run([...compose, 'ps', '-q', 'app']), commit);
    await report({...metadata, status: 'deployed'});
    console.log('Implantação concluída.');
  } catch (error) {
    console.error(error.stderr?.trim() || error.message);
    if (previousImage) {
      console.log('Falha na implantação; restaurando a imagem anterior.');
      try {
        up(previousImage);
        verify(run([...compose, 'ps', '-q', 'app']), previousCommit);
        await report({...metadata, status: 'rolled_back'});
      } catch {
        await report({...metadata, status: 'rollback_failed'});
        throw new Error(
          'Implantação e recuperação falharam; intervenção manual necessária.',
        );
      }
    } else {
      try {
        run([...compose, 'rm', '--stop', '--force', 'app']);
      } catch {
        console.error(
          'Não foi possível remover o contêiner de aplicativo com falha.',
        );
      }
      await report({...metadata, status: 'failed_first_deploy'});
    }
    throw new Error('Implantação reprovada. Consulte reports/deployment.json.');
  }
}

if (import.meta.main) {
  try {
    await deploy();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
