declare module "*/licence-check.mjs" {
  export function isAllowedLicence(expression: string | undefined): boolean;
  export function offenders<T extends { name: string; licence?: string }>(packages: T[]): T[];
}
