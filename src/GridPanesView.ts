import {
	TextFileView,
	WorkspaceLeaf,
	TFile,
	Menu,
	MarkdownView,
	MarkdownRenderer,
	Component,
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
} from './types';
import { FileSuggestModal } from './FileSuggestModal';

export class GridPanesView extends TextFileView {
	private gridData: GridPanesData;
	private gridContainer: HTMLElement | null = null;
	private headerContainer: HTMLElement | null = null;
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

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.gridData = this.createDefaultData();
	}

	private createDefaultData(): GridPanesData {
		return {
			version: 2,
			currentLayout: 'default',
			layouts: {
				default: JSON.parse(JSON.stringify(DEFAULT_LAYOUT)),
			},
		};
	}

	getViewType(): string {
		return GRID_PANES_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Grid Panes';
	}

	getViewData(): string {
		return JSON.stringify(this.gridData, null, 2);
	}

	setViewData(data: string, clear: boolean): void {
		if (clear) {
			this.disposeEditorLeaf();
			this.disposePreviewComponents();
			this.activeCellKey = null;
			this.pendingFocusKey = null;
		}
		try {
			const parsed = data ? JSON.parse(data) : null;
			this.gridData = this.migrateData(parsed);
		} catch {
			this.gridData = this.createDefaultData();
		}
		if (this.gridContainer && this.headerContainer) {
			this.render();
		}
	}

	private migrateData(data: unknown): GridPanesData {
		if (!data || typeof data !== 'object') {
			return this.createDefaultData();
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
				version: 2,
				currentLayout: 'default',
				layouts: { default: layout },
			};
		}

		return obj as unknown as GridPanesData;
	}

	clear(): void {
		this.resetHoverState();
		this.disposeEditorLeaf();
		this.disposePreviewComponents();
		this.activeCellKey = null;
		this.pendingFocusKey = null;
		this.gridData = this.createDefaultData();
	}

	async onOpen(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('grid-panes-container');

		// 顶部方案选择器
		this.headerContainer = container.createDiv({ cls: 'grid-panes-header' });
		this.gridContainer = container.createDiv({ cls: 'grid-panes-grid' });

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (!(file instanceof TFile)) return;
			if (this.file && file.path === this.file.path) return;
			const updated = this.clearNotePaths(file.path);
			if (updated) {
				this.requestSave();
				this.render();
			}
		}));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			if (!(file instanceof TFile)) return;
			if (this.file && file.path === this.file.path) return;
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
		this.headerContainer = null;
	}

	private getCurrentLayout(): GridLayout {
		return this.gridData.layouts[this.gridData.currentLayout] || DEFAULT_LAYOUT;
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
	}



	private render(): void {
		const gridContainer = this.gridContainer;
		if (!gridContainer || !this.headerContainer) return;
		const renderId = ++this.renderId;
		this.renderHeader();
		gridContainer.empty();

		const layout = this.getCurrentLayout();
		this.ensureActiveCellValid(layout);
		this.pruneUnusedPreviews(layout);
		const { rows, cols } = layout;

		// 设置 CSS Grid 布局
		gridContainer.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
		gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

		// 渲染删除控制按钮
		if (rows > MIN_GRID_SIZE) {
			for (let r = 0; r < rows; r++) {
				const btn = gridContainer.createDiv({
					cls: 'grid-panes-del-btn grid-panes-row-del',
					attr: { 'data-row': String(r), 'aria-label': '删除行' }
				});
				btn.createSpan({ text: '×' });
				// 定位到该行的第一列，通过 CSS 调整位置
				btn.style.gridRow = String(r + 1);
				btn.style.gridColumn = '1';
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
					attr: { 'data-col': String(c), 'aria-label': '删除列' }
				});
				btn.createSpan({ text: '×' });
				// 定位到该列的第一行
				btn.style.gridRow = '1';
				btn.style.gridColumn = String(c + 1);
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
	}

	private renderHeader(): void {
		if (!this.headerContainer) return;
		this.headerContainer.empty();

		const layoutNames = Object.keys(this.gridData.layouts);

		// 下拉选择器
		const select = this.headerContainer.createEl('select', { cls: 'grid-panes-layout-select' });
		for (const name of layoutNames) {
			const option = select.createEl('option', { text: name, value: name });
			if (name === this.gridData.currentLayout) {
				option.selected = true;
			}
		}
		select.addEventListener('change', () => {
			this.switchLayout(select.value);
		});

		// 新建按钮
		const newBtn = this.headerContainer.createEl('button', {
			cls: 'grid-panes-new-layout-btn',
			text: '+',
			attr: { title: '新建方案' },
		});
		newBtn.addEventListener('click', () => {
			this.createNewLayout();
		});

		// 删除按钮（仅当有多个方案时显示）
		if (layoutNames.length > 1) {
			const deleteBtn = this.headerContainer.createEl('button', {
				cls: 'grid-panes-delete-layout-btn',
				text: '×',
				attr: { title: '删除当前方案' },
			});
			deleteBtn.addEventListener('click', () => {
				this.deleteCurrentLayout();
			});
		}

		// 重命名按钮
		const renameBtn = this.headerContainer.createEl('button', {
			cls: 'grid-panes-rename-layout-btn',
			text: '✎',
			attr: { title: '重命名方案' },
		});
		renameBtn.addEventListener('click', () => {
			this.renameCurrentLayout();
		});
	}

	private switchLayout(name: string): void {
		if (this.gridData.layouts[name]) {
			this.gridData.currentLayout = name;
			this.resetHoverState();
			this.activeCellKey = null;
			this.pendingFocusKey = null;
			this.requestSave();
			this.render();
		}
	}

	private createNewLayout(): void {
		let baseName = 'Layout';
		let counter = 1;
		let name = baseName;

		while (this.gridData.layouts[name]) {
			name = `${baseName} ${counter}`;
			counter++;
		}

		// 弹出输入框
		const inputName = prompt('输入新方案名称:', name);
		if (!inputName || inputName.trim() === '') return;

		const finalName = inputName.trim();
		if (this.gridData.layouts[finalName]) {
			alert('方案名称已存在');
			return;
		}

		this.gridData.layouts[finalName] = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
		this.gridData.currentLayout = finalName;
		this.resetHoverState();
		this.requestSave();
		this.render();
	}

	private deleteCurrentLayout(): void {
		const layoutNames = Object.keys(this.gridData.layouts);
		if (layoutNames.length <= 1) return;

		if (!confirm(`确定删除方案 "${this.gridData.currentLayout}"？`)) return;

		delete this.gridData.layouts[this.gridData.currentLayout];
		const remainingLayouts = Object.keys(this.gridData.layouts);
		this.gridData.currentLayout = remainingLayouts[0] ?? 'default';
		this.resetHoverState();
		this.requestSave();
		this.render();
	}

	private renameCurrentLayout(): void {
		const currentName = this.gridData.currentLayout;
		const newName = prompt('输入新名称:', currentName);
		if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

		const finalName = newName.trim();
		if (this.gridData.layouts[finalName]) {
			alert('方案名称已存在');
			return;
		}

		const currentLayout = this.gridData.layouts[currentName];
		if (!currentLayout) return;

		this.gridData.layouts[finalName] = currentLayout;
		delete this.gridData.layouts[currentName];
		this.gridData.currentLayout = finalName;
		this.requestSave();
		this.render();
	}

	private renderCell(row: number, col: number, renderId: number, gridContainer: HTMLElement): void {
		const cell = this.getCell(row, col);
		const cellEl = gridContainer.createDiv({ cls: 'grid-panes-cell' });
		cellEl.setAttribute('data-row', String(row));
		cellEl.setAttribute('data-col', String(col));
		cellEl.style.gridRow = String(row + 1);
		cellEl.style.gridColumn = String(col + 1);
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
			this.renderNoteContent(cellEl, cell, renderId);
		} else {
			this.renderEmptyCell(cellEl, row, col);
		}
	}

	private getCell(row: number, col: number): GridCell | undefined {
		const layout = this.getCurrentLayout();
		return layout.cells.find((c) => c.row === row && c.col === col);
	}

	private setCell(row: number, col: number, notePath: string | null, mode: CellMode = 'preview'): void {
		const layout = this.getCurrentLayout();
		const existingIndex = layout.cells.findIndex((c) => c.row === row && c.col === col);
		const newCell: GridCell = { row, col, notePath, mode };

		if (existingIndex >= 0) {
			layout.cells[existingIndex] = newCell;
		} else {
			layout.cells.push(newCell);
		}

		this.requestSave();
		this.render();
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
			cellEl.createDiv({ cls: 'grid-panes-error', text: '文件未找到' });
			return;
		}

		const key = this.getCellKey(cell.row, cell.col);
		const isActive = key === this.activeCellKey;

		// 渲染单元格标题栏
		const headerEl = cellEl.createDiv({ cls: 'grid-panes-cell-header' });
		headerEl.createSpan({ cls: 'grid-panes-cell-title', text: file.basename });

		if (isActive) {
			headerEl.createSpan({ cls: 'grid-panes-cell-status', text: '编辑中' });
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
		placeholder.createSpan({ text: '点击选择笔记' });

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

	private showCellContextMenu(e: MouseEvent, row: number, col: number): void {
		const cell = this.getCell(row, col);
		const menu = new Menu();

		if (cell?.notePath) {
			menu.addItem((item) =>
				item
					.setTitle('更换笔记')
					.setIcon('file-edit')
					.onClick(() => this.selectNoteForCell(row, col))
			);

			menu.addItem((item) =>
				item
					.setTitle('清空')
					.setIcon('trash')
					.onClick(() => this.setCell(row, col, null))
			);

			menu.addItem((item) =>
				item
					.setTitle('在新窗口打开')
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
					.setTitle('选择笔记')
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
			const addRowBtn = gridContainer.createDiv({ cls: 'grid-panes-add-btn grid-panes-add-row' });
			addRowBtn.createSpan({ text: '+' });
			addRowBtn.style.gridRow = String(rows + 1);
			addRowBtn.style.gridColumn = `1 / ${cols + 1}`;
			addRowBtn.addEventListener('click', () => this.addRow());
		}

		// 右侧添加列按钮
		if (cols < MAX_GRID_SIZE) {
			const addColBtn = gridContainer.createDiv({ cls: 'grid-panes-add-btn grid-panes-add-col' });
			addColBtn.createSpan({ text: '+' });
			addColBtn.style.gridRow = `1 / ${rows + 1}`;
			addColBtn.style.gridColumn = String(cols + 1);
			addColBtn.addEventListener('click', () => this.addColumn());
		}
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
		this.showUndoToast('已删除行');
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
		this.showUndoToast('已删除列');
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
			contentEl.createDiv({ cls: 'grid-panes-error', text: '读取失败' });
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
			contentEl.createDiv({ cls: 'grid-panes-error', text: '渲染失败' });
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
		const desiredMode: 'source' = 'source';
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
			this.hideEditorLeaf(leaf);
			view.containerEl.addClass('grid-panes-markdown-view');
			return view;
		}

		const currentPath = this.editorView.file?.path;
		if (currentPath !== file.path || this.editorView.getMode() !== desiredMode) {
			await this.editorLeaf.openFile(file, { state: { mode: desiredMode }, active: false });
		}
		return this.editorView;
	}

	private hideEditorLeaf(leaf: WorkspaceLeaf): void {
		const parentEl = (leaf.parent as { containerEl?: HTMLElement } | null)?.containerEl;
		if (parentEl) {
			parentEl.addClass('grid-panes-hidden-tabs');
			return;
		}
		const leafEl = (leaf as { containerEl?: HTMLElement }).containerEl;
		if (leafEl) {
			leafEl.style.display = 'none';
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
		for (const layout of Object.values(this.gridData.layouts)) {
			for (const cell of layout.cells) {
				if (cell.notePath === path) {
					cell.notePath = null;
					updated = true;
				}
			}
		}
		return updated;
	}

	private updateNotePaths(oldPath: string, newPath: string): boolean {
		let updated = false;
		for (const layout of Object.values(this.gridData.layouts)) {
			for (const cell of layout.cells) {
				if (cell.notePath === oldPath) {
					cell.notePath = newPath;
					updated = true;
				}
			}
		}
		return updated;
	}

	private saveUndoState(): void {
		this.undoData = {
			data: JSON.parse(JSON.stringify(this.gridData)),
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
			text: '撤销',
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
