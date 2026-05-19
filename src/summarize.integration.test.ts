import test from "node:test";
import assert from "node:assert/strict";

import { summarizeWithClient } from "./summarize.js";
import type { EnrichedRepo, TrendingRepo } from "./types.js";

function makeRepo(name: string, velocity: number, createdAt: string): EnrichedRepo {
  return {
    id: Math.floor(Math.random() * 10000),
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: `${name} description`,
    created_at: createdAt,
    pushed_at: "2026-05-19T00:00:00.000Z",
    stargazers_count: 1200,
    forks_count: 40,
    open_issues_count: 8,
    size: 500,
    language: "TypeScript",
    fork: false,
    archived: false,
    topics: ["agent"],
    source: ["A"],
    velocity,
    velocitySource: "snapshot",
    dailyStarsDelta: velocity,
    acceleration: 12,
    score: 400,
    radarBoost: 0,
    radarMatchScore: 0,
    fireLevel: velocity >= 30 ? "🔥🔥" : "🔥",
  };
}

function makeTrendingRepos(): TrendingRepo[] {
  return [
    { fullName: "team/alpha", htmlUrl: "https://github.com/team/alpha", description: "alpha", language: "TypeScript", dailyStars: 120 },
    { fullName: "team/beta", htmlUrl: "https://github.com/team/beta", description: "beta", language: "Go", dailyStars: 90 },
    { fullName: "team/gamma", htmlUrl: "https://github.com/team/gamma", description: "gamma", language: "Rust", dailyStars: 80 },
    { fullName: "team/delta", htmlUrl: "https://github.com/team/delta", description: "delta", language: "Python", dailyStars: 70 },
    { fullName: "team/epsilon", htmlUrl: "https://github.com/team/epsilon", description: "epsilon", language: "TypeScript", dailyStars: 60 },
  ];
}

test("summarizeWithClient falls back to ranked repos when Claude returns invalid JSON", async () => {
  const client = {
    baseURL: "https://example.invalid",
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "not valid json" }],
      }),
    },
  };
  const repos = [
    makeRepo("team/alpha", 120, "2026-05-10T00:00:00.000Z"),
    makeRepo("team/hot-new", 55, "2026-05-15T00:00:00.000Z"),
  ];
  const trendingRepos = makeTrendingRepos();

  const summary = await summarizeWithClient(repos, trendingRepos, client);

  assert.equal(summary.top5.length, 5);
  assert.equal(summary.top5[0]?.name, "team/alpha");
  assert.equal(summary.top5[0]?.dailyStars, "+120");
  assert.equal(summary.explosiveRepos.length, 2);
  assert.ok(summary.explosiveRepos.some((item) => item.name === "team/hot-new"));
  assert.match(summary.trendObservation, /工具调用能力/);
  assert.equal(summary.raw, "not valid json");
});