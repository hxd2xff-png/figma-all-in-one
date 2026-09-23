export const PAIR_ADJUSTMENTS: Record<string, number> = {
  AV: -8, AW: -7, AY: -9, FA: -5, LT: -4, LY: -6, PA: -5, Ta: -6, Te: -5, To: -8, Tr: -4, Tu: -5, Va: -7, Ve: -6, Vo: -7, Wa: -8, We: -6, Wo: -7, Ya: -8, Yo: -8,
  '.,': -4, ':"': -6, '"A': -4, '"T': -5, "'A": -4, "'T": -5,
};

export function getPairAdjustment(pair: string): number { return PAIR_ADJUSTMENTS[pair] ?? 0; }

export type AutoKerningResult = { applied: number; skipped: number };

export function applyAutoKerning(node: TextNode, pairedOuterValue = -45): AutoKerningResult {
  const text = node.characters || '';
  if (!text || text.length < 2) return { applied: 0, skipped: 0 };

  let applied = 0; let skipped = 0;
  const pairs: Record<string, string> = {
    '(': ')', '[': ']', '{': '}',
    '（': '）', '［': '］', '｛': '｝', '＜': '＞',
    '【': '】', '〔': '〕', '〖': '〗', '〘': '〙', '〚': '〛',
    '《': '》', '〈': '〉', '“': '”', '‘': '’', '「': '」', '『': '』',
    '﹁': '﹂', '﹃': '﹄', '﹙': '﹚', '﹛': '﹜', '﹝': '﹞',
  };
  const stack: Array<{ ch: string; index: number }> = [];
  const matched: Array<[number, number]> = [];
  for (let i = 0; i < text.length; i++) {
    if (pairs[text[i]]) stack.push({ ch: text[i], index: i });
    else { const at = stack.length - 1; if (at >= 0 && pairs[stack[at].ch] === text[i]) matched.push([stack.pop()!.index, i]); }
  }
  const pairedIndexes = new Set<number>();
  const excludedStandalone = new Set(['#', '*', '¥', '·', '~', '%', '&', '.', '/', '\\', '-', '+']);
  for (const [open, close] of matched) { pairedIndexes.add(open); pairedIndexes.add(close); }
  for (let i = 0; i < text.length;) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const end = i + ch.length;
    if (end >= text.length) { skipped++; i = end; continue; }
    if (/\s/.test(ch)) { skipped++; i = end; continue; }
    const isSymbol = /[\p{P}\p{S}]/u.test(ch);
    if (!isSymbol || pairedIndexes.has(i) || excludedStandalone.has(ch)) { skipped++; i = end; continue; }
    node.setRangeLetterSpacing(i, end, { unit: 'PERCENT', value: -30 });
    applied++;
    i = end;
  }

  for (const [open, close] of matched) {
    const value = /[\u3000-\u303F\uFF00-\uFFEF]/u.test(text[open]) && /[\u3000-\u303F\uFF00-\uFFEF]/u.test(text[close]) ? pairedOuterValue : 0;
    if (open > 0) {
      const prevStart = open > 1 && /[\uD800-\uDBFF]/.test(text[open - 2]) ? open - 2 : open - 1;
      node.setRangeLetterSpacing(prevStart, open, { unit: 'PERCENT', value });
      applied++;
    }
    const closeEnd = close + (close + 1 < text.length && /[\uD800-\uDBFF]/.test(text[close + 1]) ? 2 : 1);
    if (closeEnd < text.length) { node.setRangeLetterSpacing(close, closeEnd, { unit: 'PERCENT', value }); applied++; }
  }

  return { applied, skipped };
}



