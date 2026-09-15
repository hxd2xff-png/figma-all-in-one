# FIGMA工具箱 · figma-all-in-one

一个包含字体混排、批量样式、斜切和导出压缩的 Figma 插件。适合中英文排版、批量视觉调整和设计资源导出。

## 功能

| 功能 | 能力 |
| --- | --- |
| 字体混排 | 分别设置中文和英文字体、字号、颜色；保存、更新、导入和导出预设 |
| 字号识别 | 汇总选中文本中的中英字号；一致时显示数值，不一致时显示混合字号 |
| 批量样式 | 填充、描边、圆角、阴影；支持纯色及线性、径向、角度、菱形渐变 |
| 斜切 | X/Y 轴斜切、快捷角度、实时预览；保留旋转并支持组合递归处理 |
| 导出压缩 | 按图层名称中的 `/` 建立目录，多目标打包 ZIP，JPG/WebP 可调质量 |

字体混排在启动时读取设备字体列表，预加载已保存方案所需字体，并复用加载结果。应用时并行加载目标字体，先整体替换再分段设置，避免等待旧字体。设备全部字体文件不会被一次性预加载。

## 安装

1. 下载仓库 ZIP 并解压，或者克隆仓库。
2. 在 Figma 桌面端打开插件开发菜单，选择“从 manifest 导入插件”（Import plugin from manifest）。
3. 选择根目录的 `manifest.json`，运行 **FIGMA工具箱**。

仓库包含 `dist/main.js` 和 `dist/ui.html`，直接安装不需要 Node.js。

详细操作见 [使用说明](docs/USER_GUIDE.md)。

## 开发

安装 Node.js 与 npm 后运行：

```sh
npm ci
npm run check
npm run watch
```

- `npm run build`：生成 `dist/main.js` 和 `dist/ui.html`。
- `npm run check`：TypeScript 检查、构建、产物验证及斜切、导出路径、渐变、字体混排测试。
- `npm run watch`：监听源文件变化并重新构建；Figma 中重新运行插件加载新版本。

技术栈为 TypeScript + esbuild，无运行时 npm 依赖。

```text
src/main.ts                 插件消息路由
src/features/               四项功能实现
src/shared/selection.ts     图层选择与文本收集
src/ui/ui.html              插件界面
scripts/                    构建验证与回归测试
manifest.json               Figma 插件入口
```

## 分享与限制

分享本地安装版本时，提供 `manifest.json` 和完整 `dist/`，保持相对路径。预设通过插件内导出的 JSON 单独分享；字体文件不随插件提供，对方需要在设备或 Figma 中拥有对应字体。

已选预设会阻止自动识别覆盖表单。需要查看选中文本的实际属性时，在下拉列表再次点击“当前”方案取消选择。

本仓库为开发插件分发方式，不代表已发布到 Figma 社区。真实字体可用性、加载时间及部分布局行为仍需在 Figma 中验证。

## 参考

字体混排应用顺序参考 [Ashung/MixFonts](https://github.com/Ashung/mixfonts-figma) 的公开实现思路；API 行为参考 [Figma Working with Text](https://developers.figma.com/docs/plugins/working-with-text/)。
