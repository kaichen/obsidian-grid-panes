// Grid Panes 类型定义

export const GRID_PANES_VIEW_TYPE = 'grid-panes-view';
export const GRID_PANES_EXTENSION = 'gridpanes';

export type CellMode = 'preview' | 'edit';

export interface GridCell {
	row: number;
	col: number;
	notePath: string | null;
	mode: CellMode;
}

export interface GridLayout {
	rows: number;
	cols: number;
	cells: GridCell[];
}

export interface GridPanesData {
	version: number;
	currentLayout: string;
	layouts: Record<string, GridLayout>;
}

export const DEFAULT_LAYOUT: GridLayout = {
	rows: 2,
	cols: 2,
	cells: [
		{ row: 0, col: 0, notePath: null, mode: 'preview' },
		{ row: 0, col: 1, notePath: null, mode: 'preview' },
		{ row: 1, col: 0, notePath: null, mode: 'preview' },
		{ row: 1, col: 1, notePath: null, mode: 'preview' },
	],
};

export const DEFAULT_GRID_DATA: GridPanesData = {
	version: 2,
	currentLayout: 'default',
	layouts: {
		default: { ...DEFAULT_LAYOUT },
	},
};

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 5;
