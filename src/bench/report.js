import { ARM_LABELS } from './arms.js';
import { SCENARIOS } from './runner.js';

export function cellText(cell) {
  if (!cell) return '— not run';
  const runs = cell.runs;
  if (runs.length > 1) {
    const ok = runs.filter((r) => r.verdict === 'pass').length;
    const healed = Math.round(runs.reduce((a, r) => a + r.healed, 0) / runs.length);
    return `${ok === runs.length ? '✅' : ok === 0 ? '❌' : '🟡'} ${ok}/${runs.length} runs${healed ? ` (~${healed} healed)` : ''}`;
  }
  const r = runs[0];
  if (r.verdict === 'pass') return `✅ ${r.passed}/${r.total}${r.healed ? ` (${r.healed} healed)` : ''}`;
  if (r.verdict === 'wrong-result') return `⚠️ wrong result`;
  return `❌ stops at step ${r.failedAt}`;
}

export function scoreOf(results, armId) {
  const cells = results.filter((c) => c.arm === armId);
  const pass = cells.filter((c) => c.runs.every((r) => r.verdict === 'pass')).length;
  return { pass, total: cells.length };
}

export function renderMarkdown(results, meta = {}) {
  const arms = [...new Set(results.map((c) => c.arm))];
  const scenarios = SCENARIOS.filter((s) => results.some((c) => c.scenario === s.id));
  const head = `| Approach | ${scenarios.map((s) => s.label).join(' | ')} | Score |`;
  const sep = `|---|${scenarios.map(() => '---').join('|')}|---|`;
  const rows = arms.map((a) => {
    const cells = scenarios.map((s) => cellText(results.find((c) => c.arm === a && c.scenario === s.id)));
    const sc = scoreOf(results, a);
    return `| ${ARM_LABELS[a]} | ${cells.join(' | ')} | **${sc.pass}/${sc.total}** |`;
  });
  return [
    '# Synthetix benchmark',
    '',
    `Flow: 9-step checkout (${meta.stepsFile ?? 'steps file'}), run on a mock shop that is changed on purpose.`,
    `Generated: ${meta.when ?? new Date().toISOString()}`,
    '',
    head, sep, ...rows,
    '',
    '**Legend.** ✅ all steps ran AND the order contained exactly one Trail Backpack ($59.00). ❌ the test stopped at the shown step. ⚠️ every step ran without error but the wrong item was bought (a false pass, the most dangerous outcome). "(n healed)" = locators repaired automatically.',
    '',
    '**Scenarios.** Layout wrappers: an extra `<div>` around every control. Hashed CSS classes: every class renamed to random text, page looks identical. Reordered products: product cards shown in reverse order. Renamed wording: button, link and field text changed ("Place order" becomes "Complete purchase"). Everything: all four together.',
    '',
    '**How to read this honestly.** Hand-written semantic locators and the saved Synthetix locators survive layout and class changes, but break when the wording changes. The selector approaches show the opposite: they survive wording changes but break on structure, and position-based ones can silently click the wrong thing. The Healer is what lets Synthetix recover when the wording changes too.',
    '',
  ].join('\n');
}
