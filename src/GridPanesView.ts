import {
	ItemView,
	WorkspaceLeaf,
	TFile,
	Menu,
	MarkdownView,
	MarkdownRenderer,
	Component,
	Notice,
} from 'obsidian';
import {
	GRID_PANES_VIEW_TYPE,
	GridPanesData,
	GridCell,
	GridLayout,
	DEFAULT_LAYOUT,
	MIN_GRID_SIZE,
	MAX_GRID_SIZE,
	CellMode,
	createDefaultGridData,
	migrateGridPanesData,
	cloneGridPanesData,
} from './types';
import { FileSuggestModal } from './FileSuggestModal';
import { t } from './i18n';
import type GridPanesPlugin from './main';

type SwapDirection = 'horizontal' | 'vertical';

type SwapTarget = {
	fromRow: number;
	fromCol: number;
	toRow: number;
	toCol: number;
	direction: SwapDirection;
	centerX: number;
	centerY: number;
};

type SetCellOptions = {
	render?: boolean;
	save?: boolean;
};

export class GridPanesView extends ItemView {
	private plugin: GridPanesPlugin;
	private gridData: GridPanesData;
	private gridContainer: HTMLElement | null = null;
	private editorLeaf: WorkspaceLeaf | null = null;
	private editorView: MarkdownView | null = null;
	private previewComponents: Map<string, Component> = new Map();
	private previewRenderIds: Map<string, number> = new Map();
	private activeCellKey: string | null = null;
	private pendingFocusKey: string | null = null;
	private renderId = 0;
	private undoData: { data: GridPanesData; timestamp: number } | null = null;
	private undoTimeout: number | null = null;
	private rowHideTimers: Map<number, number> = new Map();
	private colHideTimers: Map<number, number> = new Map();
	private visibleRows: Set<number> = new Set();
	private visibleCols: Set<number> = new Set();
	private swapButtonEl: HTMLButtonElement | null = null;
	private swapTarget: SwapTarget | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: GridPanesPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.gridData = createDefaultGridData();
	}

	getViewType(): string {
		return GRID_PANES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t(this.app, 'view.displayText');
	}

	getIcon(): string {
		return 'layout-grid';
	}

	clear(): void {
		this.resetHoverState();
		this.disposeEditorLeaf();
		this.disposePreviewComponents();
		this.activeCellKey = null;
		this.pendingFocusKey = null;
		this.gridData = createDefaultGridData();
		this.requestSave();
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('grid-panes-container');

		this.gridContainer = container.createDiv({ cls: 'grid-panes-grid' });
		this.registerSwapEvents();

		this.gridData = migrateGridPanesData(this.plugin.getGridData());

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (!leaf || !this.editorLeaf) return;
				if (leaf !== this.editorLeaf) return;
				this.app.workspace.setActiveLeaf(this.leaf, { focus: false });
			})
		);

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (!(file instanceof TFile)) return;
			const updated = this.clearNotePaths(file.path);
			if (updated) {
				this.requestSave();
				this.render();
			}
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (!(file instanceof TFile)) return;
			const updated = this.updateNotePaths(oldPath, file.path);
			if (updated) {
				this.requestSave();
				this.render();
			}
		}));
		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (!(file instanceof TFile)) return;
			if (!this.isFileInLayout(file.path)) return;
			if (this.isActiveFile(file.path)) return;
			this.render();
		}));

		this.render();
	}

	async onClose(): Promise<void> {
		this.resetHoverState();
		this.disposeEditorLeaf();
		this.disposePreviewComponents();
		this.gridContainer = null;
	}

	private getCurrentLayout(): GridLayout {
		return this.gridData.layout || DEFAULT_LAYOUT;
	}

	private requestSave(): void {
		this.plugin.setGridData(this.gridData);
	}

	private showRow(row: number): void {
		if (this.rowHideTimers.has(row)) {
			window.clearTimeout(this.rowHideTimers.get(row));
			this.rowHideTimers.delete(row);
		}
		this.visibleRows.add(row);
		const btn = this.gridContainer?.querySelector(`.grid-panes-row-del[data-row="${row}"]`);
		if (btn) btn.addClass('visible');
	}

	private hideRowDelayed(row: number): void {
		if (this.rowHideTimers.has(row)) return;
		const timerId = window.setTimeout(() => {
			this.visibleRows.delete(row);
			const btn = this.gridContainer?.querySelector(`.grid-panes-row-del[data-row="${row}"]`);
			if (btn) btn.removeClass('visible');
			this.rowHideTimers.delete(row);
		}, 1000);
		this.rowHideTimers.set(row, timerId);
	}

	private showCol(col: number): void {
		if (this.colHideTimers.has(col)) {
			window.clearTimeout(this.colHideTimers.get(col));
			this.colHideTimers.delete(col);
		}
		this.visibleCols.add(col);
		const btn = this.gridContainer?.querySelector(`.grid-panes-col-del[data-col="${col}"]`);
		if (btn) btn.addClass('visible');
	}

	private hideColDelayed(col: number): void {
		if (this.colHideTimers.has(col)) return;
		const timerId = window.setTimeout(() => {
			this.visibleCols.delete(col);
			const btn = this.gridContainer?.querySelector(`.grid-panes-col-del[data-col="${col}"]`);
			if (btn) btn.removeClass('visible');
			this.colHideTimers.delete(col);
		}, 1000);
		this.colHideTimers.set(col, timerId);
	}

	private resetHoverState(): void {
		for (const timer of this.rowHideTimers.values()) window.clearTimeout(timer);
		this.rowHideTimers.clear();
		for (const timer of this.colHideTimers.values()) window.clearTimeout(timer);
		this.colHideTimers.clear();
		this.visibleRows.clear();
		this.visibleCols.clear();
		this.hideSwapButton();
	}



	private render(): void {
		const gridContainer = this.gridContainer;
		if (!gridContainer) return;
		const renderId = ++this.renderId;
		gridContainer.empty();
		this.swapButtonEl = null;
		this.swapTarget = null;

		const layout = this.getCurrentLayout();
		this.ensureActiveCellValid(layout);
		this.pruneUnusedPreviews(layout);
		const { rows, cols } = layout;

		// 设置 CSS Grid 布局
		gridContainer.setCssProps({
			'grid-template-rows': `repeat(${rows}, 1fr)`,
			'grid-template-columns': `repeat(${cols}, 1fr)`,
		});

		// 渲染删除控制按钮
		if (rows > MIN_GRID_SIZE) {
			for (let r = 0; r < rows; r++) {
				const btn = gridContainer.createDiv({
					cls: 'grid-panes-del-btn grid-panes-row-del',
					attr: { 'data-row': String(r), 'aria-label': t(this.app, 'button.deleteRowAria') },
				});
				btn.createSpan({ text: '×' });
				// 定位到该行的第一列，通过 CSS 调整位置
				btn.setCssProps({
					'grid-row': String(r + 1),
					'grid-column': '1',
				});
				if (this.visibleRows.has(r)) btn.addClass('visible');
				btn.addEventListener('mouseenter', () => this.showRow(r));
				btn.addEventListener('mouseleave', () => this.hideRowDelayed(r));
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.removeRowAt(r);
				});
			}
		}

		if (cols > MIN_GRID_SIZE) {
			for (let c = 0; c < cols; c++) {
				const btn = gridContainer.createDiv({
					cls: 'grid-panes-del-btn grid-panes-col-del',
					attr: { 'data-col': String(c), 'aria-label': t(this.app, 'button.deleteColumnAria') },
				});
				btn.createSpan({ text: '×' });
				// 定位到该列的第一行
				btn.setCssProps({
					'grid-row': '1',
					'grid-column': String(c + 1),
				});
				if (this.visibleCols.has(c)) btn.addClass('visible');
				btn.addEventListener('mouseenter', () => this.showCol(c));
				btn.addEventListener('mouseleave', () => this.hideColDelayed(c));
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					this.removeColumnAt(c);
				});
			}
		}

		// 渲染单元格
		for (let row = 0; row < rows; row++) {
			for (let col = 0; col < cols; col++) {
				this.renderCell(row, col, renderId, gridContainer);
			}
		}

		// 渲染增加行/列的按钮
		this.renderAddButtons(gridContainer);
		this.ensureSwapButton(gridContainer);
	}

	private renderCell(row: number, col: number, renderId: number, gridContainer: HTMLElement): void {
		const cell = this.getCell(row, col);
		const cellEl = gridContainer.createDiv({ cls: 'grid-panes-cell' });
		cellEl.setAttribute('data-row', String(row));
		cellEl.setAttribute('data-col', String(col));
		cellEl.setCssProps({
			'grid-row': String(row + 1),
			'grid-column': String(col + 1),
		});
		cellEl.addEventListener('mouseenter', () => {
			this.showRow(row);
			this.showCol(col);
		});
		cellEl.addEventListener('mouseleave', () => {
			this.hideRowDelayed(row);
			this.hideColDelayed(col);
		});
		const key = this.getCellKey(row, col);
		if (key === this.activeCellKey) {
			cellEl.addClass('grid-panes-cell-active');
		}

		// 右键菜单
		cellEl.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			this.showCellContextMenu(e, row, col);
		});
		cellEl.addEventListener('click', (e) => {
			if (e.button !== 0) return;
			if (!cell?.notePath) return;
			this.activateCell(row, col);
		});

		if (cell?.notePath) {
			void this.renderNoteContent(cellEl, cell, renderId);
		} else {
			this.renderEmptyCell(cellEl, row, col);
		}
	}

	private getCell(row: number, col: number): GridCell | undefined {
		const layout = this.getCurrentLayout();
		return layout.cells.find((c) => c.row === row && c.col === col);
	}

	private setCell(
		row: number,
		col: number,
		notePath: string | null,
		mode: CellMode = 'preview',
		options?: SetCellOptions
	): void {
		const layout = this.getCurrentLayout();
		const existingIndex = layout.cells.findIndex((c) => c.row === row && c.col === col);
		const newCell: GridCell = { row, col, notePath, mode };

		if (existingIndex >= 0) {
			layout.cells[existingIndex] = newCell;
		} else {
			layout.cells.push(newCell);
		}

		if (options?.save !== false) {
			this.requestSave();
		}
		if (options?.render !== false) {
			this.render();
		}
	}

	private async renderNoteContent(cellEl: HTMLElement, cell: GridCell, renderId: number): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(cell.notePath!);
		if (!(file instanceof TFile)) {
			const key = this.getCellKey(cell.row, cell.col);
			this.clearPreviewComponent(key);
			if (this.activeCellKey === key) {
				this.activeCellKey = null;
				this.pendingFocusKey = null;
				this.detachEditorView();
			}
			cellEl.createDiv({ cls: 'grid-panes-error', text: t(this.app, 'cell.fileNotFound') });
			return;
		}

		const key = this.getCellKey(cell.row, cell.col);
		const isActive = key === this.activeCellKey;

		// 渲染单元格标题栏
		const headerEl = cellEl.createDiv({ cls: 'grid-panes-cell-header' });
		headerEl.createSpan({ cls: 'grid-panes-cell-title', text: file.basename });

		if (isActive) {
			headerEl.createSpan({ cls: 'grid-panes-cell-status', text: t(this.app, 'cell.editing') });
		}

		// 内容区 - 预览渲染或嵌入编辑器
		const contentEl = cellEl.createDiv({ cls: 'grid-panes-cell-content' });
		if (isActive) {
			await this.attachEditorView(cell, file, contentEl, renderId);
		} else {
			await this.renderNotePreview(cell, file, contentEl, renderId);
		}
	}

	private renderEmptyCell(cellEl: HTMLElement, row: number, col: number): void {
		const placeholder = cellEl.createDiv({ cls: 'grid-panes-empty' });
		placeholder.createSpan({ text: t(this.app, 'cell.emptyPlaceholder') });

		placeholder.addEventListener('click', () => {
			this.selectNoteForCell(row, col);
		});
	}

	private selectNoteForCell(row: number, col: number): void {
		new FileSuggestModal(this.app, (file) => {
			this.activeCellKey = this.getCellKey(row, col);
			this.setCell(row, col, file.path, 'preview');
		}).open();
	}

	selectNoteForActiveCell(): void {
		const active = this.parseCellKey(this.activeCellKey);
		if (!active) {
			new Notice(t(this.app, 'notice.noActiveCell'));
			return;
		}
		this.selectNoteForCell(active.row, active.col);
	}

	private showCellContextMenu(e: MouseEvent, row: number, col: number): void {
		const cell = this.getCell(row, col);
		const menu = new Menu();

		if (cell?.notePath) {
			menu.addItem((item) =>
				item
					.setTitle(t(this.app, 'menu.replaceNote'))
					.setIcon('file-edit')
					.onClick(() => this.selectNoteForCell(row, col))
			);

			menu.addItem((item) =>
				item
					.setTitle(t(this.app, 'menu.clear'))
					.setIcon('trash')
					.onClick(() => this.setCell(row, col, null))
			);

			menu.addItem((item) =>
				item
					.setTitle(t(this.app, 'menu.openNewTab'))
					.setIcon('external-link')
					.onClick(async () => {
						const file = this.app.vault.getAbstractFileByPath(cell.notePath!);
						if (file instanceof TFile) {
							await this.app.workspace.getLeaf('tab').openFile(file);
						}
					})
			);
		} else {
			menu.addItem((item) =>
				item
					.setTitle(t(this.app, 'menu.selectNote'))
					.setIcon('file-plus')
					.onClick(() => this.selectNoteForCell(row, col))
			);
		}

		menu.showAtMouseEvent(e);
	}

	private renderAddButtons(gridContainer: HTMLElement): void {
		const layout = this.getCurrentLayout();
		const { rows, cols } = layout;

		// 底部添加行按钮
		if (rows < MAX_GRID_SIZE) {
			const addRowBtn = gridContainer.createDiv({
			cls: 'grid-panes-add-btn grid-panes-add-row',
			attr: { 'aria-label': t(this.app, 'command.addRowBelow') },
		});
			addRowBtn.createSpan({ text: '+' });
			addRowBtn.style.gridRow = String(rows + 1);
			addRowBtn.style.gridColumn = `1 / ${cols + 1}`;
			addRowBtn.addEventListener('click', () => this.addRow());
		}

		// 右侧添加列按钮
		if (cols < MAX_GRID_SIZE) {
			const addColBtn = gridContainer.createDiv({
			cls: 'grid-panes-add-btn grid-panes-add-col',
			attr: { 'aria-label': t(this.app, 'command.addColumnRight') },
		});
			addColBtn.createSpan({ text: '+' });
			addColBtn.style.gridRow = `1 / ${rows + 1}`;
			addColBtn.style.gridColumn = String(cols + 1);
			addColBtn.addEventListener('click', () => this.addColumn());
		}
	}

	private registerSwapEvents(): void {
		if (!this.gridContainer) return;
		this.registerDomEvent(this.gridContainer, 'mousemove', (event: MouseEvent) => {
			this.updateSwapButton(event);
		});
		this.registerDomEvent(this.gridContainer, 'mouseleave', () => {
			this.hideSwapButton();
		});
	}

	private ensureSwapButton(gridContainer: HTMLElement | null = this.gridContainer): HTMLButtonElement | null {
		if (!gridContainer) return null;
		if (this.swapButtonEl && this.swapButtonEl.isConnected) return this.swapButtonEl;
		const btn = gridContainer.createEl('button', {
			cls: 'grid-panes-swap-btn',
			attr: { 'aria-label': t(this.app, 'button.swapAria'), type: 'button' },
		});
		btn.addEventListener('click', (event) => {
			event.stopPropagation();
			this.handleSwapClick();
		});
		this.swapButtonEl = btn;
		return btn;
	}

	private updateSwapButton(event: MouseEvent): void {
		if (!this.gridContainer) return;
		const eventTarget = event.target as HTMLElement | null;
		if (eventTarget && this.swapButtonEl && this.swapButtonEl.contains(eventTarget)) {
			return;
		}
		const target = this.getSwapTarget(event);
		if (!target) {
			this.hideSwapButton();
			return;
		}
		const fromCell = this.getCell(target.fromRow, target.fromCol);
		const toCell = this.getCell(target.toRow, target.toCol);
		if (!fromCell?.notePath || !toCell?.notePath) {
			this.hideSwapButton();
			return;
		}
		const btn = this.ensureSwapButton();
		if (!btn) return;
		btn.style.left = `${target.centerX}px`;
		btn.style.top = `${target.centerY}px`;
		const arrow = target.direction === 'horizontal' ? '↔' : '↕';
		if (btn.textContent !== arrow) {
			btn.textContent = arrow;
		}
		btn.addClass('visible');
		this.swapTarget = target;
	}

	private hideSwapButton(): void {
		if (this.swapButtonEl) {
			this.swapButtonEl.removeClass('visible');
		}
		this.swapTarget = null;
	}

	private handleSwapClick(): void {
		if (!this.swapTarget) return;
		const { fromRow, fromCol, toRow, toCol } = this.swapTarget;
		this.swapCells(fromRow, fromCol, toRow, toCol);
		this.hideSwapButton();
	}

	private getSwapTarget(event: MouseEvent): SwapTarget | null {
		const gridContainer = this.gridContainer;
		if (!gridContainer) return null;
		const layout = this.getCurrentLayout();
		if (layout.rows < 2 && layout.cols < 2) return null;

		const cells = Array.from(gridContainer.querySelectorAll<HTMLElement>('.grid-panes-cell'));
		if (cells.length === 0) return null;

		const containerRect = gridContainer.getBoundingClientRect();
		const mouseX = event.clientX;
		const mouseY = event.clientY;

		const cellRects = new Map<string, DOMRect>();
		for (const cell of cells) {
			const row = cell.dataset.row;
			const col = cell.dataset.col;
			if (row !== undefined && col !== undefined) {
				cellRects.set(`${row}-${col}`, cell.getBoundingClientRect());
			}
		}

		const style = window.getComputedStyle(gridContainer);
		const rawGap = Number.parseFloat(style.gap || '8');
		const gap = Number.isNaN(rawGap) ? 8 : rawGap;
		const hitZone = Math.max(gap, 16);

		let bestTarget: SwapTarget | null = null;
		let bestDist = Number.POSITIVE_INFINITY;

		for (let row = 0; row < layout.rows; row++) {
			for (let col = 0; col < layout.cols - 1; col++) {
				const leftRect = cellRects.get(`${row}-${col}`);
				const rightRect = cellRects.get(`${row}-${col + 1}`);
				if (!leftRect || !rightRect) continue;

				const gapLeft = leftRect.right;
				const gapRight = rightRect.left;
				const gapCenterX = (gapLeft + gapRight) / 2;
				const gapCenterY = (leftRect.top + leftRect.bottom) / 2;

				const inHorizontalZone = mouseX >= gapLeft - hitZone / 2 && mouseX <= gapRight + hitZone / 2;
				const inVerticalZone = mouseY >= leftRect.top && mouseY <= leftRect.bottom;

				if (inHorizontalZone && inVerticalZone) {
					const dist = Math.abs(mouseX - gapCenterX);
					if (dist < bestDist) {
						bestDist = dist;
						bestTarget = {
							fromRow: row,
							fromCol: col,
							toRow: row,
							toCol: col + 1,
							direction: 'horizontal',
							centerX: gapCenterX - containerRect.left,
							centerY: gapCenterY - containerRect.top,
						};
					}
				}
			}
		}

		for (let col = 0; col < layout.cols; col++) {
			for (let row = 0; row < layout.rows - 1; row++) {
				const topRect = cellRects.get(`${row}-${col}`);
				const bottomRect = cellRects.get(`${row + 1}-${col}`);
				if (!topRect || !bottomRect) continue;

				const gapTop = topRect.bottom;
				const gapBottom = bottomRect.top;
				const gapCenterX = (topRect.left + topRect.right) / 2;
				const gapCenterY = (gapTop + gapBottom) / 2;

				const inVerticalZone = mouseY >= gapTop - hitZone / 2 && mouseY <= gapBottom + hitZone / 2;
				const inHorizontalZone = mouseX >= topRect.left && mouseX <= topRect.right;

				if (inVerticalZone && inHorizontalZone) {
					const dist = Math.abs(mouseY - gapCenterY);
					if (dist < bestDist) {
						bestDist = dist;
						bestTarget = {
							fromRow: row,
							fromCol: col,
							toRow: row + 1,
							toCol: col,
							direction: 'vertical',
							centerX: gapCenterX - containerRect.left,
							centerY: gapCenterY - containerRect.top,
						};
					}
				}
			}
		}

		return bestTarget;
	}

	private swapCells(firstRow: number, firstCol: number, secondRow: number, secondCol: number): void {
		const firstCell = this.getCell(firstRow, firstCol);
		const secondCell = this.getCell(secondRow, secondCol);
		if (!firstCell?.notePath || !secondCell?.notePath) return;

		const keyA = this.getCellKey(firstRow, firstCol);
		const keyB = this.getCellKey(secondRow, secondCol);
		const activeKey = this.activeCellKey;

		this.setCell(firstRow, firstCol, secondCell.notePath, secondCell.mode, { save: false, render: false });
		this.setCell(secondRow, secondCol, firstCell.notePath, firstCell.mode, { save: false, render: false });

		if (activeKey === keyA) {
			this.activeCellKey = keyB;
			this.pendingFocusKey = keyB;
		} else if (activeKey === keyB) {
			this.activeCellKey = keyA;
			this.pendingFocusKey = keyA;
		}

		this.requestSave();
		this.render();
	}

	// 公共方法供命令使用
	addRow(): void {
		const layout = this.getCurrentLayout();
		if (layout.rows >= MAX_GRID_SIZE) return;
		layout.rows++;
		this.requestSave();
		this.render();
	}

	addRowTop(): void {
		const layout = this.getCurrentLayout();
		if (layout.rows >= MAX_GRID_SIZE) return;
		// 将所有现有单元格的行号 +1
		for (const cell of layout.cells) {
			cell.row++;
		}
		layout.rows++;
		this.requestSave();
		this.render();
	}

	addColumn(): void {
		const layout = this.getCurrentLayout();
		if (layout.cols >= MAX_GRID_SIZE) return;
		layout.cols++;
		this.requestSave();
		this.render();
	}

	addColumnLeft(): void {
		const layout = this.getCurrentLayout();
		if (layout.cols >= MAX_GRID_SIZE) return;
		// 将所有现有单元格的列号 +1
		for (const cell of layout.cells) {
			cell.col++;
		}
		layout.cols++;
		this.requestSave();
		this.render();
	}

	removeRow(): void {
		const layout = this.getCurrentLayout();
		this.removeRowAt(layout.rows - 1);
	}

	removeRowAt(row: number): void {
		const layout = this.getCurrentLayout();
		if (layout.rows <= MIN_GRID_SIZE) return;
		if (row < 0 || row >= layout.rows) return;
		
		this.saveUndoState();
		
		layout.rows--;
		layout.cells = layout.cells
			.filter((cell) => cell.row !== row)
			.map((cell) => (cell.row > row ? { ...cell, row: cell.row - 1 } : cell));
		this.adjustActiveCellKeyForRowDelete(row);
		this.disposePreviewComponents();
		this.requestSave();
		this.render();
		this.showUndoToast(t(this.app, 'toast.rowDeleted'));
	}

	removeColumn(): void {
		const layout = this.getCurrentLayout();
		this.removeColumnAt(layout.cols - 1);
	}

	removeColumnAt(col: number): void {
		const layout = this.getCurrentLayout();
		if (layout.cols <= MIN_GRID_SIZE) return;
		if (col < 0 || col >= layout.cols) return;

		this.saveUndoState();

		layout.cols--;
		layout.cells = layout.cells
			.filter((cell) => cell.col !== col)
			.map((cell) => (cell.col > col ? { ...cell, col: cell.col - 1 } : cell));
		this.adjustActiveCellKeyForColumnDelete(col);
		this.disposePreviewComponents();
		this.requestSave();
		this.render();
		this.showUndoToast(t(this.app, 'toast.columnDeleted'));
	}

	private getCellKey(row: number, col: number): string {
		return `${row}-${col}`;
	}

	private parseCellKey(key: string | null): { row: number; col: number } | null {
		if (!key) return null;
		const parts = key.split('-');
		if (parts.length !== 2) return null;
		const row = Number(parts[0]);
		const col = Number(parts[1]);
		if (Number.isNaN(row) || Number.isNaN(col)) return null;
		return { row, col };
	}

	private adjustActiveCellKeyForRowDelete(row: number): void {
		const active = this.parseCellKey(this.activeCellKey);
		if (!active) return;
		if (active.row === row) {
			this.activeCellKey = null;
			this.pendingFocusKey = null;
			this.detachEditorView();
			return;
		}
		if (active.row > row) {
			this.activeCellKey = this.getCellKey(active.row - 1, active.col);
			if (this.pendingFocusKey) {
				this.pendingFocusKey = this.activeCellKey;
			}
		}
	}

	private adjustActiveCellKeyForColumnDelete(col: number): void {
		const active = this.parseCellKey(this.activeCellKey);
		if (!active) return;
		if (active.col === col) {
			this.activeCellKey = null;
			this.pendingFocusKey = null;
			this.detachEditorView();
			return;
		}
		if (active.col > col) {
			this.activeCellKey = this.getCellKey(active.row, active.col - 1);
			if (this.pendingFocusKey) {
				this.pendingFocusKey = this.activeCellKey;
			}
		}
	}

	private activateCell(row: number, col: number): void {
		const key = this.getCellKey(row, col);
		if (this.activeCellKey === key) return;
		this.activeCellKey = key;
		this.pendingFocusKey = key;
		this.render();
	}

	private async renderNotePreview(
		cell: GridCell,
		file: TFile,
		contentEl: HTMLElement,
		renderId: number
	): Promise<void> {
		const key = this.getCellKey(cell.row, cell.col);
		this.clearPreviewComponent(key);
		const component = new Component();
		this.addChild(component);
		this.previewComponents.set(key, component);
		this.previewRenderIds.set(key, renderId);

		let markdown = '';
		try {
			markdown = await this.app.vault.cachedRead(file);
		} catch {
			if (this.previewRenderIds.get(key) === renderId) {
				this.clearPreviewComponent(key);
			}
			if (renderId !== this.renderId) return;
			contentEl.createDiv({ cls: 'grid-panes-error', text: t(this.app, 'cell.readFailed') });
			return;
		}

		if (renderId !== this.renderId) {
			if (this.previewRenderIds.get(key) === renderId) {
				this.clearPreviewComponent(key);
			}
			return;
		}

		contentEl.empty();
		const previewWrapper = contentEl.createDiv({ cls: 'grid-panes-markdown-view' });
		const previewEl = previewWrapper.createDiv({ cls: 'markdown-preview-view' });
		const sizer = previewEl.createDiv({ cls: 'markdown-preview-sizer' });
		try {
			await MarkdownRenderer.render(this.app, markdown, sizer, file.path, component);
		} catch {
			if (this.previewRenderIds.get(key) !== renderId) return;
			this.clearPreviewComponent(key);
			if (renderId !== this.renderId) return;
			contentEl.empty();
			contentEl.createDiv({ cls: 'grid-panes-error', text: t(this.app, 'cell.renderFailed') });
		}
	}

	private async attachEditorView(
		cell: GridCell,
		file: TFile,
		contentEl: HTMLElement,
		renderId: number
	): Promise<void> {
		const key = this.getCellKey(cell.row, cell.col);
		const view = await this.getOrCreateEditorView(file);
		if (renderId !== this.renderId) return;
		if (view.containerEl.parentElement !== contentEl) {
			contentEl.appendChild(view.containerEl);
		}
		if (this.pendingFocusKey === key) {
			this.pendingFocusKey = null;
			view.editor?.focus();
		}
	}

	private async getOrCreateEditorView(file: TFile): Promise<MarkdownView> {
		const desiredMode = 'source' as const;
		if (!this.editorLeaf || !this.editorView) {
			const leaf = this.app.workspace.createLeafBySplit(this.leaf, 'vertical', true);
			await leaf.setViewState({
				type: 'markdown',
				state: { file: file.path, mode: desiredMode },
				active: false,
			});
			if (leaf.loadIfDeferred) {
				await leaf.loadIfDeferred();
			}
			const view = leaf.view as MarkdownView;
			this.editorLeaf = leaf;
			this.editorView = view;
			this.lockEditorLeaf(leaf, view);
			this.hideEditorLeaf(leaf);
			view.containerEl.addClass('grid-panes-markdown-view');
			return view;
		}

		this.lockEditorLeaf(this.editorLeaf, this.editorView);
		const currentPath = this.editorView.file?.path;
		if (currentPath !== file.path || this.editorView.getMode() !== desiredMode) {
			await this.editorLeaf.openFile(file, { state: { mode: desiredMode }, active: false });
		}
		return this.editorView;
	}

	private lockEditorLeaf(leaf: WorkspaceLeaf, view: MarkdownView): void {
		// Prevent the hidden editor leaf from being reused by the file explorer.
		leaf.setPinned(true);
		view.navigation = false;
	}

	private hideEditorLeaf(leaf: WorkspaceLeaf): void {
		const parentEl = (leaf.parent as { containerEl?: HTMLElement } | null)?.containerEl;
		if (parentEl) {
			parentEl.addClass('grid-panes-hidden-tabs');
			return;
		}
		const leafEl = (leaf as { containerEl?: HTMLElement }).containerEl;
		if (leafEl) {
			leafEl.setCssProps({ display: 'none' });
		}
	}

	private detachEditorView(): void {
		if (!this.editorLeaf || !this.editorView) return;
		const leafEl = (this.editorLeaf as { containerEl?: HTMLElement }).containerEl;
		if (leafEl && this.editorView.containerEl.parentElement !== leafEl) {
			leafEl.appendChild(this.editorView.containerEl);
		}
	}

	private pruneUnusedPreviews(layout: GridLayout): void {
		const validKeys = new Set<string>();
		for (const cell of layout.cells) {
			if (!cell.notePath) continue;
			const key = this.getCellKey(cell.row, cell.col);
			if (key === this.activeCellKey) continue;
			validKeys.add(key);
		}

		for (const key of Array.from(this.previewComponents.keys())) {
			if (!validKeys.has(key)) {
				this.clearPreviewComponent(key);
			}
		}
	}

	private clearPreviewComponent(key: string): void {
		const component = this.previewComponents.get(key);
		if (!component) return;
		component.unload();
		this.removeChild(component);
		this.previewComponents.delete(key);
		this.previewRenderIds.delete(key);
	}

	private disposePreviewComponents(): void {
		for (const key of Array.from(this.previewComponents.keys())) {
			this.clearPreviewComponent(key);
		}
	}

	private disposeEditorLeaf(): void {
		if (this.editorView?.containerEl.parentElement) {
			this.editorView.containerEl.parentElement.removeChild(this.editorView.containerEl);
		}
		if (this.editorLeaf) {
			this.editorLeaf.detach();
		}
		this.editorLeaf = null;
		this.editorView = null;
	}

	private ensureActiveCellValid(layout: GridLayout): void {
		if (!this.activeCellKey) {
			this.detachEditorView();
			return;
		}
		const cell = this.getCellByKey(this.activeCellKey, layout);
		if (!cell?.notePath) {
			this.activeCellKey = null;
			this.pendingFocusKey = null;
			this.detachEditorView();
		}
	}

	private getCellByKey(key: string, layout: GridLayout): GridCell | undefined {
		const [row, col] = key.split('-').map((value) => Number(value));
		if (Number.isNaN(row) || Number.isNaN(col)) return undefined;
		return layout.cells.find((cell) => cell.row === row && cell.col === col);
	}

	private isFileInLayout(path: string): boolean {
		const layout = this.getCurrentLayout();
		return layout.cells.some((cell) => cell.notePath === path);
	}

	private isActiveFile(path: string): boolean {
		if (!this.activeCellKey) return false;
		const cell = this.getCellByKey(this.activeCellKey, this.getCurrentLayout());
		return cell?.notePath === path;
	}

	private clearNotePaths(path: string): boolean {
		let updated = false;
		const layout = this.getCurrentLayout();
		for (const cell of layout.cells) {
			if (cell.notePath === path) {
				cell.notePath = null;
				updated = true;
			}
		}
		return updated;
	}

	private updateNotePaths(oldPath: string, newPath: string): boolean {
		let updated = false;
		const layout = this.getCurrentLayout();
		for (const cell of layout.cells) {
			if (cell.notePath === oldPath) {
				cell.notePath = newPath;
				updated = true;
			}
		}
		return updated;
	}

	private saveUndoState(): void {
		this.undoData = {
			data: cloneGridPanesData(this.gridData),
			timestamp: Date.now(),
		};
	}

	private showUndoToast(msg: string): void {
		const container = this.contentEl;
		container.findAll('.grid-panes-undo-toast').forEach((el) => el.remove());

		const toast = container.createDiv({ cls: 'grid-panes-undo-toast' });
		const content = toast.createDiv({ cls: 'grid-panes-undo-content' });
		content.createSpan({ text: msg });

		const undoBtn = content.createEl('button', {
			text: t(this.app, 'toast.undo'),
			cls: 'grid-panes-undo-btn',
		});

		undoBtn.addEventListener('click', () => {
			if (this.undoData) {
				this.gridData = this.undoData.data;
				this.undoData = null;
				this.requestSave();
				this.render();
				toast.remove();
			}
		});

		if (this.undoTimeout) window.clearTimeout(this.undoTimeout);
		this.undoTimeout = window.setTimeout(() => {
			if (toast.parentElement) toast.remove();
			this.undoData = null;
		}, 5000);
	}
}
