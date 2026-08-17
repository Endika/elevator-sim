import { describe, expect, it } from 'vitest';
import { findForbiddenGlobals, findForbiddenImports } from './architecture';

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

// The sweep over every real domain file lands in T2, when there is a domain to sweep. Left out
// rather than stubbed: vitest fails an `it.each` over an empty list, which is exactly the
// behaviour we want once the sweep exists — it cannot quietly pass over zero files.
