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

  console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项未通过 ✗`);
  process.exit(failed === 0 ? 0 : 1);
})();
