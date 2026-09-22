# 符号字体归属 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在字体混排中文、英文卡片右上角增加符号字体归属按钮，并让选择结果随字体混排应用到选中文本。

**Architecture:** UI 保存 `symbolFontSide` 配置并通过现有 `font-mixer` 消息发送；混排核心扩展字符分类规则，将符号按配置归入中文或英文字体。默认保持当前规则，按钮只改变归属，最终由“应用字体混排”统一落地。

**Tech Stack:** TypeScript、原生 HTML/CSS/DOM、esbuild、Figma Plugin API。

## Global Constraints

- 不改变现有中文/英文字体、字号、颜色和方案存储行为。
- 默认符号规则保持兼容：全角/CJK 标点归中文，其他符号归英文。
- 按钮点击后需明确显示当前选中状态，并支持键盘操作。

---

### Task 1: 扩展字体混排核心配置与字符分类

**Files:**
- Modify: `src/features/font-mixer.ts`
- Test: `scripts/test-font-mixer.js`

**Interfaces:**
- Consumes: `FontMixConfig.symbolFontSide?: 'cn' | 'en'`
- Produces: `applyFontMix` 按配置将符号区间应用到中文或英文字体。

- [ ] **Step 1: 为配置和测试增加符号归属场景**
- [ ] **Step 2: 运行 `npm run test:font-mixer` 验证新增断言先失败**
- [ ] **Step 3: 实现默认兼容的符号分类和配置分流**
- [ ] **Step 4: 运行测试验证所有字体混排回归通过**

### Task 2: 增加 UI 按钮与配置发送逻辑

**Files:**
- Modify: `src/ui/ui.html`

**Interfaces:**
- Consumes: `fontSel.cn`、`fontSel.en` 和按钮选中状态。
- Produces: `FontMixConfig.symbolFontSide` 随 `font-mixer` 消息发送。

- [ ] **Step 1: 在中文/英文卡片头部增加两个按钮**
- [ ] **Step 2: 增加按钮样式、选中态和无障碍属性**
- [ ] **Step 3: 增加互斥点击逻辑和 `font-apply` 配置字段**
- [ ] **Step 4: 运行构建和 UI 检查脚本**

### Task 3: 完成验证

**Files:**
- Test: `scripts/test-font-mixer.js`
- Test: `scripts/ui-check.js`

- [ ] **Step 1: 运行 `npm test` 或项目现有测试命令**
- [ ] **Step 2: 运行 `node scripts/ui-check.js`**
- [ ] **Step 3: 检查工作区 diff，确认只包含本需求相关改动**
