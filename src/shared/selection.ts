// 共用选区层：三个功能都从这里拿节点，避免重复造轮子
// 注：SceneNode / TextNode 等为 @figma/plugin-typings 的全局类型，无需 import

export function getSelectedNodes(): SceneNode[] {
  return Array.from(figma.currentPage.selection) as SceneNode[];
}

// 取选区内的文本图层。
// 关键：选中的若是分组 / 画框 / 组件，必须递归收集内部的文本；
// 否则用户「选中整个分组再点应用」会拿到空数组，表现为按钮毫无反应。
export function getTextNodes(nodes: SceneNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const n of nodes) {
    if (n.type === 'TEXT') {
      out.push(n);
      continue;
    }
    if ('findAllWithCriteria' in n) {
      try {
        const inner = (n as ChildrenMixin).findAllWithCriteria({ types: ['TEXT'] }) as TextNode[];
        out.push(...inner);
      } catch {
        // 个别节点类型不支持递归查找，忽略即可
      }
    }
  }
  return out;
}

// 支持 fills 的节点：矩形/画框/图片填充/矢量等，批量样式统一套用
export function getStyleableNodes(nodes: SceneNode[]): SceneNode[] {
  return nodes.filter((n) => 'fills' in n);
}
