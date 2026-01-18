# Grid Panes

Display multiple notes in a customizable grid layout for easy comparison and reference.

## Features

- **Grid Layout**: Arrange notes in a configurable grid (1×1 to 5×5)
- **Multiple Layouts**: Save multiple layout schemes per `.gridpanes` file
- **Preview & Edit**: Click any cell to edit in place; preview mode by default
- **Auto-sync**: Grid updates automatically when linked notes are modified, renamed, or deleted

## Usage

1. Click the grid icon in the ribbon or run the command `Grid Panes: 创建新网格`
2. Click any empty cell to select a note
3. Right-click cells for more options (swap note, clear, open in new tab)
4. Use the `+` buttons to add rows/columns

## Commands

| Command | Description |
|---------|-------------|
| 创建新网格 | Create a new grid file |
| 在顶部添加一行 | Add row at top |
| 在底部添加一行 | Add row at bottom |
| 在左侧添加一列 | Add column at left |
| 在右侧添加一列 | Add column at right |
| 删除最后一行 | Remove last row |
| 删除最后一列 | Remove last column |

## Installation

### From Obsidian

1. Open Settings → Community plugins
2. Search for "Grid Panes"
3. Install and enable

### Manual

Copy `main.js`, `styles.css`, and `manifest.json` to your vault's `.obsidian/plugins/obsidian-grid-panes/` folder.

## Author

[Kai Chen](https://thekaiway.com)
