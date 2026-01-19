// Grid Panes 类型定义

export const GRID_PANES_VIEW_TYPE = 'grid-panes-view';

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
	layout: GridLayout;
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

export function createDefaultGridData(): GridPanesData {
	return {
		version: 3,
		layout: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
	};
}

export function migrateGridPanesData(data: unknown): GridPanesData {
	if (!data || typeof data !== 'object') {
		return createDefaultGridData();
	}

	const obj = data as Record<string, unknown>;

	// 迁移 v1 格式到 v2
	if (!obj.layouts && obj.rows !== undefined && obj.cols !== undefined) {
		const layout: GridLayout = {
			rows: obj.rows as number,
			cols: obj.cols as number,
			cells: (obj.cells as GridCell[]) || [],
		};
		return {
			version: 3,
			layout,
		};
	}

	// 迁移 v2 布局记录到 v3
	if (obj.layouts && obj.currentLayout) {
		const layouts = obj.layouts as Record<string, GridLayout>;
		const current = obj.currentLayout as string;
		const layout = layouts?.[current] ?? Object.values(layouts ?? {})[0];
		return {
			version: 3,
			layout: layout ? JSON.parse(JSON.stringify(layout)) : JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
		};
	}

	if (obj.layout && typeof obj.layout === 'object') {
		return {
			version: 3,
			layout: obj.layout as GridLayout,
		};
	}

	return createDefaultGridData();
}

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 5;
