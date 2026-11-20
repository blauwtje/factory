import { expect, test } from "vitest";
import { isAllowedLicence, offenders } from "../../scripts/licence-check.mjs";

test.each([
  ["MIT", true],
  ["MIT OR Apache-2.0", true],
  ["Apache-2.0 WITH LLVM-exception", true],
  ["BSD-3-Clause", true],
  ["(MIT OR Apache-2.0) AND Unicode-3.0", true],
  ["MIT/Apache-2.0", true],
  ["apache-2.0", true],
  ["OFL-1.1", false],
  ["GPL-3.0-only", false],
  ["MIT AND GPL-3.0-only", false],
  ["(MIT OR GPL-3.0-only) AND GPL-2.0-only", false],
  ["AGPL-3.0-or-later OR GPL-3.0-only", false],
  [undefined, false],
])("licence %s allowed: %s", (expression, allowed) => {
  expect(isAllowedLicence(expression)).toBe(allowed);
});

test("offenders lists packages with a forbidden licence", () => {
  const packages = [
    { name: "good@1.0.0", licence: "ISC" },
    { name: "bad@1.0.0", licence: "GPL-3.0-only" },
    { name: "unknown@1.0.0", licence: undefined },
  ];
  expect(offenders(packages).map((pkg) => pkg.name)).toEqual(["bad@1.0.0", "unknown@1.0.0"]);
});

test("offenders allows OFL-1.1 only for font packages", () => {
  const packages = [
    { name: "@fontsource-variable/geist@5.3.0", licence: "OFL-1.1" },
    { name: "some-lib@1.0.0", licence: "OFL-1.1" },
  ];
  expect(offenders(packages).map((pkg) => pkg.name)).toEqual(["some-lib@1.0.0"]);
});
