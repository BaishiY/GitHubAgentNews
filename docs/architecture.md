# GitHub Agent 日报 — 架构方案

> 每天早上 9 点自动搜索 GitHub 上活跃的 Agent 相关仓库，用 Claude 生成摘要，推送到 Teams。

## 1. 整体架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐     ┌───────────┐
│ GitHub Actions   │────▶│ GitHub Search API │────▶│ Claude API  │────▶│ Teams     │
│ cron: 0 1 * * * │     │ (4组关键词搜索)    │     │ (摘要+趋势)  │     │ Workflow  │
│ (UTC 1点=北京9点)│     └──────────────────┘     └─────────────┘     │ Webhook   │
└─────────────────┘                                                   └───────────┘
```

**技术栈：** Node.js / TypeScript + GitHub Actions（免费调度）

**每日成本：** ~$1/月（Claude API ~$0.01-0.03/次，其余免费）

## 2. 搜索策略

### 2.1 四组搜索关键词

| 组 | 查询词 | 目标 |
|---|--------|------|
| A | `agent OR ai-agent OR autonomous-agent` | 核心 agent 项目 |
| B | `agent-framework OR agentic OR llm-agent` | 框架类项目 |
| C | `copilot OR assistant OR mcp OR tool-use OR function-calling` | 周边生态 |
| D | 新建 30 天内 + `stars:>200`（`created:>`） | **暴涨新仓库** |

### 2.2 查询参数

**A/B/C 组（活跃仓库）：**

```
GET /search/repositories
  ?q={关键词}+in:name,description,topics+pushed:>{yesterday}+stars:>100
  &sort=stars&order=desc&per_page=30
```

**D 组（暴涨检测）：**

```
GET /search/repositories
  ?q=agent+OR+ai-agent+OR+llm+OR+framework
   +created:>{30天前}+stars:>200
  &sort=stars&order=desc&per_page=50
```

关键区别：D 组用 `created:>` 而不是 `pushed:>`，专门捞**新创建但快速增长**的仓库。

## 3. 过滤与质量校验

### 3.1 过滤管线

```
原始结果 (~80-130条)
  │
  ├── 按 repo.id 去重
  ├── 排除 fork (repo.fork === true)
  ├── 排除 archived 仓库
  ├── 排除无 description 的仓库
  ├── stars ≥ 100
  │
  ├── [D组额外] 反空壳过滤 ← 见 3.2
  │
  ├── 评分排序 ← 见 3.3
  └── 取 Top 20
```

### 3.2 反空壳过滤（D 组专用）

针对刷星/空壳仓库（5k stars 但只有 2 commits + 1 个 README），对 D 组候选仓库额外校验：

```
对每个候选调用 GET /repos/{owner}/{repo}，检查：

必须全部通过：
├── commits ≥ 10              // 排除只有 README 的空壳
├── size ≥ 100 KB             // 排除无实际代码
├── open_issues > 0           // 有真实社区互动
├── forks ≥ 5                 // 有人在用
└── contributors ≥ 2          // 非单人刷星项目

可选加强（额外 API 调用）：
├── GET /repos/{owner}/{repo}/languages
│   └── 返回非空               // 确认有代码文件
└── GET /repos/{owner}/{repo}/commits?per_page=1
    └── 最近 commit < 7天      // 确认持续开发中
```

### 3.3 评分公式

```
score = base_score + quality_score + trend_score

base_score:
  stars × 0.2

quality_score:
  commits × 0.5
  + contributors × 2
  + (has_real_code ? 5 : 0)
  + (open_issues > 10 ? 3 : 0)

trend_score:
  velocity × 3                   // 日均增星（见第4节）
  + acceleration × 5             // 增速变化（有历史数据时）
  + (created < 30d ? 10 : 0)     // 新仓库加分
  + (pushed < 24h ? 5 : 0)       // 今日活跃
```

## 4. Stars 增长追踪

### 4.1 增速计算

```
velocity = stars / repo_age_days       // 日均增星数

爆发等级：
  🔥🔥🔥 velocity > 100     "爆发增长"
  🔥🔥   velocity 30-100    "快速增长"
  🔥     velocity 10-30     "稳步增长"
```

### 4.2 历史快照

用仓库中的 `data/stars-snapshot.json` 记录每日 stars：

```json
{
  "2026-05-17": {
    "langchain-ai/langgraph": 15200,
    "microsoft/autogen": 38500
  },
  "2026-05-18": { ... }
}
```

- 每次运行后 commit 回仓库
- 只保留最近 7 天数据
- 有历史数据时可计算**加速度**（今天增速 vs 昨天增速）

## 5. Claude 摘要

### 5.1 模型选择

`claude-sonnet-4-6-20250514`（性价比最佳）

### 5.2 Prompt

```
你是一个 AI Agent 技术趋势分析师。

## 任务1：Top 5 值得关注
从以下仓库中选出最值得关注的 5 个。
优先关注以下方向（如果有的话）：
- 🧠 非传统 agent 架构（非 ReAct/CoT 的新范式）
- 🤝 多 agent 编排（multi-agent orchestration）
- 💾 memory / 长期记忆创新
- 📋 planning / 任务规划
- 🔧 tool-use / function-calling 创新
- 🆕 新兴框架（创建<30天，增速快）

每个仓库输出：
- 仓库名 | ⭐数 | 增速(🔥等级) | 方向标签
- 一句话中文总结（不超30字）

## 任务2：暴涨仓库速报（如有）
如果有创建不到30天但增速 >30stars/天的仓库，单独列出并说明为什么值得关注。

