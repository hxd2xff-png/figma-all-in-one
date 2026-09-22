// 功能① 字体混排：中英文各自字体/字号/颜色，按字符区间设置
// TextNode / FontName / RGB 为 Figma 全局类型
//
// 目标字体并行加载；先整体设置 fontName，再分段设置字体/字号/颜色。
// 整体替换只需加载新字体，避免旧字体不可用或加载缓慢阻塞应用。
// 参考 MixFonts 的应用顺序，保留本项目的字符分类和逐节点错误反馈。

export interface FontMixConfig {
  cnFont: FontName; // 中文字体（family+style）
  enFont: FontName; // 英文字体
  cnSize: number | null; // 中文号；null = 不改
  enSize: number | null; // 英文号；null = 不改
  cnColor: RGB | null; // 中文字色；null = 不改
  enColor: RGB | null; // 英文字色；null = 不改
  symbolFontSide?: 'cn' | 'en'; // 符号使用哪一侧字体；默认沿用旧规则
  applyColors?: boolean; // 是否同步应用中英文颜色；默认不改颜色
}

export interface FontMixResult {
  ok: number; // 成功处理的文本节点数
  failed: { name: string; reason: string }[]; // 逐个失败的节点与原因
  missingFonts: string[]; // 本机不可用的目标字体
  timedOut: boolean; // 是否出现字体加载超时（结果可能不完整，但要如实告知）
}

// 按中英分别识别出的现有属性（用于面板「识别选中图层」回填）
export interface DetectedFontMix {
  cnFont: FontName | null;
  enFont: FontName | null;
  cnSize: number | null;
  enSize: number | null;
  cnColor: RGB | null;
  enColor: RGB | null;
  cnSizeMixed?: boolean;
  enSizeMixed?: boolean;
}

export function fontLabel(f: FontName): string {
  return f ? `${f.family} ${f.style}` : '(空字体)';
}

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return String(m || '未知错误').slice(0, 90);
}

// 判断字符是否属于 CJK（含汉字/假名/全角标点）
// 注：一律用 \uXXXX 转义书写，避免裸控制字节被工具链破坏（曾踩过坑）
function isCJK(ch: string): boolean {
  return /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF\uFF00-\uFFEF]/.test(ch);
}

function isSymbol(ch: string): boolean {
  return /[\p{P}\p{S}]/u.test(ch);
}

function isRomanNumeral(ch: string): boolean {
  return /[\u2160-\u2188]/u.test(ch);
}

function isChineseSide(ch: string, symbolFontSide?: 'cn' | 'en'): boolean {
  if (isRomanNumeral(ch)) return true;
  if (symbolFontSide && isSymbol(ch)) return symbolFontSide === 'cn';
  return isCJK(ch);
}

function applyChinesePairSpacing(node: TextNode, symbolFontSide?: 'cn' | 'en') {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '（': '）', '［': '］', '【': '】', '《': '》', '〈': '〉', '“': '”', '‘': '’', '「': '」', '『': '』', '｛': '｝' };
  const stack: Array<{ ch: string; index: number }> = [];
  const matched: Array<[number, number]> = [];
  const text = node.characters || '';
  for (let i = 0; i < text.length; i++) {
    if (pairs[text[i]]) stack.push({ ch: text[i], index: i });
    else if (stack.length && pairs[stack[stack.length - 1].ch] === text[i]) matched.push([stack.pop()!.index, i]);
  }
  for (const [open, close] of matched) {
    // 只微调中文输入法产生的全角/中文成对标点；英文输入法产生的
    // ASCII 成对符号不参与。间距判断独立于「符号用中文/英文」字体按钮。
    if (!isCJK(text[open]) || !isCJK(text[close])) continue;
    if (open > 0) node.setRangeLetterSpacing(open - 1, open, { unit: 'PERCENT', value: -45 });
    if (close < text.length - 1) node.setRangeLetterSpacing(close, close + 1, { unit: 'PERCENT', value: -45 });
  }
}

/* ============================================================
   字体加载：统一带超时
   ============================================================ */

// 单次字体加载的超时上限。Figma 的 loadFontAsync 在少数情况下（字体需联网下载、
// 字体库异常、节点上带有无法解析的字体）会长时间不返回；超过此值即放弃等待。
const FONT_LOAD_TIMEOUT_MS = 4000;

