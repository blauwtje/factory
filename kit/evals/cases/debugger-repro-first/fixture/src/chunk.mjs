export function chunk(items, size) {
  const chunks = [];
  for (let start = 0; start + size <= items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
