// 功能③ 斜切（SkewDat 风格）—— 真正的「斜切」，不是旋转
//
// ══ Figma 变换矩阵的硬事实（均来自官方文档 / 官方类型定义）════════════
// 1) 形状是 [[m00, m01, m02], [m10, m11, m12]]；
//    x 轴向量 = (m00, m10)，y 轴向量 = (m01, m11)，平移 = (m02, m12)。
// 2) 两个轴向量被强制归一化为【单位长度】：
//    sqrt(m00² + m10²) == sqrt(m01² + m11²) == 1，但【不要求互相垂直】。
//    · "不要求垂直" → 这正是斜切能够存在的原因；
//    · "强制归一化" → 直接写 [[1, tanα], [0, 1]] 这类带缩放的矩阵，缩放会被抹掉，
//      所以必须【自己先把列归一化成单位向量】再写入。
// 3) 官方对 rotation 的定义是 Math.atan2(-m10, m00)。
//
// ══ 斜切矩阵（naive 形式 + 列归一化）══════════════════════════════════
//   水平斜切 α（让【竖直边】倾斜）：[[1, tanα], [0, 1]]
//   垂直斜切 β（让【水平边】倾斜）：[[1, 0], [tanβ, 1]]
//   两者独立叠加                ：[[1, tanα], [tanβ, 1]]
//   逐列归一化                  ：[[cosβ, sinα], [sinβ, cosα]]
//   → 归一化后两条边的倾角恰好分别是 β 与 α，与滑块的字面含义完全一致。
//
// ══ 为什么「X = +21 / Y = −21」看起来像旋转（这不是 bug）══════════════
//   两轴夹角 = 90° − (α + β)，即【总斜切量 = α + β】。
//   当 α = −β 时两个轴恢复互相垂直，斜切量归零 → 剩下的只是一个纯旋转。
//   Photoshop 的斜切同样如此。UI 会对「总斜切量 ≈ 0」直接给出提示。
//
// ══ 旋转的解耦规则 ═══════════════════════════════════════════════════
//   矩阵无法唯一拆分「旋转 + 斜切」——例如 skewY(β) 与 rotation(−β)+skewX(β)
//   是同一个矩阵。这里约定：优先把量归给斜切。
//     T1 = atan2(m01, m11)   竖边相对垂直方向的倾角
//     T0 = atan2(m10, m00)   横边相对水平方向的倾角
//     |T1| <= |T0| → 基础旋转 ρ = T1，斜切 = (0, T1+T0)
//     否则         → 基础旋转 ρ = −T0，斜切 = (T1+T0, 0)
//   读取（analyseSkew）与写入（applySkew）使用【同一条规则】，
//   因此「读取 → 应用」在视觉上可精确往返，反复点也不会跑偏。

export interface SkewConfig {
  skewX: number; // 水平斜切：竖直边倾角（度，正 = 向右倾）
  skewY: number; // 垂直斜切：水平边倾角（度，正 = 向下倾）
}

export interface SkewState {
  skewX: number;
  skewY: number;
  rotation: number; // 解耦出来的基础旋转（度）
}

export interface SkewResult {
  applied: number; // 实际写入成功的图层数
  total: number; // 参与计算的目标图层数
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MAX_ANGLE = 60;

type Lin2 = [[number, number], [number, number]]; // [[m00, m01], [m10, m11]]

// 只声明实际用到的字段：SceneNode 是联合类型，并非每个成员都声明了 relativeTransform
export interface SkewNode {
  name: string;
  type: string;
  width: number;
  height: number;
  relativeTransform: number[][];
  children?: readonly SceneNode[];
  parent?: SkewNode | null;
}

const asSkewNode = (n: SceneNode): SkewNode => n as unknown as SkewNode;

const clampAngle = (v: number) => Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, v));

// 斜切矩阵（列已归一化，满足 Figma 的「单位轴」约束）
export function shearLinear(skewX: number, skewY: number): Lin2 {
  const ta = Math.tan(skewX * RAD);
  const tb = Math.tan(skewY * RAD);
  const k0 = Math.hypot(1, tb) || 1; // 列 0 = (1, tanβ)
  const k1 = Math.hypot(ta, 1) || 1; // 列 1 = (tanα, 1)
  return [
    [1 / k0, ta / k1],
    [tb / k0, 1 / k1],
  ];
}

