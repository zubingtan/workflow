import { readFile } from 'node:fs/promises';

const prototypePath = new URL('../src/prototypes/shadcn-ui/prototype-app.tsx', import.meta.url);
const source = await readFile(prototypePath, 'utf8');

const forbiddenPatterns = [
  {
    label: 'native interactive HTML',
    pattern: /<(button|input|textarea|select|option|label|kbd)\b/g,
  },
  {
    label: 'manual interactive roles',
    pattern: /role=["']button["']|tabIndex=/g,
  },
  {
    label: 'manual sibling spacing',
    pattern: /\bspace-[xy]-/g,
  },
  {
    label: 'manual dark-mode utility',
    pattern: /\bdark:[^\s'"`]+/g,
  },
  {
    label: 'non-semantic palette utility',
    pattern:
      /\b(?:bg|border|text)-(?:blue|red|green|amber|orange|purple|violet|gray|slate|zinc|neutral)-/g,
  },
  {
    label: 'component variant class composition',
    pattern: /\b(?:buttonVariants|badgeVariants|toggleVariants)\s*\(/g,
  },
];

const violations = forbiddenPatterns.flatMap(({ label, pattern }) => {
  const matches = [...source.matchAll(pattern)];
  return matches.map((match) => {
    const line = source.slice(0, match.index).split('\n').length;
    return `${label} at line ${line}: ${match[0]}`;
  });
});

if (violations.length > 0) {
  console.error('Shadcn prototype audit failed:\n');
  console.error(violations.map((violation) => `- ${violation}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('Shadcn prototype audit passed.');
}
