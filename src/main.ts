import { Notice, Plugin } from 'obsidian';
import { GridPanesView } from './GridPanesView';
import { GRID_PANES_VIEW_TYPE, GRID_PANES_EXTENSION, DEFAULT_GRID_DATA } from './types';

export default class GridPanesPlugin extends Plugin {
	async onload() {
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
				new Notice('Grid Panes 已注册视图，请重启 Obsidian 以完成重新加载。');
			} else {
				throw new Error(`View type "${GRID_PANES_VIEW_TYPE}" 已被其他插件注册。请禁用冲突插件或重启 Obsidian。`);
			}
		} else {
			this.registerView(
				GRID_PANES_VIEW_TYPE,
				(leaf) => new GridPanesView(leaf)
			);
			(globalThis as Record<string, unknown>)[globalKey] = true;
		}

		// 注册 .gridpanes 文件扩展名
		this.registerExtensions([GRID_PANES_EXTENSION], GRID_PANES_VIEW_TYPE);

		// Ribbon 图标：创建新网格
		this.addRibbonIcon('layout-grid', 'Grid Panes: 创建新网格', async () => {
			await this.createNewGridFile();
		});

		// 注册命令
		this.addCommand({
			id: 'create-new-grid',
			name: '创建新网格',
			callback: async () => {
				await this.createNewGridFile();
			},
		});

		this.addCommand({
			id: 'add-row-above',
			name: '在顶部添加一行',
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
			name: '在底部添加一行',
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
			name: '在左侧添加一列',
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
			name: '在右侧添加一列',
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
			name: '删除最后一行',
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
			name: '删除最后一列',
			checkCallback: (checking) => {
				const view = this.getActiveGridView();
				if (view) {
					if (!checking) view.removeColumn();
					return true;
				}
				return false;
			},
		});
	}

	onunload() {
		// 清理视图
		this.app.workspace.detachLeavesOfType(GRID_PANES_VIEW_TYPE);
	}

	private getActiveGridView(): GridPanesView | null {
		const leaf = this.app.workspace.getActiveViewOfType(GridPanesView);
		return leaf;
	}

	private async createNewGridFile(): Promise<void> {
		// 生成唯一文件名
		const baseName = 'Grid Layout';
		let fileName = `${baseName}.${GRID_PANES_EXTENSION}`;
		let counter = 1;

		while (this.app.vault.getAbstractFileByPath(fileName)) {
			fileName = `${baseName} ${counter}.${GRID_PANES_EXTENSION}`;
			counter++;
		}

		// 创建文件
		const content = JSON.stringify(DEFAULT_GRID_DATA, null, 2);
		const file = await this.app.vault.create(fileName, content);

		// 打开文件
		const leaf = this.app.workspace.getLeaf();
		await leaf.openFile(file);
	}
}
