export function slug(text) {
  return text.toLowerCase().split(' ').join('-');
}
