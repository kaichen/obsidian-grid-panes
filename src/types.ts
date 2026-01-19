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

function isGridCell(value: unknown): value is GridCell {
	if (!value || typeof value !== 'object') return false;
	const cell = value as Record<string, unknown>;
	const rowOk = typeof cell.row === 'number';
	const colOk = typeof cell.col === 'number';
	const notePathOk = cell.notePath === null || typeof cell.notePath === 'string';
	const modeOk = cell.mode === 'preview' || cell.mode === 'edit';
	return rowOk && colOk && notePathOk && modeOk;
}

function parseLayout(value: unknown): GridLayout | null {
	if (!value || typeof value !== 'object') return null;
	const obj = value as Record<string, unknown>;
	const rows = typeof obj.rows === 'number' ? obj.rows : null;
	const cols = typeof obj.cols === 'number' ? obj.cols : null;
	if (rows === null || cols === null) return null;
	const cells = Array.isArray(obj.cells) ? obj.cells.filter(isGridCell) : [];
	return { rows, cols, cells };
}

function cloneLayout(layout: GridLayout): GridLayout {
	return {
		rows: layout.rows,
		cols: layout.cols,
		cells: layout.cells.map((cell) => ({ ...cell })),
	};
}

export function cloneGridPanesData(data: GridPanesData): GridPanesData {
	return {
		version: data.version,
		layout: cloneLayout(data.layout),
	};
}

export function createDefaultGridData(): GridPanesData {
	return {
		version: 3,
		layout: cloneLayout(DEFAULT_LAYOUT),
	};
}

export function migrateGridPanesData(data: unknown): GridPanesData {
	if (!data || typeof data !== 'object') {
		return createDefaultGridData();
	}

	const obj = data as Record<string, unknown>;

	// 迁移 v1 格式到 v2
	if (!obj.layouts && obj.rows !== undefined && obj.cols !== undefined) {
		const layout = parseLayout({ rows: obj.rows, cols: obj.cols, cells: obj.cells });
		return {
			version: 3,
			layout: layout ? cloneLayout(layout) : cloneLayout(DEFAULT_LAYOUT),
		};
	}

	// 迁移 v2 布局记录到 v3
	if (obj.layouts && obj.currentLayout) {
		const layouts = obj.layouts as Record<string, unknown>;
		const current = typeof obj.currentLayout === 'string' ? obj.currentLayout : '';
		const layout = parseLayout(layouts?.[current]) ?? parseLayout(Object.values(layouts ?? {})[0]);
		return {
			version: 3,
			layout: layout ? cloneLayout(layout) : cloneLayout(DEFAULT_LAYOUT),
		};
	}

	if (obj.layout && typeof obj.layout === 'object') {
		const layout = parseLayout(obj.layout);
		if (layout) {
			return {
				version: 3,
				layout: cloneLayout(layout),
			};
		}
	}

	return createDefaultGridData();
}

export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 5;
