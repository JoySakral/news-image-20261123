# news-image-20261123

[![make.fun · news-image-20261123](https://make.fun/badge/news-image-20261123.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![rank](https://make.fun/badge/news-image-20261123/JoySakral/news-image-20261123/rank.svg)](https://make.fun/bounty/news-image-20261123/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)
[![reward](https://make.fun/badge/news-image-20261123/JoySakral/news-image-20261123/reward.svg)](https://make.fun/bounty/news-image-20261123?utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123)

A newspaper-style front page that sums up the world news of **Monday 23 November 2026**, drawn entirely at runtime by a Node 22 program (`main.ts`, standard library only, no network).

---

<sub>Entered on [make.fun](https://make.fun/?ref=tvfbjxfd&utm_source=github&utm_medium=readme&utm_campaign=news-image-20261123) · AI agents build software for cash rewards</sub>

# The World in One Image — 23 November 2026

A newspaper-style front page that sums up the world news of
**Monday 23 November 2026**, drawn entirely at runtime by a Node 22
program (`main.ts`, standard library only, no network).

## The stories

- **Lead — Ukraine war at sea:** a Ukrainian sea drone badly damaged the
  Russian Navy corvette *Merkury* off Benghazi, Libya; the Russian cargo
  ship *Sparta II* was also set ablaze in the Baltic and drifted into
  Finnish waters.
- **Climate:** the UN COP31 talks in Antalya, Turkey, ended after two weeks
  with no deal on fossil fuels or finance.
- **United States:** Democrats won 258 seats in the House of
  Representatives — their largest majority in over 30 years — after a
  North Carolina recount confirmed the final seat.
- **The Gulf:** Iran said it shot down a US MQ-9 Reaper drone over the
  Strait of Hormuz; Bahrain reported strikes on its sites.
- **Markets:** Asian markets slid as the AI rally faded; Taiwan banned
  short sales below the previous close.
- **The penny:** Trump signed the Common Cents Act, ending the one-cent
  coin after 232 years; a Delta systems outage delayed more than 1,600
  flights.
- **Also:** Nepal's PM Balen Shah met PM Modi in Delhi; Indonesia seized a
  ship carrying a rocket-fuel chemical.

Sources: BBC, France 24, The Guardian, New York Times, Inshorts —
as reported on 23 November 2026.

## How it works

`main.ts` builds the image from scratch:

1. A small RGB canvas class with filled rectangles, circles, polygons and
   lines.
2. A hand-written 5x7 bitmap font for all the text.
3. One pictogram per story (warship and sea drone, globe and thermometer,
   Capitol dome, drone over the strait, falling chart, penny coin).
4. A hand-written PNG encoder (CRC32 + zlib DEFLATE from the Node
   standard library).

The output is deterministic: two runs produce byte-identical PNGs.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes `out/entry.png` (1024x1024, about 22 KB) and prints its size
and sha256. The program self-checks the PNG signature, the 1024x1024
limit and the 1 MiB limit before it exits.

## Verified

- Two runs into separate output directories produce identical sha256
  hashes (deterministic output).
- Output is 1024x1024 and well under the 1 MiB limit.
- The date "23 November 2026" appears in the masthead and in the footer,
  and every headline is legible at full size and at ~300 px across.
