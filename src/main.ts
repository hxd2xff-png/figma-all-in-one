import { warmFontPresets, applyFontMix, detectFontMix, collapseFontFamilies, FontFamily, FontMixConfig } from './features/font-mixer';
import { applyStyles, StyleConfig, readPaintConfig } from './features/bulk-styles';
import { exportNodes, ExportConfig } from './features/export-compress';
import { applySkew, analyseSkew, pickSkewTarget, SkewConfig } from './features/skew';
import { applyAutoKerning } from './features/auto-kerning';
import { getSelectedNodes, getTextNodes, getStyleableNodes } from './shared/selection';

// 从 Paint 数组里取第一个纯色填充的颜色（无则 null）
function firstSolidColor(paints: Paint[]): RGB | null {
  for (const p of paints) {
    if (p.type === 'SOLID') return p.color;
  }
  return null;
}

// 构建时由 esbuild 注入的 UI 面板 HTML 字符串（见 esbuild.config.js 的 define）
declare const __html__: string;

// 插件内核：打开 UI，按消息类型路由到四个功能模块
// 注意：第一个参数必须是 HTML 字符串，Figma 运行时会严格校验，
// 传 undefined / 省略都会报 "Property showUI failed validation: Required value missing"
figma.showUI(__html__, { width: 400, height: 920 });

/* ============================================================
   方案预设的持久化
   ------------------------------------------------------------
   为什么不能用 localStorage：Figma 把插件 UI 的 HTML 以 data: URL 塞进 iframe，
   这种页面没有域名（opaque origin），浏览器会直接拒绝 localStorage / cookie
   的读写（SecurityError）。而 iframe 里取不到 figma.* API，
   所以持久化只能由主线程通过 figma.clientStorage 完成，UI 侧发消息委托。
   ============================================================ */
const STORE_KEY = 'figma-toolbox-presets';

// 启动即预加载已保存方案的目标字体，不阻塞面板或修改文档。
void figma.clientStorage.getAsync(STORE_KEY)
  .then(data => warmFontPresets(data?.fontPresets))
  .catch(() => {});

figma.on('selectionchange', () => {
  figma.ui.postMessage({ type: 'selection-changed' });
});

/* ============================================================
   字体家族列表：按需加载 + 进程内缓存
   ------------------------------------------------------------
   为什么不在插件启动时就拉：figma.listAvailableFontsAsync() 要把本机全部
   字体跨进程序列化，字体装得多的机器上耗时可达数秒。而「识别选中文本」
   「应用字体混排」都不需要它——启动就拉会让用户看到「面板开着却不能用」。

   加载时机改由 UI 决定（打开字体下拉时，或面板空闲后预热），
   并且只在首次真正请求一次，之后命中缓存立即返回。
   ============================================================ */
let fontFamilies: FontFamily[] | null = null;

