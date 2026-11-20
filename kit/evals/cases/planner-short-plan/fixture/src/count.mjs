export function countWords(text) {
  const counts = {};
  for (const word of text.toLowerCase().split(/\s+/).filter(Boolean)) counts[word] = (counts[word] ?? 0) + 1;
  return counts;
}
