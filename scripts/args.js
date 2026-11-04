// Tiny command-line reader: positional words plus --flag and --name value.
export function parseArgs(argv, valueFlags = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (valueFlags.includes(name)) flags[name] = argv[++i];
      else flags[name] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}
