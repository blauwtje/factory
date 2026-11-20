import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  const changed = changedFiles(repo);
  if (changed.length > 0) return { pass: false, reason: `the reviewer changed [${changed.join(', ')}], expected the repository unchanged` };
  const verdict = /^Review: (CLEAN|FINDINGS [1-9]\d*|BLOCKED .+)\s*$/.exec(report.trimEnd().split('\n').at(-1))?.[1];
  if (verdict === undefined || !verdict.startsWith('FINDINGS')) return { pass: false, reason: `last line verdict is ${verdict ?? 'missing'}, expected FINDINGS for the planted bug` };
  if (!report.includes('src/paginate.mjs')) return { pass: false, reason: 'the findings do not name src/paginate.mjs' };
  return { pass: true, reason: 'FINDINGS reported, src/paginate.mjs named and the repository unchanged' };
}
