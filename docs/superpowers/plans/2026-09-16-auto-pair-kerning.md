# Automatic Pair Kerning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a rule-based automatic Latin character-pair spacing feature for selected Figma text nodes.

**Architecture:** A pure feature module exposes pair rules and applies range letter spacing. The main message router invokes it for selected text nodes and reports counts. The UI adds one action button and status handling.

**Tech Stack:** TypeScript, Figma Plugin API, existing HTML UI.

## Global Constraints

- Do not promise Photoshop-compatible optical kerning.
- Skip CJK and unsupported mixed ranges.
- Keep repeated application idempotent.

### Task 1: Rule engine
**Files:** Create `src/features/auto-kerning.ts`; create `scripts/test-auto-kerning.js`.
- [ ] Add exported `PAIR_ADJUSTMENTS`, `getPairAdjustment`, and `applyAutoKerning` using range letter spacing in em-percent units.
- [ ] Test matching, unsupported pairs, and empty text with a mock TextNode.
- [ ] Run the focused test and commit.

### Task 2: Main-thread integration
**Files:** Modify `src/main.ts`.
- [ ] Route `auto-kerning`, apply to selected text nodes, and notify/post result counts.
- [ ] Catch node-level failures and preserve other nodes.
- [ ] Run TypeScript check and commit.

### Task 3: UI action
**Files:** Inspect and modify the existing UI source containing feature controls.
- [ ] Add “自动字符对微调” button and post `auto-kerning`.
- [ ] Display completion feedback using existing message conventions.
- [ ] Build and run full check; commit.
