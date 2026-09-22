// 字体混排的容错逻辑验证（mock figma 全局对象）
// 前置：esbuild src/features/font-mixer.ts --bundle --format=cjs --platform=node --outfile=scripts/.fontmix.cjs
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
};

// ---- mock figma：只认白名单里的字体，其余抛错（模拟「本机没装这个字体」）----
const AVAILABLE = new Set(['CN Regular', 'EN Regular', 'Old Regular', 'Alt Regular']);
let loaded = [];
global.figma = {
  loadFontAsync: async (f) => {
    const key = f.family + ' ' + f.style;
    loaded.push(key);
    if (!AVAILABLE.has(key)) throw new Error('Font not found: ' + f.family);
  },
};

const { warmFontPresets, applyFontMix, detectFontMix, collapseFontFamilies } = require(path.join(__dirname, '.fontmix.cjs'));

const F = (family, style) => ({ family, style });
const CN = F('CN', 'Regular');
const EN = F('EN', 'Regular');
const cfg = (over) => Object.assign({
  cnFont: CN, enFont: EN, cnSize: null, enSize: null, cnColor: null, enColor: null,
}, over);

// mock 文本节点：记录 setRange* 调用
function textNode(name, chars, opts = {}) {
  const calls = [];
  let baseFont = null;
  return {
    calls, type: 'TEXT', name, characters: chars,
    set fontName(f) { if (opts.throwOnSet) throw new Error('boom'); baseFont = f; },
    get fontName() { return baseFont; },
    getRangeAllFontNames: () => opts.mixedFonts || [F('Old', 'Regular')],
    setRangeFontName: (s, e, f) => {
      if (opts.throwOnSet) throw new Error('boom');
      if (!baseFont) throw new Error('Old fonts are not loaded: replace fontName first');
      calls.push(['font', s, e, f.family + ' ' + f.style]);
    },
    setRangeFontSize: (s, e, n) => calls.push(['size', s, e, n]),
    setRangeFills: (s, e, p) => calls.push(['fill', s, e, p.length]),
    setRangeLetterSpacing: (s, e, v) => calls.push(['spacing', s, e, v.value]),
  };
}
const fontCalls = (n) => n.calls.filter((c) => c[0] === 'font');