type LoadOutcome = 'ok' | 'missing' | 'timeout';

// 按运行时字体加载器缓存成功/进行中的请求；失败可重试。
const fontLoads = new WeakMap<typeof figma.loadFontAsync, Map<string, Promise<LoadOutcome>>>();
function loadFontSafe(f: FontName): Promise<LoadOutcome> {
  const loader = figma.loadFontAsync;
  let cache = fontLoads.get(loader);
  if (!cache) { cache = new Map(); fontLoads.set(loader, cache); }
  const key = JSON.stringify([f.family, f.style]);
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.resolve().then(() => figma.loadFontAsync(f)).then(
      (): LoadOutcome => 'ok',
      (): LoadOutcome => { cache!.delete(key); return 'missing'; },
    );
    cache.set(key, pending);
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      // 尚在加载的请求继续复用，迟到的成功结果供下一次点击使用。
      resolve('timeout');
    }, FONT_LOAD_TIMEOUT_MS);
    pending!.then(outcome => { clearTimeout(timer); resolve(outcome); });
  });
}

export async function warmFontPresets(presets: unknown): Promise<void> {
  if (!Array.isArray(presets)) return;
  const fonts = new Map<string, FontName>();
  for (const preset of presets) {
    for (const f of [preset?.cnFont, preset?.enFont]) {
      if (f && typeof f.family === 'string' && typeof f.style === 'string') {
        fonts.set(JSON.stringify([f.family, f.style]), f);
      }
    }
  }
  await Promise.all(Array.from(fonts.values(), loadFontSafe));
}

/* ============================================================
   应用字体混排
   ============================================================ */

export async function applyFontMix(nodes: TextNode[], cfg: FontMixConfig): Promise<FontMixResult> {
  const result: FontMixResult = { ok: 0, failed: [], missingFonts: [], timedOut: false };
  if (nodes.length === 0) return result;

  // 两种目标字体一起加载；未就绪时不修改文档。
  const targets: FontName[] = [];
  if (cfg) {
    for (const f of [cfg.cnFont, cfg.enFont]) {
      if (!f || !f.family) continue;
      if (!targets.some((t) => t.family === f.family && t.style === f.style)) targets.push(f);
    }
  }
  const outcomes = await Promise.all(targets.map(loadFontSafe));
  outcomes.forEach((outcome, i) => {
    if (outcome === 'missing') result.missingFonts.push(fontLabel(targets[i]));
    else if (outcome === 'timeout') result.timedOut = true;
  });
  if (result.missingFonts.length) return result;
  if (result.timedOut) {
    result.failed = nodes.map(node => ({ name: node.name, reason: '目标字体加载超时，尚未修改，请重试' }));
    return result;
  }

  // ---- 2. 逐节点处理，单个失败不影响其余 ----
  for (const node of nodes) {
    try {
      const text = node.characters;
      if (!text) {
        result.ok++; // 空文本：无需处理，也不算失败
        continue;
      }

      // fontName 整体赋值只依赖新字体；此后所有区间都使用已加载字体。
      node.fontName = cfg.cnFont;

      let start = 0;
      let prev = isChineseSide(text[0], cfg.symbolFontSide);
      for (let i = 1; i < text.length; i++) {
        const cur = isChineseSide(text[i], cfg.symbolFontSide);
        if (cur !== prev) {
          applyRange(node, start, i, prev, cfg);
          prev = cur;
          start = i;
        }
      }
      applyRange(node, start, text.length, prev, cfg);
      applyChinesePairSpacing(node, cfg.symbolFontSide);
      result.ok++;
    } catch (e) {
      result.failed.push({ name: node.name, reason: errText(e) });
    }
  }

  return result;
}

function applyRange(node: TextNode, start: number, end: number, cjk: boolean, cfg: FontMixConfig) {
  const font = cjk ? cfg.cnFont : cfg.enFont;
  if (font && font.family) node.setRangeFontName(start, end, font);

  const size = cjk ? cfg.cnSize : cfg.enSize;
  if (size != null) node.setRangeFontSize(start, end, size);

  if (cfg.applyColors) {
    const color = cjk ? cfg.cnColor : cfg.enColor;
    if (color != null) node.setRangeFills(start, end, [{ type: 'SOLID', color }]);
  }
}

