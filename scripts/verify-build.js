// 构建产物校验：确认 dist/main.js 注入的 HTML 与源文件逐字节一致、语法合法、showUI 入参正确。
// 用途：防止「构建产物与源码不一致」这类静默问题（例如模板字面量转义错误）。
// 用法：npm run verify
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MAIN_JS = path.join(ROOT, 'dist', 'main.js');
const UI_SRC = path.join(ROOT, 'src', 'ui', 'ui.html');
const UI_DIST = path.join(ROOT, 'dist', 'ui.html');

let failed = 0;
function check(label, ok, detail) {
  console.log(`${ok ? '  OK  ' : ' FAIL '} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failed++;
}

// 1. dist/ui.html 是否与源文件一致
check('dist/ui.html 与 src/ui/ui.html 一致', fs.readFileSync(UI_SRC, 'utf8') === fs.readFileSync(UI_DIST, 'utf8'));

// 2. dist/main.js 语法合法性
try {
  execFileSync(process.execPath, ['--check', MAIN_JS], { stdio: 'pipe' });
  check('dist/main.js 语法合法', true);
} catch (e) {
  check('dist/main.js 语法合法', false, String(e.stderr || e.message).slice(0, 200));
}

// 3. 用 mock figma 实际执行产物，比对 showUI 收到的 HTML
let captured = null;
let opts = null;
const posted = [];      // 主进程 → UI 的消息
const store = {};       // mock clientStorage 的数据
global.figma = {
  showUI(html, o) { captured = html; opts = o; },
  on() {},
  notify() {},
  ui: { onmessage: null, postMessage(m) { posted.push(m); } },
  listAvailableFontsAsync: async () => [],
  clientStorage: {
    async getAsync(k) { return store[k]; },
    async setAsync(k, v) { store[k] = v; },
  },
};

let runtimeErr = null;
try {
  delete require.cache[MAIN_JS];
  require(MAIN_JS);
} catch (e) {
  runtimeErr = e;
}

check('产物可执行（无运行时异常）', !runtimeErr, runtimeErr ? runtimeErr.message : '');

if (!runtimeErr) {
  const expected = fs.readFileSync(UI_SRC, 'utf8');
  check('showUI 入参为字符串', typeof captured === 'string');
  check('注入的 HTML 与源文件逐字节一致', captured === expected,
    `captured=${captured ? captured.length : 0}B, expected=${expected.length}B`);
  check('showUI 尺寸参数正确', !!opts && opts.width === 400 && typeof opts.height === 'number' && opts.height >= 600, JSON.stringify(opts));

  // 4. 模板字面量转义核查：HTML 内联后是一个模板字面量，其中每个 ${ 都必须转义为 \${
  //    （源码自身的模板字面量如 figma.notify(`...${n}...`) 不在此列，属正常）
  const raw = fs.readFileSync(MAIN_JS, 'utf8');
  const htmlDollarBrace = (expected.match(/\$\{/g) || []).length;
  const escapedInBundle = (raw.match(/\\\$\{/g) || []).length;
  check('HTML 中的 ${ 已全部转义为 \\${', escapedInBundle >= htmlDollarBrace,
    `HTML 内 ${htmlDollarBrace} 处 → 产物中转义 ${escapedInBundle} 处`);
}

// 5. 方案预设持久化通道：走 figma.clientStorage 存取一轮，验证能原样读回。
//    为什么必须查这项：插件 UI 在 data: URL 的 iframe 里，localStorage 会被浏览器拒绝，
//    历史上这里静默失败过（点保存没反应），需要一道回归防线。
(async () => {
  if (runtimeErr) {
    console.log(' 跳过  持久化通道校验（产物未能执行）');
    return process.exit(failed === 0 ? 0 : 1);
  }
  const onmessage = global.figma.ui.onmessage;
  check('存在 storage-save 处理', typeof onmessage === 'function');
  if (typeof onmessage !== 'function') return process.exit(1);

  const payload = { fontPresets: [{ name: 'A测试' }], stylePresets: [{ name: 'B测试' }] };
  await onmessage({ type: 'storage-save', data: payload });
  check('方案已写入 clientStorage', !!store[Object.keys(store)[0]], Object.keys(store).join(','));

  await onmessage({ type: 'storage-load' });
  const back = posted.filter((m) => m.type === 'storage-data').pop();
  check('回传的 storage-data 与写入一致',
    !!back && JSON.stringify(back.data) === JSON.stringify(payload),
    JSON.stringify(back && back.data).slice(0, 80));

  // Verify the real message handler returns all color/effect properties to the UI.
  const node = {
    type: 'RECTANGLE', fills: [{ type:'SOLID',color:{r:1,g:0,b:0},opacity:0,blendMode:'MULTIPLY' }],
    strokes: [], effects: [
      { type:'DROP_SHADOW',color:{r:0,g:0,b:0,a:0.3},offset:{x:1,y:2},radius:4,spread:0,visible:true,blendMode:'SCREEN' },
      { type:'INNER_SHADOW',color:{r:1,g:0,b:0,a:0},offset:{x:-1,y:3},radius:5,spread:-2,visible:true,blendMode:'OVERLAY' },
      { type:'LAYER_BLUR',radius:0,blurType:'NORMAL',visible:true },
      { type:'BACKGROUND_BLUR',radius:12,blurType:'NORMAL',visible:true },
    ],
  };
  global.figma.currentPage = { selection:[node] };
  await onmessage({ type:'detect-style' });
  const detected = posted.filter(m => m.type === 'detect-style-result').pop();
  check('识别回传填充不透明度和混合模式', detected.fill.opacity === 0 && detected.fill.blendMode === 'MULTIPLY');
  check('识别回传投影和内阴影混合模式', detected.shadow.blendMode === 'SCREEN' && detected.innerShadow.blendMode === 'OVERLAY' && detected.innerShadow.color.a === 0);
  check('识别回传两种模糊及零半径', detected.layerBlurOn && detected.layerBlur.radius === 0 && detected.backgroundBlurOn && detected.backgroundBlur.radius === 12);
  await onmessage({ type:'bulk-style-remove',style:'innerShadow' });
  await onmessage({ type:'bulk-style-remove',style:'fill' });
  check('不再接受开关即时删除消息，应用前图层保持原样', node.effects.length === 4 && node.fills.length === 1);
  await onmessage({ type:'bulk-styles',config:{fill:null,stroke:null,cornerRadius:null,strokeWeight:null,strokeAlign:null,shadow:null,remove:['innerShadow','fill']} });
  check('点击应用后删除内阴影和填充，其它效果保留', node.fills.length === 0 && node.effects.length === 3 && !node.effects.some(effect => effect.type === 'INNER_SHADOW') && node.effects.some(effect => effect.type === 'DROP_SHADOW'));
  await onmessage({ type:'bulk-styles',config:{fill:null,stroke:null,cornerRadius:null,strokeWeight:null,strokeAlign:null,shadow:null,remove:['shadow','layerBlur','backgroundBlur']} });
  check('应用方案消息清除已关闭的效果', node.effects.length === 0);

  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项未通过 ✗`);
  process.exit(failed === 0 ? 0 : 1);
})();
