// 导出路径规则单元测试（对应 Figma「用 / 新建文件夹」规则）
// 用法：npm run test:export
const path = require('path');
const mod = require(path.join(__dirname, '.export.cjs'));
const { buildExportPath, splitName, exportNodes } = mod;

let failed = 0;
function ok(label, cond, extra) {
  if (cond) {
    console.log('  OK   ' + label + (extra ? ' — ' + extra : ''));
  } else {
    failed++;
    console.log('  FAIL ' + label + (extra ? ' — ' + extra : ''));
  }
}
const eqArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

// mock 节点树
function node(name, type, parent) {
  return {
    name,
    type,
    parent: parent || null,
    exportAsync: async () => new Uint8Array([1, 2, 3, 4]),
  };
}
const P = () => node('页面 1', 'PAGE', null);

console.log('\n=== 1. 用户示例：画框 0911 + 图层 1555/HR面霜-11主图-1 ===');
{
  const page = P();
  const frame = node('0911', 'FRAME', page);
  const target = node('1555/HR面霜-11主图-1', 'RECTANGLE', frame);
  const got = buildExportPath(target);
  ok('路径 = 0911/1555/HR面霜-11主图-1', eqArr(got, ['0911', '1555', 'HR面霜-11主图-1']), JSON.stringify(got));
}

console.log('\n=== 2. 父级名带尾斜杠 "0911/" 结果一致 ===');
{
  const page = P();
  const frame = node('0911/', 'FRAME', page);
  const target = node('1555/HR面霜-11主图-1', 'RECTANGLE', frame);
  const got = buildExportPath(target);
  ok('尾斜杠不产生空目录', eqArr(got, ['0911', '1555', 'HR面霜-11主图-1']), JSON.stringify(got));
}

console.log('\n=== 3. 多层祖先 + 祖先名自带斜杠 ===');
{
  const page = P();
  const f1 = node('A', 'FRAME', page);
  const f2 = node('B/C', 'FRAME', f1);
  const t = node('D', 'RECTANGLE', f2);
  const got = buildExportPath(t);
  ok('路径 = A/B/C/D', eqArr(got, ['A', 'B', 'C', 'D']), JSON.stringify(got));
}

console.log('\n=== 4. 顶层节点（父级为 PAGE） ===');
{
  const page = P();
  const t = node('图/1', 'RECTANGLE', page);
  const got = buildExportPath(t);
  ok('PAGE 不进入路径', eqArr(got, ['图', '1']), JSON.stringify(got));
}

console.log('\n=== 5. 非法字符清洗 ===');
{
  ok('Windows 非法字符被移除', eqArr(splitName('a:b*c?d"e<f>g|h'), ['abcdefgh']), JSON.stringify(splitName('a:b*c?d"e<f>g|h')));
  ok('全角斜杠 ／ 等价 "/"', eqArr(splitName('0911／1555'), ['0911', '1555']), JSON.stringify(splitName('0911／1555')));
  ok('首尾空白与点被去掉', eqArr(splitName('  ..主图. '), ['主图']), JSON.stringify(splitName('  ..主图. ')));
  // 回归守卫：连字符与空格是合法文件名字符，不能被当成非法字符清掉
  ok('连字符保留（李佳琦-气垫800）', eqArr(splitName('李佳琦-气垫800'), ['李佳琦-气垫800']), JSON.stringify(splitName('李佳琦-气垫800')));
  ok('连字符保留（1555/HR面霜-11主图-1）', eqArr(splitName('1555/HR面霜-11主图-1'), ['1555', 'HR面霜-11主图-1']), JSON.stringify(splitName('1555/HR面霜-11主图-1')));
  ok('中间空格保留', eqArr(splitName('李佳琦 气垫 800'), ['李佳琦 气垫 800']), JSON.stringify(splitName('李佳琦 气垫 800')));
}

console.log('\n=== 6. 空名兜底 ===');
{
  const page = P();
  const t = node('///', 'RECTANGLE', page);
  const got = buildExportPath(t);
  ok('全空名 → export', eqArr(got, ['export']), JSON.stringify(got));
}

console.log('\n=== 7. 同名节点自动去重 ===');
{
  const page = P();
  const f = node('0911', 'FRAME', page);
  const a = node('主图', 'RECTANGLE', f);
  const b = node('主图', 'RECTANGLE', f);
  const c = node('主图', 'RECTANGLE', f);
  const out = [];
  exportNodes([a, b, c], { format: 'PNG', scale: 1, quality: 1 }, (item) => out.push(item.path)).then(() => {
    ok('三个同名节点路径互不覆盖',
      eqArr(out, ['0911/主图', '0911/主图-2', '0911/主图-3']), JSON.stringify(out));
    console.log(failed === 0 ? '\n全部通过 ✓' : `\n${failed} 项未通过 ✗`);
    process.exit(failed === 0 ? 0 : 1);
  });
}
