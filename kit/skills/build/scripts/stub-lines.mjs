import { gitText } from '#git';

const STUB = /\bTODO\b|\btodo!\(|\bunimplemented!\(|\bNotImplemented/;
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[^/]+$/;

function addedLines(diff) {
  const added = [];
  let file = null;
  let line = 0;
  let inHunk = false;
  for (const text of diff.split('\n')) {
    if (text.startsWith('diff ')) {
      file = null;
      inHunk = false;
    } else if (!inHunk && text.startsWith('+++ ')) {
      file = text === '+++ /dev/null' ? null : text.slice(4);
    } else if (text.startsWith('@@ ')) {
      line = Number(/\+(\d+)/.exec(text)[1]);
      inHunk = true;
    } else if (inHunk && text.startsWith('+')) {
      if (file !== null) added.push({ file, line, text: text.slice(1) });
      line += 1;
    }
  }
  return added;
}

export function stubLines(root, commits) {
  return commits.flatMap(({ number, sha }) => {
    const diff = gitText(root, ['-c', 'core.quotePath=false', 'show', '--format=', '--unified=0', '--no-prefix', '--no-color', '--no-ext-diff', '--no-renames', sha], { trim: false });
    return addedLines(diff)
      .filter(({ file, text }) => STUB.test(text) && !TEST_PATH.test(file))
      .map(({ file, line, text }) => `Stub: Task ${number} ${file}:${line} ${text.trim()}`);
  });
}
