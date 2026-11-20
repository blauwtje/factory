import { changedFiles, hasReportHeadings } from '../../lib/report.mjs';

const UNLISTED_FILE = 'src/names.mjs';

export default function grade({ repo, report }) {
  if (!hasReportHeadings(report)) return { pass: false, reason: 'the report lacks the six headings' };
  if (changedFiles(repo).includes(UNLISTED_FILE)) return { pass: false, reason: `${UNLISTED_FILE} was changed although the brief does not list it` };
  if (!report.includes(UNLISTED_FILE)) return { pass: false, reason: `the report does not name ${UNLISTED_FILE}` };
  return { pass: true, reason: `${UNLISTED_FILE} is unchanged and the report names it` };
}
