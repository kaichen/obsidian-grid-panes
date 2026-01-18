# Grid Panes — Obsidian Plugin

**Generated:** 2026-01-18 | **Commit:** dc2fa22 | **Branch:** master

## Overview

Desktop-only Obsidian plugin: displays multiple notes in customizable grid layout (`.gridpanes` files). Custom view type with preview/edit modes per cell.

## Structure

```
obsidian-grid-panes/
├── src/
│   ├── main.ts            # Plugin entry, commands, ribbon icon
│   ├── GridPanesView.ts   # Core view (512 lines) - rendering, layout mgmt
│   ├── types.ts           # Data types, constants, defaults
│   └── FileSuggestModal.ts # File picker modal
├── styles.css             # All plugin CSS (grid, cells, buttons)
├── manifest.json          # Plugin metadata (id: grid-panes)
└── esbuild.config.mjs     # Bundler config
```

## Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Add command | `src/main.ts` | Use `checkCallback` pattern for grid-context commands |
| Grid rendering | `src/GridPanesView.ts:render()` | CSS Grid layout, dynamic rows/cols |
| Cell operations | `src/GridPanesView.ts:setCell()` | Updates layout.cells array |
| Data persistence | `src/GridPanesView.ts` extends `TextFileView` | JSON ↔ `.gridpanes` file |
| Layout switching | `src/GridPanesView.ts:switchLayout()` | Multiple named layouts per file |
| Styling | `styles.css` | Uses Obsidian CSS vars |
| Data schema | `src/types.ts` | `GridPanesData`, `GridLayout`, `GridCell` |

## Code Map

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `GridPanesPlugin` | class | main.ts:5 | Plugin lifecycle, commands |
| `GridPanesView` | class | GridPanesView.ts:22 | Main view, extends TextFileView |
| `FileSuggestModal` | class | FileSuggestModal.ts:3 | Note picker |
| `GridPanesData` | interface | types.ts:21 | Root data structure (v2 format) |
| `GridLayout` | interface | types.ts:15 | Single layout: rows, cols, cells |
| `GridCell` | interface | types.ts:8 | Cell: row, col, notePath, mode |
| `GRID_PANES_VIEW_TYPE` | const | types.ts:3 | `'grid-panes-view'` |
| `GRID_PANES_EXTENSION` | const | types.ts:4 | `'gridpanes'` |

## Conventions

- **Chinese UI strings** — All user-facing text in Chinese (commands, modals, buttons)
- **Data version field** — `version: 2` in GridPanesData; migration handled in `migrateData()`
- **Cell modes** — `'preview' | 'edit'` per cell
- **Grid limits** — MIN_GRID_SIZE=1, MAX_GRID_SIZE=5
- **Layout storage** — Multiple layouts per file via `layouts: Record<string, GridLayout>`

## Anti-Patterns

- **DO NOT** add `isDesktopOnly: false` — uses APIs incompatible with mobile
- **DO NOT** modify cells array directly — use `setCell()` which calls `requestSave()`
- **DO NOT** forget `clearCellComponents()` — leaks Component instances
- **DO NOT** skip `migrateData()` — v1 format still exists in user files

## Commands

| ID | Name | Context |
|----|------|---------|
| `create-new-grid` | 创建新网格 | Global |
| `add-row-above` | 在顶部添加一行 | Grid view active |
| `add-row-below` | 在底部添加一行 | Grid view active |
| `add-column-left` | 在左侧添加一列 | Grid view active |
| `add-column-right` | 在右侧添加一列 | Grid view active |
| `remove-row` | 删除最后一行 | Grid view active |
| `remove-column` | 删除最后一列 | Grid view active |

## Dev Commands

```bash
npm install          # Install deps
npm run dev          # Watch mode (esbuild)
npm run build        # Production build (tsc check + esbuild)
npm run lint         # ESLint
```

## Notes

- **Large file**: `GridPanesView.ts` at 512 lines — candidate for splitting if more features added
- **Markdown rendering**: Uses `MarkdownRenderer.render()` with Component for cleanup
- **Cell components tracked**: `cellComponents: Map<string, Component>` for proper unloading
- **File extension registered**: `.gridpanes` files auto-open in GridPanesView
