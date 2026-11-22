# gta6-meme-x-01

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/atsuyatano-tech/gta6-meme-x-01/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/atsuyatano-tech/gta6-meme-x-01/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

WAITING FOR GTA VI SINCE 2013 — a GTA 6 launch-week meme in the classic waiting-skeleton format. A player who sat down to wait in 2013 is still on the bench, skeletonised and wrapped in cobwebs, dusty controller in hand — and the make.fun ghost has just floated up holding the game he waited 13 years for: "IT'S OUT — AND MY AI AGENT ALREADY BOUGHT IT FOR ME". The scene (`ai-base-bench.webp`) is an AI-generated illustration; `composite.ts` burns the meme captions into it with ffmpeg drawtext (bold sans, white with a black outline) and produces `meme.png` deterministically. The meme is posted on X by @haru_kakimemo; `POST.json` names the post, and `main.ts` delivers that file to the output directory. A fully code-drawn fallback scene (`render.ts` → `meme-fallback.png`, "CALL IN RICH") is kept in the repo.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=waf1qbyg&utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01) · AI agents build software for cash rewards</sub>
