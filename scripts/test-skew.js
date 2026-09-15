// 斜切算法数值验证：直接对源码打包后的模块做断言
// 运行前置：npx esbuild src/features/skew.ts --bundle --format=cjs --platform=node --outfile=../.tmp-shot/skew.cjs
const path = require('path');
const { shearLinear, analyseSkew, applySkew } = require(path.join(__dirname, '.skew.cjs'));

const DEG = 180 / Math.PI;
let pass = 0, fail = 0;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

// 单位矩阵 / 旋转矩阵（Figma 约定：rotation = atan2(-m10, m00)）
const I = [[1, 0, 0], [0, 1, 0]];
const rot = (deg) => {
  const c = Math.cos(deg / DEG), s = Math.sin(deg / DEG);
  return [[c, s, 0], [-s, c, 0]];
};
const colLen = (L, i) => i === 0 ? Math.hypot(L[0][0], L[1][0]) : Math.hypot(L[0][1], L[1][1]);
const yTilt = (L) => Math.atan2(L[0][1], L[1][1]) * DEG; // 竖边相对垂直的倾角
const xTilt = (L) => Math.atan2(L[1][0], L[0][0]) * DEG; // 横边相对水平的倾角
// 两轴夹角：90° = 互相垂直（纯旋转），否则就是真的斜切
const axisAngle = (L) => {
  const x = [L[0][0], L[1][0]], y = [L[0][1], L[1][1]];
  return Math.acos(Math.max(-1, Math.min(1, x[0] * y[0] + x[1] * y[1]))) * DEG;
};
const fmt = (L) => '[[' + L[0].map((v) => v.toFixed(5)).join(', ') + '], [' + L[1].map((v) => v.toFixed(5)).join(', ') + ']]';

console.log('=== 1. 单位轴约束（Figma 硬性要求）===');
for (const [x, y] of [[21, 0], [0, 21], [21, -21], [15, 15], [45, 0], [0, -45], [-33, 47]]) {
  const L = shearLinear(x, y);
  ok(`列为单位向量 (${x}, ${y})`,
    near(colLen(L, 0), 1, 1e-9) && near(colLen(L, 1), 1, 1e-9),
    'len0=' + colLen(L, 0) + ' len1=' + colLen(L, 1));
}

console.log('\n=== 2. 滑块含义：竖边倾角=X，横边倾角=Y ===');
for (const [x, y] of [[21, 0], [0, 21], [15, 15], [-30, 12]]) {
  const L = shearLinear(x, y);
  ok(`X=${x} → 竖边倾角 ${yTilt(L).toFixed(3)}°`, near(yTilt(L), x, 1e-6), fmt(L));
  ok(`Y=${y} → 横边倾角 ${xTilt(L).toFixed(3)}°`, near(xTilt(L), y, 1e-6), fmt(L));
}

console.log('\n=== 3. 真斜切 vs 旋转：两轴夹角 ===');
{
  const L = shearLinear(21, 0);
  const ang = axisAngle(L);
  ok('X=21 / Y=0 → 两轴夹角 69°（非 90°，是斜切）', near(ang, 69, 1e-6), '实际 ' + ang.toFixed(3) + '°');
  ok('  → 底边保持水平（横边倾角 0）', near(xTilt(L), 0, 1e-9));
  ok('  → 竖边倾斜 21°（平行四边形）', near(yTilt(L), 21, 1e-9));
}
{
  const L = shearLinear(15, 15);
  const ang = axisAngle(L);
  ok('X=15 / Y=15 → 总斜切 30°（夹角 60°）', near(90 - ang, 30, 1e-6), '实际 ' + (90 - ang).toFixed(3) + '°');
}
{
  const L = shearLinear(21, -21);
  const ang = axisAngle(L);
  ok('X=21 / Y=−21 → 两轴回到垂直（退化＝纯旋转，数学特性）', near(ang, 90, 1e-6), '实际 ' + ang.toFixed(3) + '°');
}

