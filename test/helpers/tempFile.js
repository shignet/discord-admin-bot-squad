import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function makeTempFile(name, contents) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dab-test-'));
  const filePath = path.join(dir, name);
  await writeFile(filePath, contents, 'utf8');
  return {
    dir,
    filePath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
