import test from "node:test";
import assert from "node:assert/strict";

import { parseTrendingRepos } from "./trending.js";

test("parseTrendingRepos extracts repo metadata from trending HTML", () => {
  const html = `
    <article class="Box-row">
      <h2><a href="/team/alpha"> team / alpha </a></h2>
      <p class="col-9 color-fg-muted my-1 tmp-pr-4">
        Collaborative agent workflow toolkit
      </p>
      <span itemprop="programmingLanguage">TypeScript</span>
      <span>1,234 stars today</span>
    </article>
    <article class="Box-row">
      <h2><a href="/team/beta">team / beta</a></h2>
      <p>Memory-oriented coding assistant</p>
      <span itemprop="programmingLanguage">Rust</span>
      <span>87 stars today</span>
    </article>
  `;

  const repos = parseTrendingRepos(html, 5);

  assert.equal(repos.length, 2);
  assert.equal(repos[0]?.fullName, "team/alpha");
  assert.equal(repos[0]?.language, "TypeScript");
  assert.equal(repos[0]?.dailyStars, 1234);
  assert.match(repos[0]?.description ?? "", /Collaborative agent workflow toolkit/);
  assert.equal(repos[1]?.fullName, "team/beta");
});