/* ============================================================
   识别：中英文各自的字体 / 字号 / 颜色
   ------------------------------------------------------------
   旧实现的两个错误（用户实测反馈）：
     · cnFont 与 enFont 被赋成同一个值，cnSize/enSize 同理 —— 中英根本没有分开识别；
     · 取值只用了 getRangeFontName(0, 1)，即「第 1 个字符」，
       所以面板里永远显示第一个字符的字体与字号。
   字体/颜色取各语言首字符；字号遍历全部选中文本，分别汇总中英字号。
   ============================================================ */

export function detectFontMix(input: TextNode | TextNode[]): DetectedFontMix {
  const out: DetectedFontMix = {
    cnFont: null, enFont: null, cnSize: null, enSize: null, cnColor: null, enColor: null,
    cnSizeMixed: false, enSizeMixed: false,
  };
  const nodes = Array.isArray(input) ? input : [input];
  const sizes = { cn: new Set<number>(), en: new Set<number>() };
  const seen = { cn: false, en: false };
  const unknown = { cn: false, en: false };
  for (const node of nodes) {
    const text = node.characters || '';
    for (let i = 0; i < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(i)!);
      const end = i + ch.length;
      if (!/\s/.test(ch)) {
        const side = isCJK(ch) ? 'cn' : 'en';
        if (!seen[side]) {
          try {
            const font = node.getRangeFontName(i, end);
            if (typeof font === 'object' && font) out[`${side}Font`] = font;
          } catch { /* 字体读取失败不影响字号 */ }
          try {
            const fills = node.getRangeFills(i, end);
            if (Array.isArray(fills)) {
              const solid = fills.find(p => p.type === 'SOLID') as SolidPaint | undefined;
              if (solid) out[`${side}Color`] = solid.color;
            }
          } catch { /* 颜色读取失败不影响字号 */ }
        }
        seen[side] = true;
        try {
          const size = node.getRangeFontSize(i, end);
          if (typeof size === 'number' && Number.isFinite(size)) sizes[side].add(size);
          else unknown[side] = true;
        } catch { unknown[side] = true; }
      }
      i = end;
    }
  }
  for (const side of ['cn', 'en'] as const) {
    // 只有该语言完全缺席时才互补；不能用另一个语言掩盖混合字号。
    const source = seen[side] ? side : side === 'cn' ? 'en' : 'cn';
    out[`${side}Size`] = !unknown[source] && sizes[source].size === 1
      ? Array.from(sizes[source])[0] : null;
    out[`${side}SizeMixed`] = sizes[source].size > 1;
    if (!seen[side]) {
      out[`${side}Font`] = out[`${source}Font`];
      out[`${side}Color`] = out[`${source}Color`];
    }
  }
  return out;
}

/* ============================================================
   字体家族聚合（面板启动速度的关键）
   ------------------------------------------------------------
   Figma 的 listAvailableFontsAsync() 返回的是「family + style」的**扁平组合**。
   装了设计/办公全家桶的机器上，这个数组常有 6000~10000 条，绝大多数是同一
   家族的不同字重（如 Inter 一个家族就有 Thin…Black 十几个 style）。
   原样传给 UI 会带来三重浪费：跨进程序列化体积、两个下拉各建 N 个 DOM、
   下拉打开时再渲染 N 行。

   这里按 family 聚合为 [{family, styles:[…]}]：
     · 条数通常降到原来的 1/5 ~ 1/8（实测 8000 → 约 800）
     · UI 侧得以「先挑家族、再挑字重」，DOM 数量再降一个数量级
   ============================================================ */
export interface FontFamily {
  family: string;
  styles: string[];
}

export function collapseFontFamilies(fonts: { fontName: FontName }[]): FontFamily[] {
  const map = new Map<string, string[]>();
  for (const f of fonts || []) {
    const n = f && f.fontName;
    if (!n || !n.family) continue;
    const styles = map.get(n.family);
    if (styles) {
      if (!styles.includes(n.style)) styles.push(n.style);
    } else {
      map.set(n.family, [n.style]);
    }
  }
  const out: FontFamily[] = [];
  map.forEach((styles, family) => out.push({ family, styles }));
  // 家族按名称排序：用户找字体靠肌肉记忆，每次打开的顺序必须稳定
  out.sort((a, b) => a.family.localeCompare(b.family));
  return out;
}
