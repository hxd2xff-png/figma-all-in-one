// 纯色 / 渐变样式的数值验证：直接对源码打包后的模块做断言
// 前置：esbuild src/features/bulk-styles.ts --bundle --format=cjs --platform=node --outfile=scripts/.bulk.cjs
const path = require('path');
const {
  gradientTransform, angleFromTransform, normalizeStops,
  buildGradientPaint, paintFromConfig, readPaintConfig,
} = require(path.join(__dirname, '.bulk.cjs'));

let pass = 0, fail = 0;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  OK   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? '  → ' + extra : '')); }
}

// 归一化空间中的点变换：p' = M · p（M = [[m00,m01,m02],[m10,m11,m12]]）
const apply = (M, x, y) => [
  M[0][0] * x + M[0][1] * y + M[0][2],
  M[1][0] * x + M[1][1] * y + M[1][2],
];
const rgbs = (r, g, b) => ({ r, g, b, a: 1 });

console.log('=== 1. 角度 → 矩阵（必须绕中心 (0.5,0.5)）===');
{
  const M0 = gradientTransform(0);
  ok('0° = identity（线性左→右）',
    near(M0[0][0], 1) && near(M0[0][1], 0) && near(M0[0][2], 0) &&
    near(M0[1][0], 0) && near(M0[1][1], 1) && near(M0[1][2], 0),
    JSON.stringify(M0));

  for (const a of [0, 17, 90, 180, 270, 315, -45]) {
    const c = apply(gradientTransform(a), 0.5, 0.5);
    ok(`中心是不动点 ${a}°`, near(c[0], 0.5, 1e-12) && near(c[1], 0.5, 1e-12), JSON.stringify(c));
  }

  // 线性渐变轴：单位空间中 [0,0.5] → [1,0.5]，旋转后应落在预期方位（y 轴向下）
  const cases = [
    [0, [0, 0.5], [1, 0.5], '左→右'],
    [90, [0.5, 0], [0.5, 1], '上→下'],
    [180, [1, 0.5], [0, 0.5], '右→左'],
    [270, [0.5, 1], [0.5, 0], '下→上'],
  ];
  for (const [a, s, e, label] of cases) {
    const M = gradientTransform(a);
    const gotS = apply(M, 0, 0.5);
    const gotE = apply(M, 1, 0.5);
    ok(`${a}° 线性渐变 = ${label}`,
      near(gotS[0], s[0], 1e-12) && near(gotS[1], s[1], 1e-12) &&
      near(gotE[0], e[0], 1e-12) && near(gotE[1], e[1], 1e-12),
      JSON.stringify([gotS, gotE]));
  }

  const M45 = gradientTransform(45);
  const s45 = apply(M45, 0, 0.5), e45 = apply(M45, 1, 0.5);
  ok('45° = 左上→右下', e45[0] - s45[0] > 0 && e45[1] - s45[1] > 0, JSON.stringify([s45, e45]));

  for (const a of [0, 37, 90, 215]) {
    const M = gradientTransform(a);
    const det = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    ok(`行列式 = 1（纯旋转，无缩放/剪切）${a}°`, near(det, 1, 1e-12), String(det));
  }
}

console.log('=== 2. 角度反推往返 ===');
{
  for (const a of [0, 1, 45, 90, 123, 180, 270, 359, 360]) {
    const back = angleFromTransform(gradientTransform(a));
    const want = ((a % 360) + 360) % 360;
    ok(`往返 ${a}° → ${back}°`, back === want, '期望 ' + want);
  }
}

console.log('=== 3. 色标清洗 ===');
{
  const s = normalizeStops([
    { color: rgbs(1, 0, 0), position: 1 },
    { color: rgbs(0, 0, 1), position: 0 },
  ]);
  ok('按位置升序排序', s[0].color.b === 1 && s[1].color.r === 1);
  ok('缺省 alpha 补为 1', s[0].color.a === 1);

  const c = normalizeStops([
    { color: rgbs(2, -1, 0.5), position: 2 },
    { color: rgbs(0, 0, 0), position: -3 },
  ]);
  ok('位置钳制到 0~1', c[0].position === 0 && c[1].position === 1);
  ok('颜色分量钳制到 0~1',
    c[0].color.r === 0 && c[1].color.r === 1 && c[1].color.g === 0 && c[1].color.b === 0.5,
    JSON.stringify(c.map((x) => x.color)));

  ok('空数组 → 补黑白两端', normalizeStops([]).length === 2);
  const one = normalizeStops([{ color: rgbs(0.5, 0.5, 0.5), position: 0.3 }]);
  ok('单色标 → 撑成 0 与 1 两端', one.length === 2 && one[0].position === 0 && one[1].position === 1);
}

console.log('=== 4. Paint 构造（四种渐变类型）===');
{
  const solid = paintFromConfig({ kind: 'solid', color: rgbs(1, 0, 0) });
  ok('纯色 → SOLID', solid.type === 'SOLID' && solid.color.r === 1);

  for (const k of ['GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND']) {
    const g = paintFromConfig({
      kind: 'gradient',
      gradient: { gradientType: k, angle: 90, stops: [{ color: rgbs(0, 0, 0), position: 0 }, { color: rgbs(1, 1, 1), position: 1 }] },
    });
    ok(`${k} 类型正确`, g.type === k);
    ok(`${k} 带 2x3 gradientTransform`, Array.isArray(g.gradientTransform) && g.gradientTransform.length === 2 && g.gradientTransform[0].length === 3);
    ok(`${k} 带 2 个色标`, g.gradientStops.length === 2);
  }

  const empty = buildGradientPaint({ gradientType: 'GRADIENT_LINEAR', angle: 0, stops: [] });
  ok('空色标也能构造（自动补黑白）', empty.gradientStops.length === 2);
}

console.log('=== 5. 反读 Paint（识别选中图层）===');
{
  const src = {
    kind: 'gradient',
    gradient: {
      gradientType: 'GRADIENT_ANGULAR',
      angle: 135,
      stops: [
        { color: rgbs(1, 0, 0), position: 0 },
        { color: rgbs(0, 0, 1), position: 0.5 },
        { color: rgbs(0, 1, 0), position: 1 },
      ],
    },
  };
  const back = readPaintConfig(paintFromConfig(src));
  ok('渐变类型往返一致', back.kind === 'gradient' && back.gradient.gradientType === 'GRADIENT_ANGULAR');
  ok('角度往返一致', back.gradient.angle === 135, String(back.gradient.angle));
  ok('色标数量与位置往返一致', back.gradient.stops.length === 3 && near(back.gradient.stops[1].position, 0.5));

  const bs = readPaintConfig(paintFromConfig({ kind: 'solid', color: rgbs(0.2, 0.4, 0.6) }));
  ok('纯色往返一致', bs.kind === 'solid' && near(bs.color.g, 0.4));

  ok('图片填充返回 null', readPaintConfig({ type: 'IMAGE' }) === null);
  ok('空值返回 null', readPaintConfig(undefined) === null && readPaintConfig(null) === null);
}

console.log('\n' + pass + ' 项通过' + (fail ? '，' + fail + ' 项未通过 ✗' : ' ✓'));
process.exit(fail ? 1 : 0);
