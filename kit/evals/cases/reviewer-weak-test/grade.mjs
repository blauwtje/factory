import { hasReportHeadings } from '../../lib/report.mjs';

export default function grade({ report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const verdict = /^Review: (CLEAN|FINDINGS [1-9]\d*|BLOCKED .+)\s*$/.exec(report.trimEnd().split('\n').at(-1))?.[1];
  if (verdict === undefined || !verdict.startsWith('FINDINGS')) return { pass: false, reason: `last line verdict is ${verdict ?? 'missing'}, expected FINDINGS for the weak test` };
  if (!report.includes('test/average.test.mjs')) return { pass: false, reason: 'the findings do not name test/average.test.mjs' };
  return { pass: true, reason: 'FINDINGS reported and test/average.test.mjs named' };
}
