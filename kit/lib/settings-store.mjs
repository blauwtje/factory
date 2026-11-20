import fs from 'node:fs';

export function settingValue(key) {
  const config = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
  if (!Object.hasOwn(config, key ?? '')) throw new Error(`unknown setting ${key}; known: ${Object.keys(config).join(', ')}`);
  return config[key];
}
