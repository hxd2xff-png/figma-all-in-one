export const PAIR_ADJUSTMENTS: Record<string, number> = {
  AV: -8, AW: -7, AY: -9, FA: -5, LT: -4, LY: -6, PA: -5, Ta: -6, Te: -5, To: -8, Tr: -4, Tu: -5, Va: -7, Ve: -6, Vo: -7, Wa: -8, We: -6, Wo: -7, Ya: -8, Yo: -8,
  '.,': -4, ':"': -6, '"A': -4, '"T': -5, "'A": -4, "'T": -5,
};

export function getPairAdjustment(pair: string): number { return PAIR_ADJUSTMENTS[pair] ?? 0; }

export type AutoKerningResult = { applied: number; skipped: number };

export function applyAutoKerning(node: TextNode, manualPair?: string, manualValue?: number): AutoKerningResult {
  const text = node.characters || '';
  if (!text || text.length < 2) return { applied: 0, skipped: 0 };
  const marker = JSON.stringify({ text, rules: PAIR_ADJUSTMENTS });
  if (node.getPluginData('auto-kerning') === marker) return { applied: 0, skipped: text.length - 1 };
  let applied = 0; let skipped = 0;
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    const value = manualPair && pair === manualPair ? (manualValue || 0) : getPairAdjustment(pair);
    if (!value || !/[A-Za-z]/.test(pair[0])) { skipped++; continue; }
    node.setRangeLetterSpacing(i, i + 1, { unit: 'PERCENT', value });
    applied++;
  }
  node.setPluginData('auto-kerning', marker);
  return { applied, skipped };
}

