/**
 * The simulation engine must stay pure: no DOM, no Node, no clock, no randomness that
 * isn't explicitly seeded. That is what lets the browser and the CLI produce identical
 * numbers for the same scenario, which is a stated acceptance criterion.
 *
 * Enforced by test, because a rule nobody checks is a rule nobody keeps.
 */

/** Import sources the domain layer may never reach for. */
const FORBIDDEN_IMPORTS = [
  /^node:/,
  /^@presentation\//,
  /^@infrastructure\//,
  /^\.\.\/presentation\//,
  /^\.\.\/infrastructure\//,
];

/** Globals that make a result depend on the host or on the wall clock. */
const FORBIDDEN_GLOBALS = [
  'Math.random',
  'Date.now',
  'new Date',
  'performance.now',
  'window.',
  'document.',
  'localStorage',
  'crypto.randomUUID',
];

const IMPORT_SOURCE = /(?:^|\n)\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g;

export function findForbiddenImports(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_SOURCE)) {
    const specifier = match[1];
    if (specifier && FORBIDDEN_IMPORTS.some((pattern) => pattern.test(specifier))) {
      found.push(specifier);
    }
  }
  return found;
}

export function findForbiddenGlobals(source: string): string[] {
  const withoutComments = stripComments(source);
  return FORBIDDEN_GLOBALS.filter((global) => withoutComments.includes(global));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}
