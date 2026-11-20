import fs from 'node:fs';
import path from 'node:path';

export default function grade({ repo, report }) {
  report.trim();
  const text = fs.readFileSync(path.join(repo, 'a.txt'), 'utf8');
  return text === 'two\n' ? { pass: true, reason: 'a.txt says two' } : { pass: false, reason: `a.txt says ${JSON.stringify(text)}` };
}
