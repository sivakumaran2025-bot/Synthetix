# Synthetix benchmark

Flow: 9-step checkout (steps\buy-backpack.steps.json), run on a mock shop that is changed on purpose.
Generated: 2026-11-02T13:16:49.572Z

| Approach | Renamed wording | Everything at once | Score |
|---|---|---|---|
| CSS selectors (DevTools "Copy selector") | ✅ 9/9 | ❌ stops at step 1 | **1/2** |
| XPath (DevTools "Copy XPath") | ✅ 9/9 | ❌ stops at step 1 | **1/2** |
| Playwright getByRole / getByLabel (hand-written) | ❌ stops at step 1 | ❌ stops at step 1 | **0/2** |
| Synthetix replay (saved locators, no healing) | ❌ stops at step 1 | ❌ stops at step 1 | **0/2** |
| Synthetix + Healer (SAM 3.1 + Muse Spark) | ✅ 3/3 runs (~7 healed) | ✅ 3/3 runs (~7 healed) | **2/2** |

**Legend.** ✅ all steps ran AND the order contained exactly one Trail Backpack ($59.00). ❌ the test stopped at the shown step. ⚠️ every step ran without error but the wrong item was bought (a false pass, the most dangerous outcome). "(n healed)" = locators repaired automatically.

**Scenarios.** Layout wrappers: an extra `<div>` around every control. Hashed CSS classes: every class renamed to random text, page looks identical. Reordered products: product cards shown in reverse order. Renamed wording: button, link and field text changed ("Place order" becomes "Complete purchase"). Everything: all four together.

**How to read this honestly.** Hand-written semantic locators and the saved Synthetix locators survive layout and class changes, but break when the wording changes. The selector approaches show the opposite: they survive wording changes but break on structure, and position-based ones can silently click the wrong thing. The Healer is what lets Synthetix recover when the wording changes too.