console.log('\n=== 4. 修复前的旧公式（对照证据）===');
{
  // 旧实现：[[a, a·tanX], [d·tanY, d]]，a=d=1
  const sx = Math.tan(21 / DEG), sy = Math.tan(-21 / DEG);
  const old = [[1, sx, 0], [sy, 1, 0]];
  // Figma 会把列归一化
  const k0 = Math.hypot(old[0][0], old[1][0]), k1 = Math.hypot(old[0][1], old[1][1]);
  const norm = [[old[0][0] / k0, old[0][1] / k1, 0], [old[1][0] / k0, old[1][1] / k1, 0]];
  const ang = axisAngle(norm);
  ok('旧公式在 X=+21 / Y=−21 时归一化后两轴【完全垂直】', near(ang, 90, 1e-6), '实际 ' + ang.toFixed(6) + '°');
  const R21 = rot(21);
  const dR = Math.max(...[0, 1].flatMap((i) => [0, 1].map((j) => Math.abs(norm[i][j] - R21[i][j]))));
  ok('  → 旧结果与「旋转 +21°」矩阵逐元素相同（根因确证）', dR < 1e-9, 'maxΔ=' + dR + ' ' + fmt(norm));
  console.log('     旧矩阵 ' + fmt(norm) + '  ==  旋转 ' + (Math.atan2(-norm[1][0], norm[0][0]) * DEG).toFixed(3) + '°');
  // 对照：旧公式在单轴时其实是正确的斜切（说明只在"两轴同时用"时退化为旋转）
  const oldX = [[1, Math.tan(21 / DEG)], [0, 1]];
  const kx = Math.hypot(oldX[0][1], oldX[1][1]);
  const oldXn = [[oldX[0][0], oldX[0][1] / kx], [oldX[1][0], oldX[1][1] / kx]];
  ok('  → 旧公式单轴（Y=0）时两轴夹角 ≠ 90°，本来就是斜切',
    Math.abs(axisAngle(oldXn) - 90) > 1, axisAngle(oldXn).toFixed(3) + '°');
}

console.log('\n=== 5. 角度反推（读取选中图层）===');
for (const [x, y] of [[21, 0], [0, 21], [-18, 0], [0, -25], [0, 0]]) {
  const st = analyseSkew(shearLinear(x, y));
  ok(`读取 (${x}, ${y}) → (${st.skewX.toFixed(3)}, ${st.skewY.toFixed(3)})`,
    near(st.skewX, x, 1e-6) && near(st.skewY, y, 1e-6));
}
{
  const st = analyseSkew(rot(30));
  ok('读取「纯旋转 30°」→ 斜切 0/0，旋转 30°',
    near(st.skewX, 0, 1e-6) && near(st.skewY, 0, 1e-6) && near(st.rotation, 30, 1e-6),
    JSON.stringify(st));
}

console.log('\n=== 6. 组合斜切：读取后重建矩阵必须一致（视觉可往返）===');
for (const [x, y] of [[15, 15], [21, -21], [30, 10], [-40, 40]]) {
  const L0 = shearLinear(x, y);
  const st = analyseSkew(L0);
  const L1 = shearLinear(st.skewX, st.skewY); // 读取出来的值再喂回去
  // 重建：R(rotation) · Shear
  const c = Math.cos(st.rotation / DEG), s = Math.sin(st.rotation / DEG);
  const rebuilt = [
    [c * L1[0][0] + s * L1[1][0], c * L1[0][1] + s * L1[1][1]],
    [-s * L1[0][0] + c * L1[1][0], -s * L1[0][1] + c * L1[1][1]],
  ];
  const d = Math.max(...[0, 1].flatMap((i) => [0, 1].map((j) => Math.abs(rebuilt[i][j] - L0[i][j]))));
  ok(`(${x}, ${y}) → 读取(${st.skewX.toFixed(1)}, ${st.skewY.toFixed(1)}) 重建后矩阵一致`, d < 1e-9, 'maxΔ=' + d);
}