## 任务3：今日趋势观察
用2-3句话总结趋势，重点关注技术方向变化而非单个项目。

仓库列表：
{repo} | ⭐{stars} | 创建:{created} | 增速:{velocity}/天 |
  commits:{n} | contributors:{n} | {description}
...
```

## 6. Teams 推送

### 6.1 方式

使用 **Teams Workflows Webhook**（非旧版 Incoming Webhook，旧版将于 2026-05 停用）。

设置路径：Teams 频道 → `...` → Workflows → "Post to a channel when a webhook request is received"

### 6.2 Adaptive Card 结构

```
┌─────────────────────────────────────┐
│ 🤖 Agent 日报 - 2026/05/18          │
├─────────────────────────────────────┤
│ 🔥 暴涨速报                         │
│ repo/name  ⭐800 (创建7天,114/天)    │
│ 🧠🤝 多agent记忆共享框架...          │
├─────────────────────────────────────┤
│ ⭐ Top 5 值得关注                    │
│ 1. repo/name ⭐1.2k 🔥🔥 🤝          │
│    一句话摘要...                     │
│ 2. ...                              │
├─────────────────────────────────────┤
│ 📊 趋势观察                         │
│ 本周 agent 领域趋势...              │
│                        [查看详情 →]  │
└─────────────────────────────────────┘
```

### 6.3 Payload 示例

```json
{
  "type": "message",
  "attachments": [{
    "contentType": "application/vnd.microsoft.card.adaptive",
    "content": {
      "type": "AdaptiveCard",
      "version": "1.4",
      "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
      "body": [
        {
          "type": "TextBlock",
          "text": "🤖 Agent 日报 - 2026/05/18",
          "weight": "bolder",
          "size": "large"
        },
        {
          "type": "TextBlock",
          "text": "🔥 暴涨速报",
          "weight": "bolder",
          "separator": true
        },
        {
          "type": "FactSet",
          "facts": [
            {
              "title": "repo/name",
              "value": "⭐800 (创建7天, 114⭐/天) 🧠 多agent记忆共享框架"
            }
          ]
        },
        {
          "type": "TextBlock",
          "text": "⭐ Top 5 值得关注",
          "weight": "bolder",
          "separator": true
        },
        {
          "type": "FactSet",
          "facts": [
            { "title": "1. owner/repo", "value": "⭐1.2k 🔥🔥 🤝 一句话摘要" },
            { "title": "2. owner/repo", "value": "⭐800 🔥 🧠 一句话摘要" }
          ]
        },
        {
          "type": "TextBlock",
          "text": "📊 趋势观察",
          "weight": "bolder",
          "separator": true
        },
        {
          "type": "TextBlock",
          "text": "本周 agent 领域主要趋势...",
          "wrap": true
        }
      ],
      "actions": [
        {
          "type": "Action.OpenUrl",
          "title": "查看详情",
          "url": "https://github.com/trending"
        }
      ]
    }
  }]
}
```

## 7. GitHub Actions Workflow

```yaml
name: Daily Agent News
on:
  schedule:
    - cron: '0 1 * * *'        # UTC 01:00 = 北京时间 09:00
  workflow_dispatch:             # 支持手动触发测试

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run report
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TEAMS_WEBHOOK_URL: ${{ secrets.TEAMS_WEBHOOK_URL }}

      # 保存 stars 快照供次日对比
      - name: Commit stars snapshot
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/stars-snapshot.json
          git diff --cached --quiet || git commit -m "chore: update stars snapshot"
          git push
```

## 8. 项目文件结构

```
github-news/
├── .github/
│   └── workflows/
│       └── daily-agent-news.yml    # 定时任务
├── src/
│   ├── index.ts                    # 主入口 & 流程编排
│   ├── github.ts                   # GitHub Search API + 质量校验
│   ├── scorer.ts                   # 评分排序逻辑
│   ├── summarize.ts                # Claude API 摘要生成
│   └── teams.ts                    # Teams Webhook 推送
├── data/
│   └── stars-snapshot.json         # Stars 历史快照（自动更新）
├── package.json
├── tsconfig.json
└── docs/
    └── architecture.md             # 本文档
```

## 9. Secrets 配置

在 GitHub 仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 来源 | 说明 |
|--------|------|------|
| `GITHUB_TOKEN` | Actions 自带 | 无需额外配置 |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Claude API 密钥 |
| `TEAMS_WEBHOOK_URL` | Teams Workflows | Webhook 端点 URL |

## 10. API 调用量

| 步骤 | 调用数 | 限额 |
|------|--------|------|
| 搜索 A/B/C 组 | 3 次 | 30 次/分 |
| 搜索 D 组 | 1 次 | |
| D 组质量校验 | ~100 次 | 5000 次/时 |
| Claude 摘要 | 1 次 | 按 token 计费 |
| Teams 推送 | 1 次 | 4 次/秒 |
| **总计** | **~106 次** | 完全在限额内 |

## 11. 关注方向优先级

Claude 摘要时优先关注以下技术方向：

| 标签 | 方向 | 说明 |
|------|------|------|
| 🧠 | 非传统架构 | 非 ReAct/CoT 的新范式 |
| 🤝 | 多 Agent 编排 | multi-agent orchestration |
| 💾 | Memory 创新 | 长期记忆、上下文管理 |
| 📋 | Planning | 任务规划、分解 |
| 🔧 | Tool-use 创新 | function-calling、MCP |
| 🆕 | 新兴框架 | 创建 <30 天，增速快 |
