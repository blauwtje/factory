import type { ThemeRegistration } from "shiki";

type Palette = Record<"fg" | "comment" | "keyword" | "string" | "func" | "number" | "type" | "property" | "punctuation" | "tag" | "deleted", string>;

const SCOPES: [string[], keyof Palette, string?][] = [
  [["comment", "punctuation.definition.comment"], "comment", "italic"],
  [["keyword", "storage", "storage.type", "keyword.operator.new", "keyword.control"], "keyword"],
  [["string", "string.quoted", "punctuation.definition.string", "markup.inserted"], "string"],
  [["entity.name.function", "support.function", "meta.function-call entity.name.function"], "func"],
  [["constant.numeric", "constant.language", "constant.character", "support.constant", "variable.other.constant"], "number"],
  [["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class"], "type"],
  [["variable.other.property", "meta.object-literal.key", "support.type.property-name", "entity.other.attribute-name", "variable.other.object.property"], "property"],
  [["entity.name.tag", "support.class.component", "markup.heading"], "tag"],
  [["punctuation", "meta.brace", "keyword.operator"], "punctuation"],
  [["variable", "variable.parameter", "meta.definition.variable"], "fg"],
  [["markup.deleted", "invalid"], "deleted"],
];

function theme(name: "factory-light" | "factory-dark", type: "light" | "dark", bg: string, palette: Palette): ThemeRegistration & { name: typeof name } {
  return {
    name,
    type,
    fg: palette.fg,
    bg,
    colors: { "editor.foreground": palette.fg, "editor.background": bg },
    tokenColors: SCOPES.map(([scope, key, fontStyle]) => ({ scope, settings: { foreground: palette[key], ...(fontStyle && { fontStyle }) } })),
  };
}

export const FACTORY_DARK = theme("factory-dark", "dark", "#1a1d21", {
  fg: "#e8eaed",
  comment: "#b0b6be",
  keyword: "#a3bdf9",
  string: "#8bd28d",
  func: "#eaa874",
  number: "#6fd1b5",
  type: "#85c8e6",
  property: "#c9ced6",
  punctuation: "#b4bbc4",
  tag: "#a3bdf9",
  deleted: "#f2716a",
});

export const FACTORY_LIGHT = theme("factory-light", "light", "#f6f7f8", {
  fg: "#16191f",
  comment: "#4f565f",
  keyword: "#2a4696",
  string: "#2a6326",
  func: "#8a410f",
  number: "#076050",
  type: "#05607b",
  property: "#4a515c",
  punctuation: "#4f5661",
  tag: "#2a4696",
  deleted: "#9e2320",
});

export const SYNTAX_THEMES = { light: FACTORY_LIGHT.name, dark: FACTORY_DARK.name } as const;
