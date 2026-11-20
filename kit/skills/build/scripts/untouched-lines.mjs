import { gitText } from '#git';

function changedPaths(root, shas) {
  return shas.flatMap((sha) => gitText(root, ['-c', 'core.quotePath=false', 'show', '--format=', '--name-only', '--no-renames', sha]).split('\n').filter((line) => line !== ''));
}

function touched(filePath, changed) {
  return filePath.endsWith('/') ? changed.some((changedPath) => changedPath.startsWith(filePath)) : changed.includes(filePath);
}

export function untouchedLines(root, tasks) {
  return tasks.flatMap(({ number, files, shas }) => {
    const changed = changedPaths(root, shas);
    return files.filter(({ path }) => !touched(path, changed)).map(({ path }) => `Untouched: Task ${number} ${path}`);
  });
}
