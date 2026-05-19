import test from "node:test";
import assert from "node:assert/strict";

import { extractJson, parseSummary } from "./summarize.js";
import type { EnrichedRepo, RadarContext, TrendingRepo } from "./types.js";

function makeEnrichedRepo(name: string): EnrichedRepo {
  return {
    id: 1,
    full_name: name,
    html_url: `https://github.com/${name}`,
    description: "A useful repo",
    created_at: "2026-05-01T00:00:00.000Z",
    pushed_at: "2026-05-19T00:00:00.000Z",
    stargazers_count: 1200,
    forks_count: 50,
    open_issues_count: 20,
    size: 800,
    language: "TypeScript",
    fork: false,
    archived: false,
    topics: ["agent"],
    source: ["A"],
    velocity: 42,
    velocitySource: "snapshot",
    dailyStarsDelta: 42,
    acceleration: 10,
    score: 500,
    radarBoost: 12,
    radarMatchScore: 12,
    fireLevel: "🔥🔥",
    matchedSignal: {
      id: "workflow-orchestration",
      label: "Workflow orchestration",
      count: 3,
      searchTerms: ["workflow", "orchestration"],
      sampleTitle: "Teams are shipping orchestration tools",
      sampleUrl: "https://example.com/signal",
      siteName: "Example",
      source: "news",
    },
    matchedHeadline: "Teams are shipping orchestration tools",
  };
}

function makeTrendingRepos(): TrendingRepo[] {
  return [
    { fullName: "owner/repo-1", htmlUrl: "https://github.com/owner/repo-1", description: "repo 1", language: "TypeScript", dailyStars: 100 },
    { fullName: "owner/repo-2", htmlUrl: "https://github.com/owner/repo-2", description: "repo 2", language: "Go", dailyStars: 90 },
    { fullName: "owner/repo-3", htmlUrl: "https://github.com/owner/repo-3", description: "repo 3", language: "Rust", dailyStars: 80 },
    { fullName: "owner/repo-4", htmlUrl: "https://github.com/owner/repo-4", description: "repo 4", language: "Python", dailyStars: 70 },
    { fullName: "owner/repo-5", htmlUrl: "https://github.com/owner/repo-5", description: "repo 5", language: "TypeScript", dailyStars: 60 },
  ];
}

test("extractJson pulls JSON out of fenced responses", () => {
  const raw = '```json\n{"top5":[],"explosiveRepos":[],"trendObservation":[]}\n```';

  assert.equal(extractJson(raw), '{"top5":[],"explosiveRepos":[],"trendObservation":[]}');
});

test("parseSummary preserves valid items and backfills to five from trending", () => {
  const repos = [makeEnrichedRepo("owner/repo-1")];
  const trendingRepos = makeTrendingRepos();
  const radarContext: RadarContext = {
    generatedAt: "2026-05-19T00:00:00.000Z",
    overview: "Today is about orchestration.",
    dynamicSearchTerms: ["workflow"],
    topSignals: [repos[0].matchedSignal!],
    topSites: [],
    sourceHealth: {
      successfulSites: 1,
      totalSites: 1,
      failedSites: [],
      aiItems: 3,
      rawItems: 5,
    },
  };
  const raw = JSON.stringify({
    top5: [
      {
        name: "owner/repo-1",
        tags: ["编排", "workflow"],
        summary: "编排能力最近很热",
        whyNow: "外部信号与仓库方向一致",
        linkedSignal: "Workflow orchestration",
      },
    ],
    explosiveRepos: [],
    trendObservation: ["编排相关能力升温", "工具调用与协同继续增强"],
  });

  const summary = parseSummary(raw, repos, trendingRepos, radarContext);

  assert.equal(summary.top5.length, 5);
  assert.equal(summary.top5[0]?.name, "owner/repo-1");
  assert.equal(summary.top5[0]?.linkedSignal, "Workflow orchestration");
  assert.equal(summary.top5[0]?.dailyStars, "+100");
  assert.match(summary.trendObservation, /编排相关能力升温/);
  assert.ok(summary.top5.some((item) => item.name === "owner/repo-5"));
});