import type { RepoInfo, EnrichedRepo, QualityCheck, SearchGroup, StarsSnapshot } from "./types.js";
import { getAcceleration } from "./snapshot.js";

export function calculateVelocity(repo: RepoInfo): number {
  const created = new Date(repo.created_at).getTime();
  const ageDays = Math.max(1, (Date.now() - created) / (1000 * 60 * 60 * 24));
  return repo.stargazers_count / ageDays;
}

export function getFireLevel(velocity: number): string {
  if (velocity > 100) return "🔥🔥🔥";
  if (velocity >= 30) return "🔥🔥";
  if (velocity >= 10) return "🔥";
  return "";
}

function calculateScore(
  repo: RepoInfo,
  velocity: number,
  acceleration: number | null,
  qualityCheck?: QualityCheck
): number {
  const baseScore = repo.stargazers_count * 0.2;

  let qualityScore = 0;
  if (qualityCheck) {
    qualityScore =
      qualityCheck.commits * 0.5 +
      qualityCheck.contributors * 2 +
      (qualityCheck.hasRealCode ? 5 : 0) +
      (repo.open_issues_count > 10 ? 3 : 0);
  }

  const created = new Date(repo.created_at).getTime();
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
  const pushed = new Date(repo.pushed_at).getTime();
  const pushedHoursAgo = (Date.now() - pushed) / (1000 * 60 * 60);

  const trendScore =
    velocity * 3 +
    (acceleration !== null ? acceleration * 5 : 0) +
    (ageDays < 30 ? 10 : 0) +
    (pushedHoursAgo < 24 ? 5 : 0);

  return baseScore + qualityScore + trendScore;
}

export function enrichAndRank(
  repos: { repo: RepoInfo; sources: SearchGroup[]; qualityCheck?: QualityCheck }[],
  snapshot: StarsSnapshot,
  topN = 20
): EnrichedRepo[] {
  const enriched: EnrichedRepo[] = repos.map(({ repo, sources, qualityCheck }) => {
    const velocity = calculateVelocity(repo);
    const acceleration = getAcceleration(repo.full_name, repo.stargazers_count, snapshot);
    const score = calculateScore(repo, velocity, acceleration, qualityCheck);

    return {
      ...repo,
      source: sources,
      velocity,
      acceleration,
      score,
      fireLevel: getFireLevel(velocity),
      qualityCheck,
    };
  });

  enriched.sort((a, b) => b.score - a.score);
  return enriched.slice(0, topN);
}
