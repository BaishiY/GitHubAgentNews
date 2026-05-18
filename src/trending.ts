import type { TrendingRepo } from "./types.js";

function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function matchFirst(input: string, pattern: RegExp): string | null {
  return input.match(pattern)?.[1]?.trim() ?? null;
}

export async function fetchTrendingRepos(limit = 5): Promise<TrendingRepo[]> {
  const res = await fetch("https://github.com/trending");
  if (!res.ok) {
    throw new Error(`GitHub Trending fetch error (${res.status})`);
  }

  const html = await res.text();
  const articles = [...html.matchAll(/<article class="Box-row">([\s\S]*?)<\/article>/g)].map((match) => match[1]);

  const repos = articles.map((article) => {
    const repoPath = matchFirst(article, /href="\/([^"\s]+\/[^"\s]+)"/);
    const description = stripTags(matchFirst(article, /<p class="col-9 color-fg-muted my-1 tmp-pr-4">([\s\S]*?)<\/p>/) ?? "");
    const language = stripTags(matchFirst(article, /programmingLanguage">([\s\S]*?)<\/span>/) ?? "") || null;
    const dailyStarsMatch = article.match(/([\d,]+)\s+stars today/);
    const dailyStars = dailyStarsMatch ? parseInt(dailyStarsMatch[1].replace(/,/g, ""), 10) : null;

    if (!repoPath) {
      throw new Error("Failed to parse trending repo path");
    }

    return {
      fullName: repoPath,
      htmlUrl: `https://github.com/${repoPath}`,
      description,
      language,
      dailyStars: Number.isFinite(dailyStars) ? dailyStars : null,
    };
  });

  repos.sort((a, b) => (b.dailyStars ?? 0) - (a.dailyStars ?? 0));
  return repos.slice(0, limit);
}
