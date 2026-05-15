# 游戏开发 DDL

> Just-DDL Network 独立专题仓库。中文优先展示，英文名称保留，所有事件都带倒计时、来源和校验入口。

## 页面

- GitHub Pages: https://just-agent.github.io/game-dev-ddl/
- Hub: https://just-agent.github.io/just-ddl/
- Repo: https://github.com/Just-Agent/game-dev-ddl

## 数据概览

| 指标 | 数值 |
| --- | ---: |
| 当前事件 | 16 |
| 来源族 | 4 |
| 下一条 | Global Game Jam Site Registration / 2026-07-01 |

## 数据链路

本仓库把专题从 Just-DDL Hub 中拆出来，目录结构固定：

- `data/items.json`: 事件数据，每条事件包含 `deadline`、`url`、`source`。
- `data/sources.json`: 官方来源和聚合来源清单。
- `scripts/crawl-sources.mjs`: source-specific crawler scaffold。
- `scripts/validate-data.mjs`: 数据质量校验。
- `scripts/link-check.mjs`: 链接检查，默认 warning-only，设置 `STRICT_LINK_CHECK=1` 后严格失败。

## 本地校验

```bash
npm run validate
npm run link-check
STRICT_LINK_CHECK=1 npm run link-check
```

## 自动更新

`.github/workflows/update-data.yml` 每周运行 crawler、validator 和 link-check。当前阶段会保留人工精选数据，待各来源解析器补齐后再切换到严格发布流。