figma.ui.onmessage = async (msg: any) => {
  // UI 请求字体库（首次较慢，之后走缓存）
  if (msg.type === 'list-fonts') {
    try {
      if (!fontFamilies) {
        const fonts = await figma.listAvailableFontsAsync();
        fontFamilies = collapseFontFamilies(fonts);
      }
      figma.ui.postMessage({ type: 'fonts-list', families: fontFamilies });
    } catch (e) {
      // 拉取失败也要回包，否则 UI 会永远停在「正在加载字体库…」
      fontFamilies = null;
      figma.ui.postMessage({
        type: 'fonts-list',
        families: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return;
  }

  // UI 请求读回已保存的方案预设
  if (msg.type === 'storage-load') {
    try {
      const data = await figma.clientStorage.getAsync(STORE_KEY);
      figma.ui.postMessage({ type: 'storage-data', data: data || null });
    } catch (e) {
      figma.notify('读取方案失败：' + (e instanceof Error ? e.message : String(e)));
    }
    return;
  }

  // UI 请求落盘方案预设（字体混排 + 批量样式两套一起写）
  if (msg.type === 'storage-save') {
    try {
      const d = msg.data || {};
      void warmFontPresets(d.fontPresets);
      await figma.clientStorage.setAsync(STORE_KEY, {
        fontPresets: Array.isArray(d.fontPresets) ? d.fontPresets : [],
        stylePresets: Array.isArray(d.stylePresets) ? d.stylePresets : [],
      });
    } catch (e) {
      figma.notify('保存方案失败：' + (e instanceof Error ? e.message : String(e)));
    }
    return;
  }

  // UI 侧的轻量提示（方案切换 / 保存等）
  if (msg.type === 'notify') {
    figma.notify(String(msg.msg || ''));
    return;
  }

  // UI 请求按当前标签页内容调整面板高度，避免内容被截断或短页面留大片空白
  if (msg.type === 'resize') {
    const raw = Number(msg.height);
    // 限制在合理区间，避免异常值：最小 320，最大 1000
    const h = Math.max(320, Math.min(1000, Math.round(raw) || 600));
    figma.ui.resize(400, h);
    return;
  }

  const sel = getSelectedNodes();

  // 识别选中文本图层的实际字体混排（字体/字号/颜色）
  if (msg.type === 'detect-font') {
    const texts = getTextNodes(sel);
    const node = texts[0];
    if (!node) {
      figma.ui.postMessage({ type: 'detect-font-result', empty: true });
      return;
    }
    // 字号汇总所有选中文本，分别报告中英文的统一值或混合状态。
    const d = detectFontMix(texts);
    figma.ui.postMessage({
      type: 'detect-font-result',
      cnFont: d.cnFont ? { family: d.cnFont.family, style: d.cnFont.style } : null,
      enFont: d.enFont ? { family: d.enFont.family, style: d.enFont.style } : null,
      cnSize: d.cnSize,
      cnSizeMixed: d.cnSizeMixed,
      enSize: d.enSize,
      enSizeMixed: d.enSizeMixed,
      cnColor: d.cnColor,
      enColor: d.enColor,
    });
    return;
  }

  // 识别选中图形图层的实际样式（填充/圆角/描边/阴影）
  if (msg.type === 'detect-style') {
    const shapes = getStyleableNodes(sel);
    const node = shapes[0] as SceneNode & {
      fills?: Paint[]; cornerRadius?: number; strokes?: Paint[];
      strokeWeight?: number; strokeAlign?: string; effects?: Effect[];
    };
    if (!node) {
      figma.ui.postMessage({ type: 'detect-style-result', empty: true });
      return;
    }
    const fills = (node.fills as Paint[]) || [];
    // 识别纯色或渐变（渐变会带类型、角度、色标）
    const fillCfg = readPaintConfig(fills[0]);
    const rawR = node.cornerRadius;
    const radius = typeof rawR === 'number' ? rawR : null;
    const strokes = (node.strokes as Paint[]) || [];
    const strokeCfg = readPaintConfig(strokes[0]);
    const rawW = node.strokeWeight;
    const strokeWeight = typeof rawW === 'number' ? rawW : 0;
    const align = (node.strokeAlign as string) || 'INSIDE';
    const effects = (node.effects as Effect[]) || [];
    const shadow = effects.find((e) => e.type === 'DROP_SHADOW') as
      | (Effect & { color: RGBA; offset: { x: number; y: number }; radius: number; spread: number })
      | undefined;

    figma.ui.postMessage({
      type: 'detect-style-result',
      fillOn: !!fillCfg,
      fill: fillCfg,
      radiusOn: radius !== null,
      radius,
      strokeOn: strokes.length > 0,
      stroke: strokeCfg,
      strokeWeight,
      strokeAlign: align,
      shadowOn: !!shadow,
      shadow: shadow ? {
        color: { r: shadow.color.r, g: shadow.color.g, b: shadow.color.b, a: shadow.color.a ?? 1 },
        offsetX: shadow.offset.x,
        offsetY: shadow.offset.y,
        blur: shadow.radius,
        spread: shadow.spread ?? 0,
      } : null,
    });
    return;
  }


  // 识别选中图层的当前斜切角度（从变换矩阵反推，与写入端使用同一套约定）
  if (msg.type === 'detect-skew') {
    const target = pickSkewTarget(getSelectedNodes()[0]);
    if (!target) {
      figma.ui.postMessage({ type: 'detect-skew-result', empty: true });
      return;
    }
    const st = analyseSkew(target.relativeTransform as unknown as Transform);
    figma.ui.postMessage({
      type: 'detect-skew-result',
      skewX: Math.round(st.skewX),
      skewY: Math.round(st.skewY),
      rotation: Math.round(st.rotation),
      name: target.name,
    });
    return;
  }

  if (msg.type === 'font-mixer') {
    let texts: TextNode[] = [];
    // 全流程包 try/catch：字体加载一抛错若不被兜住，整条消息就静默中断，
    // 用户看到的现象就是「点应用没反应」（不同设备装的字体不同，因此只在部分设备复现）。
    try {
      texts = getTextNodes(sel);
      // 先立刻应答：UI 可据此区分「消息没送达」与「正在加载字体」，
      // 避免字体加载慢时用户误以为按钮坏了。
      figma.ui.postMessage({ type: 'font-mixer-start', total: texts.length });
      const r = await applyFontMix(texts, msg.config as FontMixConfig);
      figma.ui.postMessage({ type: 'font-mixer-done', ...r, total: texts.length, empty: !texts.length });
      if (!texts.length) {
        figma.notify('请先选中至少一个文本图层', { error: true });
      } else if (r.missingFonts.length) {
        figma.notify(`字体在本机不可用：${r.missingFonts.join('、')}`, { error: true });
      } else if (r.failed.length) {
        figma.notify(`字体混排：成功 ${r.ok} 个，失败 ${r.failed.length} 个`, { error: true });
      } else if (r.timedOut) {
        figma.notify(`字体混排：已处理 ${r.ok} 个（部分字体加载超时，如有遗漏请重试）`);
      } else {
        figma.notify(`字体混排：已处理 ${r.ok} 个文本节点`);
      }
    } catch (e) {
      const m = (e as Error)?.message || String(e);
      figma.ui.postMessage({
        type: 'font-mixer-done', ok: 0, failed: [], missingFonts: [], total: texts.length, fatal: m,
      });
      figma.notify('字体混排失败：' + m, { error: true });
    }
  } else if (msg.type === 'auto-kerning') {
    const texts = getTextNodes(sel);
    let applied = 0; let failed = 0;
    for (const node of texts) { try { applied += applyAutoKerning(node, String(msg.manualPair || ''), Number(msg.manualValue || 0)).applied; } catch (_) { failed++; } }
    figma.ui.postMessage({ type: 'auto-kerning-done', nodes: texts.length, applied, failed, empty: !texts.length });
    figma.notify(texts.length ? ('自动字符对微调：' + applied + ' 处') : '请先选中至少一个文本图层', { error: !texts.length });
  } else if (msg.type === 'bulk-styles') {
    const shapes = getStyleableNodes(sel);
    // 同样要给出明确反馈：选中分组/画框时它们本身没有 fills，会被过滤成 0 个，
    // 旧代码此时完全静默，用户会以为按钮坏了。
    try {
      applyStyles(shapes, msg.config as StyleConfig);
      figma.ui.postMessage({ type: 'bulk-styles-done', count: shapes.length, total: sel.length });
      if (!shapes.length) {
        figma.notify('未选中可套用样式的图层（分组/画框请选中内部图层）', { error: true });
      } else {
        figma.notify(`批量样式：已处理 ${shapes.length} 个节点`);
      }
    } catch (e) {
      const m = (e as Error)?.message || String(e);
      figma.ui.postMessage({ type: 'bulk-styles-done', count: 0, total: sel.length, fatal: m });
      figma.notify('批量样式失败：' + m, { error: true });
    }
  } else if (msg.type === 'skew') {
    const nodes = getSelectedNodes();
    const r = applySkew(nodes, msg.config as SkewConfig);
    figma.notify(
      r.applied
        ? `斜切：已处理 ${r.applied} 个图层`
        : '斜切：没有可写入变换的图层（可能被锁定或受自动布局约束）',
    );
    figma.ui.postMessage({ type: 'skew-done', applied: r.applied, total: r.total });
  } else if (msg.type === 'export') {
    const r = await exportNodes(sel, msg.config as ExportConfig, (item, cfg) => {
      // 把「相对路径 + 字节流」回传 UI，由 UI 侧重编码质量后落盘
      figma.ui.postMessage({
        type: 'export-chunk',
        path: item.path,
        bytes: item.bytes,
        format: cfg.format,
        quality: cfg.quality,
      });
    });
    // count 供 UI 侧校验「分片是否全部归队」：JPG/WebP 在 UI 侧要过 canvas 重编码（异步），
    // 若 UI 直接按收到的分片打包，末尾节点会被漏掉，表现为「选中 6 个只导出 4 个」。
    figma.ui.postMessage({ type: 'export-done', count: r.ok, failed: r.failed });
    figma.notify(
      r.failed.length
        ? `导出完成：${r.ok} 个；${r.failed.length} 个失败（${r.failed.slice(0, 3).join('、')}${r.failed.length > 3 ? '…' : ''}）`
        : r.ok
          ? `导出完成：共 ${r.ok} 个节点`
          : '导出失败：没有可导出的节点',
    );
  }
};



