// 功能④ 导出压缩：批量导出选中节点，支持倍数 / PNG-JPG-WebP
// SceneNode / BaseNode 为 Figma 全局类型
//
// 导出路径规则 —— 与 Figma 官方「用 / 新建文件夹」规则一致：
//   1) 图层名里的 "/" 表示新建一层文件夹
//      例：图层名 "1555/HR面霜-11主图-1"  →  1555/HR面霜-11主图-1.png
//   2) 目标图层的「祖先图层名」依次作为更外层目录（不含 PAGE / DOCUMENT）
//      例：父级画框名 "0911"，图层名 "1555/HR面霜-11主图-1"
//          →  0911/1555/HR面霜-11主图-1.jpg
//
// 注：Figma 官方 API 对 JPG/WebP 没有 quality 参数，
//     质量压缩在 UI 侧用 canvas 重编码实现（见 ui.html）

export interface ExportConfig {
  format: 'PNG' | 'JPG' | 'WEBP';
  scale: number; // 0.5 ~ 4
  quality: number; // 0.1 ~ 1，仅 JPG/WebP 生效
}

export interface ExportItem {
  path: string; // 不含扩展名的相对路径，如 "0911/1555/HR面霜-11主图-1"
  bytes: Uint8Array;
}

export interface ExportResult {
  ok: number; // 成功导出并回传的文件数
  failed: string[]; // 导出失败的节点名（回传 UI 提示，避免静默丢节点）
}

// Windows / macOS 不允许出现在文件名里的字符（"/" 是目录分隔符，单独处理）
// 空格与连字符都是合法文件名字符（如「李佳琦-气垫800」「HR面霜-11主图-1」），绝不能清掉。
// 控制字符一律写成 \x00 转义形式，不要嵌裸控制字节到源码里（易被工具链/编码转换破坏）。
const ILLEGAL_CHARS = /[\\:*?"<>|\x00-\x1f]/g;

function cleanSegment(raw: string): string {
  return raw
    .replace(ILLEGAL_CHARS, '')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
}

// 把一个图层名按 "/" 拆成多级目录（兼容全角斜杠 ／）
export function splitName(name: string): string[] {
  return String(name == null ? '' : name)
    .replace(/／/g, '/')
    .split('/')
    .map(cleanSegment)
    .filter(Boolean);
}

// 计算某个节点的导出路径（分段数组，最终 join('/')）
export function buildExportPath(node: SceneNode): string[] {
  const segs: string[] = [];

  // 祖先链：从最外层往内排，跳过 PAGE / DOCUMENT
  const chain: BaseNode[] = [];
  let p = node.parent as BaseNode | null;
  while (p && p.type !== 'PAGE' && p.type !== 'DOCUMENT') {
    chain.unshift(p);
    p = p.parent as BaseNode | null;
  }
  for (const a of chain) segs.push(...splitName(a.name));

  // 自身图层名
  segs.push(...splitName(node.name));

  if (!segs.length) segs.push('export');
  return segs;
}

export async function exportNodes(
  nodes: SceneNode[],
  cfg: ExportConfig,
  onEach: (item: ExportItem, cfg: ExportConfig) => void,
): Promise<ExportResult> {
  const used = new Map<string, number>();
  const failed: string[] = [];
  let ok = 0;

  for (const node of nodes) {
    let bytes: Uint8Array;
    try {
      bytes = await (node as any).exportAsync({
        format: cfg.format,
        constraint: { type: 'SCALE', value: cfg.scale },
      });
    } catch (e) {
      console.warn('export failed:', node.name, e);
      // 记录失败节点名而不是 continue 了事：否则用户只看到数量变少，无从判断哪个节点出问题
      failed.push((node && node.name) || '(未命名)');
      continue;
    }

    const segs = buildExportPath(node);
    const base = segs.join('/');
    const seen = used.get(base) || 0;
    used.set(base, seen + 1);

    // 同名节点自动追加 -2 / -3，避免互相覆盖
    let path = base;
    if (seen > 0) {
      segs[segs.length - 1] = segs[segs.length - 1] + '-' + (seen + 1);
      path = segs.join('/');
    }

    onEach({ path, bytes }, cfg);
    ok++;
  }

  return { ok, failed };
}
