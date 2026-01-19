import { Notice, Plugin } from 'obsidian';
import { GridPanesView } from './GridPanesView';
import { GRID_PANES_VIEW_TYPE, GridPanesData, createDefaultGridData, migrateGridPanesData } from './types';
import { t } from './i18n';

export default class GridPanesPlugin extends Plugin {
	private gridData: GridPanesData = createDefaultGridData();
	private saveTimer: number | null = null;

	async onload() {
		await this.loadGridData();

		// 注册自定义视图（避免重复注册导致崩溃）
		const globalKey = '__obsidianGridPanesViewRegistered';
		const viewRegistry = (this.app as { viewRegistry?: Record<string, unknown> }).viewRegistry as
			| { getViewCreatorByType?: (type: string) => unknown; viewCreators?: Record<string, unknown> }
			| undefined;
		const existingView =
			viewRegistry?.getViewCreatorByType?.(GRID_PANES_VIEW_TYPE) ??
			viewRegistry?.viewCreators?.[GRID_PANES_VIEW_TYPE];
		const alreadyRegisteredByThis = (globalThis as Record<string, unknown>)[globalKey] === true;

		if (existingView) {
			if (alreadyRegisteredByThis) {
				new Notice(t(this.app, 'notice.viewRegistered'));
			} else {
				throw new Error(t(this.app, 'error.viewConflict', { type: GRID_PANES_VIEW_TYPE }));
			}
		} else {
			this.registerView(
				GRID_PANES_VIEW_TYPE,
				(leaf) => new GridPanesView(leaf, this)
			);
			(globalThis as Record<string, unknown>)[globalKey] = true;
		}

		// Ribbon 图标：打开网格视图
		this.addRibbonIcon('layout-grid', t(this.app, 'ribbon.openGridView'), async () => {
			await this.openGridView();
		});

		// 注册命令
		this.addCommand({
			id: 'open-grid-view',
			name: t(this.app, 'command.openGridView'),
			callback: async () => {
				await this.openGridView();
			},
		});

		this.addCommand({
			id: 'add-row-above',
			name: t(this.app, 'command.addRowAbove'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.addRowTop();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'add-row-below',
			name: t(this.app, 'command.addRowBelow'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.addRow();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'add-column-left',
			name: t(this.app, 'command.addColumnLeft'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.addColumnLeft();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'add-column-right',
			name: t(this.app, 'command.addColumnRight'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.addColumn();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'remove-row',
			name: t(this.app, 'command.removeRow'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.removeRow();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'remove-column',
			name: t(this.app, 'command.removeColumn'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.removeColumn();
					return true;
				}
				return false;
			},
		});

		this.addCommand({
			id: 'select-note-for-cell',
			name: t(this.app, 'command.selectNoteForCell'),
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.selectNoteForActiveCell();
					return true;
				}
				return false;
			},
		});
	}

	onunload() {
		// 清理视图
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	private getActiveGridView(): GridPanesView | null {
		const leaf = this.app.workspace.getActiveViewOfType(GridPanesView);
		return leaf;
	}

	async openGridView(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(GRID_PANES_VIEW_TYPE);
		const leaf = leaves[0] ?? this.app.workspace.getLeaf();
		for (const extra of leaves.slice(1)) {
			extra.detach();
		}
		await leaf.setViewState({ type: GRID_PANES_VIEW_TYPE, active: true });
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
	}

	getGridData(): GridPanesData {
		return this.gridData;
	}

	setGridData(data: GridPanesData): void {
		this.gridData = data;
		this.queueSave();
	}

	private queueSave(): void {
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
		}
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			void this.saveData(this.gridData);
		}, 300);
	}

	private async loadGridData(): Promise<void> {
		const raw = (await this.loadData()) as unknown;
		this.gridData = migrateGridPanesData(raw);
	}
}
