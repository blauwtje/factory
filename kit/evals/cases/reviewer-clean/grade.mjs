import { hasReportHeadings } from '../../lib/report.mjs';

export default function grade({ report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const verdict = /^Review: (CLEAN|FINDINGS [1-9]\d*|BLOCKED .+)\s*$/.exec(report.trimEnd().split('\n').at(-1))?.[1];
  if (verdict !== 'CLEAN') return { pass: false, reason: `last line verdict is ${verdict ?? 'missing'}, expected CLEAN for a correct diff` };
  return { pass: true, reason: 'CLEAN reported for a correct diff' };
}
