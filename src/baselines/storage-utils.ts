import { randomUUID } from 'crypto';
import { link, unlink, writeFile } from 'fs/promises';
import * as path from 'path';

const SAFE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
export const SHA256 = /^[a-f0-9]{64}$/;

export function validateStoreName(kind: string, name: string): void {
  if (
    !SAFE_NAME.test(name) ||
    name === '.' ||
    name === '..' ||
    path.basename(name) !== name
  ) {
    throw new Error(
      `Unsafe ${kind} "${name}"; use 1-128 letters, numbers, dots, underscores, or hyphens`
    );
  }
}

export async function writeExclusiveAtomic(
  destination: string,
  contents: string
): Promise<boolean> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' });
  try {
    await link(temporary, destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}