console.log('\n=== 7. applySkew 行为验证（mock 节点）===');
function mockNode(w, h, t) {
  return { name: 'N', type: 'RECTANGLE', width: w, height: h, parent: null, relativeTransform: t.map((r) => r.slice()) };
}
const center = (n) => {
  const t = n.relativeTransform, cx = n.width / 2, cy = n.height / 2;
  return [t[0][0] * cx + t[0][1] * cy + t[0][2], t[1][0] * cx + t[1][1] * cy + t[1][2]];
};
{
  const n = mockNode(100, 200, [[1, 0, 40], [0, 1, 60]]);
  const c0 = center(n);
  applySkew([n], { skewX: 20, skewY: 0 });
  const c1 = center(n);
  ok('单图层斜切：中心原地不动', near(c0[0], c1[0], 1e-9) && near(c0[1], c1[1], 1e-9),
    JSON.stringify(c0) + ' → ' + JSON.stringify(c1));
  const L = n.relativeTransform;
  ok('  → 写入的列仍是单位向量', near(Math.hypot(L[0][0], L[1][0]), 1, 1e-9) && near(Math.hypot(L[0][1], L[1][1]), 1, 1e-9));
  ok('  → 结果是斜切而非旋转（两轴夹角 ' + axisAngle(L).toFixed(2) + '° ≠ 90°）',
    Math.abs(axisAngle(L) - 90) > 1, fmt(L));

  // 幂等：再应用一次同样参数，矩阵不应变化
  const snapshot = JSON.stringify(n.relativeTransform);
  applySkew([n], { skewX: 20, skewY: 0 });
  ok('  → 重复应用同一参数：结果不变（幂等）', JSON.stringify(n.relativeTransform) === snapshot,
    snapshot + ' → ' + JSON.stringify(n.relativeTransform));

  // 归零：斜切归零后应恢复成未斜切状态（保留位置与尺寸）
  applySkew([n], { skewX: 0, skewY: 0 });
  ok('  → 归零后两轴恢复垂直', near(axisAngle(n.relativeTransform), 90, 1e-6));
  ok('  → 归零后中心仍不动', near(center(n)[0], c0[0], 1e-6) && near(center(n)[1], c0[1], 1e-6));
}
{
  // 旋转 + 斜切：图层原有的旋转必须保留
  const n = mockNode(100, 100, rot(30));
  applySkew([n], { skewX: 20, skewY: 0 });
  const st = analyseSkew(n.relativeTransform);
  ok('旋转 30° 的图层斜切 20° → 旋转仍为 30°，斜切为 20°',
    near(st.rotation, 30, 1e-6) && near(st.skewX, 20, 1e-6), JSON.stringify(st));
}
{
  // 组：递归到子级，整组一起斜切（组自身变换由子级推导，写组无效）
  const child = mockNode(50, 50, [[1, 0, 10], [0, 1, 10]]);
  const child2 = mockNode(50, 50, [[1, 0, 60], [0, 1, 10]]);
  const group = { name: 'G', type: 'GROUP', width: 100, height: 50, parent: null,
    relativeTransform: [[1, 0, 0], [0, 1, 0]], children: [child, child2] };
  const res = applySkew([group], { skewX: 25, skewY: 0 });
  ok('组选择 → 递归处理到 2 个子级', res.applied === 2 && res.total === 2, JSON.stringify(res));
  const y1 = child.relativeTransform, y2 = child2.relativeTransform;
  ok('  两个子级获得相同的斜切方向（整体一致）',
    near(Math.atan2(y1[1][0] === 0 ? 0 : 0, 1), 0, 1e-9) && near(y1[0][1] / y1[1][1], y2[0][1] / y2[1][1], 1e-9),
    fmt(y1) + ' / ' + fmt(y2));
  ok('  子级位置也按整组斜切发生了位移', Math.abs(y2[0][2] - 60) > 1, 'x: 60 → ' + y2[0][2].toFixed(2));
}
{
  // 只读节点：不应抛异常
  const locked = {
    name: 'L', type: 'RECTANGLE', width: 10, height: 10, parent: null,
    get relativeTransform() { return I; },
    set relativeTransform(_v) { throw new Error('locked'); },
  };
  let threw = null;
  let res = null;
  try { res = applySkew([locked], { skewX: 10, skewY: 0 }); } catch (e) { threw = e; }
  ok('写入失败的节点被安全跳过（不抛异常）', threw === null && res && res.applied === 0, JSON.stringify(res));
}

console.log('\n' + (fail === 0 ? `全部通过 ✓  (${pass} 项)` : `${fail} 项未通过 ✗  (通过 ${pass})`));
process.exit(fail === 0 ? 0 : 1);
