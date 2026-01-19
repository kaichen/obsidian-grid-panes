import { App } from 'obsidian';

type Locale = 'en' | 'zh';

type TranslationKey =
	| 'plugin.name'
	| 'notice.viewRegistered'
	| 'notice.noActiveCell'
	| 'error.viewConflict'
	| 'ribbon.openGridView'
	| 'command.openGridView'
	| 'command.selectNoteForCell'
	| 'command.addRowAbove'
	| 'command.addRowBelow'
	| 'command.addColumnLeft'
	| 'command.addColumnRight'
	| 'command.removeRow'
	| 'command.removeColumn'
	| 'view.displayText'
	| 'button.deleteRowAria'
	| 'button.deleteColumnAria'
	| 'cell.editing'
	| 'cell.fileNotFound'
	| 'cell.emptyPlaceholder'
	| 'cell.readFailed'
	| 'cell.renderFailed'
	| 'menu.replaceNote'
	| 'menu.clear'
	| 'menu.openNewTab'
	| 'menu.selectNote'
	| 'modal.fileSuggestPlaceholder'
	| 'toast.rowDeleted'
	| 'toast.columnDeleted'
	| 'toast.undo';

const translations: Record<Locale, Record<TranslationKey, string>> = {
	en: {
		'plugin.name': 'Grid Panes',
		'notice.viewRegistered': 'Grid Panes view already registered. Please restart Obsidian to reload.',
		'notice.noActiveCell': 'Select a grid cell first',
		'error.viewConflict': 'View type "{type}" is already registered by another plugin. Disable the conflicting plugin or restart Obsidian.',
		'ribbon.openGridView': 'Grid Panes: Open grid view',
		'command.openGridView': 'Open grid view',
		'command.selectNoteForCell': 'Choose note for active cell',
		'command.addRowAbove': 'Add row at top',
		'command.addRowBelow': 'Add row at bottom',
		'command.addColumnLeft': 'Add column at left',
		'command.addColumnRight': 'Add column at right',
		'command.removeRow': 'Remove last row',
		'command.removeColumn': 'Remove last column',
		'view.displayText': 'Grid Panes',
		'button.deleteRowAria': 'Delete row',
		'button.deleteColumnAria': 'Delete column',
		'cell.editing': 'Editing',
		'cell.fileNotFound': 'File not found',
		'cell.emptyPlaceholder': 'Click to choose note',
		'cell.readFailed': 'Failed to read',
		'cell.renderFailed': 'Render failed',
		'menu.replaceNote': 'Change note',
		'menu.clear': 'Clear',
		'menu.openNewTab': 'Open in new tab',
		'menu.selectNote': 'Select note',
		'modal.fileSuggestPlaceholder': 'Select a note...',
		'toast.rowDeleted': 'Row deleted',
		'toast.columnDeleted': 'Column deleted',
		'toast.undo': 'Undo',
	},
	zh: {
		'plugin.name': '网格面板',
		'notice.viewRegistered': 'Grid Panes 已注册视图，请重启 Obsidian 以完成重新加载。',
		'notice.noActiveCell': '请先选择一个网格单元',
		'error.viewConflict': '视图类型 "{type}" 已被其他插件注册。请禁用冲突插件或重启 Obsidian。',
		'ribbon.openGridView': 'Grid Panes: 打开网格视图',
		'command.openGridView': '打开网格视图',
		'command.selectNoteForCell': '为当前单元格选择笔记',
		'command.addRowAbove': '在顶部添加一行',
		'command.addRowBelow': '在底部添加一行',
		'command.addColumnLeft': '在左侧添加一列',
		'command.addColumnRight': '在右侧添加一列',
		'command.removeRow': '删除最后一行',
		'command.removeColumn': '删除最后一列',
		'view.displayText': '网格面板',
		'button.deleteRowAria': '删除行',
		'button.deleteColumnAria': '删除列',
		'cell.editing': '编辑中',
		'cell.fileNotFound': '文件未找到',
		'cell.emptyPlaceholder': '点击选择笔记',
		'cell.readFailed': '读取失败',
		'cell.renderFailed': '渲染失败',
		'menu.replaceNote': '更换笔记',
		'menu.clear': '清空',
		'menu.openNewTab': '在新窗口打开',
		'menu.selectNote': '选择笔记',
		'modal.fileSuggestPlaceholder': '选择一个笔记...',
		'toast.rowDeleted': '已删除行',
		'toast.columnDeleted': '已删除列',
		'toast.undo': '撤销',
	},
};

const defaultLocale: Locale = 'zh';

const templatePattern = /\{(\w+)\}/g;

type VaultConfigAccess = { getConfig?: (key: string) => unknown };

export function getLocale(app: App): Locale {
	const vault = app.vault as VaultConfigAccess;
	const language = vault.getConfig?.('language');
	if (typeof language === 'string' && language.toLowerCase().startsWith('zh')) {
		return 'zh';
	}
	return 'en';
}

export function t(app: App, key: TranslationKey, vars?: Record<string, string | number>): string {
	const locale = getLocale(app);
	const dict = translations[locale] ?? translations[defaultLocale];
	let text = dict[key] ?? translations[defaultLocale][key] ?? key;
	if (vars) {
		text = text.replace(templatePattern, (match, name: string) => {
			if (Object.prototype.hasOwnProperty.call(vars, name)) {
				return String(vars[name]);
			}
			return match;
		});
	}
	return text;
}
