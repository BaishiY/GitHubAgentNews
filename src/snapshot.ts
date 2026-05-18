import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { StarsSnapshot, RepoInfo } from "./types.js";

const SNAPSHOT_PATH = "data/stars-snapshot.json";
const MAX_DAYS = 7;

export async function loadSnapshot(): Promise<StarsSnapshot> {
  try {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    return JSON.parse(raw) as StarsSnapshot;
  } catch {
    return {};
  }
}

export async function saveSnapshot(repos: RepoInfo[], existing: StarsSnapshot): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const todayData: Record<string, number> = {};

  for (const repo of repos) {
    todayData[repo.full_name] = repo.stargazers_count;
  }

  existing[today] = todayData;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  for (const date of Object.keys(existing)) {
    if (date < cutoffStr) {
      delete existing[date];
    }
  }

  await mkdir(dirname(SNAPSHOT_PATH), { recursive: true });
  await writeFile(SNAPSHOT_PATH, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`[Snapshot] Saved ${Object.keys(todayData).length} repos for ${today}`);
}

export function getYesterdayStars(repoName: string, snapshot: StarsSnapshot): number | null {
  const dates = Object.keys(snapshot).sort();
  if (dates.length < 2) return null;
  const yesterday = dates[dates.length - 2];
  return snapshot[yesterday]?.[repoName] ?? null;
}

export function getDailyStarDelta(
  repoName: string,
  currentStars: number,
  snapshot: StarsSnapshot
): number | null {
  const yesterdayStars = getYesterdayStars(repoName, snapshot);
  if (yesterdayStars === null) {
    return null;
  }

  return currentStars - yesterdayStars;
}

export function getAcceleration(
  repoName: string,
  currentStars: number,
  snapshot: StarsSnapshot
): number | null {
  const dates = Object.keys(snapshot).sort();
  if (dates.length < 2) return null;

  const prevDate = dates[dates.length - 2];
  const prevStars = snapshot[prevDate]?.[repoName];
  if (prevStars === undefined) return null;

  const todayDelta = currentStars - prevStars;

  if (dates.length < 3) return null;
  const prevPrevDate = dates[dates.length - 3];
  const prevPrevStars = snapshot[prevPrevDate]?.[repoName];
  if (prevPrevStars === undefined) return null;

  const yesterdayDelta = prevStars - prevPrevStars;
  return todayDelta - yesterdayDelta;
}
