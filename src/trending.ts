import { load } from "cheerio";
import type { TrendingRepo } from "./types.js";

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function normalizeRepoPath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/^\/+|\/+$/g, "").replace(/\s+/g, "");
  return normalized.includes("/") ? normalized : null;
}

export function parseTrendingRepos(html: string, limit = 5): TrendingRepo[] {
  const $ = load(html);
  const repos = $("article.Box-row")
    .map((_, element) => {
      const article = $(element);
      const repoPath = normalizeRepoPath(
        article.find("h2 a").first().attr("href") ?? article.find("a[href^='/']").first().attr("href")
      );

      if (!repoPath) {
        return null;
      }

      const description =
        normalizeWhitespace(
          article.find("p").first().text() || article.find("p[class*='color-fg-muted']").first().text() || ""
        ) || "";
      const language = normalizeWhitespace(
        article.find("span[itemprop='programmingLanguage']").first().text() ||
          article.find("span[class*='programmingLanguage']").first().text() ||
          ""
      );
      const articleText = normalizeWhitespace(article.text());
      const dailyStarsMatch = articleText.match(/([\d,]+)\s+stars today/i);
      const dailyStars = dailyStarsMatch ? Number.parseInt(dailyStarsMatch[1].replace(/,/g, ""), 10) : null;

      return {
        fullName: repoPath,
        htmlUrl: `https://github.com/${repoPath}`,
        description,
        language: language || null,
        dailyStars: Number.isFinite(dailyStars) ? dailyStars : null,
      };
    })
    .get()
    .filter((repo): repo is TrendingRepo => repo !== null);

  repos.sort((a, b) => (b.dailyStars ?? 0) - (a.dailyStars ?? 0));
  return repos.slice(0, limit);
}

export async function fetchTrendingRepos(limit = 5): Promise<TrendingRepo[]> {
  const res = await fetch("https://github.com/trending");
  if (!res.ok) {
    throw new Error(`GitHub Trending fetch error (${res.status})`);
  }

  return parseTrendingRepos(await res.text(), limit);
}
