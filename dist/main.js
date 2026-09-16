"use strict";
(() => {
  // src/features/font-mixer.ts
  function fontLabel(f) {
    return f ? `${f.family} ${f.style}` : "(空字体)";
  }
  function errText(e) {
    const m = e instanceof Error ? e.message : String(e);
    return String(m || "未知错误").slice(0, 90);
  }
  function isCJK(ch) {
    return /[\u3000-\u303F\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/.test(ch);
  }
  var FONT_LOAD_TIMEOUT_MS = 4e3;
  var fontLoads = /* @__PURE__ */ new WeakMap();
  function loadFontSafe(f) {
    const loader = figma.loadFontAsync;
    let cache = fontLoads.get(loader);
    if (!cache) {
      cache = /* @__PURE__ */ new Map();
      fontLoads.set(loader, cache);
    }
    const key = JSON.stringify([f.family, f.style]);
    let pending = cache.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => figma.loadFontAsync(f)).then(
        () => "ok",
        () => {
          cache.delete(key);
          return "missing";
        }
      );
      cache.set(key, pending);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve("timeout");
      }, FONT_LOAD_TIMEOUT_MS);
      pending.then((outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
    });
  }
  async function warmFontPresets(presets) {
    if (!Array.isArray(presets)) return;
    const fonts = /* @__PURE__ */ new Map();
    for (const preset of presets) {
      for (const f of [preset == null ? void 0 : preset.cnFont, preset == null ? void 0 : preset.enFont]) {
        if (f && typeof f.family === "string" && typeof f.style === "string") {
          fonts.set(JSON.stringify([f.family, f.style]), f);
        }
      }
    }
    await Promise.all(Array.from(fonts.values(), loadFontSafe));
  }
  async function applyFontMix(nodes, cfg) {
    const result = { ok: 0, failed: [], missingFonts: [], timedOut: false };
    if (nodes.length === 0) return result;
    const targets = [];
    if (cfg) {
      for (const f of [cfg.cnFont, cfg.enFont]) {
        if (!f || !f.family) continue;
        if (!targets.some((t) => t.family === f.family && t.style === f.style)) targets.push(f);
      }
    }
    const outcomes = await Promise.all(targets.map(loadFontSafe));
    outcomes.forEach((outcome, i) => {
      if (outcome === "missing") result.missingFonts.push(fontLabel(targets[i]));
      else if (outcome === "timeout") result.timedOut = true;
    });
    if (result.missingFonts.length) return result;
    if (result.timedOut) {
      result.failed = nodes.map((node) => ({ name: node.name, reason: "目标字体加载超时，尚未修改，请重试" }));
      return result;
    }
    for (const node of nodes) {
      try {
        const text = node.characters;
        if (!text) {
          result.ok++;
          continue;
        }
        node.fontName = cfg.cnFont;
        let start = 0;
        let prev = isCJK(text[0]);
        for (let i = 1; i < text.length; i++) {
          const cur = isCJK(text[i]);
          if (cur !== prev) {
            applyRange(node, start, i, prev, cfg);
            prev = cur;
            start = i;
          }
        }
        applyRange(node, start, text.length, prev, cfg);
        result.ok++;
      } catch (e) {
        result.failed.push({ name: node.name, reason: errText(e) });
      }
    }
    return result;
  }
  function applyRange(node, start, end, cjk, cfg) {
    const font = cjk ? cfg.cnFont : cfg.enFont;
    if (font && font.family) node.setRangeFontName(start, end, font);
    const size = cjk ? cfg.cnSize : cfg.enSize;
    if (size != null) node.setRangeFontSize(start, end, size);
    const color = cjk ? cfg.cnColor : cfg.enColor;
    if (color != null) node.setRangeFills(start, end, [{ type: "SOLID", color }]);
  }
  function detectFontMix(input) {
    const out = {
      cnFont: null,
      enFont: null,
      cnSize: null,
      enSize: null,
      cnColor: null,
      enColor: null,
      cnSizeMixed: false,
      enSizeMixed: false
    };
    const nodes = Array.isArray(input) ? input : [input];
    const sizes = { cn: /* @__PURE__ */ new Set(), en: /* @__PURE__ */ new Set() };
    const seen = { cn: false, en: false };
    const unknown = { cn: false, en: false };
    for (const node of nodes) {
      const text = node.characters || "";
      for (let i = 0; i < text.length; ) {
        const ch = String.fromCodePoint(text.codePointAt(i));
        const end = i + ch.length;
        if (!/\s/.test(ch)) {
          const side = isCJK(ch) ? "cn" : "en";
          if (!seen[side]) {
            try {
              const font = node.getRangeFontName(i, end);
              if (typeof font === "object" && font) out[`${side}Font`] = font;
            } catch {
            }
            try {
              const fills = node.getRangeFills(i, end);
              if (Array.isArray(fills)) {
                const solid = fills.find((p) => p.type === "SOLID");
                if (solid) out[`${side}Color`] = solid.color;
              }
            } catch {
            }
          }
          seen[side] = true;
          try {
            const size = node.getRangeFontSize(i, end);
            if (typeof size === "number" && Number.isFinite(size)) sizes[side].add(size);
            else unknown[side] = true;
          } catch {
            unknown[side] = true;
          }
        }
        i = end;
      }
    }
    for (const side of ["cn", "en"]) {
      const source = seen[side] ? side : side === "cn" ? "en" : "cn";
      out[`${side}Size`] = !unknown[source] && sizes[source].size === 1 ? Array.from(sizes[source])[0] : null;
      out[`${side}SizeMixed`] = sizes[source].size > 1;
      if (!seen[side]) {
        out[`${side}Font`] = out[`${source}Font`];
        out[`${side}Color`] = out[`${source}Color`];
      }
    }
    return out;
  }
  function collapseFontFamilies(fonts) {
    const map = /* @__PURE__ */ new Map();
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
    const out = [];
    map.forEach((styles, family) => out.push({ family, styles }));
    out.sort((a, b) => a.family.localeCompare(b.family));
    return out;
  }

  // src/features/bulk-styles.ts
  function clamp01(n) {
    if (!isFinite(n)) return 0;
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }
  function gradientTransform(angleDeg) {
    const deg = Number(angleDeg) || 0;
    const rad = deg * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return [
      [cos, -sin, 0.5 - 0.5 * cos + 0.5 * sin],
      [sin, cos, 0.5 - 0.5 * sin - 0.5 * cos]
    ];
  }
  function angleFromTransform(t) {
    const deg = Math.atan2(t[1][0], t[0][0]) * 180 / Math.PI;
    return Math.round((deg % 360 + 360) % 360);
  }
  function normalizeStops(stops) {
    const list = (stops || []).filter((s) => s && s.color).map((s) => ({
      position: clamp01(Number(s.position) || 0),
      color: {
        r: clamp01(s.color.r),
        g: clamp01(s.color.g),
        b: clamp01(s.color.b),
        a: s.color.a == null ? 1 : clamp01(s.color.a)
      }
    })).sort((a, b) => a.position - b.position);
    if (!list.length) {
      return [
        { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }
      ];
    }
    if (list.length === 1) {
      const only = list[0];
      return [
        { position: 0, color: { ...only.color } },
        { position: 1, color: { ...only.color } }
      ];
    }
    return list;
  }
  function buildGradientPaint(g) {
    return {
      type: g.gradientType,
      gradientTransform: gradientTransform(g.angle),
      gradientStops: normalizeStops(g.stops)
    };
  }
  function paintFromConfig(cfg) {
    if (cfg.kind === "gradient") return buildGradientPaint(cfg.gradient);
    return { type: "SOLID", color: cfg.color };
  }
  function readPaintConfig(p) {
    if (!p) return null;
    if (p.type === "SOLID") return { kind: "solid", color: { ...p.color } };
    if (p.type === "GRADIENT_LINEAR" || p.type === "GRADIENT_RADIAL" || p.type === "GRADIENT_ANGULAR" || p.type === "GRADIENT_DIAMOND") {
      return {
        kind: "gradient",
        gradient: {
          gradientType: p.type,
          angle: angleFromTransform(p.gradientTransform),
          stops: p.gradientStops.map((s) => ({
            color: { ...s.color },
            position: s.position
          }))
        }
      };
    }
    return null;
  }
  function applyStyles(nodes, cfg) {
    for (const node of nodes) {
      if (cfg.fill && "fills" in node) {
        node.fills = [paintFromConfig(cfg.fill)];
      }
      if (cfg.cornerRadius != null && "cornerRadius" in node) {
        node.cornerRadius = cfg.cornerRadius;
      }
      if (cfg.stroke && cfg.strokeWeight != null && "strokes" in node) {
        node.strokes = [paintFromConfig(cfg.stroke)];
        node.strokeWeight = cfg.strokeWeight;
        if (cfg.strokeAlign && "strokeAlign" in node) {
          node.strokeAlign = cfg.strokeAlign;
        }
      }
      if (cfg.shadow && "effects" in node) {
        const shadow = {
          type: "DROP_SHADOW",
          color: cfg.shadow.color,
          offset: { x: cfg.shadow.offsetX, y: cfg.shadow.offsetY },
          radius: cfg.shadow.blur,
          spread: cfg.shadow.spread,
          visible: true,
          blendMode: "NORMAL"
        };
        node.effects = [...node.effects, shadow];
      }
    }
  }

  // src/features/export-compress.ts
  var ILLEGAL_CHARS = /[\\:*?"<>|\x00-\x1f]/g;
  function cleanSegment(raw) {
    return raw.replace(ILLEGAL_CHARS, "").replace(/^[\s.]+|[\s.]+$/g, "").trim();
  }
  function splitName(name) {
    return String(name == null ? "" : name).replace(/／/g, "/").split("/").map(cleanSegment).filter(Boolean);
  }
  function buildExportPath(node) {
    const segs = [];
    const chain = [];
    let p = node.parent;
    while (p && p.type !== "PAGE" && p.type !== "DOCUMENT") {
      chain.unshift(p);
      p = p.parent;
    }
    for (const a of chain) segs.push(...splitName(a.name));
    segs.push(...splitName(node.name));
    if (!segs.length) segs.push("export");
    return segs;
  }
  async function exportNodes(nodes, cfg, onEach) {
    const used = /* @__PURE__ */ new Map();
    const failed = [];
    let ok = 0;
    for (const node of nodes) {
      let bytes;
      try {
        bytes = await node.exportAsync({
          format: cfg.format,
          constraint: { type: "SCALE", value: cfg.scale }
        });
      } catch (e) {
        console.warn("export failed:", node.name, e);
        failed.push(node && node.name || "(未命名)");
        continue;
      }
      const segs = buildExportPath(node);
      const base = segs.join("/");
      const seen = used.get(base) || 0;
      used.set(base, seen + 1);
      let path = base;
      if (seen > 0) {
        segs[segs.length - 1] = segs[segs.length - 1] + "-" + (seen + 1);
        path = segs.join("/");
      }
      onEach({ path, bytes }, cfg);
      ok++;
    }
    return { ok, failed };
  }

  // src/features/skew.ts
  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var MAX_ANGLE = 60;
  var asSkewNode = (n) => n;
  var clampAngle = (v) => Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, v));
  function shearLinear(skewX, skewY) {
    const ta = Math.tan(skewX * RAD);
    const tb = Math.tan(skewY * RAD);
    const k0 = Math.hypot(1, tb) || 1;
    const k1 = Math.hypot(ta, 1) || 1;
    return [
      [1 / k0, ta / k1],
      [tb / k0, 1 / k1]
    ];
  }
  function rotLinear(rho) {
    const c = Math.cos(rho * RAD);
    const s = Math.sin(rho * RAD);
    return [
      [c, s],
      [-s, c]
    ];
  }
  function mul(a, b) {
    return [
      [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
      [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]
    ];
  }
  function analyseSkew(t) {
    const T1 = Math.atan2(t[0][1], t[1][1]) * DEG;
    const T0 = Math.atan2(t[1][0], t[0][0]) * DEG;
    if (Math.abs(T1) <= Math.abs(T0)) {
      return { skewX: 0, skewY: clampAngle(T1 + T0), rotation: T1 };
    }
    return { skewX: clampAngle(T1 + T0), skewY: 0, rotation: -T0 };
  }
  function collectLeaves(node, out) {
    const kids = node.children;
    if (node.type !== "GROUP" || !kids || !kids.length) {
      out.push(node);
      return;
    }
    for (const c of kids) collectLeaves(asSkewNode(c), out);
  }
  function refParent(node) {
    var _a;
    let p = node.parent;
    while (p && (p.type === "GROUP" || p.type === "BOOLEAN_OPERATION")) p = (_a = p.parent) != null ? _a : null;
    return p != null ? p : null;
  }
  function pickSkewTarget(node) {
    if (!node) return null;
    const leaves = [];
    collectLeaves(asSkewNode(node), leaves);
    for (const l of leaves) {
      if (l.relativeTransform) return l;
    }
    return null;
  }
  function applySkew(nodes, cfg) {
    const S = shearLinear(cfg.skewX, cfg.skewY);
    let applied = 0;
    let total = 0;
    if (!nodes.length) return { applied, total };
    const buckets = /* @__PURE__ */ new Map();
    for (const n of nodes) {
      const node = asSkewNode(n);
      const key = refParent(node);
      const arr = buckets.get(key);
      if (arr) collectLeaves(node, arr);
      else {
        const fresh = [];
        collectLeaves(node, fresh);
        buckets.set(key, fresh);
      }
    }
    for (const leaves of buckets.values()) {
      const items = leaves.map((node) => {
        const t = node.relativeTransform;
        const cx = node.width / 2;
        const cy = node.height / 2;
        const q = {
          x: t[0][0] * cx + t[0][1] * cy + t[0][2],
          y: t[1][0] * cx + t[1][1] * cy + t[1][2]
        };
        const rho = analyseSkew(t).rotation;
        return { node, L: mul(rotLinear(rho), S), q, cx, cy };
      });
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const it of items) {
        minX = Math.min(minX, it.q.x);
        maxX = Math.max(maxX, it.q.x);
        minY = Math.min(minY, it.q.y);
        maxY = Math.max(maxY, it.q.y);
      }
      const ax = (minX + maxX) / 2;
      const ay = (minY + maxY) / 2;
      for (const it of items) {
        total++;
        const dx = it.q.x - ax;
        const dy = it.q.y - ay;
        const nx = ax + S[0][0] * dx + S[0][1] * dy;
        const ny = ay + S[1][0] * dx + S[1][1] * dy;
        const tx = nx - (it.L[0][0] * it.cx + it.L[0][1] * it.cy);
        const ty = ny - (it.L[1][0] * it.cx + it.L[1][1] * it.cy);
        try {
          it.node.relativeTransform = [
            [it.L[0][0], it.L[0][1], tx],
            [it.L[1][0], it.L[1][1], ty]
          ];
          applied++;
        } catch {
        }
      }
    }
    return { applied, total };
  }

  // src/features/auto-kerning.ts
  function applyAutoKerning(node) {
    const text = node.characters || "";
    if (!text || text.length < 2) return { applied: 0, skipped: 0 };
    let applied = 0;
    let skipped = 0;
    const pairs = { "(": ")", "[": "]", "{": "}", "（": "）", "［": "］", "【": "】", "《": "》", "〈": "〉", "“": "”", "‘": "’", "「": "」", "『": "』", "｛": "｝" };
    const stack = [];
    const matched = [];
    for (let i = 0; i < text.length; i++) {
      if (pairs[text[i]]) stack.push({ ch: text[i], index: i });
      else {
        const at = stack.length - 1;
        if (at >= 0 && pairs[stack[at].ch] === text[i]) matched.push([stack.pop().index, i]);
      }
    }
    const pairedIndexes = /* @__PURE__ */ new Set();
    const excludedStandalone = /* @__PURE__ */ new Set(["#", "*", "¥", "·", "~", "%", "&"]);
    for (const [open, close] of matched) {
      pairedIndexes.add(open);
      pairedIndexes.add(close);
    }
    for (let i = 0; i < text.length - 1; i++) {
      const ch = text[i];
      if (/\s/.test(ch)) {
        skipped++;
        continue;
      }
      const isSymbol = /[\p{P}\p{S}]/u.test(ch);
      if (!isSymbol || pairedIndexes.has(i) || excludedStandalone.has(ch)) {
        skipped++;
        continue;
      }
      node.setRangeLetterSpacing(i, i + 1, { unit: "PERCENT", value: -30 });
      applied++;
    }
    for (const [open, close] of matched) {
      if (open > 0) {
        node.setRangeLetterSpacing(open - 1, open, { unit: "PERCENT", value: -45 });
        applied++;
      }
      if (close < text.length - 1) {
        node.setRangeLetterSpacing(close, close + 1, { unit: "PERCENT", value: -45 });
        applied++;
      }
    }
    return { applied, skipped };
  }

  // src/shared/selection.ts
  function getSelectedNodes() {
    return Array.from(figma.currentPage.selection);
  }
  function getTextNodes(nodes) {
    const out = [];
    for (const n of nodes) {
      if (n.type === "TEXT") {
        out.push(n);
        continue;
      }
      if ("findAllWithCriteria" in n) {
        try {
          const inner = n.findAllWithCriteria({ types: ["TEXT"] });
          out.push(...inner);
        } catch {
        }
      }
    }
    return out;
  }
  function getStyleableNodes(nodes) {
    return nodes.filter((n) => "fills" in n);
  }

  // src/main.ts
  figma.showUI(`<!DOCTYPE html>\r
<html lang="zh-CN" data-page-node-id="TgilifIuroSppXD6NQREbl">\r
<head data-page-node-id="i5mUrUQ5NNcpBhHuM8JRHn">\r
  <meta charset="utf-8" data-page-node-id="cpL4OxieSJBpsJFpymIODv" />\r
  <style>\r
    /* ============================================================\r
       设计语言：暖橙渐变 + 大圆角白卡 + 柔和橙调阴影\r
       参考：iPhone 风格信息卡片（橙红 CTA / 黑色胶囊选中 / 浅灰网格底）\r
       ============================================================ */\r
    :root {\r
      --o-1: #FF9161;          /* 橙 · 浅 */\r
      --o-2: #FF5A2B;          /* 橙 · 深（主色） */\r
      --o-soft: rgba(255, 90, 43, .16);\r
      --ink: #1A1A1A;\r
      --ink-2: #3D3A38;\r
      --ink-3: #8E8A87;\r
      --ink-4: #A8A29E;\r
      --bg: #F7F5F3;\r
      --fill: #F5F2F0;\r
      --line: #F0EAE6;\r
      --card: #FFFFFF;\r
      --r-card: 20px;\r
      --r-input: 12px;\r
    }\r
\r
    * { box-sizing: border-box; }\r
\r
    html, body { height: 100%; }\r
\r
    body {\r
      margin: 0;\r
      padding: 0 0 22px;\r
      width: 100%;\r
      min-height: 100%;\r
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;\r
      font-size: 13px;\r
      color: var(--ink);\r
      -webkit-font-smoothing: antialiased;\r
      background-color: var(--bg);\r
      background-image:\r
        linear-gradient(rgba(0, 0, 0, .035) 1px, transparent 1px),\r
        linear-gradient(90deg, rgba(0, 0, 0, .035) 1px, transparent 1px);\r
      background-size: 26px 26px;\r
      overflow-x: hidden;\r
    }\r
\r
    /* 顶部暖橙光晕 */\r
    body::before {\r
      content: "";\r
      position: fixed;\r
      top: -110px; left: 50%;\r
      transform: translateX(-50%);\r
      width: 360px; height: 210px;\r
      border-radius: 50%;\r
      background: radial-gradient(closest-side, rgba(255, 138, 91, .40), rgba(255, 138, 91, 0) 100%);\r
      pointer-events: none;\r
      z-index: 0;\r
    }\r
\r
    ::-webkit-scrollbar { width: 8px; }\r
    ::-webkit-scrollbar-track { background: transparent; }\r
    ::-webkit-scrollbar-thumb { background: #E3DDD8; border-radius: 4px; }\r
    ::-webkit-scrollbar-thumb:hover { background: #D6CFC9; }\r
\r
    /* ---------- 顶部品牌栏 ---------- */\r
    .topbar {\r
      position: relative; z-index: 1;\r
      display: flex; align-items: center; justify-content: space-between;\r
      padding: 16px 16px 12px;\r
    }\r
    .brand { display: flex; align-items: center; gap: 9px; }\r
    .logo {\r
      width: 30px; height: 30px;\r
      border-radius: 10px;\r
      background: linear-gradient(135deg, var(--o-1), var(--o-2));\r
      box-shadow: 0 7px 15px -6px rgba(255, 90, 43, .70);\r
      display: grid; place-items: center;\r
      flex: none;\r
    }\r
    .brand-name { font-size: 14.5px; font-weight: 700; letter-spacing: .2px; }\r
    .chip-tag {\r
      font-size: 10.5px; font-weight: 700; letter-spacing: .4px;\r
      color: var(--o-2);\r
      background: rgba(255, 90, 43, .10);\r
      border: 1px solid rgba(255, 90, 43, .18);\r
      padding: 4px 9px; border-radius: 999px;\r
    }\r
\r
    /* ---------- 分段标签（黑色胶囊选中） ---------- */\r
    .seg {\r
      position: relative; z-index: 1;\r
      display: flex; gap: 4px;\r
      margin: 0 14px 12px;\r
      padding: 4px;\r
      background: var(--card);\r
      border: 1px solid var(--line);\r
      border-radius: 16px;\r
      box-shadow: 0 8px 20px -14px rgba(80, 45, 30, .55);\r
    }\r
    .tab-btn {\r
      flex: 1;\r
      padding: 9px 2px;\r
      border: none; border-radius: 12px;\r
      background: transparent;\r
      font-family: inherit; font-size: 12.5px; font-weight: 600;\r
      color: var(--ink-3);\r
      cursor: pointer;\r
      transition: all .2s ease;\r
    }\r
    .tab-btn.active {\r
      background: #1A1A1A;\r
      color: #fff;\r
      box-shadow: 0 7px 14px -8px rgba(0, 0, 0, .75);\r
    }\r
\r
    /* ---------- 方案选择器（仅字体混排页 · 顶部） ---------- */\r
    .preset-bar { position: relative; z-index: 5; margin: 0 0 12px; }\r
    .preset-bar.open { z-index: 60; }   /* 展开时抬高，避免被下方卡片内的下拉遮挡 */\r
    .preset-trigger {\r
      display: flex; align-items: center; gap: 9px;\r
      width: 100%;\r
      padding: 10px 13px;\r
      background: #fff;\r
      border: 1px solid var(--line);\r
      border-radius: 15px;\r
      cursor: pointer;\r
      box-shadow: 0 8px 22px -14px rgba(90, 55, 38, .45);\r
      transition: border-color .18s, box-shadow .18s;\r
    }\r
    .preset-trigger:hover { border-color: #F0D9CE; }\r
    .preset-bar.open .preset-trigger { border-color: var(--o-1); box-shadow: 0 0 0 3px var(--o-soft); }\r
\r
    .preset-ico {\r
      width: 20px; height: 20px; border-radius: 7px; flex: none;\r
      background: linear-gradient(135deg, var(--o-1), var(--o-2));\r
      display: grid; place-items: center;\r
      font-size: 11px; color: #fff;\r
      box-shadow: 0 4px 9px -4px rgba(255, 90, 43, .70);\r
    }\r
    .preset-current {\r
      flex: 1; min-width: 0; text-align: left;\r
      font-size: 13px; font-weight: 600; color: var(--ink-2);\r
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\r
    }\r
    .preset-current.empty { color: var(--ink-4); font-weight: 500; }\r
    .preset-caret { color: var(--ink-3); font-size: 13px; flex: none; transition: transform .2s ease; }\r
    .preset-bar.open .preset-caret { transform: rotate(180deg); }\r
\r
    .preset-pop {\r
      display: none;\r
      position: absolute; top: calc(100% + 7px); left: 0; right: 0;\r
      background: #fff;\r
      border: 1px solid var(--line);\r
      border-radius: 18px;\r
      box-shadow: 0 22px 50px -24px rgba(80, 45, 30, .55), 0 0 0 1px rgba(0, 0, 0, .02);\r
      padding: 8px;\r
      z-index: 20;\r
      max-height: 300px;\r
      overflow-y: auto;\r
    }\r
    .preset-pop.open { display: block; animation: pop .16s ease; }\r
    @keyframes pop {\r
      from { opacity: 0; transform: translateY(-6px) scale(.98); }\r
      to   { opacity: 1; transform: none; }\r
    }\r
    .preset-pop-head {\r
      font-size: 10.5px; font-weight: 700; letter-spacing: .4px;\r
      color: var(--ink-4); text-transform: uppercase;\r
      padding: 3px 8px 8px;\r
    }\r
    .preset-search { padding: 0 4px 8px; }\r
    .preset-search input { font-size: 12.5px; padding: 8px 10px; }\r
    .preset-row {\r
      display: flex; align-items: center; justify-content: space-between; gap: 8px;\r
      width: 100%;\r
      padding: 10px;\r
      border: none; background: transparent; border-radius: 11px;\r
      font-family: inherit; font-size: 13px; color: var(--ink-2);\r
      text-align: left; cursor: pointer;\r
      transition: background .15s;\r
    }\r
    .preset-row:hover { background: #FFF6F2; }\r
    .preset-row.on { background: #FFF1EA; }\r
    .preset-row-name {\r
      flex: 1; min-width: 0;\r
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\r
    }\r
    .preset-row-tip { font-size: 10.5px; color: var(--o-2); font-weight: 700; flex: none; }\r
    .preset-row-del {\r
      flex: none; width: 20px; height: 20px;\r
      display: grid; place-items: center;\r
      border-radius: 50%;\r
      font-size: 15px; line-height: 1; color: var(--ink-4);\r
      cursor: pointer; opacity: 0; transition: all .15s;\r
    }\r
    .preset-row:hover .preset-row-del { opacity: 1; }\r
    .preset-row-del:hover { background: var(--o-2); color: #fff; }\r
    .preset-pop-empty {\r
      font-size: 12px; color: var(--ink-4); text-align: center;\r
      padding: 12px 8px;\r
    }\r
\r
    /* ============================================================\r
       通用下拉组件（.dd）：与「方案预设」弹层完全同款\r
       用于字体选择 / 导出格式 / 描边对齐 —— 所有下拉统一视觉\r
       ============================================================ */\r
    .dd { position: relative; z-index: 6; }\r
    .dd.open { z-index: 60; }   /* 展开时抬高，避免被下方同级下拉的触发条遮挡 */\r
    .dd-trigger {\r
      display: flex; align-items: center; gap: 9px;\r
      width: 100%;\r
      padding: 9px 11px;\r
      background: #fff;\r
      border: 1px solid var(--line);\r
      border-radius: var(--r-input);\r
      cursor: pointer;\r
      font-family: inherit; font-size: 13px; color: var(--ink-2);\r
      text-align: left;\r
      transition: border-color .18s, box-shadow .18s;\r
    }\r
    .dd-trigger:hover { border-color: #F0D9CE; }\r
    .dd.open .dd-trigger { border-color: var(--o-1); box-shadow: 0 0 0 3px var(--o-soft); }\r
    .dd-current {\r
      flex: 1; min-width: 0;\r
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\r
    }\r
    .dd-current.empty { color: var(--ink-4); }\r
    .dd-caret { color: var(--ink-3); font-size: 13px; flex: none; transition: transform .2s ease; }\r
    .dd.open .dd-caret { transform: rotate(180deg); }\r
\r
    .dd-pop {\r
      display: none;\r
      position: absolute; top: calc(100% + 7px); left: 0; right: 0;\r
      background: #fff;\r
      border: 1px solid var(--line);\r
      border-radius: 18px;\r
      box-shadow: 0 22px 50px -24px rgba(80, 45, 30, .55), 0 0 0 1px rgba(0, 0, 0, .02);\r
      padding: 8px;\r
      z-index: 30;\r
      max-height: 280px;\r
      overflow-y: auto;\r
    }\r
    .dd-pop.open { display: block; animation: pop .16s ease; }\r
    /* 窄字段（如描边对齐）右侧对齐展开，并给最小宽度 */\r
    .dd-pop.align-right { left: auto; right: 0; min-width: 134px; }\r
    .dd-head {\r
      font-size: 10.5px; font-weight: 700; letter-spacing: .4px;\r
      color: var(--ink-4); text-transform: uppercase;\r
      padding: 3px 8px 8px;\r
    }\r
    .dd-search { padding: 0 4px 8px; }\r
    .dd-search input { font-size: 12.5px; padding: 8px 10px; }\r
    .dd-list { display: flex; flex-direction: column; gap: 2px; }\r
    .dd-row {\r
      display: flex; align-items: center; gap: 8px;\r
      width: 100%;\r
      padding: 9px 10px;\r
      border: none; background: transparent; border-radius: 11px;\r
      font-family: inherit; font-size: 13px; color: var(--ink-2);\r
      text-align: left; cursor: pointer;\r
      transition: background .15s;\r
    }\r
    .dd-row:hover { background: #FFF6F2; }\r
    .dd-row.on { background: #FFF1EA; color: var(--ink); font-weight: 600; }\r
    .dd-row-check { margin-left: auto; color: var(--o-2); font-size: 13px; font-weight: 700; flex: none; opacity: 0; }\r
    .dd-row.on .dd-row-check { opacity: 1; }\r
    .dd-empty { font-size: 12px; color: var(--ink-4); text-align: center; padding: 12px 8px; }\r
    /* 字体库条目多，只渲染前若干条；这里提示还有更多，引导用搜索缩小范围 */\r
    .dd-more { font-size: 11px; color: var(--ink-4); text-align: center; padding: 8px 6px 4px; border-top: 1px solid #F2ECE7; margin-top: 4px; }\r
\r
    /* ---------- 内容区 ---------- */\r
    .content { position: relative; z-index: 1; padding: 0 14px; }\r
    .panel { display: none; }\r
    .panel.active { display: block; animation: fade .22s ease; }\r
    @keyframes fade {\r
      from { opacity: 0; transform: translateY(4px); }\r
      to   { opacity: 1; transform: none; }\r
    }\r
\r
    /* ---------- 卡片 ---------- */\r
    .card {\r
      background: var(--card);\r
      border: 1px solid var(--line);\r
      border-radius: var(--r-card);\r
      padding: 14px;\r
      margin-bottom: 10px;\r
      box-shadow: 0 8px 22px -14px rgba(90, 55, 38, .45);\r
    }\r
    .card-head {\r
      display: flex; align-items: center; gap: 8px;\r
      font-size: 12px; font-weight: 700; color: var(--ink-2);\r
      letter-spacing: .3px;\r
      margin-bottom: 11px;\r
    }\r
    .lang-title { display:flex; align-items:center; gap:8px; }\r
    .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }\r
    .dot.cn { background: var(--o-2); box-shadow: 0 0 0 3px var(--o-soft); }\r
    .dot.en { background: var(--o-2); box-shadow: 0 0 0 3px var(--o-soft); }\r
\r
    /* ---------- 表单 ---------- */\r
    .field { margin-bottom: 10px; }\r
    .field:last-child { margin-bottom: 0; }\r
    .field.grow { flex: 1; min-width: 0; }\r
    .field > label {\r
      display: block;\r
      margin-bottom: 5px;\r
      font-size: 11px; font-weight: 600; color: var(--ink-4);\r
      letter-spacing: .3px;\r
    }\r
    .row { display: flex; gap: 8px; align-items: flex-end; }\r
\r
    select,\r
    input[type="text"],\r
    input[type="number"] {\r
      width: 100%;\r
      padding: 9px 11px;\r
      border: none;\r
      border-radius: var(--r-input);\r
      background-color: var(--fill);\r
      font-family: inherit;\r
      font-size: 13px;\r
      color: var(--ink);\r
      outline: none;\r
      transition: background .18s, box-shadow .18s;\r
      -moz-appearance: textfield;\r
    }\r
    input[type="number"]::-webkit-outer-spin-button,\r
    input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }\r
    select {\r
      padding-right: 28px; cursor: pointer;\r
      appearance: none; -webkit-appearance: none;\r
      background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238E8A87' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");\r
      background-repeat: no-repeat;\r
      background-position: right 10px center;\r
    }\r
    select:focus,\r
    input[type="text"]:focus,\r
    input[type="number"]:focus {\r
      background-color: #FFF6F2;\r
      box-shadow: inset 0 0 0 1.5px var(--o-1);\r
    }\r
    ::placeholder { color: #BDB8B4; }\r
\r
    input[type="color"] {\r
      width: 46px; height: 38px;\r
      flex: none;\r
      padding: 3px;\r
      border: none;\r
      border-radius: var(--r-input);\r
      background: var(--fill);\r
      cursor: pointer;\r
    }\r
    input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }\r
    input[type="color"]::-webkit-color-swatch { border: none; border-radius: 9px; }\r
\r
    /* ---------- 纯色 / 渐变 分段控件（iOS segmented 同款） ---------- */\r
    .seg { display: flex; gap: 3px; background: var(--fill); border-radius: 11px; padding: 3px; }\r
    .seg-btn {\r
      flex: 1; border: 0; padding: 7px 0;\r
      background: transparent; border-radius: 9px;\r
      font-family: inherit; font-size: 12.5px; color: var(--ink-3);\r
      cursor: pointer; transition: background .15s, color .15s;\r
    }\r
    .seg-btn.on { background: #fff; color: var(--ink); font-weight: 700; box-shadow: 0 1px 3px rgba(26, 26, 26, .10); }\r
\r
    /* ---------- 渐变编辑器 ---------- */\r
    /* 预览条给足高度：径向/菱形/角度的形状差异才看得出来 */\r
    .gp-preview {\r
      display: block; width: 100%; height: 54px;\r
      border-radius: 10px; border: 1px solid #EDE7E2; background: var(--fill);\r
    }\r
    .gp-dirs { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; margin-top: 7px; }\r
    .gp-dir {\r
      height: 26px; padding: 0;\r
      border: 1px solid #EDE7E2; background: #fff; border-radius: 7px;\r
      font-family: inherit; font-size: 12px; color: var(--ink-2);\r
      cursor: pointer; line-height: 1;\r
    }\r
    .gp-dir:hover { background: #FFF6F2; border-color: var(--o-1); }\r
    .gp-dir.on { background: var(--o-2); border-color: var(--o-2); color: #fff; }\r
    .stop-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }\r
    .stop-row input[type="color"] { width: 34px; height: 30px; padding: 2px; border-radius: 9px; }\r
    .stop-row input[type="color"]::-webkit-color-swatch { border-radius: 7px; }\r
    .stop-pos {\r
      width: 54px; height: 30px; text-align: center;\r
      border: 1.5px solid transparent; border-radius: 9px;\r
      background: var(--fill); color: var(--ink); font-family: inherit; font-size: 12.5px;\r
    }\r
    .stop-pos:focus { outline: none; border-color: var(--o-1); background: #FFF6F2; }\r
    .stop-pct { font-size: 11px; color: var(--ink-3); flex: none; }\r
    .stop-del {\r
      flex: none; width: 26px; height: 26px; padding: 0;\r
      border: 0; border-radius: 8px; background: var(--fill);\r
      color: var(--ink-3); font-size: 15px; line-height: 1; cursor: pointer;\r
    }\r
    .stop-del:hover { background: #FFE8E0; color: var(--o-2); }\r
    .btn-mini {\r
      width: 100%; margin-top: 7px; padding: 7px 0;\r
      border: 1px dashed #DCD5CF; background: #fff; border-radius: 10px;\r
      font-family: inherit; font-size: 12.5px; color: var(--ink-3); cursor: pointer;\r
    }\r
    .btn-mini:hover { background: #FFF6F2; border-color: var(--o-1); color: var(--o-2); }\r
\r
    /* ---------- iOS 式开关（保留原生 checkbox 供 JS 读取 .checked） ---------- */\r
    .switch-row {\r
      display: flex; align-items: center; gap: 9px;\r
      cursor: pointer; user-select: none;\r
    }\r
    .switch-row input[type="checkbox"] {\r
      position: absolute;\r
      opacity: 0; width: 0; height: 0; margin: 0;\r
    }\r
    .sw {\r
      position: relative;\r
      width: 38px; height: 22px; flex: none;\r
      border-radius: 999px;\r
      background: #E6E1DD;\r
      transition: background .22s ease;\r
    }\r
    .sw::after {\r
      content: "";\r
      position: absolute;\r
      top: 2.5px; left: 2.5px;\r
      width: 17px; height: 17px;\r
      border-radius: 50%;\r
      background: #fff;\r
      box-shadow: 0 1px 3px rgba(0, 0, 0, .22);\r
      transition: transform .22s cubic-bezier(.4, .1, .3, 1.3);\r
    }\r
    .switch-row input:checked + .sw { background: linear-gradient(135deg, var(--o-1), var(--o-2)); }\r
    .switch-row input:checked + .sw::after { transform: translateX(16px); }\r
    .switch-row input:focus-visible + .sw { box-shadow: 0 0 0 3px var(--o-soft); }\r
    .sw-txt { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }\r
\r
    /* ---------- 滑块 ---------- */\r
    input[type="range"] {\r
      -webkit-appearance: none; appearance: none;\r
      width: 100%; height: 6px;\r
      margin: 8px 0;\r
      border-radius: 999px;\r
      background: #ECE7E3;\r
      outline: none;\r
    }\r
    input[type="range"]::-webkit-slider-thumb {\r
      -webkit-appearance: none;\r
      width: 19px; height: 19px;\r
      border-radius: 50%;\r
      background: linear-gradient(135deg, var(--o-1), var(--o-2));\r
      border: 2.5px solid #fff;\r
      box-shadow: 0 3px 8px -2px rgba(255, 90, 43, .70);\r
      cursor: pointer;\r
      transition: transform .15s;\r
    }\r
    input[type="range"]::-webkit-slider-thumb:hover { transform: scale(1.10); }\r
    input[type="range"]:disabled { opacity: .45; }\r
\r
    /* ---------- 按钮 ---------- */\r
    .btn {\r
      width: 100%;\r
      padding: 11px 14px;\r
      border: none; border-radius: 14px;\r
      font-family: inherit; font-size: 13px; font-weight: 600;\r
      cursor: pointer;\r
      transition: all .18s ease;\r
    }\r
    .btn-primary {\r
      background: linear-gradient(135deg, var(--o-1), var(--o-2));\r
      color: #fff;\r
      box-shadow: 0 10px 20px -10px rgba(255, 90, 43, .85);\r
      margin-bottom: 10px;\r
    }\r
    .btn-primary:hover { filter: brightness(1.05); box-shadow: 0 12px 22px -10px rgba(255, 90, 43, .95); }\r
    .btn-primary:active { transform: translateY(1px) scale(.995); }\r
\r
    .btn-ghost {\r
      width: auto;\r
      padding: 5px 11px;\r
      border: 1px solid #F5E2D8;\r
      border-radius: 10px;\r
      background: #fff;\r
      color: var(--o-2);\r
      font-family: inherit; font-size: 11.5px; font-weight: 600;\r
      cursor: pointer;\r
      box-shadow: 0 3px 8px -5px rgba(80, 45, 30, .55);\r
      transition: all .18s ease;\r
    }\r
    .btn-ghost:hover { background: #FFF7F3; border-color: #FFCDB8; }\r
    .btn-ghost:active { transform: translateY(1px); }\r
\r
    /* ---------- 文本 ---------- */\r
    .hint { margin-top: 6px; font-size: 11px; line-height: 1.55; color: var(--ink-4); }\r
    .status { min-height: 16px; margin-top: 2px; font-size: 12px; font-weight: 600; color: var(--o-2); text-align: center; }\r
\r
    /* ---------- 斜切页：实时预览 + 快捷角度 ---------- */\r
    .skew-preview {\r
      margin: 2px 0 11px;\r
      padding: 7px 9px 5px;\r
      border-radius: 14px;\r
      background: var(--bg);\r
      border: 1px solid var(--line);\r
    }\r
    .skew-preview svg { display: block; width: 100%; height: 72px; }\r
    .sp-ref { fill: none; stroke: #D9D1CB; stroke-width: 1; stroke-dasharray: 4 4; }\r
    .sp-box { fill: rgba(255, 145, 97, .18); stroke: var(--o-2); stroke-width: 1.5; }\r
    .sp-x { stroke: rgba(255, 90, 43, .5); stroke-width: 1.1; fill: none; }\r
    .sp-a { font: 700 19px/1 -apple-system, "PingFang SC", system-ui, sans-serif; fill: #2A211C; }\r
    .sp-note { min-height: 15px; margin-top: 1px; font-size: 11px; color: var(--ink-4); text-align: center; }\r
    .sp-note.warn { color: #C2410C; font-weight: 600; }\r
    .skew-quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 0 0 12px; }\r
    .chip-btn {\r
      height: 29px; padding: 0; border-radius: 9px; cursor: pointer;\r
      border: 1px solid var(--line); background: #fff;\r
      font-size: 11.5px; font-weight: 600; color: var(--ink-3);\r
      font-family: inherit; transition: .15s;\r
    }\r
    .chip-btn:hover { border-color: #FFCDB8; color: var(--o-2); background: #FFF7F3; }\r
    .chip-btn:active { transform: translateY(1px); }\r
  </style>\r
</head>\r
<body data-page-node-id="mGtn0qUxCwcNGIXj41gxRb">\r
  <!-- ============ 品牌栏 ============ -->\r
  <header class="topbar" data-page-node-id="DmdD6WjQHUxDThya5mMPtO">\r
    <div class="brand" data-page-node-id="ZxUuwcYBVBfsIfTbez4OcM">\r
      <span class="logo" data-page-node-id="lpXbU0YSTZIkJcl0YECGTv">\r
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" data-page-node-id="20PHeIgnFocEKXEH7R02tq">\r
          <rect x="3" y="3" width="8" height="8" rx="2.5" data-page-node-id="2npOcQPUE6aI4B7Mx4ApBa" />\r
          <rect x="13" y="3" width="8" height="8" rx="2.5" data-page-node-id="sLZOv49OKtVPwtIZXUUeLr" />\r
          <rect x="3" y="13" width="8" height="8" rx="2.5" data-page-node-id="nuu9r0jVAK1w2YTpimVuvO" />\r
          <rect x="13" y="13" width="8" height="8" rx="2.5" data-page-node-id="dQ13P0M1NTewNKJocqDGy9" />\r
        </svg>\r
      </span>\r
      <span class="brand-name" data-page-node-id="mJYtsynAzGg8yG9mqtafNX">FIGMA工具箱</span>\r
    </div>\r
    <span class="chip-tag" data-page-node-id="pVllz5BCWHrjqrGhNGDxBo">4 IN 1</span>\r
  </header>\r
\r
  <!-- ============ 标签切换 ============ -->\r
  <nav class="seg" data-page-node-id="x7Fo7E8k0SB271oQrhcP8q">\r
    <button class="tab-btn active" data-tab="font" data-page-node-id="lh3mOL8qhU6ouMRcfS1nhi">字体混排</button>\r
    <button class="tab-btn" data-tab="style" data-page-node-id="pWFxN6OitQYmzDCvV1Fm6A">批量样式</button>\r
    <button class="tab-btn" data-tab="skew">斜切</button>\r
    <button class="tab-btn" data-tab="export" data-page-node-id="0xpIaDSumHKc2olCzEETeC">导出压缩</button>\r
  </nav>\r
\r
  <main class="content" data-page-node-id="DP0Xy7US4buvF9MEtGVkm6">\r
    <!-- ============ ① 字体混排 ============ -->\r
    <section class="panel active" id="font" data-page-node-id="T869DRNyX4vuL4PUq2OAza">\r
      <!-- 方案选择器：仅字体混排功能拥有 -->\r
      <div class="preset-bar" id="preset-bar" data-page-node-id="wBPaEjf6MuGBOqZOHoY0vQ">\r
        <div class="preset-trigger" id="preset-trigger" data-page-node-id="mqvmpDot2exreMEB6d8GGU">\r
          <span class="preset-ico" data-page-node-id="k9XDUtAHwpQ9o9GTpBJVPF">◆</span>\r
          <span class="preset-current empty" id="preset-current" data-page-node-id="eqzBdKcIAg1vifdbyAZq3w">未选择方案</span>\r
          <span class="preset-caret" data-page-node-id="2vHIGfVdZtfij9YF0LePgi">⌄</span>\r
        </div>\r
        <div class="preset-pop" id="preset-pop" data-page-node-id="83LcVZXaeTQvFgSWr7aaBX">\r
          <div class="preset-pop-head" data-page-node-id="32XStsT6uyOIXWQd7puQxx">字体混排方案</div>\r
          <div class="preset-search" data-page-node-id="IBCcM4ydfI2U1WxdBqvBLH"><input type="text" id="preset-search" placeholder="搜索方案…" data-page-node-id="OnOqAzrF8FWq3ZmQp8Jaw4" /></div>\r
          <div id="preset-pop-list" data-page-node-id="s3uFANcpLn6ZHSjz1wojYl"></div>\r
          <div class="preset-pop-empty" id="preset-pop-empty" style="display:none" data-page-node-id="4KvgKBMZpMZukwNwyzEAMF">暂无方案，在下方保存一个</div>\r
        </div>\r
      </div>\r
\r
      <div class="card" data-page-node-id="fTFDw4xiKJcAtnY7PhhPGC">\r
        <div class="card-head" data-page-node-id="SvAAbqnrdcJbydKlFuBJQT"><span class="dot cn" data-page-node-id="jDJeCWDVryzUERlZfljamX"></span>中文</div>\r
        <div class="field" data-page-node-id="8JniWzZr2M3XijmLNCxlZX">\r
          <label data-page-node-id="3zQxF4nq2VNjcZk2BW7AyS">字体</label>\r
          <div class="dd" data-target="cn-font" data-placeholder="选择字体…">\r
            <button type="button" class="dd-trigger">\r
              <span class="dd-current empty">选择字体…</span>\r
              <span class="dd-caret">⌄</span>\r
            </button>\r
            <div class="dd-pop">\r
              <div class="dd-head">中文字体</div>\r
              <div class="dd-search"><input type="text" placeholder="搜索字体…"></div>\r
              <div class="dd-list"></div>\r
              <div class="dd-empty" style="display:none">无匹配字体</div>\r
            </div>\r
          </div>\r
          <select id="cn-font" data-page-node-id="qb30phlXOmzDTe75CRJ6dO" style="display:none"></select>\r
        </div>\r
        <div class="row" data-page-node-id="A7dDG9yloWKawGQQXXx67k">\r
          <div class="field grow" data-page-node-id="SbLDVbRP3E4WFBlDuDHNjR">\r
            <label data-page-node-id="ctEXRaYLC318MplftKFCfn">字号</label>\r
            <input type="number" id="cn-size" placeholder="如 14，留空不改" data-page-node-id="0zlqaZhVRmQVNYDrRIHiWx" />\r
          </div>\r
          <div class="field" data-page-node-id="GF37ISo8J8SEG1sndqV3l0">\r
            <label data-page-node-id="2IBcWBRLInPEpvqA5FWnzA">字色</label>\r
            <input type="color" id="cn-color" value="#000000" data-page-node-id="86ZKluwVulGNFq6vHsMGxd" />\r
          </div>\r
        </div>\r
      </div>\r
\r
      <div class="card" data-page-node-id="h68brhrpkutEVZpZFFAe7I">\r
        <div class="card-head" style="display:flex;align-items:center;justify-content:space-between" data-page-node-id="OHbNMT9E012hFuj2odwciv"><span class="lang-title"><span class="dot en" data-page-node-id="jIF2AF8GGfPkgYEOKG1dH7"></span>英文</span><button class="btn-ghost" id="kerning-apply" style="padding:5px 10px;font-size:11px">自动微调</button></div><div class="status" id="kerning-status"></div>\r
        <div class="field" data-page-node-id="pix27OwA2SVYSuEgOuH2gJ">\r
          <label data-page-node-id="AaPEWEFKDmEP5rQP9ilIou">字体</label>\r
          <div class="dd" data-target="en-font" data-placeholder="选择字体…">\r
            <button type="button" class="dd-trigger">\r
              <span class="dd-current empty">选择字体…</span>\r
              <span class="dd-caret">⌄</span>\r
            </button>\r
            <div class="dd-pop">\r
              <div class="dd-head">英文字体</div>\r
              <div class="dd-search"><input type="text" placeholder="搜索字体…"></div>\r
              <div class="dd-list"></div>\r
              <div class="dd-empty" style="display:none">无匹配字体</div>\r
            </div>\r
          </div>\r
          <select id="en-font" data-page-node-id="nyKL6JgsniKsoHk72pGoVw" style="display:none"></select>\r
        </div>\r
        <div class="row" data-page-node-id="FOjFCKY7V9B4qFxx93vsyz">\r
          <div class="field grow" data-page-node-id="jQc8LhAHWWUYGV0QwOQvhH">\r
            <label data-page-node-id="JL2lAhW5hU9WVbczp58KT0">字号</label>\r
            <input type="number" id="en-size" placeholder="如 12，留空不改" data-page-node-id="RovLYRJwyLzwk5aKmFQoQp" />\r
          </div>\r
          <div class="field" data-page-node-id="l4FJjV3CvQQyAXPPeJgJhA">\r
            <label data-page-node-id="E8jgoRNeXXIVtM7h3Dse2C">字色</label>\r
            <input type="color" id="en-color" value="#000000" data-page-node-id="3GpxfbLsTeVXqejgeFvwEg" />\r
          </div>\r
        </div>\r
      </div>\r
\r
      <button class="btn btn-primary" id="font-apply">应用字体混排</button>\r
      <div class="status" id="font-status"></div>\r
\r
      <div class="card" data-page-node-id="ofyJgVCAT90A3HfYDY29ER">\r
        <div class="card-head" data-page-node-id="qk707xjfSulLDsR5xwFohE">方案管理</div>\r
        <div class="row" style="margin-bottom: 10px" data-page-node-id="b5ijvPKphxRPa4R3566ISi">\r
          <div class="field grow" style="margin-bottom: 0" data-page-node-id="gBHVsznLnm7sJBcFw3wKFU">\r
            <input type="text" id="preset-name" placeholder="新方案名，如 中文正文" data-page-node-id="9mWkDwkCVAvSTG32SBy9Mj" />\r
          </div>\r
          <button class="btn-ghost" id="preset-save" data-page-node-id="IAYHEtu3x6uJentodvlKGP">保存为方案</button>\r
        </div>\r
        <div class="row" style="gap: 7px" data-page-node-id="dm5dMFpzXpWhcjR7TI1nE0">\r
          <button class="btn-ghost" id="preset-import-btn" data-page-node-id="DmAx6JU2BBzBZI3TmfKo02">导入方案</button>\r
          <button class="btn-ghost" id="preset-export" data-page-node-id="sVsxwjLoR9H5Uo6kzuorDR">导出全部</button>\r
          <input type="file" id="preset-import" accept="application/json" style="display: none" data-page-node-id="ZECX5qfBgdNey1XFFOWwHT" />\r
        </div>\r
        <div class="hint" data-page-node-id="a9avpmWwttFoefmoIVDp6U">在上方「方案」下拉选预设 → 本页微调 → 点「应用字体混排」生效。预设保存在插件本地存储，关掉再开仍在，全程不联网。</div>\r
      </div>\r
    </section>\r
\r
    <!-- ============ ② 批量样式 ============ -->\r
    <section class="panel" id="style">\r
      <!-- 方案选择器：仅批量样式功能拥有 -->\r
      <div class="preset-bar" id="sp-bar">\r
        <div class="preset-trigger" id="sp-trigger">\r
          <span class="preset-ico">▣</span>\r
          <span class="preset-current empty" id="sp-current">未选择方案</span>\r
          <span class="preset-caret">⌄</span>\r
        </div>\r
        <div class="preset-pop" id="sp-pop">\r
          <div class="preset-pop-head">批量样式方案</div>\r
          <div class="preset-search"><input type="text" id="sp-search" placeholder="搜索方案…" /></div>\r
          <div id="sp-pop-list"></div>\r
          <div class="preset-pop-empty" id="sp-pop-empty" style="display:none">暂无方案，在下方保存一个</div>\r
        </div>\r
      </div>\r
\r
      <div class="card">\r
        <label class="switch-row" data-page-node-id="gcxQZScCejNaaNIJ2EaPro">\r
          <input type="checkbox" id="fill-on" data-page-node-id="jkAplHZ690nelko0DwvdbS" />\r
          <span class="sw" data-page-node-id="wjG42AqKGbtF9yGVQO6bCG"></span>\r
          <span class="sw-txt" data-page-node-id="HYc0Rd1IjmGzDRtDzIXutG">填充颜色</span>\r
        </label>\r
        <div class="seg" id="fill-seg" style="margin-top: 11px">\r
          <button type="button" class="seg-btn on" data-v="solid">纯色</button>\r
          <button type="button" class="seg-btn" data-v="gradient">渐变</button>\r
        </div>\r
        <div class="row" id="fill-solid" style="margin-top: 10px">\r
          <input type="color" id="fill-color" value="#60a5fa" />\r
          <span class="hint" style="margin-top: 0">纯色填充，套用到所有选中图形</span>\r
        </div>\r
        <div id="fill-grad" style="display: none"></div>\r
      </div>\r
\r
      <div class="card" data-page-node-id="sMBBch1DD73uh9YDTwqTWN">\r
        <label class="switch-row" data-page-node-id="Kkb7YPJFEesjteoBHtOajv">\r
          <input type="checkbox" id="radius-on" data-page-node-id="gihOP4mQouxfyiqG7L2rq1" />\r
          <span class="sw" data-page-node-id="mIsq9Ah4gnprjn29EI9DYq"></span>\r
          <span class="sw-txt" data-page-node-id="N1evyK6l6RylEhzKJ23877">圆角</span>\r
        </label>\r
        <div class="field" style="margin-top: 11px" data-page-node-id="gPOknMqnlzOdnQbjvAddTn">\r
          <input type="number" id="radius" placeholder="圆角半径，如 8" data-page-node-id="9ZKFSmYPpXCSVuBuiLZCi9" />\r
        </div>\r
      </div>\r
\r
      <div class="card" data-page-node-id="Ag6xnyf4v1xKqiWfeoiruQ">\r
        <label class="switch-row" data-page-node-id="RJEeYVwfWBk13aTZzAuDYg">\r
          <input type="checkbox" id="stroke-on" data-page-node-id="bmLBp7sr3JAEU7DIV2NiBr" />\r
          <span class="sw" data-page-node-id="F0JMcNixdePXQUqM4IFqHk"></span>\r
          <span class="sw-txt" data-page-node-id="rgxgt73OERWpCMwm4U4VNf">描边</span>\r
        </label>\r
        <div class="seg" id="stroke-seg" style="margin-top: 11px">\r
          <button type="button" class="seg-btn on" data-v="solid">纯色</button>\r
          <button type="button" class="seg-btn" data-v="gradient">渐变</button>\r
        </div>\r
        <div class="row" id="stroke-solid" style="margin-top: 10px">\r
          <input type="color" id="stroke-color" value="#111827" />\r
          <span class="hint" style="margin-top: 0">描边颜色</span>\r
        </div>\r
        <div id="stroke-grad" style="display: none"></div>\r
        <div class="row" style="margin-top: 9px">\r
          <div class="field grow" style="margin-bottom: 0">\r
            <input type="number" id="stroke-weight" placeholder="粗细" />\r
          </div>\r
          <div class="field" style="margin-bottom: 0; width: 78px; flex: none">\r
            <div class="dd" data-target="stroke-align" data-placeholder="对齐">\r
              <button type="button" class="dd-trigger">\r
                <span class="dd-current empty">对齐</span>\r
                <span class="dd-caret">⌄</span>\r
              </button>\r
              <div class="dd-pop align-right">\r
                <div class="dd-head">描边对齐</div>\r
                <div class="dd-list"></div>\r
              </div>\r
            </div>\r
            <select id="stroke-align" style="display:none">\r
              <option value="INSIDE">内</option>\r
              <option value="OUTSIDE">外</option>\r
              <option value="CENTER">中</option>\r
            </select>\r
          </div>\r
        </div>\r
      </div>\r
\r
      <div class="card" data-page-node-id="lruldyao7ydoW9lWm37W6j">\r
        <label class="switch-row" data-page-node-id="6ULc1BgoyBaP6xckaresvQ">\r
          <input type="checkbox" id="shadow-on" data-page-node-id="ry6VLPgiWKBWJSI1LAXRv1" />\r
          <span class="sw" data-page-node-id="xjy5qvsUDi3vMf1BzhzUXg"></span>\r
          <span class="sw-txt" data-page-node-id="PqpX6qPo2N4jrOTd2nMdoG">投影 DROP_SHADOW</span>\r
        </label>\r
        <div class="row" style="margin-top: 11px" data-page-node-id="rOUYGPGeH0OKNd9xaMcFLt">\r
          <input type="color" id="shadow-color" value="#000000" data-page-node-id="3osXfEeHzaOk8mPZNOB1la" />\r
          <div class="field grow" style="margin-bottom: 0" data-page-node-id="2tbXOLX8FybsPBAN2b3om6">\r
            <input type="number" id="shadow-x" placeholder="X" data-page-node-id="D0e5BYaTCTBhRWCceD0DxY" />\r
          </div>\r
          <div class="field grow" style="margin-bottom: 0" data-page-node-id="YZHUSrw5nJaAtLJxXg3LNR">\r
            <input type="number" id="shadow-y" placeholder="Y" data-page-node-id="pUPWDERE3VW9qLxP9LqTZw" />\r
          </div>\r
        </div>\r
        <div class="row" style="margin-top: 8px" data-page-node-id="b0NXvidf7CuR3yxG26tCfB">\r
          <div class="field grow" style="margin-bottom: 0" data-page-node-id="GXvnx90S6ZuxHhLj4iUQzN">\r
            <input type="number" id="shadow-blur" placeholder="模糊" data-page-node-id="Sp2ZKXLxF9yWynlwTjQtyC" />\r
          </div>\r
          <div class="field grow" style="margin-bottom: 0" data-page-node-id="AY75YkmBilxIUkgu0DCc5E">\r
            <input type="number" id="shadow-spread" placeholder="扩展" data-page-node-id="knB9DMmy4s6VDxwRtQztQx" />\r
          </div>\r
        </div>\r
      </div>\r
\r
      <button class="btn btn-primary" id="style-apply">应用批量样式</button>\r
      <div class="status" id="style-status"></div>\r
\r
      <div class="card">\r
        <div class="card-head"><span class="dot cn"></span>方案管理</div>\r
        <div class="row" style="margin-bottom: 10px">\r
          <div class="field grow" style="margin-bottom: 0">\r
            <input type="text" id="sp-name" placeholder="新方案名，如 卡片蓝底" />\r
          </div>\r
          <button class="btn-ghost" id="sp-save">保存为方案</button>\r
        </div>\r
        <div class="row" style="gap: 7px">\r
          <button class="btn-ghost" id="sp-import-btn">导入方案</button>\r
          <button class="btn-ghost" id="sp-export">导出全部</button>\r
          <input type="file" id="sp-import" accept="application/json" style="display: none" />\r
        </div>\r
        <div class="hint">在上方「方案」下拉选预设 → 本页微调 → 点「应用批量样式」生效。预设保存在插件本地存储，关掉再开仍在，全程不联网。</div>\r
      </div>\r
    </section>\r
\r
    <!-- ============ ③ 斜切（SkewDat 风格） ============ -->\r
    <section class="panel" id="skew">\r
      <div class="card">\r
        <div class="card-head"><span class="dot cn"></span>斜切参数</div>\r
\r
        <!-- 实时预览：一眼看出「斜切（平行四边形）」与「旋转」的区别 -->\r
        <div class="skew-preview">\r
          <svg viewBox="0 0 260 66" preserveAspectRatio="xMidYMid meet" aria-label="斜切预览">\r
            <rect class="sp-ref" id="sp-ref" x="110" y="13" width="40" height="40" rx="4"></rect>\r
            <g id="sp-g">\r
              <rect class="sp-box" x="0" y="0" width="40" height="40" rx="3"></rect>\r
              <path class="sp-x" d="M0 0 L40 40 M40 0 L0 40"></path>\r
              <text class="sp-a" x="20" y="27" text-anchor="middle">A</text>\r
            </g>\r
          </svg>\r
          <div class="sp-note" id="sp-note"></div>\r
        </div>\r
\r
        <div class="field">\r
          <label>水平斜切 · 竖边倾角（度）</label>\r
          <div class="row" style="align-items: center">\r
            <input type="range" id="skew-x" min="-60" max="60" step="1" value="0">\r
            <input type="number" id="skew-x-num" value="0" style="width: 62px; flex: none">\r
          </div>\r
        </div>\r
        <div class="field">\r
          <label>垂直斜切 · 横边倾角（度）</label>\r
          <div class="row" style="align-items: center">\r
            <input type="range" id="skew-y" min="-60" max="60" step="1" value="0">\r
            <input type="number" id="skew-y-num" value="0" style="width: 62px; flex: none">\r
          </div>\r
        </div>\r
\r
        <div class="skew-quick">\r
          <button class="chip-btn" data-skew="15,0">右倾 15°</button>\r
          <button class="chip-btn" data-skew="-15,0">左倾 15°</button>\r
          <button class="chip-btn" data-skew="0,15">下倾 15°</button>\r
          <button class="chip-btn" data-skew="0,-15">上倾 15°</button>\r
        </div>\r
\r
        <div class="row" style="gap: 7px; margin-top: 2px">\r
          <button class="btn-ghost" id="skew-reset">归零</button>\r
          <button class="btn-ghost" id="skew-sync">读取选中图层</button>\r
        </div>\r
        <div class="hint">以图层中心为锚点做真正的斜切（竖直边 / 水平边各自倾斜），并保留图层原有旋转。总斜切量 = α + β —— 两个角度方向相反时会互相抵消（结果看起来像旋转）。</div>\r
      </div>\r
      <button class="btn btn-primary" id="skew-apply">应用斜切到选中图层</button>\r
      <div class="status" id="skew-status"></div>\r
    </section>\r
\r
    <!-- ============ ④ 导出压缩 ============ -->\r
    <section class="panel" id="export" data-page-node-id="kTM7H70jkioCrkb87FKl3w">\r
      <div class="card" data-page-node-id="uhMJAcehrIVcBfY3yTXAHe">\r
        <div class="field" data-page-node-id="0DXpcFub0ySDjmupHN002D">\r
          <label data-page-node-id="OryE9F7NC4FtrancQjSZ3D">格式</label>\r
          <div class="dd" data-target="fmt" data-placeholder="选择格式">\r
            <button type="button" class="dd-trigger">\r
              <span class="dd-current empty">选择格式</span>\r
              <span class="dd-caret">⌄</span>\r
            </button>\r
            <div class="dd-pop">\r
              <div class="dd-head">导出格式</div>\r
              <div class="dd-list"></div>\r
            </div>\r
          </div>\r
          <select id="fmt" data-page-node-id="X8sEmT3bfjk5DS5ZUe18VB" style="display:none">\r
            <option value="PNG" data-page-node-id="WtHujyOCJQqgNODWdHF3am">PNG</option>\r
            <option value="JPG" data-page-node-id="DmnwfIjzUVsSj07BvKrvNN">JPG</option>\r
            <option value="WEBP" data-page-node-id="rZM6r29nJ3lhmLlHRA4IlF">WebP</option>\r
          </select>\r
        </div>\r
        <div class="field" data-page-node-id="28cRGZhZxpefzfh7stuRCM">\r
          <label data-page-node-id="lutivyCb0aJL32LSduHMld">倍数（0.5 ~ 4）</label>\r
          <input type="number" id="scale" value="1" step="0.5" min="0.5" max="4" data-page-node-id="t89VvOwXUqrk8n5DYDlrO4" />\r
        </div>\r
        <div class="field" data-page-node-id="AuHoUkBxk1kbFwzjHa8lHq">\r
          <label data-page-node-id="pnaa0Q2xsuCB1K7RYUGO59">质量（仅 JPG / WebP）</label>\r
          <input type="range" id="quality" min="0.1" max="1" step="0.05" value="0.9" data-page-node-id="jGSfBlfbR11E43PWclfUW3" />\r
          <div class="hint" id="quality-hint" data-page-node-id="iXHo7ByLiYgL49QeAyfxrF">0.90</div>\r
        </div>\r
      </div>\r
\r
      <button class="btn btn-primary" id="export-btn" data-page-node-id="Um8sfnLK0WnPQ1c8G9llha">批量导出选中节点</button>\r
      <div class="status" id="exp-status" data-page-node-id="FayylJw8P0qtdWUTW6hr8R"></div>\r
      <div class="card" style="margin-top: 10px">\r
        <div class="card-head"><span class="dot"></span>保存规则</div>\r
        <div class="hint" style="margin-top: 0">\r
          路径规则与 Figma 一致：图层名里的 <b>/</b> 表示新建一层文件夹，祖先图层名作为更外层目录。<br>\r
          例：画框 <b>0911</b> → 图层 <b>1555/HR面霜-11主图-1</b><br>\r
          　→ 保存为 <b>0911/1555/HR面霜-11主图-1.jpg</b>\r
        </div>\r
        <div class="hint" style="margin-top: 6px">\r
          · 选中 <b>1 个</b>目标：先选文件夹，按规则自动建子目录后直接存图片。<br>\r
          · 选中 <b>多个</b>目标：自动打包为 <b>zip</b>（压缩包内保留目录结构），再选保存位置。<br>\r
          · PNG 不支持质量参数，原样输出；JPG / WebP 按质量重编码。\r
        </div>\r
      </div>\r
    </section>\r
  </main>\r
\r
  <script>\r
    const $ = (s) => document.querySelector(s);\r
    let activeTab = 'font';   // 当前激活标签页，用于决定「识别」读哪类节点\r
    const ddRegistry = {};    // 通用下拉组件实例表，按目标 select 的 id 索引\r
    const fontSel = { cn: null, en: null };   // 中/英文字体的真实取值状态（方案保存以它为准）\r
    // 字体混排的等待守卫：主进程若长时间不回包（例如字体加载卡住），\r
    // 必须主动告诉用户，否则状态栏会永远停在「应用中…」，看起来就是按钮坏了。\r
    let fontGuard = null;\r
\r
    // 收起所有弹层（方案预设 / 批量样式预设 / 通用下拉）\r
    function closeAllPickers() {\r
      closePresetPop();\r
      closeStylePop();\r
      document.querySelectorAll('.dd.open').forEach((el) => el.classList.remove('open'));\r
      document.querySelectorAll('.dd-pop.open').forEach((el) => el.classList.remove('open'));\r
    }\r
\r
    // ---- 标签页切换 ----\r
    document.querySelectorAll('.tab-btn').forEach((btn) => {\r
      btn.addEventListener('click', () => {\r
        document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));\r
        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));\r
        btn.classList.add('active');\r
        document.getElementById(btn.dataset.tab).classList.add('active');\r
        activeTab = btn.dataset.tab;\r
        closeAllPickers();\r
        detectActive();   // 切到对应页时，自动识别当前选中图层并回填表单\r
        requestResize();  // 切页后让面板高度贴合当前页内容\r
      });\r
    });\r
\r
    // ---- 与插件主进程通信 ----\r
    function send(msg) { parent.postMessage({ pluginMessage: msg }, '*'); }\r
\r
    // 让插件面板高度贴合当前标签页内容：切页 / 内容变化后调用。\r
    // 用「当前面板距顶偏移 + 面板高度 + 底部留白」计算，\r
    // 这样即使 body 被面板高度撑大，测到的仍是真实内容高度。\r
    function requestResize() {\r
      const panel = document.querySelector('.panel.active');\r
      if (!panel) return;\r
      // 用 getBoundingClientRect 取面板底部「相对文档」的位置。\r
      // 注意：不能用 panel.offsetTop —— 该布局下 offsetParent 会让它返回 0，导致高度少算约 125px。\r
      const r = panel.getBoundingClientRect();\r
      const scrollY = window.scrollY || window.pageYOffset || 0;\r
      const h = Math.ceil(r.bottom + scrollY) + 32;   // 22 = body 底部留白，+10 为安全余量（实测误差 <10px）\r
      send({ type: 'resize', height: h });\r
    }\r
    window.onmessage = async (e) => {\r
      const msg = e.data.pluginMessage;\r
      if (!msg) return;\r
      // 字体库到达只更新字体数据，不再顺带触发识别\r
      // （旧写法把 detectActive() 挂在这里，等于「识别」被字体库拖住，\r
      //   表现为插件打开后要等字体列表回来才能用）\r
      if (msg.type === 'fonts-list') applyFontList(msg);\r
      if (msg.type === 'selection-changed') detectActive();\r
      if (msg.type === 'detect-font-result') fillFontFromDetect(msg);\r
      if (msg.type === 'detect-style-result') fillStyleFromDetect(msg);\r
      if (msg.type === 'detect-skew-result') {\r
        if (msg.empty) {\r
          $('#skew-status').textContent = '未选中可斜切的图层';\r
        } else {\r
          setSkew(msg.skewX || 0, msg.skewY || 0);\r
          const rot = msg.rotation || 0;\r
          $('#skew-status').textContent = rot\r
            ? '已读取（图层本身含 ' + rot + '° 旋转）'\r
            : '已读取选中图层';\r
        }\r
      }\r
      if (msg.type === 'skew-done') {\r
        $('#skew-status').textContent = msg.applied\r
          ? '已应用斜切：' + msg.applied + ' 个图层'\r
          : '未能应用：图层被锁定或受自动布局约束';\r
      }\r
      if (msg.type === 'font-mixer-start') onFontMixStart(msg);\r
      if (msg.type === 'font-mixer-done') showFontMixResult(msg);\r
      if (msg.type === 'bulk-styles-done') showStyleResult(msg);\r
      if (msg.type === 'auto-kerning-done') $('#kerning-status').textContent = msg.empty ? '未选中文本' : ('已调整 ' + msg.applied + ' 处字符对' + (msg.failed ? '，失败 ' + msg.failed + ' 个文本' : ''));\r
      if (msg.type === 'export-chunk') chunkChain = chunkChain.then(() => handleChunk(msg));\r
      if (msg.type === 'export-done') await finalizeExport(msg);\r
      if (msg.type === 'storage-data') applyStoredPresets(msg.data);\r
    };\r
    // 识别选中图层**不依赖字体库** → 立刻发出。\r
    // 面板一打开就能回填中英字体 / 字号 / 字色，不再出现「插件开着却要等一会才能用」。\r
    detectActive();\r
    send({ type: 'storage-load' });   // 从插件存储（clientStorage）读回已保存的方案\r
    // 字体库体积大、加载慢（listAvailableFontsAsync 在字体装得多的机器上可达数秒），\r
    // 启动即异步读取设备字体列表；延后到当前脚本初始化完成，避免变量未初始化。\r
    setTimeout(requestFontList, 0);\r
    requestResize();   // 插件打开时先贴合一次当前页高度\r
\r
    $('#kerning-apply').addEventListener('click', () => { $('#kerning-status').textContent = '处理中…'; send({ type: 'auto-kerning' }); });\r
\r
    // 主进程回传的持久化方案：以它为准覆盖内存态并重绘\r
    function applyStoredPresets(data) {\r
      const d = data || {};\r
      if (Array.isArray(d.fontPresets)) {\r
        fontPresets = d.fontPresets;\r
        lsWrite(PK, fontPresets);\r
        renderPresetPop();\r
      }\r
      if (Array.isArray(d.stylePresets)) {\r
        stylePresets = d.stylePresets;\r
        lsWrite(SPK, stylePresets);\r
        renderStylePresetPop();\r
      }\r
    }\r
\r
    // 按当前标签页，请求主进程识别选中的图层\r
    function detectActive() {\r
      if (activeTab === 'font') send({ type: 'detect-font' });\r
      else if (activeTab === 'style') send({ type: 'detect-style' });\r
      else if (activeTab === 'skew') send({ type: 'detect-skew' });\r
    }\r
\r
    // 把识别到的文本图层字体混排回填到表单（同时重置方案态，保存即存为新方案）\r
    // 守卫：用户已选中预设方案时，识别结果不得覆盖表单 ——\r
    // 预设是显式意图，优先级高于任何自动识别；否则启动识别晚到 / 选区变化\r
    // 都会把刚选好的预设悄悄冲掉，表现为「点了预设但不生效」。\r
    // 想恢复识别回填：在方案下拉里再次点击「当前」方案行即可取消选择。\r
    function fillFontFromDetect(msg) {\r
      if (currentScheme) return;\r
      setCurrentLabel('');\r
      if (msg.empty) return;\r
      if (msg.cnFont) setFontValue('cn', msg.cnFont);\r
      if (msg.enFont) setFontValue('en', msg.enFont);\r
      $('#cn-size').value = msg.cnSize != null ? msg.cnSize : '';\r
      $('#en-size').value = msg.enSize != null ? msg.enSize : '';\r
      $('#cn-size').placeholder = msg.cnSizeMixed ? '混合字号（留空保留）' : '如 14，留空不改';\r
      $('#en-size').placeholder = msg.enSizeMixed ? '混合字号（留空保留）' : '如 12，留空不改';\r
      if (msg.cnColor) $('#cn-color').value = rgbToHex(msg.cnColor);\r
      if (msg.enColor) $('#en-color').value = rgbToHex(msg.enColor);\r
    }\r
\r
    // 批量样式结果反馈：没套到东西也要说清楚原因（分组/画框自身没有 fills）\r
    function showStyleResult(msg) {\r
      const el = $('#style-status');\r
      if (!el) return;\r
      if (msg.fatal) { el.textContent = '应用失败：' + msg.fatal; return; }\r
      if (!msg.count) {\r
        el.textContent = msg.total\r
          ? '选中的 ' + msg.total + ' 个图层没有可套用的填充/描边（分组、画框请选中内部图层）'\r
          : '未选中任何图层';\r
        return;\r
      }\r
      el.textContent = '已应用：' + msg.count + ' 个图层';\r
    }\r
\r
    // 主进程已开始处理（字体加载可能耗时）→ 明确告知，并启动等待守卫\r
    function onFontMixStart(msg) {\r
      if (fontGuard) { clearTimeout(fontGuard); fontGuard = null; }\r
      const n = (msg && msg.total) || 0;\r
      $('#font-status').textContent = n ? ('正在加载字体…（共 ' + n + ' 个文本节点）') : '正在加载字体…';\r
      fontGuard = setTimeout(() => {\r
        fontGuard = null;\r
        $('#font-status').textContent = '主进程长时间无响应（可能卡在字体加载）。请再点一次；若仍停在这里，请把此提示告诉我。';\r
      }, 20000);\r
    }\r
\r
    // 字体混排结果反馈：成功 / 失败 / 字体不可用都要说清楚，不能静默\r
    function showFontMixResult(msg) {\r
      const el = $('#font-status');\r
      if (!el) return;\r
      if (fontGuard) { clearTimeout(fontGuard); fontGuard = null; }   // 收到结果即撤掉等待守卫\r
      const failed = msg.failed || [];\r
      const missing = msg.missingFonts || [];\r
      if (msg.fatal) { el.textContent = '应用失败：' + msg.fatal; return; }\r
      if (msg.empty || msg.total === 0) { el.textContent = '未选中文本图层，请先在画布上选择文本'; return; }\r
      if (missing.length) {\r
        el.textContent = '字体在本机不可用：' + missing.join('、') + '（请改用本机已安装的字体）';\r
        return;\r
      }\r
      if (failed.length) {\r
        el.textContent = '已处理 ' + msg.ok + ' 个，失败 ' + failed.length +\r
          ' 个（' + failed[0].name + '：' + failed[0].reason + '）';\r
        return;\r
      }\r
      el.textContent = msg.timedOut\r
        ? ('已应用：' + msg.ok + ' 个文本节点（部分字体加载超时，若有遗漏请重试）')\r
        : ('已应用：' + msg.ok + ' 个文本节点');\r
    }\r
\r
    // 把识别到的图形图层样式回填到表单\r
    // 与字体页同款守卫：已选中方案时，识别结果不覆盖表单（显式意图优先）\r
    function fillStyleFromDetect(msg) {\r
      if (styleCurrent) return;\r
      setStyleCurrentLabel('');\r
      if (msg.empty) return;\r
      $('#fill-on').checked = !!msg.fillOn;\r
      if (msg.fill) setPaintConfig('fill', msg.fill);\r
      $('#radius-on').checked = !!msg.radiusOn;\r
      $('#radius').value = msg.radius != null ? msg.radius : '';\r
      $('#stroke-on').checked = !!msg.strokeOn;\r
      if (msg.stroke) setPaintConfig('stroke', msg.stroke);\r
      $('#stroke-weight').value = msg.strokeWeight != null ? msg.strokeWeight : '';\r
      if (msg.strokeAlign) { $('#stroke-align').value = msg.strokeAlign; syncAlignDisplay(); }\r
      $('#shadow-on').checked = !!msg.shadowOn;\r
      if (msg.shadow) {\r
        $('#shadow-color').value = rgbToHex(msg.shadow.color);\r
        $('#shadow-x').value = msg.shadow.offsetX != null ? msg.shadow.offsetX : '';\r
        $('#shadow-y').value = msg.shadow.offsetY != null ? msg.shadow.offsetY : '';\r
        $('#shadow-blur').value = msg.shadow.blur != null ? msg.shadow.blur : '';\r
        $('#shadow-spread').value = msg.shadow.spread != null ? msg.shadow.spread : '';\r
      }\r
    }\r
\r
    // ---- 颜色转换 ----\r
    function hexToRgb(hex) {\r
      const h = hex.replace('#', '');\r
      const n = parseInt(h, 16);\r
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };\r
    }\r
    function rgbToHex(c) {\r
      if (!c) return '#000000';\r
      const f = (x) => ('0' + Math.round(x * 255).toString(16)).slice(-2);\r
      return '#' + f(c.r) + f(c.g) + f(c.b);\r
    }\r
    function hexToRgba(hex) { return Object.assign(hexToRgb(hex), { a: 1 }); }\r
\r
    /* ============================================================\r
       填充 / 描边：纯色 ↔ 渐变\r
       Figma 的渐变建立在图层 bbox 归一化空间（(0,0) 左上、(1,1) 右下），\r
       基底固定是「沿 x 轴 0→1」的水平渐变，gradientTransform 再旋转/缩放/平移：\r
         · 线性：渐变轴在单位空间中是 [0,0.5] → [1,0.5]\r
         · 径向：中心 (0.5,0.5)，半径 0.5\r
         · 角度 / 菱形：同样以 (0.5,0.5) 为中心\r
       → identity 矩阵即「线性：左→右」「其余：居中铺满」，旋转必须绕 (0.5,0.5)。\r
       预览用同一套数学逐像素反算，尽量与画布一致（仍以 Figma 实际效果为准）。\r
       ============================================================ */\r
    const GKINDS = [\r
      { v: 'GRADIENT_LINEAR', label: '线性渐变' },\r
      { v: 'GRADIENT_RADIAL', label: '径向渐变' },\r
      { v: 'GRADIENT_ANGULAR', label: '角度渐变' },\r
      { v: 'GRADIENT_DIAMOND', label: '菱形渐变' },\r
    ];\r
    const GDIRS = [\r
      { a: 0, t: '→' }, { a: 45, t: '↘' }, { a: 90, t: '↓' }, { a: 135, t: '↙' },\r
      { a: 180, t: '←' }, { a: 225, t: '↖' }, { a: 270, t: '↑' }, { a: 315, t: '↗' },\r
    ];\r
\r
    // UI 内部用 hex + 百分比存色标，方便表单与颜色控件\r
    const paintUI = {\r
      fill: {\r
        mode: 'solid', type: 'GRADIENT_LINEAR', angle: 0,\r
        stops: [{ color: '#FF9161', pos: 0 }, { color: '#FF5A2B', pos: 100 }],\r
      },\r
      stroke: {\r
        mode: 'solid', type: 'GRADIENT_LINEAR', angle: 0,\r
        stops: [{ color: '#111827', pos: 0 }, { color: '#6B7280', pos: 100 }],\r
      },\r
    };\r
    const clampPct = (n) => (isNaN(n) ? 0 : n < 0 ? 0 : n > 100 ? 100 : n);\r
    const norm360 = (a) => (((Number(a) || 0) % 360) + 360) % 360;\r
    const to255 = (hex) => { const c = hexToRgb(hex); return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)]; };\r
\r
    // 生成渐变编辑界面（填充 / 描边共用同一套 DOM 与逻辑）\r
    function buildGradientEditor(key) {\r
      const host = $('#' + key + '-grad');\r
      if (!host || host.dataset.built) return;\r
      host.dataset.built = '1';\r
      host.innerHTML =\r
        '<canvas class="gp-preview" id="' + key + '-gprev" style="margin-top:10px"></canvas>' +\r
        '<div class="row" style="margin-top: 8px">' +\r
          '<div class="field grow" style="margin-bottom: 0">' +\r
            '<div class="dd" data-target="' + key + '-gtype" data-placeholder="类型">' +\r
              '<button type="button" class="dd-trigger"><span class="dd-current empty">类型</span><span class="dd-caret">⌄</span></button>' +\r
              '<div class="dd-pop"><div class="dd-head">渐变类型</div><div class="dd-list"></div></div>' +\r
            '</div>' +\r
            '<select id="' + key + '-gtype" style="display:none">' +\r
              GKINDS.map((k) => '<option value="' + k.v + '">' + k.label + '</option>').join('') +\r
            '</select>' +\r
          '</div>' +\r
          '<div class="field grow" style="margin-bottom: 0">' +\r
            '<input type="number" id="' + key + '-gangle" placeholder="角度" value="0" />' +\r
          '</div>' +\r
        '</div>' +\r
        '<div class="gp-dirs" id="' + key + '-gdirs">' +\r
          GDIRS.map((d) => '<button type="button" class="gp-dir" data-a="' + d.a + '">' + d.t + '</button>').join('') +\r
        '</div>' +\r
        '<div id="' + key + '-stops"></div>' +\r
        '<button type="button" class="btn-mini" id="' + key + '-stop-add">+ 添加色标</button>' +\r
        '<div class="hint" style="margin-top: 5px">0° = 从左到右，顺时针递增；色标 0~100%</div>';\r
\r
      const st = paintUI[key];\r
      const gtSel = $('#' + key + '-gtype');\r
      gtSel.value = st.type;\r
      ddRegistry[key + '-gtype'] = initDropdown(host.querySelector('.dd'));\r
      ddRegistry[key + '-gtype'].syncDisplay();\r
      gtSel.addEventListener('change', () => {\r
        st.type = gtSel.value;\r
        // 程序化赋值（识别图层 / 载入方案 / 测试）后下拉文字不会自动更新，必须手动同步\r
        if (ddRegistry[key + '-gtype']) ddRegistry[key + '-gtype'].syncDisplay();\r
        renderGradient(key);\r
      });\r
\r
      const ang = $('#' + key + '-gangle');\r
      ang.addEventListener('input', () => { st.angle = parseFloat(ang.value) || 0; renderGradient(key); });\r
\r
      $('#' + key + '-gdirs').addEventListener('click', (e) => {\r
        const b = e.target.closest('.gp-dir');\r
        if (!b) return;\r
        st.angle = parseFloat(b.dataset.a) || 0;\r
        ang.value = st.angle;\r
        renderGradient(key);\r
      });\r
\r
      $('#' + key + '-stop-add').addEventListener('click', () => {\r
        if (st.stops.length >= 8) return;\r
        const sorted = st.stops.slice().sort((a, b) => a.pos - b.pos);\r
        let pos = 50;\r
        if (sorted.length >= 2) {\r
          // 落在最大间隙的中点，视觉上最自然\r
          let best = 0, bestGap = -1;\r
          for (let i = 0; i < sorted.length - 1; i++) {\r
            const gap = sorted[i + 1].pos - sorted[i].pos;\r
            if (gap > bestGap) { bestGap = gap; best = i; }\r
          }\r
          pos = Math.round((sorted[best].pos + sorted[best + 1].pos) / 2);\r
        }\r
        const near = sorted.reduce((p, c) => (Math.abs(c.pos - pos) < Math.abs(p.pos - pos) ? c : p), sorted[0]);\r
        st.stops.push({ color: near.color, pos });\r
        renderStops(key);\r
        renderGradient(key);\r
      });\r
\r
      renderStops(key);\r
      renderGradient(key);\r
    }\r
\r
    // 色标行：颜色 / 位置 / 删除（至少保留 2 个）\r
    function renderStops(key) {\r
      const st = paintUI[key];\r
      const box = $('#' + key + '-stops');\r
      if (!box) return;\r
      st.stops.sort((a, b) => a.pos - b.pos);\r
      box.innerHTML = '';\r
      st.stops.forEach((s) => {\r
        const row = document.createElement('div');\r
        row.className = 'stop-row';\r
        const col = document.createElement('input');\r
        col.type = 'color';\r
        col.value = s.color;\r
        col.addEventListener('input', () => { s.color = col.value; renderGradient(key); });\r
\r
        const num = document.createElement('input');\r
        num.type = 'number';\r
        num.className = 'stop-pos';\r
        num.min = 0; num.max = 100;\r
        num.value = s.pos;\r
        // 输入过程中只重绘预览，避免重建 DOM 导致焦点丢失；失焦后再按位置重排\r
        num.addEventListener('input', () => {\r
          s.pos = clampPct(parseFloat(num.value));\r
          renderGradient(key);\r
        });\r
        num.addEventListener('change', () => { renderStops(key); renderGradient(key); });\r
\r
        const pct = document.createElement('span');\r
        pct.className = 'stop-pct';\r
        pct.textContent = '%';\r
\r
        const del = document.createElement('button');\r
        del.type = 'button';\r
        del.className = 'stop-del';\r
        del.textContent = '×';\r
        del.title = st.stops.length <= 2 ? '至少保留两个色标' : '删除';\r
        del.addEventListener('click', () => {\r
          if (st.stops.length <= 2) return;\r
          st.stops.splice(st.stops.indexOf(s), 1);\r
          renderStops(key);\r
          renderGradient(key);\r
        });\r
\r
        row.append(col, num, pct, del);\r
        box.append(row);\r
      });\r
    }\r
\r
    // 用与写入端相同的数学绘制预览\r
    function paintGradientPreview(cv, st) {\r
      const dpr = Math.min(2, window.devicePixelRatio || 1);\r
      const w = cv.clientWidth || 300;\r
      const h = cv.clientHeight || 54;\r
      cv.width = Math.max(1, Math.round(w * dpr));\r
      cv.height = Math.max(1, Math.round(h * dpr));\r
      const ctx = cv.getContext('2d');\r
      const img = ctx.createImageData(cv.width, cv.height);\r
      const data = img.data;\r
\r
      // 归一化空间中的 M（绕中心旋转），这里只需要它的逆：M⁻¹ = [[cos,sin,-cos·tx-sin·ty],[-sin,cos,sin·tx-cos·ty]]\r
      const rad = (norm360(st.angle) * Math.PI) / 180;\r
      const cos = Math.cos(rad), sin = Math.sin(rad);\r
      const tx = 0.5 - 0.5 * cos + 0.5 * sin;\r
      const ty = 0.5 - 0.5 * sin - 0.5 * cos;\r
      const i00 = cos, i01 = sin, i02 = -(cos * tx + sin * ty);\r
      const i10 = -sin, i11 = cos, i12 = sin * tx - cos * ty;\r
\r
      const stops = st.stops\r
        .slice()\r
        .sort((a, b) => a.pos - b.pos)\r
        .map((s) => ({ c: to255(s.color), p: clampPct(s.pos) / 100 }));\r
      const last = stops[stops.length - 1] || { c: [255, 255, 255], p: 1 };\r
\r
      const sample = (t) => {\r
        t = t < 0 ? 0 : t > 1 ? 1 : t;\r
        if (!stops.length) return [255, 255, 255];\r
        if (t <= stops[0].p) return stops[0].c;\r
        for (let i = 0; i < stops.length - 1; i++) {\r
          const a = stops[i], b = stops[i + 1];\r
          if (t <= b.p) {\r
            const k = b.p === a.p ? 0 : (t - a.p) / (b.p - a.p);\r
            return [\r
              a.c[0] + (b.c[0] - a.c[0]) * k,\r
              a.c[1] + (b.c[1] - a.c[1]) * k,\r
              a.c[2] + (b.c[2] - a.c[2]) * k,\r
            ];\r
          }\r
        }\r
        return last.c;\r
      };\r
\r
      for (let y = 0; y < cv.height; y++) {\r
        const v = (y + 0.5) / cv.height;\r
        for (let x = 0; x < cv.width; x++) {\r
          const u = (x + 0.5) / cv.width;\r
          // 逆变换回渐变空间（与 Figma 的约定一致）\r
          const gx = i00 * u + i01 * v + i02;\r
          const gy = i10 * u + i11 * v + i12;\r
          let t;\r
          if (st.type === 'GRADIENT_LINEAR') t = gx;\r
          else if (st.type === 'GRADIENT_RADIAL') t = Math.hypot(gx - 0.5, gy - 0.5) / 0.5;\r
          else if (st.type === 'GRADIENT_DIAMOND') t = Math.max(Math.abs(gx - 0.5), Math.abs(gy - 0.5)) / 0.5;\r
          else t = ((Math.atan2(gy - 0.5, gx - 0.5) + Math.PI / 2) / (Math.PI * 2) + 1) % 1;\r
          const c = sample(t);\r
          const o = (y * cv.width + x) * 4;\r
          data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;\r
        }\r
      }\r
      ctx.putImageData(img, 0, 0);\r
    }\r
\r
    function renderGradient(key) {\r
      const st = paintUI[key];\r
      const cv = $('#' + key + '-gprev');\r
      if (cv) paintGradientPreview(cv, st);\r
      const box = $('#' + key + '-gdirs');\r
      if (box) {\r
        const cur = norm360(st.angle);\r
        Array.from(box.children).forEach((b) => {\r
          b.classList.toggle('on', parseFloat(b.dataset.a) === cur);\r
        });\r
      }\r
    }\r
\r
    // 纯色 / 渐变 切换\r
    function syncPaintMode(key) {\r
      const st = paintUI[key];\r
      const seg = $('#' + key + '-seg');\r
      if (seg) {\r
        Array.from(seg.querySelectorAll('.seg-btn')).forEach((b) => {\r
          b.classList.toggle('on', b.dataset.v === st.mode);\r
        });\r
      }\r
      const solid = $('#' + key + '-solid');\r
      if (solid) solid.style.display = st.mode === 'solid' ? '' : 'none';\r
      const grad = $('#' + key + '-grad');\r
      if (grad) grad.style.display = st.mode === 'gradient' ? '' : 'none';\r
      if (st.mode === 'gradient') {\r
        buildGradientEditor(key);   // 界面此刻才可见，canvas 才能真正量到宽度\r
        renderGradient(key);\r
      }\r
      requestResize();\r
    }\r
\r
    // 表单 → 配置\r
    function readPaintConfig(key) {\r
      const st = paintUI[key];\r
      if (st.mode === 'solid') {\r
        return { kind: 'solid', color: hexToRgb($('#' + key + '-color').value) };\r
      }\r
      return {\r
        kind: 'gradient',\r
        gradient: {\r
          gradientType: st.type,\r
          angle: norm360(st.angle),\r
          stops: st.stops.map((s) => ({\r
            color: hexToRgba(s.color),\r
            position: clampPct(s.pos) / 100,\r
          })),\r
        },\r
      };\r
    }\r
\r
    // 配置 → 表单（识别选中图层 / 载入方案时用）\r
    function setPaintConfig(key, cfg) {\r
      const st = paintUI[key];\r
      if (!cfg) return;\r
      if (cfg.kind === 'gradient' && cfg.gradient) {\r
        st.mode = 'gradient';\r
        st.type = cfg.gradient.gradientType || 'GRADIENT_LINEAR';\r
        st.angle = norm360(cfg.gradient.angle);\r
        st.stops = (cfg.gradient.stops || []).map((s) => ({\r
          color: rgbToHex(s.color),\r
          pos: Math.round(clampPct((s.position == null ? 0 : s.position) * 100)),\r
        }));\r
        if (st.stops.length < 2) {\r
          st.stops = [{ color: '#FFFFFF', pos: 0 }, { color: '#000000', pos: 100 }];\r
        }\r
      } else {\r
        st.mode = 'solid';\r
        if (cfg.color) $('#' + key + '-color').value = rgbToHex(cfg.color);\r
      }\r
      syncPaintMode(key);\r
      const gt = $('#' + key + '-gtype');\r
      if (gt && ddRegistry[key + '-gtype']) {\r
        gt.value = st.type;\r
        ddRegistry[key + '-gtype'].syncDisplay();\r
      }\r
      const ga = $('#' + key + '-gangle');\r
      if (ga) ga.value = st.angle;\r
      renderStops(key);\r
      renderGradient(key);\r
    }\r
\r
    ['fill', 'stroke'].forEach((key) => {\r
      const seg = $('#' + key + '-seg');\r
      if (seg) {\r
        seg.addEventListener('click', (e) => {\r
          const b = e.target.closest('.seg-btn');\r
          if (!b) return;\r
          paintUI[key].mode = b.dataset.v;\r
          syncPaintMode(key);\r
        });\r
      }\r
      syncPaintMode(key);\r
    });\r
\r
\r
    /* ============================================================\r
       字体库（按需加载 · family 聚合 · 限量渲染）\r
       ------------------------------------------------------------\r
       旧实现：主进程在插件启动时返回 listAvailableFontsAsync() 的**扁平全量组合**，\r
       UI 收到后给「中文」「英文」两个 <select> 各铺一份。\r
       实测 8000 条时——字体列表送达同步阻塞 ~56ms、打开下拉再花 ~47ms、\r
       DOM 里留下 16000 个 <option>；而设计机器上的字体数量往往更多。\r
\r
       新实现（做法参考开源插件 MixFonts）：\r
         · 主进程按 family 聚合（8000 → 约 800 项），体积降一个数量级\r
         · 不再预铺 <option>，条目在「打开下拉 / 输入关键词」时即时生成\r
         · 单次渲染限量（无关键词 40 条、有搜索词 120 条）\r
         · 加载时机改为「打开下拉时」或「面板空闲后预热」，不拖慢启动\r
       ============================================================ */\r
    let fontFamilies = null;   // [{family, styles:[…]}]；null = 尚未加载\r
    let fontLoading = false;\r
    let fontError = '';\r
\r
    // 请求字体库：只在首次真正发消息，之后命中主进程缓存\r
    function requestFontList() {\r
      if (fontFamilies || fontLoading) return;\r
      fontLoading = true;\r
      send({ type: 'list-fonts' });\r
    }\r
\r
    // 字体键（family + style 的唯一标识）\r
    function fontKey(family, style) { return family + '##' + style; }\r
\r
    // 「优先展示」的字体：当前选中 + 识别到的 + 方案预设里用过的。\r
    // 无害化关键词时只渲染 40 条，若这 40 条里就有用户惯用的字体，找字体会顺畅得多。\r
    function pinnedFontKeys() {\r
      const set = new Set();\r
      const add = (f) => { if (f && f.family) set.add(fontKey(f.family, f.style)); };\r
      add(fontSel.cn);\r
      add(fontSel.en);\r
      (fontPresets || []).forEach((p) => { add(p && p.cnFont); add(p && p.enFont); });\r
      return set;\r
    }\r
\r
    // 生成字体条目；返回 null 表示数据未就绪（下拉会显示加载提示并等待）\r
    function fontItems(q) {\r
      if (!fontFamilies) return null;\r
      const key = (q || '').trim().toLowerCase();\r
      const pinned = pinnedFontKeys();\r
      const head = [];\r
      const tail = [];\r
      for (const fam of fontFamilies) {\r
        for (const st of fam.styles) {\r
          const label = fam.family + ' / ' + st;\r
          if (key && label.toLowerCase().indexOf(key) < 0) continue;\r
          const item = { value: JSON.stringify({ family: fam.family, style: st }), label };\r
          (pinned.has(fontKey(fam.family, st)) ? head : tail).push(item);\r
        }\r
      }\r
      return head.concat(tail);\r
    }\r
\r
    // 字体库到达（或失败）\r
    function applyFontList(msg) {\r
      fontLoading = false;\r
      fontError = msg.error || '';\r
      fontFamilies = Array.isArray(msg.families) ? msg.families : [];\r
      if (fontError) {\r
        $('#font-status').textContent = '字体库加载失败：' + fontError;\r
      } else {\r
        ensureFontDefaults();\r
      }\r
      ['cn-font', 'en-font'].forEach((id) => {\r
        const dd = ddRegistry[id];\r
        if (dd && dd.refresh) dd.refresh();\r
      });\r
    }\r
\r
    // 兜底默认值：仅在用户还没选过字体时设置，避免覆盖「刚识别到的字体」\r
    // 用 \\u 转义书写，避免裸字符在不同工具链下被改坏（本项目踩过 Unicode 陷阱）\r
    function ensureFontDefaults() {\r
      if (!fontFamilies.length) return;\r
      if (!fontSel.cn) {\r
        const cjk = fontFamilies.find((f) => /[\\u4E00-\\u9FFF]/.test(f.family)) || fontFamilies[0];\r
        setFontValue('cn', { family: cjk.family, style: cjk.styles[0] });\r
      }\r
      if (!fontSel.en) {\r
        const f0 = fontFamilies[0];\r
        setFontValue('en', { family: f0.family, style: f0.styles[0] });\r
      }\r
    }\r
\r
    /* ============================================================\r
       通用下拉组件（.dd）：与方案预设弹层同款，用于字体 / 格式 / 对齐\r
       隐藏的原生 <select> 仍作为取值源，自定义弹层仅负责展示与选择\r
       ============================================================ */\r
    function initDropdown(root, opts) {\r
      opts = opts || {};\r
      const targetId = root.dataset.target;\r
      const sel = document.getElementById(targetId);\r
      const trigger = root.querySelector('.dd-trigger');\r
      const current = root.querySelector('.dd-current');\r
      const pop = root.querySelector('.dd-pop');\r
      const list = root.querySelector('.dd-list');\r
      const searchWrap = root.querySelector('.dd-search');\r
      const searchInput = searchWrap ? searchWrap.querySelector('input') : null;\r
      const emptyEl = root.querySelector('.dd-empty');\r
\r
      function syncDisplay() {\r
        const opt = sel.selectedOptions && sel.selectedOptions[0];\r
        if (opt && sel.value) {\r
          current.textContent = opt.textContent;\r
          current.classList.remove('empty');\r
        } else {\r
          current.textContent = root.dataset.placeholder || '请选择';\r
          current.classList.add('empty');\r
        }\r
      }\r
\r
      function build(q) {\r
        q = (q || '').trim().toLowerCase();\r
        list.innerHTML = '';\r
\r
        /* 数据源模式（字体库）：条目按查询即时生成，并且**限量渲染**。\r
           以前是把全量字体铺进两个 <select> 再整份渲染成行：\r
           实测 8000 条会让「字体列表送达」同步阻塞 ~56ms、打开下拉再花 ~47ms，\r
           而设计机器上的字体往往更多。限量后单次只留几十行。 */\r
        const useSource = typeof opts.getItems === 'function';\r
        let items;\r
        let limit = Infinity;\r
        if (useSource) {\r
          const src = opts.getItems(q);\r
          if (src === null) {   // null = 数据尚未就绪（字体库还在加载）\r
            if (emptyEl) {\r
              emptyEl.textContent = opts.loadingText || '正在加载…';\r
              emptyEl.style.display = 'block';\r
            }\r
            return;\r
          }\r
          items = src;\r
          limit = q ? (opts.searchLimit || 120) : (opts.limit || 40);\r
        } else {\r
          items = Array.from(sel.options).map((o) => ({ value: o.value, label: o.textContent }));\r
        }\r
\r
        const shown = items.length > limit ? items.slice(0, limit) : items;\r
        if (emptyEl) {\r
          emptyEl.textContent = opts.emptyText || '无匹配';\r
          emptyEl.style.display = shown.length ? 'none' : 'block';\r
        }\r
        if (useSource && items.length > shown.length) {\r
          const more = document.createElement('div');\r
          more.className = 'dd-more';\r
          more.textContent = '还有 ' + (items.length - shown.length) + ' 个结果，输入关键词缩小范围';\r
          list.append(more);\r
        }\r
        shown.forEach((o) => {\r
          const row = document.createElement('button');\r
          row.type = 'button';\r
          row.className = 'dd-row' + (o.value === sel.value ? ' on' : '');\r
          const name = document.createElement('span');\r
          name.style.flex = '1';\r
          name.style.minWidth = '0';\r
          name.style.overflow = 'hidden';\r
          name.style.textOverflow = 'ellipsis';\r
          name.style.whiteSpace = 'nowrap';\r
          name.textContent = o.label;\r
          row.append(name);\r
          const check = document.createElement('span');\r
          check.className = 'dd-row-check';\r
          check.textContent = '✓';\r
          row.append(check);\r
          row.onclick = () => {\r
            // 数据源条目并不存在于 <select> 里，选中时补一条，保证取值链路照旧\r
            if (!Array.from(sel.options).some((x) => x.value === o.value)) {\r
              sel.appendChild(new Option(o.label, o.value));\r
            }\r
            sel.value = o.value;\r
            sel.dispatchEvent(new Event('change'));\r
            syncDisplay();\r
            close();\r
            onPick(o.value);\r
          };\r
          list.append(row);\r
        });\r
      }\r
\r
      // 选中后回调上层（字体下拉用它同步「当前字体」状态）\r
      function onPick(value) {\r
        if (typeof opts.onPick === 'function') opts.onPick(value);\r
      }\r
\r
      // 程序化赋值：若目标值不在选项里（例如识别到本机字体列表之外的字体），\r
      // 自动补一条选项，避免 select.value 被浏览器清空 → 后续取值拿到空字符串。\r
      function setValue(value, label) {\r
        if (value == null || value === '') return;\r
        let hit = Array.from(sel.options).find((o) => o.value === value);\r
        if (!hit) {\r
          hit = new Option(label || value, value);\r
          sel.appendChild(hit);\r
        }\r
        sel.value = value;\r
        syncDisplay();\r
      }\r
\r
      function open() {\r
        // 打开任一下拉时，收起其余所有弹层\r
        closeAllPickers();\r
        root.classList.add('open');\r
        pop.classList.add('open');\r
        // 打开时才按需取数：字体库体积大且加载慢，不该拖住插件启动\r
        if (typeof opts.onOpen === 'function') opts.onOpen();\r
        build(searchInput ? searchInput.value : '');\r
        if (searchInput) setTimeout(() => searchInput.focus(), 30);\r
      }\r
      function close() {\r
        root.classList.remove('open');\r
        pop.classList.remove('open');\r
      }\r
\r
      trigger.addEventListener('click', (e) => {\r
        e.stopPropagation();\r
        pop.classList.contains('open') ? close() : open();\r
      });\r
      if (searchInput) searchInput.addEventListener('input', () => build(searchInput.value));\r
      root.addEventListener('click', (e) => e.stopPropagation());\r
      document.addEventListener('click', close);\r
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });\r
\r
      // 外部状态变化后重绘（字体库加载完成、默认值被写入等）\r
      function refresh() {\r
        syncDisplay();\r
        if (pop.classList.contains('open')) build(searchInput ? searchInput.value : '');\r
      }\r
\r
      syncDisplay();\r
      return { syncDisplay, open, close, setValue, refresh };\r
    }\r
\r
    ['cn-font', 'en-font', 'fmt', 'stroke-align'].forEach((id) => {\r
      const root = document.querySelector('.dd[data-target="' + id + '"]');\r
      if (!root) return;\r
      if (id === 'cn-font' || id === 'en-font') {\r
        const which = id === 'cn-font' ? 'cn' : 'en';\r
        ddRegistry[id] = initDropdown(root, {\r
          onPick: (v) => { fontSel[which] = parseFont(v); },\r
          // 字体库走「数据源」模式：不预铺 <option>，打开时才请求、\r
          // 按关键词即时筛选并限量渲染（详见 fontItems / requestFontList）\r
          getItems: (q) => fontItems(q),\r
          onOpen: () => requestFontList(),\r
          limit: 40,\r
          searchLimit: 120,\r
          loadingText: '正在加载字体库…（首次较慢，之后走缓存）',\r
          emptyText: '无匹配字体',\r
        });\r
      } else {\r
        ddRegistry[id] = initDropdown(root);\r
      }\r
    });\r
\r
    // 当前「中/英文字体」的真实状态（取值只认它，不依赖 select.value 是否有效）\r
    function parseFont(json) {\r
      try { const f = JSON.parse(json); return f && f.family ? { family: f.family, style: f.style } : null; }\r
      catch { return null; }\r
    }\r
    function fontLabel(f) { return f ? f.family + ' / ' + f.style : ''; }\r
    // 设置某一路字体：写状态 + 更新下拉显示（字体不在本机列表时自动补选项）\r
    function setFontValue(which, font) {\r
      if (!font || !font.family) return;\r
      fontSel[which] = { family: font.family, style: font.style };\r
      const id = which === 'cn' ? 'cn-font' : 'en-font';\r
      const dd = ddRegistry[id];\r
      if (dd) dd.setValue(JSON.stringify(fontSel[which]), fontLabel(fontSel[which]));\r
    }\r
\r
    // ---- 字体混排：应用 ----\r
    $('#font-apply').addEventListener('click', () => {\r
      const cnFont = fontSel.cn || parseFont($('#cn-font').value);\r
      const enFont = fontSel.en || parseFont($('#en-font').value);\r
      if (!cnFont || !enFont) { figmaNotify('请先选择中英文各自的字体'); return; }\r
      const cfg = {\r
        cnFont,\r
        enFont,\r
        cnSize: parseFloat($('#cn-size').value) || null,\r
        enSize: parseFloat($('#en-size').value) || null,\r
        cnColor: hexToRgb($('#cn-color').value),\r
        enColor: hexToRgb($('#en-color').value),\r
      };\r
      send({ type: 'font-mixer', config: cfg });\r
      // 立即反馈并启动等待守卫；主进程随后会回 font-mixer-start / font-mixer-done。\r
      // 即使主进程完全不回包，20 秒后也会明确告知，而不是永远停在「应用中…」。\r
      onFontMixStart({ total: 0 });\r
    });\r
\r
    /* ============================================================\r
       字体混排方案预设（仅字体混排功能 · 顶部下拉选择器）\r
       ============================================================ */\r
    /* 存储层：方案预设的持久化\r
       重要 —— Figma 插件 UI 运行在 data: URL 的 iframe 中，没有自己的域名，\r
       浏览器会直接拒绝 localStorage / cookie（抛 SecurityError）。\r
       所以真正的持久化必须交给主进程的 figma.clientStorage，用消息异步落盘。\r
       这里采用「内存为准 + localStorage 尽力缓存 + clientStorage 落盘」三层：\r
         · 内存      —— 所有读取都走它，任何环境都不会抛错（关键，避免保存静默失败）\r
         · localStorage —— 可用的环境（浏览器预览）即时读写，当快速缓存用\r
         · clientStorage —— 插件内真正持久，关掉插件再打开仍在 */\r
    const PK = 'figma-font-mixer-presets';\r
    const SPK = 'figma-bulk-styles-presets';\r
    let currentScheme = '';\r
    let fontPresets = [];     // 字体混排方案（内存态，唯一取值源）\r
    let stylePresets = [];    // 批量样式方案（内存态，唯一取值源）\r
\r
    function lsRead(key) {\r
      try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }\r
    }\r
    function lsWrite(key, val) {\r
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* Figma 中不可用，忽略 */ }\r
    }\r
    // 落盘：内存 → localStorage 缓存 + 主进程 clientStorage\r
    function persistPresets() {\r
      lsWrite(PK, fontPresets);\r
      lsWrite(SPK, stylePresets);\r
      send({ type: 'storage-save', data: { fontPresets, stylePresets } });\r
    }\r
\r
    const getPresets = () => fontPresets;\r
    const setPresets = (list) => {\r
      fontPresets = Array.isArray(list) ? list : [];\r
      persistPresets();\r
      renderPresetPop();\r
    };\r
\r
    // 读取当前表单，组成一个方案对象（字体取内存态，避免空值导致 JSON.parse 抛错）\r
    function readFormAsScheme(name) {\r
      return {\r
        name,\r
        cnFont: fontSel.cn || parseFont($('#cn-font').value),\r
        enFont: fontSel.en || parseFont($('#en-font').value),\r
        cnSize: parseFloat($('#cn-size').value) || null,\r
        enSize: parseFloat($('#en-size').value) || null,\r
        cnColor: hexToRgb($('#cn-color').value),\r
        enColor: hexToRgb($('#en-color').value),\r
      };\r
    }\r
\r
    function setCurrentLabel(name) {\r
      currentScheme = name || '';\r
      const cur = $('#preset-current');\r
      cur.textContent = name || '未选择方案';\r
      cur.classList.toggle('empty', !name);\r
      // 选中方案后，保存按钮变为「更新当前方案」，改完直接覆盖\r
      const saveBtn = $('#preset-save');\r
      const nameInput = $('#preset-name');\r
      if (name) {\r
        saveBtn.textContent = '更新「' + name + '」';\r
        nameInput.placeholder = '重命名（留空保持不变）';\r
      } else {\r
        saveBtn.textContent = '保存为方案';\r
        nameInput.placeholder = '新方案名，如 中文正文';\r
      }\r
    }\r
\r
    function renderPresetPop() {\r
      const list = $('#preset-pop-list');\r
      const q = ($('#preset-search').value || '').trim().toLowerCase();\r
      const items = getPresets().filter((p) => p.name.toLowerCase().includes(q));\r
      list.innerHTML = '';\r
      $('#preset-pop-empty').style.display = items.length ? 'none' : 'block';\r
\r
      items.forEach((p) => {\r
        const row = document.createElement('button');\r
        row.className = 'preset-row' + (p.name === currentScheme ? ' on' : '');\r
\r
        const name = document.createElement('span');\r
        name.className = 'preset-row-name';\r
        name.textContent = p.name;\r
\r
        row.append(name);\r
\r
        if (p.name === currentScheme) {\r
          const tip = document.createElement('span');\r
          tip.className = 'preset-row-tip';\r
          tip.textContent = '当前';\r
          row.append(tip);\r
        }\r
\r
        const del = document.createElement('span');\r
        del.className = 'preset-row-del';\r
        del.textContent = '×';\r
        del.title = '删除该方案';\r
        del.onclick = (ev) => { ev.stopPropagation(); deletePreset(p.name); };\r
        row.append(del);\r
\r
        row.onclick = () => {\r
          // 再次点击「当前」方案 = 取消选择，恢复识别回填（识别守卫见 fillFontFromDetect）\r
          if (p.name === currentScheme) {\r
            setCurrentLabel('');\r
            closePresetPop();\r
            figmaNotify('已取消方案，恢复识别回填');\r
            detectActive();\r
            return;\r
          }\r
          selectPreset(p.name);\r
        };\r
        list.append(row);\r
      });\r
    }\r
\r
    // 选中方案 → 填入表单（不直接改文档，需再点「应用字体混排」）\r
    function selectPreset(name) {\r
      const p = getPresets().find((x) => x.name === name);\r
      if (!p) return;\r
      applyPresetToForm(p);\r
      setCurrentLabel(name);\r
      closePresetPop();\r
      figmaNotify('已载入方案：' + name);\r
    }\r
\r
    function deletePreset(name) {\r
      setPresets(getPresets().filter((p) => p.name !== name));\r
      if (currentScheme === name) setCurrentLabel('');\r
    }\r
\r
    function applyPresetToForm(p) {\r
      $('#cn-size').placeholder = '如 14，留空不改';\r
      $('#en-size').placeholder = '如 12，留空不改';\r
      if (p.cnFont) setFontValue('cn', p.cnFont);\r
      if (p.enFont) setFontValue('en', p.enFont);\r
      $('#cn-size').value = p.cnSize != null ? p.cnSize : '';\r
      $('#en-size').value = p.enSize != null ? p.enSize : '';\r
      if (p.cnColor) $('#cn-color').value = rgbToHex(p.cnColor);\r
      if (p.enColor) $('#en-color').value = rgbToHex(p.enColor);\r
    }\r
\r
    function openPresetPop() {\r
      $('#preset-pop').classList.add('open');\r
      $('#preset-bar').classList.add('open');\r
    }\r
    function closePresetPop() {\r
      $('#preset-pop').classList.remove('open');\r
      $('#preset-bar').classList.remove('open');\r
    }\r
\r
    $('#preset-trigger').addEventListener('click', (e) => {\r
      e.stopPropagation();\r
      $('#preset-pop').classList.contains('open') ? closePresetPop() : openPresetPop();\r
    });\r
    // 点击外部收起\r
    document.addEventListener('click', (e) => {\r
      if (!$('#preset-bar').contains(e.target)) closePresetPop();\r
    });\r
    // Esc 收起\r
    document.addEventListener('keydown', (e) => {\r
      if (e.key === 'Escape') closePresetPop();\r
    });\r
    $('#preset-search').addEventListener('input', renderPresetPop);\r
\r
    // 保存 / 更新方案：已选中方案时直接覆盖，可输入新名实现重命名\r
    $('#preset-save').addEventListener('click', () => {\r
      try {\r
        let name = $('#preset-name').value.trim();\r
        if (currentScheme) {\r
          if (!name) name = currentScheme;         // 留空 = 更新当前方案\r
        } else if (!name) {\r
          figmaNotify('请先输入方案名');\r
          $('#preset-name').focus();\r
          return;\r
        }\r
\r
        let list = getPresets().filter((p) => p.name !== name);\r
        if (currentScheme && name !== currentScheme) {\r
          list = list.filter((p) => p.name !== currentScheme); // 改名：移除旧名\r
        }\r
        const scheme = readFormAsScheme(name);\r
        if (!scheme.cnFont || !scheme.enFont) {\r
          figmaNotify('字体信息缺失，请先选择中英文字体');\r
          return;\r
        }\r
        list.push(scheme);\r
\r
        const renamed = currentScheme && name !== currentScheme;\r
        setPresets(list);\r
        setCurrentLabel(name);\r
        $('#preset-name').value = '';\r
        figmaNotify((renamed ? '已重命名并保存：' : '已保存方案：') + name);\r
      } catch (e) {\r
        // 任何异常都明确报出来，避免「点了没反应」这种静默失败\r
        figmaNotify('保存失败：' + (e && e.message ? e.message : e));\r
      }\r
    });\r
\r
    // 导出全部方案\r
    $('#preset-export').addEventListener('click', () => {\r
      const all = getPresets();\r
      if (!all.length) { figmaNotify('当前没有可导出的方案'); return; }\r
      download('font-presets.json', JSON.stringify(all, null, 2), 'application/json');\r
    });\r
\r
    // 导入方案（按名称去重合并）\r
    $('#preset-import-btn').addEventListener('click', () => $('#preset-import').click());\r
    $('#preset-import').addEventListener('change', (e) => {\r
      const file = e.target.files[0];\r
      if (!file) return;\r
      const r = new FileReader();\r
      r.onload = () => {\r
        try {\r
          const imported = JSON.parse(r.result);\r
          if (!Array.isArray(imported)) throw new Error('格式错误');\r
          const merged = getPresets();\r
          let added = 0;\r
          imported.forEach((s) => {\r
            if (!s || typeof s.name !== 'string') return;\r
            const i = merged.findIndex((x) => x.name === s.name);\r
            if (i >= 0) { merged[i] = s; } else { merged.push(s); added++; }\r
          });\r
          setPresets(merged);\r
          figmaNotify(\`已导入 \${imported.length} 个方案（新增 \${added}）\`);\r
        } catch { figmaNotify('JSON 解析失败，请检查文件'); }\r
      };\r
      r.readAsText(file);\r
      e.target.value = '';\r
    });\r
\r
    renderPresetPop();\r
\r
    /* ============================================================\r
       批量样式方案预设（仅批量样式功能 · 顶部下拉选择器）\r
       与字体混排预设相互独立：独立下拉、独立数据（共用底层存储通道）\r
       ============================================================ */\r
    let styleCurrent = '';\r
\r
    const getStylePresets = () => stylePresets;\r
    const setStylePresets = (list) => {\r
      stylePresets = Array.isArray(list) ? list : [];\r
      persistPresets();\r
      renderStylePresetPop();\r
    };\r
\r
    // 读取当前表单（含各开关状态），组成一个方案对象\r
    function readStyleFormAsScheme(name) {\r
      return {\r
        name,\r
        fillOn: $('#fill-on').checked,\r
        fill: readPaintConfig('fill'),                    // 纯色或渐变\r
        fillColor: hexToRgb($('#fill-color').value),     // 保留纯色字段：旧版插件读它做回退\r
        radiusOn: $('#radius-on').checked,\r
        radius: parseFloat($('#radius').value) || 0,\r
        strokeOn: $('#stroke-on').checked,\r
        stroke: readPaintConfig('stroke'),\r
        strokeColor: hexToRgb($('#stroke-color').value),\r
        strokeWeight: parseFloat($('#stroke-weight').value) || 0,\r
        strokeAlign: $('#stroke-align').value,\r
        shadowOn: $('#shadow-on').checked,\r
        shadow: {\r
          color: hexToRgba($('#shadow-color').value),\r
          offsetX: parseFloat($('#shadow-x').value) || 0,\r
          offsetY: parseFloat($('#shadow-y').value) || 0,\r
          blur: parseFloat($('#shadow-blur').value) || 0,\r
          spread: parseFloat($('#shadow-spread').value) || 0,\r
        },\r
      };\r
    }\r
\r
    function setStyleCurrentLabel(name) {\r
      styleCurrent = name || '';\r
      const cur = $('#sp-current');\r
      cur.textContent = name || '未选择方案';\r
      cur.classList.toggle('empty', !name);\r
      // 选中方案后，保存按钮变为「更新当前方案」，改完直接覆盖\r
      const saveBtn = $('#sp-save');\r
      const nameInput = $('#sp-name');\r
      if (name) {\r
        saveBtn.textContent = '更新「' + name + '」';\r
        nameInput.placeholder = '重命名（留空保持不变）';\r
      } else {\r
        saveBtn.textContent = '保存为方案';\r
        nameInput.placeholder = '新方案名，如 卡片蓝底';\r
      }\r
    }\r
\r
    function renderStylePresetPop() {\r
      const list = $('#sp-pop-list');\r
      const q = ($('#sp-search').value || '').trim().toLowerCase();\r
      const items = getStylePresets().filter((p) => p.name.toLowerCase().includes(q));\r
      list.innerHTML = '';\r
      $('#sp-pop-empty').style.display = items.length ? 'none' : 'block';\r
\r
      items.forEach((p) => {\r
        const row = document.createElement('button');\r
        row.className = 'preset-row' + (p.name === styleCurrent ? ' on' : '');\r
\r
        const name = document.createElement('span');\r
        name.className = 'preset-row-name';\r
        name.textContent = p.name;\r
        row.append(name);\r
\r
        if (p.name === styleCurrent) {\r
          const tip = document.createElement('span');\r
          tip.className = 'preset-row-tip';\r
          tip.textContent = '当前';\r
          row.append(tip);\r
        }\r
\r
        const del = document.createElement('span');\r
        del.className = 'preset-row-del';\r
        del.textContent = '×';\r
        del.title = '删除该方案';\r
        del.onclick = (ev) => { ev.stopPropagation(); deleteStylePreset(p.name); };\r
        row.append(del);\r
\r
        row.onclick = () => {\r
          // 再次点击「当前」方案 = 取消选择，恢复识别回填（守卫见 fillStyleFromDetect）\r
          if (p.name === styleCurrent) {\r
            setStyleCurrentLabel('');\r
            closeStylePop();\r
            figmaNotify('已取消方案，恢复识别回填');\r
            detectActive();\r
            return;\r
          }\r
          selectStylePreset(p.name);\r
        };\r
        list.append(row);\r
      });\r
    }\r
\r
    // 选中方案 → 回填表单（不直接改文档，需再点「应用批量样式」）\r
    function selectStylePreset(name) {\r
      const p = getStylePresets().find((x) => x.name === name);\r
      if (!p) return;\r
      applyStylePresetToForm(p);\r
      setStyleCurrentLabel(name);\r
      closeStylePop();\r
      figmaNotify('已载入方案：' + name);\r
    }\r
\r
    function deleteStylePreset(name) {\r
      setStylePresets(getStylePresets().filter((p) => p.name !== name));\r
      if (styleCurrent === name) setStyleCurrentLabel('');\r
    }\r
\r
    function applyStylePresetToForm(p) {\r
      $('#fill-on').checked = !!p.fillOn;\r
      $('#fill-color').value = rgbToHex(p.fillColor);\r
      // 新格式带 fill/stroke（纯色或渐变）；旧方案只有 fillColor，回退为纯色\r
      setPaintConfig('fill', p.fill || (p.fillColor ? { kind: 'solid', color: p.fillColor } : null));\r
      $('#radius-on').checked = !!p.radiusOn;\r
      $('#radius').value = p.radius != null ? p.radius : '';\r
      $('#stroke-on').checked = !!p.strokeOn;\r
      $('#stroke-color').value = rgbToHex(p.strokeColor);\r
      setPaintConfig('stroke', p.stroke || (p.strokeColor ? { kind: 'solid', color: p.strokeColor } : null));\r
      $('#stroke-weight').value = p.strokeWeight != null ? p.strokeWeight : '';\r
      if (p.strokeAlign) {\r
        $('#stroke-align').value = p.strokeAlign;\r
        syncAlignDisplay();\r
      }\r
      $('#shadow-on').checked = !!p.shadowOn;\r
      if (p.shadow) {\r
        $('#shadow-color').value = rgbToHex(p.shadow.color);\r
        $('#shadow-x').value = p.shadow.offsetX != null ? p.shadow.offsetX : '';\r
        $('#shadow-y').value = p.shadow.offsetY != null ? p.shadow.offsetY : '';\r
        $('#shadow-blur').value = p.shadow.blur != null ? p.shadow.blur : '';\r
        $('#shadow-spread').value = p.shadow.spread != null ? p.shadow.spread : '';\r
      }\r
    }\r
\r
    // 让「描边对齐」下拉的文字与实际取值保持一致（程序赋值后必须手动同步）\r
    function syncAlignDisplay() {\r
      if (ddRegistry['stroke-align']) ddRegistry['stroke-align'].syncDisplay();\r
    }\r
\r
    function openStylePop() {\r
      $('#sp-pop').classList.add('open');\r
      $('#sp-bar').classList.add('open');\r
    }\r
    function closeStylePop() {\r
      $('#sp-pop').classList.remove('open');\r
      $('#sp-bar').classList.remove('open');\r
    }\r
\r
    $('#sp-trigger').addEventListener('click', (e) => {\r
      e.stopPropagation();\r
      $('#sp-pop').classList.contains('open') ? closeStylePop() : openStylePop();\r
    });\r
    document.addEventListener('click', (e) => {\r
      if (!$('#sp-bar').contains(e.target)) closeStylePop();\r
    });\r
    document.addEventListener('keydown', (e) => {\r
      if (e.key === 'Escape') closeStylePop();\r
    });\r
    $('#sp-search').addEventListener('input', renderStylePresetPop);\r
\r
    // 保存 / 更新方案：已选中方案时直接覆盖，可输入新名实现重命名\r
    $('#sp-save').addEventListener('click', () => {\r
      try {\r
        let name = $('#sp-name').value.trim();\r
        if (styleCurrent) {\r
          if (!name) name = styleCurrent;            // 留空 = 更新当前方案\r
        } else if (!name) {\r
          figmaNotify('请先输入方案名');\r
          $('#sp-name').focus();\r
          return;\r
        }\r
\r
        let list = getStylePresets().filter((p) => p.name !== name);\r
        if (styleCurrent && name !== styleCurrent) {\r
          list = list.filter((p) => p.name !== styleCurrent); // 改名：移除旧名\r
        }\r
        list.push(readStyleFormAsScheme(name));\r
\r
        const renamed = styleCurrent && name !== styleCurrent;\r
        setStylePresets(list);\r
        setStyleCurrentLabel(name);\r
        $('#sp-name').value = '';\r
        figmaNotify((renamed ? '已重命名并保存：' : '已保存方案：') + name);\r
      } catch (e) {\r
        figmaNotify('保存失败：' + (e && e.message ? e.message : e));\r
      }\r
    });\r
\r
    // 导出全部方案\r
    $('#sp-export').addEventListener('click', () => {\r
      const all = getStylePresets();\r
      if (!all.length) { figmaNotify('当前没有可导出的方案'); return; }\r
      download('bulk-styles-presets.json', JSON.stringify(all, null, 2), 'application/json');\r
    });\r
\r
    // 导入方案（按名称去重合并）\r
    $('#sp-import-btn').addEventListener('click', () => $('#sp-import').click());\r
    $('#sp-import').addEventListener('change', (e) => {\r
      const file = e.target.files[0];\r
      if (!file) return;\r
      const r = new FileReader();\r
      r.onload = () => {\r
        try {\r
          const imported = JSON.parse(r.result);\r
          if (!Array.isArray(imported)) throw new Error('格式错误');\r
          const merged = getStylePresets();\r
          let added = 0;\r
          imported.forEach((s) => {\r
            if (!s || typeof s.name !== 'string') return;\r
            const i = merged.findIndex((x) => x.name === s.name);\r
            if (i >= 0) { merged[i] = s; } else { merged.push(s); added++; }\r
          });\r
          setStylePresets(merged);\r
          figmaNotify(\`已导入 \${imported.length} 个方案（新增 \${added}）\`);\r
        } catch { figmaNotify('JSON 解析失败，请检查文件'); }\r
      };\r
      r.readAsText(file);\r
      e.target.value = '';\r
    });\r
\r
    renderStylePresetPop();\r
\r
    // ---- 通知主进程（非插件环境静默） ----\r
    function figmaNotify(msg) {\r
      try { parent.postMessage({ pluginMessage: { type: 'notify', msg } }, '*'); } catch { /* ignore */ }\r
    }\r
\r
    // ---- 批量样式：应用 ----\r
    $('#style-apply').addEventListener('click', () => {\r
      const cfg = {\r
        fill: $('#fill-on').checked ? readPaintConfig('fill') : null,\r
        cornerRadius: $('#radius-on').checked ? (parseFloat($('#radius').value) || 0) : null,\r
        stroke: $('#stroke-on').checked ? readPaintConfig('stroke') : null,\r
        strokeWeight: $('#stroke-on').checked ? (parseFloat($('#stroke-weight').value) || 0) : null,\r
        strokeAlign: $('#stroke-on').checked ? $('#stroke-align').value : null,\r
        shadow: $('#shadow-on').checked ? {\r
          color: hexToRgba($('#shadow-color').value),\r
          offsetX: parseFloat($('#shadow-x').value) || 0,\r
          offsetY: parseFloat($('#shadow-y').value) || 0,\r
          blur: parseFloat($('#shadow-blur').value) || 0,\r
          spread: parseFloat($('#shadow-spread').value) || 0,\r
        } : null,\r
      };\r
      send({ type: 'bulk-styles', config: cfg });\r
      $('#style-status').textContent = '应用中…';\r
    });\r
\r
    // ---- 导出压缩 ----\r
    // 滑块进度着色：不依赖系统强调色，保证各机器配色一致\r
    function paintRange(el) {\r
      const min = parseFloat(el.min), max = parseFloat(el.max);\r
      const p = max > min ? ((parseFloat(el.value) - min) / (max - min)) * 100 : 0;\r
      el.style.background = el.disabled\r
        ? '#ECE7E3'\r
        : \`linear-gradient(90deg, #FF9161 0%, #FF5A2B \${p}%, #ECE7E3 \${p}%, #ECE7E3 100%)\`;\r
    }\r
\r
    $('#fmt').addEventListener('change', () => {\r
      const png = $('#fmt').value === 'PNG';\r
      $('#quality').disabled = png;\r
      $('#quality-hint').textContent = png ? 'PNG 不支持质量' : parseFloat($('#quality').value).toFixed(2);\r
      paintRange($('#quality'));\r
    });\r
    $('#quality').addEventListener('input', () => {\r
      $('#quality-hint').textContent = parseFloat($('#quality').value).toFixed(2);\r
      paintRange($('#quality'));\r
    });\r
    paintRange($('#quality'));\r
\r
    // 本次导出收集到的文件：{ path: '0911/1555/HR面霜-11主图-1.jpg', blob }\r
    let pendingFiles = [];\r
    let exportDir = null;   // 用户选中的保存目录（FileSystemDirectoryHandle）\r
    // 分片处理链：JPG/WebP 要过 canvas 重编码（异步），必须串行排队、并在打包前 await 干净。\r
    // 否则主进程发完最后一个分片就立刻发 export-done，末尾节点还没入列就被封包丢掉。\r
    let chunkChain = Promise.resolve();\r
\r
    $('#export-btn').addEventListener('click', async () => {\r
      const cfg = {\r
        format: $('#fmt').value,\r
        scale: parseFloat($('#scale').value) || 1,\r
        quality: parseFloat($('#quality').value) || 0.9,\r
      };\r
\r
      // 路径选择弹窗必须在「点击」这个用户手势内发起，否则浏览器会直接拒绝，\r
      // 因此先选好文件夹，再开始导出（导出可能耗时数秒，会耗尽手势有效期）。\r
      let dir = null;\r
      if (typeof window.showDirectoryPicker === 'function') {\r
        try {\r
          dir = await window.showDirectoryPicker({ id: 'figma-toolbox-export', mode: 'readwrite' });\r
        } catch (e) {\r
          if (e && e.name === 'AbortError') { $('#exp-status').textContent = '已取消导出'; return; }\r
          dir = null;   // 环境不支持 / 被安全策略拦截 → 回退为直接下载\r
        }\r
      }\r
\r
      pendingFiles = [];\r
      exportDir = dir;\r
      $('#exp-status').textContent = dir ? '导出中…（保存到所选文件夹）' : '导出中…（将直接下载）';\r
      send({ type: 'export', config: cfg });\r
    });\r
\r
    // 单个分片：JPG / WebP 用 canvas 重编码控制质量（Figma API 无 quality 参数），PNG 原样保留\r
    async function handleChunk(msg) {\r
      const ext = msg.format === 'JPG' ? 'jpg' : msg.format === 'WEBP' ? 'webp' : 'png';\r
      const mime = msg.format === 'JPG' ? 'image/jpeg' : msg.format === 'WEBP' ? 'image/webp' : 'image/png';\r
      const src = new Blob([msg.bytes], { type: mime });\r
      let out = src;\r
      if (msg.format !== 'PNG') {\r
        try {\r
          const bmp = await createImageBitmap(src);\r
          const c = document.createElement('canvas');\r
          c.width = bmp.width; c.height = bmp.height;\r
          c.getContext('2d').drawImage(bmp, 0, 0);\r
          out = await new Promise((res) => { c.toBlob((b) => res(b || src), mime, msg.quality); });\r
        } catch (e) { out = src; }\r
      }\r
      pendingFiles.push({ path: (msg.path || 'export') + '.' + ext, blob: out });\r
    }\r
\r
    // 导出完成 → 落盘\r
    // 关键点：handleChunk 是异步的（JPG/WebP 走 canvas 重编码），而主进程发完最后一个分片后\r
    // 会立刻发 export-done。所以这里必须先把分片链 await 干净，再取 pendingFiles 打包，\r
    // 否则末尾 1~2 个文件还没入列就已封包 —— 表现为「选中 6 个只导出 4 个」。\r
    async function finalizeExport(msg) {\r
      await chunkChain;\r
      chunkChain = Promise.resolve();\r
\r
      // 兜底：以主进程报告的成功数为准，若仍有在途分片就给一点点缓冲再打包\r
      const expect = msg && typeof msg.count === 'number' ? msg.count : pendingFiles.length;\r
      const t0 = Date.now();\r
      while (pendingFiles.length < expect && Date.now() - t0 < 1000) {\r
        await new Promise((r) => setTimeout(r, 20));\r
      }\r
\r
      const files = pendingFiles;\r
      const dir = exportDir;\r
      const failed = (msg && msg.failed) || [];\r
      pendingFiles = [];\r
      exportDir = null;\r
\r
      if (!files.length) {\r
        $('#exp-status').textContent = failed.length\r
          ? \`导出失败：\${failed.length} 个节点无法导出（\${failed.slice(0, 3).join('、')}）\`\r
          : '没有可导出的节点';\r
        return;\r
      }\r
\r
      // 数量对不上 / 有失败节点，一定要在状态栏说清楚，不能再静默丢文件\r
      let tail = '';\r
      if (files.length < expect) tail += \`；注意：仅收到 \${files.length}/\${expect} 个分片\`;\r
      if (failed.length) {\r
        tail += \`；\${failed.length} 个导出失败：\${failed.slice(0, 3).join('、')}\${failed.length > 3 ? '…' : ''}\`;\r
      }\r
\r
      try {\r
        if (dir) {\r
          if (files.length === 1) {\r
            // 单个目标：按路径规则自动建子目录后直接存图片\r
            await writeIntoDir(dir, files[0]);\r
            $('#exp-status').textContent = '已保存：' + files[0].path + tail;\r
          } else {\r
            // 多个目标：自动打包为 zip（包内保留目录结构）后保存\r
            const name = zipBaseName(files) + '.zip';\r
            await writeIntoDir(dir, { path: name, blob: await buildZip(files) });\r
            $('#exp-status').textContent = \`已打包保存：\${name}（\${files.length} 个文件）\` + tail;\r
          }\r
          return;\r
        }\r
\r
        // 回退：当前环境不支持选择路径 → 直接下载（zip 内仍保留目录结构）\r
        if (files.length === 1) {\r
          triggerDownload(files[0].path.replace(/\\//g, '_'), files[0].blob);\r
          $('#exp-status').textContent = '已下载：' + files[0].path.split('/').pop() + tail;\r
        } else {\r
          const name = zipBaseName(files) + '.zip';\r
          triggerDownload(name, await buildZip(files));\r
          $('#exp-status').textContent = \`已打包下载：\${name}（\${files.length} 个文件）\` + tail;\r
        }\r
      } catch (e) {\r
        $('#exp-status').textContent = '保存失败：' + ((e && e.message) || e);\r
      }\r
    }\r
\r
    // 按相对路径写进用户选中的目录，缺失的中间目录自动创建\r
    async function writeIntoDir(dir, file) {\r
      const segs = file.path.split('/').filter(Boolean);\r
      const name = segs.pop() || 'export';\r
      let d = dir;\r
      for (const s of segs) d = await d.getDirectoryHandle(s, { create: true });\r
      const fh = await d.getFileHandle(name, { create: true });\r
      const w = await fh.createWritable();\r
      try { await w.write(file.blob); } finally { await w.close(); }\r
    }\r
\r
    // 压缩包名：所有文件的共同顶层目录名；没有共同目录时叫「批量导出」\r
    function zipBaseName(files) {\r
      const uniq = Array.from(new Set(files.map((f) => f.path.split('/')[0])));\r
      return uniq.length === 1 ? uniq[0] : '批量导出';\r
    }\r
\r
    function triggerDownload(name, blob) {\r
      const u = URL.createObjectURL(blob);\r
      const a = document.createElement('a');\r
      a.href = u; a.download = name;\r
      document.body.appendChild(a); a.click(); a.remove();\r
      setTimeout(() => URL.revokeObjectURL(u), 1000);\r
    }\r
    function download(name, text, mime) {\r
      triggerDownload(name, new Blob([text], { type: mime }));\r
    }\r
\r
    /* ============================================================\r
       极简 ZIP 打包（STORE 方式）\r
       图片本身已是压缩格式，再 deflate 收益极小，直接原样打包即可，\r
       这样无需引入任何第三方库，插件保持零依赖。\r
       ============================================================ */\r
    const CRC_TABLE = (() => {\r
      const t = new Uint32Array(256);\r
      for (let i = 0; i < 256; i++) {\r
        let c = i;\r
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);\r
        t[i] = c >>> 0;\r
      }\r
      return t;\r
    })();\r
\r
    function crc32(buf) {\r
      let c = 0xffffffff;\r
      for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);\r
      return (c ^ 0xffffffff) >>> 0;\r
    }\r
\r
    async function buildZip(files) {\r
      const enc = new TextEncoder();\r
      const parts = [];    // 本地文件头 + 文件数据\r
      const central = [];  // 中央目录\r
      let offset = 0;\r
\r
      const now = new Date();\r
      const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);\r
      const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();\r
\r
      for (const f of files) {\r
        const nameBytes = enc.encode(f.path);\r
        const data = new Uint8Array(await f.blob.arrayBuffer());\r
        const crc = crc32(data);\r
\r
        // 本地文件头（30 字节固定部分）\r
        const lh = new DataView(new ArrayBuffer(30));\r
        lh.setUint32(0, 0x04034b50, true);          // 签名\r
        lh.setUint16(4, 20, true);                  // 解压所需版本\r
        lh.setUint16(6, 0x0800, true);              // 通用标志：文件名 UTF-8（中文名必需）\r
        lh.setUint16(8, 0, true);                   // 压缩方式 0 = 不压缩\r
        lh.setUint16(10, dosTime, true);\r
        lh.setUint16(12, dosDate, true);\r
        lh.setUint32(14, crc, true);\r
        lh.setUint32(18, data.length, true);        // 压缩后大小\r
        lh.setUint32(22, data.length, true);        // 原始大小\r
        lh.setUint16(26, nameBytes.length, true);\r
        lh.setUint16(28, 0, true);                  // 扩展字段长度\r
        parts.push(new Uint8Array(lh.buffer), nameBytes, data);\r
\r
        // 中央目录项（46 字节固定部分）\r
        const ch = new DataView(new ArrayBuffer(46));\r
        ch.setUint32(0, 0x02014b50, true);\r
        ch.setUint16(4, 20, true);                  // 创建版本\r
        ch.setUint16(6, 20, true);                  // 解压所需版本\r
        ch.setUint16(8, 0x0800, true);\r
        ch.setUint16(10, 0, true);\r
        ch.setUint16(12, dosTime, true);\r
        ch.setUint16(14, dosDate, true);\r
        ch.setUint32(16, crc, true);\r
        ch.setUint32(20, data.length, true);\r
        ch.setUint32(24, data.length, true);\r
        ch.setUint16(28, nameBytes.length, true);\r
        ch.setUint16(30, 0, true);                  // 扩展字段\r
        ch.setUint16(32, 0, true);                  // 注释\r
        ch.setUint16(34, 0, true);                  // 起始磁盘号\r
        ch.setUint16(36, 0, true);                  // 内部属性\r
        ch.setUint32(38, 0, true);                  // 外部属性\r
        ch.setUint32(42, offset, true);             // 本地头相对偏移\r
        central.push(new Uint8Array(ch.buffer), nameBytes);\r
\r
        offset += 30 + nameBytes.length + data.length;\r
      }\r
\r
      const cdSize = central.reduce((n, p) => n + p.length, 0);\r
\r
      // 结束记录（22 字节）\r
      const eocd = new DataView(new ArrayBuffer(22));\r
      eocd.setUint32(0, 0x06054b50, true);\r
      eocd.setUint16(4, 0, true);\r
      eocd.setUint16(6, 0, true);\r
      eocd.setUint16(8, files.length, true);\r
      eocd.setUint16(10, files.length, true);\r
      eocd.setUint32(12, cdSize, true);\r
      eocd.setUint32(16, offset, true);\r
      eocd.setUint16(20, 0, true);                  // 注释长度\r
\r
      return new Blob(parts.concat(central, [new Uint8Array(eocd.buffer)]), { type: 'application/zip' });\r
    }\r
\r
    // 供自动化校验脚本调用\r
    window.__zipKit = { buildZip, crc32, zipBaseName };\r
\r
    // ---- 斜切 Tab（SkewDat 风格） ----\r
    // 预览用的正方形边长（用户坐标），与 SVG 里 rect 的 width/height 保持一致\r
    const SKEW_BASE = 40;\r
\r
    // 实时画出「当前参数会把图层变成什么形状」：\r
    // 用与写入端完全相同的矩阵（列归一化的斜切矩阵），\r
    // 于是"斜切=平行四边形"和"两角相消=旋转"都能一眼看出来。\r
    function updateSkewPreview(x, y) {\r
      const ta = Math.tan((x * Math.PI) / 180);\r
      const tb = Math.tan((y * Math.PI) / 180);\r
      const k0 = Math.hypot(1, tb) || 1; // 列 0 = (1, tanβ)\r
      const k1 = Math.hypot(ta, 1) || 1; // 列 1 = (tanα, 1)\r
      const m00 = 1 / k0, m10 = tb / k0, m01 = ta / k1, m11 = 1 / k1;\r
\r
      // 自适应缩放，保证斜切到 ±60° 时仍完整落在预览框内\r
      const pts = [[0, 0], [SKEW_BASE, 0], [0, SKEW_BASE], [SKEW_BASE, SKEW_BASE]]\r
        .map(([px, py]) => [m00 * px + m01 * py, m10 * px + m11 * py]);\r
      const xs = pts.map((p) => p[0]);\r
      const ys = pts.map((p) => p[1]);\r
      const bw = Math.max.apply(null, xs) - Math.min.apply(null, xs);\r
      const bh = Math.max.apply(null, ys) - Math.min.apply(null, ys);\r
      const fit = Math.min(1, 106 / (bw || 1), 48 / (bh || 1));\r
\r
      const cx = 130, cy = 33; // viewBox 260×66 的中心\r
      const tx = cx - ((m00 * SKEW_BASE) / 2 + (m01 * SKEW_BASE) / 2) * fit;\r
      const ty = cy - ((m10 * SKEW_BASE) / 2 + (m11 * SKEW_BASE) / 2) * fit;\r
      $('#sp-g').setAttribute(\r
        'transform',\r
        'matrix(' + (m00 * fit) + ',' + (m10 * fit) + ',' + (m01 * fit) + ',' + (m11 * fit) + ',' + tx + ',' + ty + ')'\r
      );\r
\r
      // 虚线参考框 = 未斜切的正方形，用来对比\r
      const side = SKEW_BASE * fit;\r
      const ref = $('#sp-ref');\r
      ref.setAttribute('x', cx - side / 2);\r
      ref.setAttribute('y', cy - side / 2);\r
      ref.setAttribute('width', side);\r
      ref.setAttribute('height', side);\r
\r
      // 总斜切量 = α + β；为 0 而滑块非 0 时，结果只是一次旋转\r
      const total = x + y;\r
      const note = $('#sp-note');\r
      if ((x !== 0 || y !== 0) && Math.abs(total) < 4) {\r
        note.className = 'sp-note warn';\r
        note.textContent = '总斜切量 ≈ ' + total.toFixed(0) + '°：两个方向相互抵消，结果是旋转';\r
      } else {\r
        note.className = 'sp-note';\r
        note.textContent = '总斜切量 α+β = ' + total.toFixed(0) + '°';\r
      }\r
    }\r
\r
    function readSkew() {\r
      return {\r
        x: parseFloat($('#skew-x').value) || 0,\r
        y: parseFloat($('#skew-y').value) || 0,\r
      };\r
    }\r
    function refreshSkew() {\r
      const s = readSkew();\r
      updateSkewPreview(s.x, s.y);\r
    }\r
    function setSkew(x, y) {\r
      $('#skew-x').value = x; $('#skew-x-num').value = x;\r
      $('#skew-y').value = y; $('#skew-y-num').value = y;\r
      paintRange($('#skew-x')); paintRange($('#skew-y'));\r
      refreshSkew();\r
    }\r
\r
    function bindSkewRange(rangeId, numId) {\r
      const r = $('#' + rangeId), n = $('#' + numId);\r
      const paint = () => { paintRange(r); refreshSkew(); };\r
      r.addEventListener('input', () => { n.value = r.value; paint(); });\r
      n.addEventListener('input', () => {\r
        let v = parseFloat(n.value); if (isNaN(v)) v = 0;\r
        v = Math.max(-60, Math.min(60, v));\r
        r.value = v; paint();\r
      });\r
      paint();\r
    }\r
    bindSkewRange('skew-x', 'skew-x-num');\r
    bindSkewRange('skew-y', 'skew-y-num');\r
\r
    // 快捷角度：一键得到干净的单轴斜切（杜绝"两角相消变成旋转"）\r
    document.querySelectorAll('.chip-btn').forEach((b) => {\r
      b.addEventListener('click', () => {\r
        const parts = String(b.dataset.skew).split(',');\r
        setSkew(parseFloat(parts[0]) || 0, parseFloat(parts[1]) || 0);\r
      });\r
    });\r
\r
    $('#skew-reset').addEventListener('click', () => setSkew(0, 0));\r
    $('#skew-sync').addEventListener('click', () => {\r
      $('#skew-status').textContent = '读取中…';\r
      send({ type: 'detect-skew' });\r
    });\r
    $('#skew-apply').addEventListener('click', () => {\r
      const cfg = { skewX: readSkew().x, skewY: readSkew().y };\r
      $('#skew-status').textContent = '应用斜切中…';\r
      send({ type: 'skew', config: cfg });\r
    });\r
\r
    // ---- 兜底：非插件环境（浏览器直接打开预览）填充示例 ----\r
    if (window.parent === window) {\r
      setTimeout(() => {\r
        if (!fontFamilies) {\r
          applyFontList({\r
            families: [\r
              { family: 'Inter', styles: ['Regular', 'Medium', 'Bold'] },\r
              { family: 'Roboto', styles: ['Regular', 'Bold'] },\r
              { family: '苹方-简', styles: ['Regular', 'Semibold'] },\r
              { family: '思源黑体', styles: ['Regular', 'Bold'] },\r
            ],\r
          });\r
          setPresets([\r
            { name: '中文正文 14/12', cnFont: { family: '苹方-简', style: 'Regular' }, enFont: { family: 'Inter', style: 'Regular' }, cnSize: 14, enSize: 12, cnColor: hexToRgb('#222222'), enColor: hexToRgb('#444444') },\r
            { name: '中英混排标题 20/18', cnFont: { family: '苹方-简', style: 'Semibold' }, enFont: { family: 'Inter', style: 'Bold' }, cnSize: 20, enSize: 18, cnColor: hexToRgb('#111111'), enColor: hexToRgb('#FF5A2B') },\r
          ]);\r
        }\r
        if (!getStylePresets().length) {\r
          setStylePresets([\r
            { name: '卡片蓝底 圆角8', fillOn: true, fillColor: hexToRgb('#60A5FA'), radiusOn: true, radius: 8, strokeOn: false, strokeColor: hexToRgb('#111827'), strokeWeight: 1, strokeAlign: 'INSIDE', shadowOn: true, shadow: { color: hexToRgba('#000000'), offsetX: 0, offsetY: 4, blur: 12, spread: 0 } },\r
            { name: '描边卡片 无填充', fillOn: false, fillColor: hexToRgb('#000000'), radiusOn: true, radius: 4, strokeOn: true, strokeColor: hexToRgb('#111827'), strokeWeight: 1.5, strokeAlign: 'OUTSIDE', shadowOn: false, shadow: { color: hexToRgba('#000000'), offsetX: 0, offsetY: 0, blur: 0, spread: 0 } },\r
            { name: '橙渐变 线性135°', fillOn: true, fill: { kind: 'gradient', gradient: { gradientType: 'GRADIENT_LINEAR', angle: 135, stops: [{ color: hexToRgba('#FF9161'), position: 0 }, { color: hexToRgba('#FF5A2B'), position: 1 }] } }, fillColor: hexToRgb('#FF5A2B'), radiusOn: true, radius: 12, strokeOn: false, strokeColor: hexToRgb('#111827'), strokeWeight: 1, strokeAlign: 'INSIDE', shadowOn: false, shadow: { color: hexToRgba('#000000'), offsetX: 0, offsetY: 0, blur: 0, spread: 0 } },\r
            { name: '径向高光', fillOn: true, fill: { kind: 'gradient', gradient: { gradientType: 'GRADIENT_RADIAL', angle: 0, stops: [{ color: hexToRgba('#FFFFFF'), position: 0 }, { color: hexToRgba('#93C5FD'), position: 1 }] } }, fillColor: hexToRgb('#93C5FD'), radiusOn: true, radius: 12, strokeOn: false, strokeColor: hexToRgb('#111827'), strokeWeight: 1, strokeAlign: 'INSIDE', shadowOn: false, shadow: { color: hexToRgba('#000000'), offsetX: 0, offsetY: 0, blur: 0, spread: 0 } },\r
          ]);\r
        }\r
      }, 200);\r
    }\r
  <\/script>\r
</body>\r
</html>\r
\r
\r
\r
\r
\r
\r
\r
\r
`, { width: 400, height: 920 });
  var STORE_KEY = "figma-toolbox-presets";
  void figma.clientStorage.getAsync(STORE_KEY).then((data) => warmFontPresets(data == null ? void 0 : data.fontPresets)).catch(() => {
  });
  figma.on("selectionchange", () => {
    figma.ui.postMessage({ type: "selection-changed" });
  });
  var fontFamilies = null;
  figma.ui.onmessage = async (msg) => {
    var _a, _b;
    if (msg.type === "list-fonts") {
      try {
        if (!fontFamilies) {
          const fonts = await figma.listAvailableFontsAsync();
          fontFamilies = collapseFontFamilies(fonts);
        }
        figma.ui.postMessage({ type: "fonts-list", families: fontFamilies });
      } catch (e) {
        fontFamilies = null;
        figma.ui.postMessage({
          type: "fonts-list",
          families: [],
          error: e instanceof Error ? e.message : String(e)
        });
      }
      return;
    }
    if (msg.type === "storage-load") {
      try {
        const data = await figma.clientStorage.getAsync(STORE_KEY);
        figma.ui.postMessage({ type: "storage-data", data: data || null });
      } catch (e) {
        figma.notify("读取方案失败：" + (e instanceof Error ? e.message : String(e)));
      }
      return;
    }
    if (msg.type === "storage-save") {
      try {
        const d = msg.data || {};
        void warmFontPresets(d.fontPresets);
        await figma.clientStorage.setAsync(STORE_KEY, {
          fontPresets: Array.isArray(d.fontPresets) ? d.fontPresets : [],
          stylePresets: Array.isArray(d.stylePresets) ? d.stylePresets : []
        });
      } catch (e) {
        figma.notify("保存方案失败：" + (e instanceof Error ? e.message : String(e)));
      }
      return;
    }
    if (msg.type === "notify") {
      figma.notify(String(msg.msg || ""));
      return;
    }
    if (msg.type === "resize") {
      const raw = Number(msg.height);
      const h = Math.max(320, Math.min(1e3, Math.round(raw) || 600));
      figma.ui.resize(400, h);
      return;
    }
    const sel = getSelectedNodes();
    if (msg.type === "detect-font") {
      const texts = getTextNodes(sel);
      const node = texts[0];
      if (!node) {
        figma.ui.postMessage({ type: "detect-font-result", empty: true });
        return;
      }
      const d = detectFontMix(texts);
      figma.ui.postMessage({
        type: "detect-font-result",
        cnFont: d.cnFont ? { family: d.cnFont.family, style: d.cnFont.style } : null,
        enFont: d.enFont ? { family: d.enFont.family, style: d.enFont.style } : null,
        cnSize: d.cnSize,
        cnSizeMixed: d.cnSizeMixed,
        enSize: d.enSize,
        enSizeMixed: d.enSizeMixed,
        cnColor: d.cnColor,
        enColor: d.enColor
      });
      return;
    }
    if (msg.type === "detect-style") {
      const shapes = getStyleableNodes(sel);
      const node = shapes[0];
      if (!node) {
        figma.ui.postMessage({ type: "detect-style-result", empty: true });
        return;
      }
      const fills = node.fills || [];
      const fillCfg = readPaintConfig(fills[0]);
      const rawR = node.cornerRadius;
      const radius = typeof rawR === "number" ? rawR : null;
      const strokes = node.strokes || [];
      const strokeCfg = readPaintConfig(strokes[0]);
      const rawW = node.strokeWeight;
      const strokeWeight = typeof rawW === "number" ? rawW : 0;
      const align = node.strokeAlign || "INSIDE";
      const effects = node.effects || [];
      const shadow = effects.find((e) => e.type === "DROP_SHADOW");
      figma.ui.postMessage({
        type: "detect-style-result",
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
          color: { r: shadow.color.r, g: shadow.color.g, b: shadow.color.b, a: (_a = shadow.color.a) != null ? _a : 1 },
          offsetX: shadow.offset.x,
          offsetY: shadow.offset.y,
          blur: shadow.radius,
          spread: (_b = shadow.spread) != null ? _b : 0
        } : null
      });
      return;
    }
    if (msg.type === "detect-skew") {
      const target = pickSkewTarget(getSelectedNodes()[0]);
      if (!target) {
        figma.ui.postMessage({ type: "detect-skew-result", empty: true });
        return;
      }
      const st = analyseSkew(target.relativeTransform);
      figma.ui.postMessage({
        type: "detect-skew-result",
        skewX: Math.round(st.skewX),
        skewY: Math.round(st.skewY),
        rotation: Math.round(st.rotation),
        name: target.name
      });
      return;
    }
    if (msg.type === "font-mixer") {
      let texts = [];
      try {
        texts = getTextNodes(sel);
        figma.ui.postMessage({ type: "font-mixer-start", total: texts.length });
        const r = await applyFontMix(texts, msg.config);
        figma.ui.postMessage({ type: "font-mixer-done", ...r, total: texts.length, empty: !texts.length });
        if (!texts.length) {
          figma.notify("请先选中至少一个文本图层", { error: true });
        } else if (r.missingFonts.length) {
          figma.notify(`字体在本机不可用：${r.missingFonts.join("、")}`, { error: true });
        } else if (r.failed.length) {
          figma.notify(`字体混排：成功 ${r.ok} 个，失败 ${r.failed.length} 个`, { error: true });
        } else if (r.timedOut) {
          figma.notify(`字体混排：已处理 ${r.ok} 个（部分字体加载超时，如有遗漏请重试）`);
        } else {
          figma.notify(`字体混排：已处理 ${r.ok} 个文本节点`);
        }
      } catch (e) {
        const m = (e == null ? void 0 : e.message) || String(e);
        figma.ui.postMessage({
          type: "font-mixer-done",
          ok: 0,
          failed: [],
          missingFonts: [],
          total: texts.length,
          fatal: m
        });
        figma.notify("字体混排失败：" + m, { error: true });
      }
    } else if (msg.type === "auto-kerning") {
      const texts = getTextNodes(sel);
      let applied = 0;
      let failed = 0;
      for (const node of texts) {
        try {
          const f = node.fontName;
          if (f === figma.mixed) {
            const segs = node.getStyledTextSegments(["fontName"]);
            for (const seg of segs) await figma.loadFontAsync(seg.fontName);
          } else await figma.loadFontAsync(f);
          applied += applyAutoKerning(node).applied;
        } catch (_) {
          failed++;
        }
      }
      figma.ui.postMessage({ type: "auto-kerning-done", nodes: texts.length, applied, failed, empty: !texts.length });
      figma.notify(texts.length ? "自动字符对微调：" + applied + " 处" : "请先选中至少一个文本图层", { error: !texts.length });
    } else if (msg.type === "bulk-styles") {
      const shapes = getStyleableNodes(sel);
      try {
        applyStyles(shapes, msg.config);
        figma.ui.postMessage({ type: "bulk-styles-done", count: shapes.length, total: sel.length });
        if (!shapes.length) {
          figma.notify("未选中可套用样式的图层（分组/画框请选中内部图层）", { error: true });
        } else {
          figma.notify(`批量样式：已处理 ${shapes.length} 个节点`);
        }
      } catch (e) {
        const m = (e == null ? void 0 : e.message) || String(e);
        figma.ui.postMessage({ type: "bulk-styles-done", count: 0, total: sel.length, fatal: m });
        figma.notify("批量样式失败：" + m, { error: true });
      }
    } else if (msg.type === "skew") {
      const nodes = getSelectedNodes();
      const r = applySkew(nodes, msg.config);
      figma.notify(
        r.applied ? `斜切：已处理 ${r.applied} 个图层` : "斜切：没有可写入变换的图层（可能被锁定或受自动布局约束）"
      );
      figma.ui.postMessage({ type: "skew-done", applied: r.applied, total: r.total });
    } else if (msg.type === "export") {
      const r = await exportNodes(sel, msg.config, (item, cfg) => {
        figma.ui.postMessage({
          type: "export-chunk",
          path: item.path,
          bytes: item.bytes,
          format: cfg.format,
          quality: cfg.quality
        });
      });
      figma.ui.postMessage({ type: "export-done", count: r.ok, failed: r.failed });
      figma.notify(
        r.failed.length ? `导出完成：${r.ok} 个；${r.failed.length} 个失败（${r.failed.slice(0, 3).join("、")}${r.failed.length > 3 ? "…" : ""}）` : r.ok ? `导出完成：共 ${r.ok} 个节点` : "导出失败：没有可导出的节点"
      );
    }
  };
})();
