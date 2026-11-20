export function shippingCents(orderCents) {
  if (orderCents > 5000) return 0;
  return 499;
}