// 基础旋转矩阵 R(ρ)，与 Figma 的 rotation 约定一致（rotation = atan2(−m10, m00)）
function rotLinear(rho: number): Lin2 {
  const c = Math.cos(rho * RAD);
  const s = Math.sin(rho * RAD);
  return [
    [c, s],
    [-s, c],
  ];
}

function mul(a: Lin2, b: Lin2): Lin2 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

// 从变换矩阵反推「斜切 + 基础旋转」（与应用端使用同一条约定）
export function analyseSkew(t: Transform): SkewState {
  const T1 = Math.atan2(t[0][1], t[1][1]) * DEG; // 竖边倾角
  const T0 = Math.atan2(t[1][0], t[0][0]) * DEG; // 横边倾角
  if (Math.abs(T1) <= Math.abs(T0)) {
    return { skewX: 0, skewY: clampAngle(T1 + T0), rotation: T1 };
  }
  return { skewX: clampAngle(T1 + T0), skewY: 0, rotation: -T0 };
}

// 组（GROUP）的变换由子级推导，直接写组本身不会生效 → 递归到叶子；
// 画框 / 组件 / 实例等容器则整体斜切，不深入其子级。
function collectLeaves(node: SkewNode, out: SkewNode[]): void {
  const kids = node.children;
  if (node.type !== 'GROUP' || !kids || !kids.length) {
    out.push(node);
    return;
  }
  for (const c of kids) collectLeaves(asSkewNode(c), out);
}

// relativeTransform 相对「最近的画布 / 画框 / 组件 / 实例」，组的变换会被跳过
function refParent(node: SkewNode): SkewNode | null {
  let p = node.parent;
  while (p && (p.type === 'GROUP' || p.type === 'BOOLEAN_OPERATION')) p = p.parent ?? null;
  return p ?? null;
}

// 找到用于「读取角度」的目标图层：组则取第一个叶子
export function pickSkewTarget(node?: SceneNode): SkewNode | null {
  if (!node) return null;
  const leaves: SkewNode[] = [];
  collectLeaves(asSkewNode(node), leaves);
  for (const l of leaves) {
    if (l.relativeTransform) return l;
  }
  return null;
}

export function applySkew(nodes: SceneNode[], cfg: SkewConfig): SkewResult {
  const S = shearLinear(cfg.skewX, cfg.skewY);
  let applied = 0;
  let total = 0;
  if (!nodes.length) return { applied, total };

  // 按「参照父级」分桶：同一参照系内的多个图层共用一个锚点，整体一起斜切
  const buckets = new Map<SkewNode | null, SkewNode[]>();
  for (const n of nodes) {
    const node = asSkewNode(n);
    const key = refParent(node);
    const arr = buckets.get(key);
    if (arr) collectLeaves(node, arr);
    else {
      const fresh: SkewNode[] = [];
      collectLeaves(node, fresh);
      buckets.set(key, fresh);
    }
  }

  for (const leaves of buckets.values()) {
    // 先算出每个叶子在共同参照系内的旧中心 + 保留基础旋转后的新线性部分
    const items = leaves.map((node) => {
      const t = node.relativeTransform;
      const cx = node.width / 2;
      const cy = node.height / 2;
      const q = {
        x: t[0][0] * cx + t[0][1] * cy + t[0][2],
        y: t[1][0] * cx + t[1][1] * cy + t[1][2],
      };
      const rho = analyseSkew(t as unknown as Transform).rotation; // 保留图层原有的旋转
      return { node, L: mul(rotLinear(rho), S), q, cx, cy };
    });

    // 锚点 = 所有目标中心的外接框中心。
    // 只选一个图层时锚点就是它自己的中心 → 形状原地斜切，不会位移。
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
          [it.L[1][0], it.L[1][1], ty],
        ];
        applied++;
      } catch {
        // 受约束锁定 / 自动布局子级等不允许写变换的节点 → 跳过
      }
    }
  }

  return { applied, total };
}
