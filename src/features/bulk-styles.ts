// 功能② 批量样式：填充 / 圆角 / 描边 / 阴影，统一套用到选中图形节点
// SceneNode / RGB / Effect / Transform / GradientPaint 为 Figma 全局类型
//
// ── 渐变实现要点（已按 Figma 官方约定逐项核对）────────────────────────────
// 1) 渐变建立在图层的 bbox 归一化空间：(0,0) 左上、(1,1) 右下，与图层宽高比无关。
// 2) Figma 的基底固定是「沿 x 轴 0→1 的水平渐变」，gradientTransform 再对它做
//    旋转/缩放/平移：
//      · 线性 GRADIENT_LINEAR ：渐变轴在单位空间中是 [0,0.5] → [1,0.5]
//      · 径向 GRADIENT_RADIAL ：中心 (0.5,0.5)，x 半径终点 [1,0.5]、y 半径终点
//                                [0.5,1]，即半径为 0.5
//      · 角度 GRADIENT_ANGULAR / 菱形 GRADIENT_DIAMOND ：同样以 (0.5,0.5) 为中心
// 3) 于是 identity 矩阵 [[1,0,0],[0,1,0]] 的含义是：
//      线性 = 从左到右；径向/角度/菱形 = 居中铺满。
// 4) 旋转必须绕 (0.5,0.5)，否则渐变形心会被甩出图层（绕原点旋转的经典坑）。

export type GradientKind =
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND';

export interface GradientStopConfig {
  color: RGB & { a?: number };
  position: number; // 0 ~ 1
}

export interface GradientConfig {
  gradientType: GradientKind;
  angle: number; // 度。线性：0 = 左→右，顺时针递增；其余类型为起始方向的旋转量
  stops: GradientStopConfig[];
}

// 填充/描边统一用「纯色 or 渐变」二选一
export type PaintConfig =
  | { kind: 'solid'; color: RGB }
  | { kind: 'gradient'; gradient: GradientConfig };

export interface ShadowConfig {
  color: RGB & { a: number };
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
}

export interface StyleConfig {
  fill: PaintConfig | null; // null = 不改填充
  cornerRadius: number | null;
  stroke: PaintConfig | null;
  strokeWeight: number | null;
  strokeAlign: 'INSIDE' | 'OUTSIDE' | 'CENTER' | null;
  shadow: ShadowConfig | null;
}

export const GRADIENT_KINDS: GradientKind[] = [
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
];

function clamp01(n: number): number {
  if (!isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// 绕单位空间中心 (0.5,0.5) 旋转 angle 度 → 2x3 仿射矩阵
// 推导：M = T(0.5,0.5) · R(θ) · T(-0.5,-0.5)
export function gradientTransform(angleDeg: number): Transform {
  const deg = Number(angleDeg) || 0;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [
    [cos, -sin, 0.5 - 0.5 * cos + 0.5 * sin],
    [sin, cos, 0.5 - 0.5 * sin - 0.5 * cos],
  ];
}

// 从矩阵反推角度（识别选中图层时用于回填 UI）
// m00 = cosθ，m10 = sinθ
export function angleFromTransform(t: Transform): number {
  const deg = (Math.atan2(t[1][0], t[0][0]) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360);
}

// 色标清洗：钳制位置、按位置排序、补足至少 2 个
export function normalizeStops(stops: GradientStopConfig[]): ColorStop[] {
  const list: ColorStop[] = (stops || [])
    .filter((s) => s && s.color)
    .map((s) => ({
      position: clamp01(Number(s.position) || 0),
      color: {
        r: clamp01(s.color.r),
        g: clamp01(s.color.g),
        b: clamp01(s.color.b),
        a: s.color.a == null ? 1 : clamp01(s.color.a),
      },
    }))
    .sort((a, b) => a.position - b.position);

  if (!list.length) {
    return [
      { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
      { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
    ];
  }
  if (list.length === 1) {
    const only = list[0];
    return [
      { position: 0, color: { ...only.color } },
      { position: 1, color: { ...only.color } },
    ];
  }
  return list;
}

export function buildGradientPaint(g: GradientConfig): GradientPaint {
  return {
    type: g.gradientType,
    gradientTransform: gradientTransform(g.angle),
    gradientStops: normalizeStops(g.stops),
  } as GradientPaint;
}

// 配置 → Figma Paint
export function paintFromConfig(cfg: PaintConfig): Paint {
  if (cfg.kind === 'gradient') return buildGradientPaint(cfg.gradient);
  return { type: 'SOLID', color: cfg.color } as SolidPaint;
}

// Figma Paint → 配置（识别选中图层用；图片/视频填充返回 null）
export function readPaintConfig(p: Paint | undefined | null): PaintConfig | null {
  if (!p) return null;
  if (p.type === 'SOLID') return { kind: 'solid', color: { ...p.color } };
  if (
    p.type === 'GRADIENT_LINEAR' ||
    p.type === 'GRADIENT_RADIAL' ||
    p.type === 'GRADIENT_ANGULAR' ||
    p.type === 'GRADIENT_DIAMOND'
  ) {
    return {
      kind: 'gradient',
      gradient: {
        gradientType: p.type,
        angle: angleFromTransform(p.gradientTransform),
        stops: p.gradientStops.map((s) => ({
          color: { ...s.color },
          position: s.position,
        })),
      },
    };
  }
  return null;
}

export function applyStyles(nodes: SceneNode[], cfg: StyleConfig): void {
  for (const node of nodes) {
    // 填充（纯色或渐变）
    if (cfg.fill && 'fills' in node) {
      node.fills = [paintFromConfig(cfg.fill)];
    }

    // 圆角（矩形/画框才有）
    if (cfg.cornerRadius != null && 'cornerRadius' in node) {
      (node as any).cornerRadius = cfg.cornerRadius;
    }

    // 描边（纯色或渐变）
    if (cfg.stroke && cfg.strokeWeight != null && 'strokes' in node) {
      node.strokes = [paintFromConfig(cfg.stroke)];
      node.strokeWeight = cfg.strokeWeight;
      if (cfg.strokeAlign && 'strokeAlign' in node) {
        (node as any).strokeAlign = cfg.strokeAlign;
      }
    }

    // 阴影（追加一条 DROP_SHADOW）
    if (cfg.shadow && 'effects' in node) {
      const shadow = {
        type: 'DROP_SHADOW',
        color: cfg.shadow.color,
        offset: { x: cfg.shadow.offsetX, y: cfg.shadow.offsetY },
        radius: cfg.shadow.blur,
        spread: cfg.shadow.spread,
        visible: true,
        blendMode: 'NORMAL',
      } as Effect;
      node.effects = [...(node.effects as Effect[]), shadow];
    }
  }
}
