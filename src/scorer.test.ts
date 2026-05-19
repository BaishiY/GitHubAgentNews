import test from "node:test";
import assert from "node:assert/strict";

import { enrichAndRank } from "./scorer.js";
import type { RepoInfo, StarsSnapshot } from "./types.js";

function makeRepo(overrides: Partial<RepoInfo> & Pick<RepoInfo, "full_name" | "stargazers_count">): RepoInfo {
  const { full_name, stargazers_count, ...rest } = overrides;

  return {
    id: Math.floor(Math.random() * 100000),
    full_name,
    html_url: `https://github.com/${full_name}`,
    description: "repo description",
    created_at: "2026-01-01T00:00:00.000Z",
    pushed_at: "2026-05-19T00:00:00.000Z",
    stargazers_count,
    forks_count: 20,
    open_issues_count: 12,
    size: 500,
    language: "TypeScript",
    fork: false,
    archived: false,
    topics: ["agent"],
    ...rest,
  };
}

test("enrichAndRank prefers recent daily star momentum when snapshot data exists", () => {
  const stableRepo = makeRepo({
    full_name: "stable/project",
    stargazers_count: 2000,
    created_at: "2025-01-01T00:00:00.000Z",
  });
  const hotRepo = makeRepo({
    full_name: "hot/project",
    stargazers_count: 900,
    created_at: "2026-02-01T00:00:00.000Z",
  });

  const snapshot: StarsSnapshot = {
    "2026-05-17": {
      "stable/project": 1998,
      "hot/project": 790,
    },
    "2026-05-18": {
      "stable/project": 1999,
      "hot/project": 820,
    },
  };

  const ranked = enrichAndRank(
    [
      { repo: stableRepo, sources: ["A"] },
      { repo: hotRepo, sources: ["A"] },
    ],
    snapshot,
    undefined,
    2
  );

  assert.equal(ranked[0]?.full_name, "hot/project");
  assert.equal(ranked[0]?.velocity, 80);
  assert.equal(ranked[0]?.velocitySource, "snapshot");
  assert.equal(ranked[0]?.dailyStarsDelta, 80);
});

test("enrichAndRank falls back to lifetime velocity without snapshot history", () => {
  const repo = makeRepo({
    full_name: "fallback/project",
    stargazers_count: 500,
    created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const [ranked] = enrichAndRank([{ repo, sources: ["A"] }], {}, undefined, 1);

  assert.equal(ranked.full_name, "fallback/project");
  assert.equal(ranked.velocitySource, "lifetime");
  assert.equal(ranked.dailyStarsDelta, null);
  assert.ok(ranked.velocity > 45 && ranked.velocity < 55);
});