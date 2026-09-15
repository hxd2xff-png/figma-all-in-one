// 打包脚本：把 src/main.ts 编译成 dist/main.js，并把 ui.html 复制到 dist/
//
// 关键点：Figma 的 figma.showUI(html, options) 第一个参数必须是 HTML 字符串，
// 因此构建时把 ui.html 的内容注入为 __html__ 常量，运行时由 main.ts 显式传入。
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');
const UI_SRC = path.join('src', 'ui', 'ui.html');
const UI_DIST = path.join('dist', 'ui.html');

async function run() {
  fs.mkdirSync('dist', { recursive: true });

  const html = fs.readFileSync(UI_SRC, 'utf8');

  const opts = {
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'dist/main.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2019',
    charset: 'utf8',           // 中文不转义，产物更小更可读
    logLevel: 'info',
    define: {
      // figma.showUI 的第一个参数：注入完整 HTML 字符串
      __html__: JSON.stringify(html),
    },
  };

  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('esbuild watching...');
  } else {
    await esbuild.build(opts);
  }

  // 复制 UI 面板到 dist（保持与 manifest 中 ui 路径一致）
  fs.copyFileSync(UI_SRC, UI_DIST);
  console.log('build done -> dist/main.js + dist/ui.html');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
