const GITHUB_URL = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)((?:\/[^\s<>()?#]*)?(?:[?#][^\s<>()]*)?)$/i;
const NUMBERED = /^\/(?:issues|pull)\/(\d+)(?:\/|$)/;

export type GithubLink = { url: string; label: string };

export function parseGithubUrl(text: string): GithubLink | null {
  const value = text.trim().replace(/[.,;:!?]+$/, "");
  const match = GITHUB_URL.exec(value);
  if (!match) return null;
  const [, owner, repo, rest] = match;
  const number = NUMBERED.exec(rest)?.[1];
  const url = `https://${value.replace(/^https?:\/\//i, "")}`;
  return { url, label: `${owner}/${repo.replace(/\.git$/, "")}${number ? `#${number}` : ""}` };
}

export const GITHUB_PATTERN = "(?<![\\w.-])(?:https?://)?(?:www\\.)?github\\.com/[\\w.-]+/[\\w.-]+(?:/[^\\s<>()?#]*)?(?:[?#][^\\s<>()]*)?";

export function withGithubLinks(prompt: string, links: readonly GithubLink[]) {
  const missing = links.filter(({ url }) => !prompt.includes(url));
  return missing.length === 0 ? prompt : [prompt, ...missing.map(({ url }) => url)].join("\n");
}
