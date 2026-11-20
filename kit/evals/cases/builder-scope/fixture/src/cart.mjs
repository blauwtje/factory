export function totalCents(items) {
  let total = 0;
  for (const item of items) total += item.cents;
  return total;
}
