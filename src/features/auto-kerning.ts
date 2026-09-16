export const PAIR_ADJUSTMENTS: Record<string, number> = {
  AV: -8, AW: -7, AY: -9, FA: -5, LT: -4, LY: -6, PA: -5, Ta: -6, Te: -5, To: -8, Tr: -4, Tu: -5, Va: -7, Ve: -6, Vo: -7, Wa: -8, We: -6, Wo: -7, Ya: -8, Yo: -8,
  '.,': -4, ':"': -6, '"A': -4, '"T': -5, "'A": -4, "'T": -5,
};

export function getPairAdjustment(pair: string): number { return PAIR_ADJUSTMENTS[pair] ?? 0; }

export type AutoKerningResult = { applied: number; skipped: number };

export function applyAutoKerning(node: TextNode): AutoKerningResult {
  const text = node.characters || '';
  if (!text || text.length < 2) return { applied: 0, skipped: 0 };
  const marker = JSON.stringify({ version: 4, text });
  if (node.getPluginData('auto-kerning') === marker) return { applied: 0, skipped: text.length - 1 };
  let applied = 0; let skipped = 0;
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '（': '）', '［': '］', '【': '】', '《': '》', '〈': '〉', '“': '”', '‘': '’', '「': '」', '『': '』', '｛': '｝' };
  const stack: Array<{ ch: string; index: number }> = [];
  const matched: Array<[number, number]> = [];
  for (let i = 0; i < text.length; i++) {
    if (pairs[text[i]]) stack.push({ ch: text[i], index: i });
    else { const at = stack.length - 1; if (at >= 0 && pairs[stack[at].ch] === text[i]) matched.push([stack.pop()!.index, i]); }
  }
  for (const [open, close] of matched) {
    if (open > 0) { node.setRangeLetterSpacing(open - 1, open, { unit: 'PERCENT', value: -24 }); applied++; }
    if (close < text.length - 1) { node.setRangeLetterSpacing(close, close + 1, { unit: 'PERCENT', value: -24 }); applied++; }
  }
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    if (/\s/.test(pair[0]) || /\s/.test(pair[1])) { skipped++; continue; }
    const isSymbol = (ch: string) => /[\p{P}\p{S}]/u.test(ch);
    if (!isSymbol(pair[0]) && !isSymbol(pair[1])) { skipped++; continue; }
    const value = getPairAdjustment(pair) || -12;
    node.setRangeLetterSpacing(i, i + 1, { unit: 'PERCENT', value });
    applied++;
  }
  node.setPluginData('auto-kerning', marker);
  return { applied, skipped };
}


