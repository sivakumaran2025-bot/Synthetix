// Writes a git-style unified diff (the format `git apply` and `patch` understand). No dependencies.
const lines = (t) => { const a = t.split('\n'); if (a[a.length - 1] === '') a.pop(); return a; };

// Line-by-line edit script via longest-common-subsequence (files here are small).
function editScript(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = a.slice(0, start).map((l) => ({ t: ' ', l }));
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { ops.push({ t: ' ', l: A[i] }); i++; j++; }
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: '+', l: B[j++] }); }
    else { ops.push({ t: '-', l: A[i++] }); }
  }
  for (const l of a.slice(endA)) ops.push({ t: ' ', l });
  return ops;
}

export function unifiedDiff(oldText, newText, { path: file, context = 3 }) {
  if (oldText === newText) return '';
  const ops = editScript(lines(oldText), lines(newText));
  const changed = ops.map((o, i) => (o.t === ' ' ? -1 : i)).filter((i) => i >= 0);
  const groups = [];
  for (const idx of changed) {
    const last = groups[groups.length - 1];
    if (last && idx - last.end <= 2 * context) last.end = idx; else groups.push({ start: idx, end: idx });
  }
  const out = [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`];
  for (const g of groups) {
    const from = Math.max(0, g.start - context);
    const to = Math.min(ops.length - 1, g.end + context);
    let oldStart = 1, newStart = 1;
    for (let i = 0; i < from; i++) { if (ops[i].t !== '+') oldStart++; if (ops[i].t !== '-') newStart++; }
    const slice = ops.slice(from, to + 1);
    const oldLen = slice.filter((o) => o.t !== '+').length;
    const newLen = slice.filter((o) => o.t !== '-').length;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const o of slice) out.push(o.t + o.l);
  }
  return out.join('\n') + '\n';
}
