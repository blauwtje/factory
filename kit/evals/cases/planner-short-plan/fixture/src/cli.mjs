import fs from 'node:fs';
import process from 'node:process';
import { countWords } from './count.mjs';

const counts = countWords(fs.readFileSync(process.argv[2], 'utf8'));
for (const [word, count] of Object.entries(counts)) process.stdout.write(`${word} ${count}\n`);
