# Synthetix

Vision-first, self-healing end-to-end test agent. Built phase by phase.

## Phase 1: environment + mock shop

```bash
npm install
npx playwright install chromium
cp .env.example .env        # already provided as .env
npm run check:env           # validates environment
npm run check:site          # validates site files + server (no browser)
npm run smoke               # full browser flow + screenshots
npm run phase1              # all three
npm run serve               # open http://127.0.0.1:4173 yourself
```

## Phase 2: browser layer + Set-of-Mark overlay

```bash
npm run phase2
```
Outputs land in `artifacts/` (raw screenshot, overlays, box JSON).
Set `BROWSER_CHANNEL=msedge` (or `chrome`, or blank) in `.env` to choose the browser.

## Phase 3: element discovery with SAM 3.1

1. Put your Meta key in `.env` as `MODEL_API_KEY=...` (never share or commit it).
2. `npm run check:env`  -> should say "Meta API key set".
3. `npm run phase3`      -> offline tests (fake Meta API).
4. `npm run discover -- products.html`  -> `Discovery source: sam` means the real SAM answered.

`DISCOVERY_MODE`: `auto` (SAM if a key is set, else DOM) | `sam` (SAM or show the error) | `dom`.
SAM 3.1 takes ONE noun phrase per request, so `SAM_CONCEPTS=button,input field` becomes 2 requests.

## Phase 4: Muse Spark picks the box

```bash
npm run phase4                                                    # offline tests (fake Meta API)
npm run choose -- products.html "Add the Trail Backpack to the cart"   # real SAM + real Muse
```
Model: `MUSE_MODEL=muse-spark-1.2` (Standard tier). The `-contributor` variant is cheaper but may use your prompts for training.

## Phase 5: Locator Bridge, steps file, record and replay

```bash
npm run phase5                                           # offline tests
npm run replay -- steps/offline-sample.steps.json        # pure Playwright, no AI, no cost
npm run record -- flows/buy-backpack.json                # REAL SAM + Muse; writes steps/buy-backpack.steps.json
npm run replay -- steps/buy-backpack.steps.json
```
`steps/offline-sample.steps.json` was recorded with a stand-in model (no API calls) so you can try replay immediately.

## Troubleshooting slow or failing API calls

- Slow or dropped requests are retried automatically (`MUSE_RETRIES`, `SAM_RETRIES`, default 2).
- Time limits: `MUSE_TIMEOUT_MS` (default 150000) and `SAM_TIMEOUT_MS` (default 90000).
- `npm run record` prints how long each Muse answer took.
- Optional experiment for speed: `MUSE_REASONING_EFFORT=low` in `.env`.

## Phase 6: the Healer

```bash
npm run phase6                                                              # offline tests
npm run replay -- steps/buy-backpack.steps.json --mutation hashed-classes   # survives, no healing needed
npm run replay -- steps/buy-backpack.steps.json --mutation rename-text      # breaks at the first renamed button
npm run heal   -- steps/buy-backpack.steps.json --mutation rename-text      # real SAM + Muse repair it, patch written
npm run heal   -- steps/buy-backpack.steps.json --mutation rename-text --write   # also update the steps file
```
Mutations (simulated redesigns): `wrappers`, `hashed-classes`, `rename-text`, `all` (comma-separate to combine).
Patches land in `patches/`. The Healer refuses to repair when Muse is unsure (< 0.6), picks a different kind of
action, cannot find the element, or the repaired step ends on a different page than before.

Note on `git apply`: run it from the root of a git repository that contains `steps/`. If your project folder sits inside a
different repository (for example your whole home folder), git silently skips the patch while still reporting success.
`--write` always works.

## Phase 7: the benchmark

```bash
npm run benchmark                 # free: CSS, XPath, hand-written semantic locators, Synthetix replay
npm run benchmark -- --heal       # adds Synthetix + Healer with the REAL SAM + Muse (costs API calls)
npm run benchmark -- --heal --runs 3 --only rename-text,everything
```
Writes `benchmark/results.md` (a table for your submission) and `benchmark/results.json`.
A run counts as a pass only if every step ran AND the order holds exactly one Trail Backpack ($59.00),
so a test that silently buys the wrong item is reported as a false pass.
The synthetic "stand-in model" used in `npm run phase7` is for testing the harness only; never publish its numbers.