(async () => {
  console.log('=== 1. 中英区间划分（逐段设置）===');
  {
    const n = textNode('混合文本', '中文abc中文');
    const r = await applyFontMix([n], cfg());
    ok('成功计数 = 1', r.ok === 1 && r.failed.length === 0 && r.missingFonts.length === 0, JSON.stringify(r));
    const got = JSON.stringify(fontCalls(n));
    ok('划成「中/英/中」三段且区间正确',
      got === JSON.stringify([
        ['font', 0, 2, 'CN Regular'],
        ['font', 2, 5, 'EN Regular'],
        ['font', 5, 7, 'CN Regular'],
      ]), got);
  }
  {
    const n = textNode('纯英文', 'ABC');
    await applyFontMix([n], cfg());
    ok('纯英文 = 单段 [0,3)',
      JSON.stringify(fontCalls(n)) === JSON.stringify([['font', 0, 3, 'EN Regular']]), JSON.stringify(fontCalls(n)));
  }

  console.log('=== 2. 目标字体本机不可用 → 整体中止并明确上报 ===');
  {
    const n = textNode('文本', '中文abc');
    const r = await applyFontMix([n], cfg({ cnFont: F('Missing', 'Regular') }));
    ok('missingFonts 点名缺失字体', r.missingFonts.length === 1 && r.missingFonts[0] === 'Missing Regular', JSON.stringify(r.missingFonts));
    ok('未改动任何节点（不产生半成品）', n.calls.length === 0, JSON.stringify(n.calls));
    ok('ok 计数为 0', r.ok === 0);
  }

  {
    const n = textNode('默认不改颜色', '中文abc');
    await applyFontMix([n], cfg({ cnColor: { r: 1, g: 0, b: 0 }, enColor: { r: 0, g: 0, b: 1 } }));
    ok('默认不调整颜色', n.calls.every((c) => c[0] !== 'fill'), JSON.stringify(n.calls));
    const n2 = textNode('开启颜色', '中文abc');
    await applyFontMix([n2], cfg({ applyColors: true, cnColor: { r: 1, g: 0, b: 0 }, enColor: { r: 0, g: 0, b: 1 } }));
    ok('左侧按钮可同步颜色', n2.calls.filter((c) => c[0] === 'fill').length === 2, JSON.stringify(n2.calls));
  }

  console.log('=== 符号字体归属 ===');
  {
    const cnSymbols = textNode('中文符号', '中!A文');
    await applyFontMix([cnSymbols], cfg({ symbolFontSide: 'cn' }));
    ok('符号归中文字体', JSON.stringify(fontCalls(cnSymbols)) === JSON.stringify([
      ['font', 0, 2, 'CN Regular'],
      ['font', 2, 3, 'EN Regular'],
      ['font', 3, 4, 'CN Regular'],
    ]), JSON.stringify(fontCalls(cnSymbols)));

    const enSymbols = textNode('英文符号', '中!A文');
    await applyFontMix([enSymbols], cfg({ symbolFontSide: 'en' }));
    ok('符号归英文字体', JSON.stringify(fontCalls(enSymbols)) === JSON.stringify([
      ['font', 0, 1, 'CN Regular'],
      ['font', 1, 3, 'EN Regular'],
      ['font', 3, 4, 'CN Regular'],
    ]), JSON.stringify(fontCalls(enSymbols)));
  }

  {
    const n = textNode('中文成对标点', '中（A）文');
    await applyFontMix([n], cfg({ symbolFontSide: 'cn' }));
    ok('罗马数字始终使用中文字体', JSON.stringify(fontCalls(await (async () => { const r = textNode('罗马数字', 'AⅣB'); await applyFontMix([r], cfg({ symbolFontSide: 'en' })); return r; })())) === JSON.stringify([
      ['font', 0, 1, 'EN Regular'], ['font', 1, 2, 'CN Regular'], ['font', 2, 3, 'EN Regular'],
    ]));
    ok('中文状态成对标点外侧缩小间距', n.calls.filter((c) => c[0] === 'spacing').length === 2, JSON.stringify(n.calls));
    const en = textNode('英文成对符号', 'A(B)C');
    await applyFontMix([en], cfg({ symbolFontSide: 'cn' }));
    ok('英文成对符号不调整外侧间距', en.calls.filter((c) => c[0] === 'spacing').length === 0, JSON.stringify(en.calls));
  }

  console.log('=== 3. 单节点失败不拖累其它节点 ===');
  {
    const a = textNode('A', '中文abc');
    const b = textNode('B', '中文abc', { throwOnSet: true });
    const c = textNode('C', '中文abc');
    const r = await applyFontMix([a, b, c], cfg());
    ok('成功 2 个、失败 1 个', r.ok === 2 && r.failed.length === 1, JSON.stringify({ ok: r.ok, failed: r.failed }));
    ok('失败项带节点名与原因', r.failed[0].name === 'B' && /boom/.test(r.failed[0].reason), JSON.stringify(r.failed[0]));
    ok('后续节点仍被处理（中文abc = 中/英 两段）', fontCalls(c).length === 2, JSON.stringify(fontCalls(c)));
  }

  console.log('=== 4. 边界：空文本 / 空选区 ===');
  {
    const n = textNode('空文本', '');
    const r = await applyFontMix([n], cfg());
    ok('空文本算成功且不产生调用', r.ok === 1 && n.calls.length === 0);
    const r2 = await applyFontMix([], cfg());
    ok('空选区返回 0 且不报错', r2.ok === 0 && r2.failed.length === 0);
  }

  console.log('=== 5. 多字体混排直接替换，不加载旧字体 ===');
  {
    loaded = [];
    const n = textNode('MIXED', '中文abc', { mixedFonts: [F('Old', 'Regular'), F('Alt', 'Regular')] });
    await applyFontMix([n], cfg());
    ok('不再加载 Old/Alt',
      !loaded.includes('Old Regular') && !loaded.includes('Alt Regular'), JSON.stringify(loaded));
    ok('缓存字体也可直接应用', n.fontName.family === 'CN');
  }

  console.log('=== 6. 仅设置显式提供的字号 / 颜色 ===');
  {
    const n = textNode('文本', '中文abc');
    await applyFontMix([n], cfg());
    ok('未提供字号/颜色时不产生 size/fill 调用',
      n.calls.every((c) => c[0] === 'font'), JSON.stringify(n.calls));

    const n2 = textNode('文本', '中文abc');
    await applyFontMix([n2], cfg({ applyColors: true, cnSize: 14, enSize: 12, cnColor: { r: 1, g: 0, b: 0 }, enColor: { r: 0, g: 0, b: 1 } }));
    const kinds = n2.calls.map((c) => c[0]).join(',');
    ok('提供后按段设置字号与颜色', kinds === 'font,size,fill,font,size,fill', kinds);
  }

  console.log('=== 7. 同一字体只预检一次 ===');
  {
    loaded = [];
    await applyFontMix([textNode('文本', '中文')], cfg({ enFont: CN }));
    ok('中英同字体时 load 去重',
      loaded.filter((x) => x === 'CN Regular').length <= 1, JSON.stringify(loaded));
  }

  console.log('=== 8. 回归：节点现有字体加载挂起时不得卡死 ===');
  {
    // 复现用户现象：节点上有一个 loadFontAsync 永不返回的字体。
    // 旧实现用 Promise.all 无限等待 → applyFontMix 永不 resolve → 主进程不回包
    // → UI 永远停在「应用中…」，用户看到的就是「点应用毫无反应」。
    global.figma.loadFontAsync = (f) => {
      if (f.family === 'HANG') return new Promise(() => {});   // 永不 settle
      return Promise.resolve();
    };
    const n = textNode('挂起字体', '中文abc', { mixedFonts: [F('HANG', 'Regular')] });
    const t0 = Date.now();
    const r = await applyFontMix([n], cfg());
    const dt = Date.now() - t0;
    ok('在超时上限内返回而非挂死', dt < 1000, dt + 'ms');
    ok('旧字体挂起不影响应用', r.timedOut === false, JSON.stringify(r));
    ok('旧字体挂起仍能立即设置中英两段', fontCalls(n).length === 2, JSON.stringify(fontCalls(n)));
    ok('未产生失败项', r.failed.length === 0 && r.ok === 1, JSON.stringify(r));
  }

  console.log('=== 9. 回归：目标字体加载超时 → 不当作缺失且不修改文档 ===');
  {
    global.figma.loadFontAsync = (f) => {
      if (f.family === 'SLOW') return new Promise(() => {});
      return Promise.resolve();
    };
    const n = textNode('目标超时', '中文abc');
    const r = await applyFontMix([n], cfg({ cnFont: F('SLOW', 'Regular') }));
    ok('超时不算「本机不可用」', r.missingFonts.length === 0, JSON.stringify(r.missingFonts));
    ok('标记 timedOut', r.timedOut === true);
    ok('目标超时不改文档', r.ok === 0 && n.calls.length === 0 && n.fontName === null, JSON.stringify({ ok: r.ok, failed: r.failed }));
  }

  {
    const pending = [];
    global.figma.loadFontAsync = f => new Promise(resolve => pending.push({f, resolve}));
    const n = textNode('parallel', '中abc');
    const task = applyFontMix([n], cfg());
    await Promise.resolve();
    ok('两种字体立即并行请求', pending.length === 2);
    ok('字体未就绪不写入', n.fontName === null && n.calls.length === 0);
    pending[0].resolve();
    await Promise.resolve();
    ok('仅一个字体就绪也不写入', n.fontName === null);
    // 兼容旧实现串行请求，让回归测试能结束。
    await Promise.resolve();
    pending[1].resolve();
    const r = await task;
    ok('首次请求自动完成，不需要再次点击', r.ok === 1 && n.fontName.family === 'CN');
  }

  {
    let count = 0;
    global.figma.loadFontAsync = async () => { count++; };
    await warmFontPresets([cfg(), cfg()]);
    ok('启动预加载按字体去重', count === 2);
    const n = textNode('warm', '中abc');
    await applyFontMix([n], cfg());
    ok('应用复用启动已加载字体', count === 2 && n.fontName.family === 'CN');
  }

  // 恢复默认 mock（后续场景用）
  global.figma.loadFontAsync = async (f) => {
    const key = f.family + ' ' + f.style;
    if (!AVAILABLE.has(key)) throw new Error('Font not found: ' + f.family);
  };

  console.log('=== 10. 识别：中英文各取「自己第一个字符」的属性 ===');
  {
    // 文本 'AB中文CD'：英文在 0..2，中文在 2..4
    const node = {
      type: 'TEXT', name: 'x', characters: 'AB中文CD',
      getRangeFontName: (s) => (s < 2 ? F('ENFamily', 'Regular') : F('CNFamily', 'Regular')),
      getRangeFontSize: (s) => (s < 2 || s >= 4 ? 12 : 16),
      getRangeFills: (s) => [{ type: 'SOLID', color: s < 2 ? { r: 1, g: 0, b: 0 } : { r: 0, g: 0, b: 1 } }],
    };
    const d = detectFontMix(node);
    ok('中文侧取到中文字体', d.cnFont && d.cnFont.family === 'CNFamily', JSON.stringify(d.cnFont));
    ok('英文侧取到英文字体', d.enFont && d.enFont.family === 'ENFamily', JSON.stringify(d.enFont));
    ok('中英字体不同（旧实现两边同值）', d.cnFont.family !== d.enFont.family);
    ok('中英字号各自正确（16 / 12）', d.cnSize === 16 && d.enSize === 12, d.cnSize + ' / ' + d.enSize);
    ok('中英颜色各自正确', d.cnColor.b === 1 && d.enColor.r === 1, JSON.stringify([d.cnColor, d.enColor]));
  }

  console.log('=== 11. 识别边界：纯中文 / 纯英文 / 前置空白 / mixed ===');
  {
    const mk = (chars, fn) => ({
      type: 'TEXT', name: 'x', characters: chars,
      getRangeFontName: fn, getRangeFontSize: () => 14,
      getRangeFills: () => [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }],
    });

    // 纯中文 → 英文侧兜底复制中文侧，面板不留空
    const d1 = detectFontMix(mk('中文标题', () => F('OnlyCN', 'Regular')));
    ok('纯中文：两侧都有值', d1.cnFont.family === 'OnlyCN' && d1.enFont.family === 'OnlyCN', JSON.stringify(d1.cnFont));
    ok('纯中文：字号两侧都有', d1.cnSize === 14 && d1.enSize === 14);

    // 纯英文 → 中文侧兜底复制英文侧
    const d2 = detectFontMix(mk('Hello', () => F('OnlyEN', 'Regular')));
    ok('纯英文：两侧都有值', d2.cnFont.family === 'OnlyEN' && d2.enFont.family === 'OnlyEN');

    // 前置空白：应跳过空白取第一个实际字符
    let seen = [];
    const d3 = detectFontMix({
      type: 'TEXT', name: 'x', characters: '   A中',
      getRangeFontName: (s) => { seen.push(s); return F('F' + s, 'Regular'); },
      getRangeFontSize: () => 14,
      getRangeFills: () => [],
    });
    ok('跳过空白字符', seen.includes(3) && seen.includes(4), JSON.stringify(seen));
    ok('英文侧取到 A(3)', d3.enFont.family === 'F3', JSON.stringify(d3.enFont));

    // figma.mixed（symbol）应被安全跳过
    const mixed = Symbol('figma.mixed');
    const d4 = detectFontMix(mk('中文', () => mixed));
    ok('mixed 字体不崩且两侧为空', d4.cnFont === null && d4.enFont === null, JSON.stringify(d4.cnFont));

    // 空文本
    const d5 = detectFontMix(mk('', () => F('X', 'Regular')));
    ok('空文本返回全空对象', d5.cnFont === null && d5.enFont === null && d5.cnSize === null);
  }

  {
    const mk = (text, sizes) => ({
      characters: text,
      getRangeFontName: () => CN,
      getRangeFontSize: i => sizes[i],
      getRangeFills: () => [],
    });
    const separate = detectFontMix([mk('中文', [24,24]), mk('ABC', [12,12,12])]);
    ok('跨图层中文24/英文12分别读取', separate.cnSize === 24 && separate.enSize === 12);
    const mixed = detectFontMix(mk('中A文B', [24,12,30,12]));
    ok('中文不同字号显示混合，不取首字24', mixed.cnSize === null && mixed.cnSizeMixed === true);
    ok('中文混合不影响英文字号12', mixed.enSize === 12 && !mixed.enSizeMixed);
    const latinMixed = detectFontMix(mk('A中B文', [10,24,12,24]));
    ok('英文不同字号显示混合', latinMixed.enSize === null && latinMixed.enSizeMixed === true);
    const multiple = detectFontMix([mk('中', [20]), mk('文', [28])]);
    ok('跨图层同类字号不同也显示混合', multiple.cnSize === null && multiple.cnSizeMixed === true);
    const decimals = detectFontMix(mk('中A', [18.5,12.25]));
    ok('保留中英文小数字号', decimals.cnSize === 18.5 && decimals.enSize === 12.25);
  }

  /* ---- collapseFontFamilies：字体家族聚合（面板打开速度的关键） ----
     旧实现把 listAvailableFontsAsync 的扁平组合原样传给 UI，
     8000 条 (family,style) 会被铺进两个下拉 → 启动阻塞、DOM 爆炸。
     这里守卫聚合规则本身：家族合并、style 保序去重、排序稳定、规模收敛。 */
  {
    const fn = (family, style) => ({ fontName: { family, style } });

    const a = collapseFontFamilies([
      fn('Inter', 'Regular'), fn('Inter', 'Bold'), fn('苹方-简', 'Regular'),
    ]);
    ok('同家族合并为一条', a.length === 2, JSON.stringify(a.map((x) => x.family)));
    ok('styles 收齐且保持出现顺序',
      JSON.stringify(a.find((x) => x.family === 'Inter').styles) === '["Regular","Bold"]',
      JSON.stringify(a));
    ok('家族按名称排序（每次打开顺序稳定）',
      a[0].family.localeCompare(a[1].family) <= 0, JSON.stringify(a.map((x) => x.family)));

    const dup = collapseFontFamilies([fn('Inter', 'Bold'), fn('Inter', 'Bold')]);
    ok('重复的 family+style 去重', dup.length === 1 && dup[0].styles.length === 1, JSON.stringify(dup));

    ok('空输入返回空数组', collapseFontFamilies([]).length === 0);
    ok('null 安全', collapseFontFamilies(null).length === 0);
    ok('缺失 fontName 的项被跳过',
      collapseFontFamilies([{ fontName: null }, fn('Inter', 'Bold'), {}]).length === 1);
    ok('缺 family 的项被跳过',
      collapseFontFamilies([{ fontName: { family: '', style: 'Bold' } }]).length === 0);

    // 规模：8000 条组合 → 800 家族（UI 侧据此限量渲染）
    const big = [];
    for (let i = 0; i < 800; i++) {
      for (const s of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) big.push(fn('Fam' + i, s));
    }
    const bigOut = collapseFontFamilies(big);
    ok('8000 条组合聚合为 800 家族', bigOut.length === 800, String(bigOut.length));
    ok('每个家族的 styles 无丢失', bigOut.every((x) => x.styles.length === 10));
  }

  console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项未通过 ✗' : ' ✓'));
  process.exit(fail ? 1 : 0);
})();
