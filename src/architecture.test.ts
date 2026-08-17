import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findForbiddenGlobals, findForbiddenImports } from './architecture';

const DOMAIN_DIR = path.resolve(import.meta.dirname, 'domain');

function sourceFilesUnder(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFilesUnder(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

describe('purity checker', () => {
  it('flags an import that escapes the domain layer', () => {
    const source = "import { render } from '@presentation/Chart';\n";
    expect(findForbiddenImports(source)).toEqual(['@presentation/Chart']);
  });

  it('flags a node builtin import', () => {
    expect(findForbiddenImports("import fs from 'node:fs';\n")).toEqual(['node:fs']);
  });

  it('allows imports inside the domain layer', () => {
    const source = "import { Car } from './Car';\nimport { Doors } from '@domain/sim/Doors';\n";
    expect(findForbiddenImports(source)).toEqual([]);
  });

  it('flags unseeded randomness and clock reads', () => {
    expect(findForbiddenGlobals('const x = Math.random();')).toEqual(['Math.random']);
    expect(findForbiddenGlobals('const t = Date.now();')).toEqual(['Date.now']);
  });

  it('ignores forbidden names that only appear in comments', () => {
    const source = '// never call Math.random here\n/* nor Date.now */\nconst x = 1;';
    expect(findForbiddenGlobals(source)).toEqual([]);
  });

  it('does not flag a seeded prng that merely mentions randomness in an identifier', () => {
    expect(findForbiddenGlobals('const seeded = nextRandom(state);')).toEqual([]);
  });
});

describe('domain layer purity', () => {
  // vitest fails an `it.each` over an empty list, so this guard cannot quietly pass over zero
  // files if the domain directory ever moves or empties.
  const files = sourceFilesUnder(DOMAIN_DIR);

  it.each(files.map((file) => [path.relative(DOMAIN_DIR, file), file] as const))(
    'domain/%s stays pure',
    (_name, file) => {
      const source = readFileSync(file, 'utf-8');
      expect(findForbiddenImports(source)).toEqual([]);
      expect(findForbiddenGlobals(source)).toEqual([]);
    },
  );
});
