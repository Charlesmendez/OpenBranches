import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = join(import.meta.dirname, '../src/ui');

describe('UI energy use', () => {
  it('reserves infinite animation for transient loading indicators', async () => {
    const files = (await readdir(ui, { recursive: true }))
      .filter((path) => path.endsWith('.css'))
      .sort();
    const animations: Array<{ file: string; value: string }> = [];

    for (const file of files) {
      const path = join(ui, file);
      const css = await readFile(path, 'utf8');
      for (const match of css.matchAll(/animation:\s*([^;]*\binfinite\b)[^;]*;/g))
        animations.push({ file: relative(ui, path), value: match[1].trim() });
    }

    expect(animations).toEqual([{ file: 'styles.css', value: 'spin 1s linear infinite' }]);
  });
});
