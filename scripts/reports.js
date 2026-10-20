import {mkdir, readFile, writeFile} from 'node:fs/promises';

export async function writeReport(name, data) {
  await mkdir('reports', {recursive: true});
  await writeFile(`reports/${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

export async function readReport(name) {
  try {
    return JSON.parse(await readFile(`reports/${name}.json`, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
