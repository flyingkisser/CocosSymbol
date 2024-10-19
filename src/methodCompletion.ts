import * as vscode from 'vscode';
import { SymbolEntry,determineObjectTypeFromContext } from './core'; // Assuming the SymbolEntry type is defined in symbolIndexer.ts


// Register completion provider for both JavaScript and TypeScript
//对象函数成员补全
export function registerMethodCompletion(context: vscode.ExtensionContext, symbolTable: SymbolEntry[]) {
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(
        [
            { language: 'javascript', scheme: 'file' },
            { language: 'typescript', scheme: 'file' },
            { language: 'javascriptreact', scheme: 'file' },
            { language: 'typescriptreact', scheme: 'file' }
        ],
        {
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position){
				const linePrefix = document.lineAt(position).text.substr(0, position.character);
				let prefix = '';
				if (linePrefix.endsWith('.')) {
					const match = linePrefix.match(/[\w\.]+$/);
					if (match) {
						prefix = match[0];
						console.log(`Detected prefix: ${prefix}`); // Debug log
					}
				}
			
				if (prefix) {
					const items = getCompletionItemsForPrefix(prefix, symbolTable, document, position);
					console.log(`Found ${items.length} completion items for prefix: ${prefix}`); // Debug log
					if(items.length > 0) return items;
				}
			
				const objectType = determineObjectTypeFromContext(document, position,symbolTable);
				console.log(`Determined object type: ${objectType}`); // Debug log
				if (objectType) {
					const items = getCompletionItemsForObjectType(objectType, symbolTable);
					console.log(`Found ${items.length} completion items for object type: ${objectType}`); // Debug log
					return items;
				}
			
				console.log('No completion items found.'); // Debug log
				return undefined;
			}
        }, '.'));

		function getCompletionItemsForPrefix(prefix: string, symbolTable: SymbolEntry[],document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
			// Only return the portion of the symbol name that follows the prefix
			const prefixParts = prefix.split('.');
			const basePrefix = prefixParts.slice(0, -1).join('.') + '.';
			const searchPrefix = prefixParts[prefixParts.length - 1];
		
			// Instead of filtering by basePrefix, check against the determined object type
			const objectType = determineObjectTypeFromContext(document, position,symbolTable);
			const objectTypePrefix = objectType + '.';
		
			return symbolTable
				.filter(entry => {
					if(!entry.symbolName.startsWith(objectTypePrefix) || (searchPrefix && !entry.symbolName.includes(searchPrefix)))
						return false;
					//只返回一级属性
					let leftPart=entry.symbolName.substr(objectTypePrefix.length);
					if(leftPart.includes('.'))
						return false;
					return true;
				})
				.map(entry => {
					const fullEntryName = entry.symbolName.replace(objectTypePrefix, '');
					const label = fullEntryName.startsWith(searchPrefix) ? fullEntryName : searchPrefix + fullEntryName;
					return new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
				});
		}
		
		function getCompletionItemsForObjectType(objectType: string, symbolTable: SymbolEntry[]): vscode.CompletionItem[] {
			const objectTypePrefix = objectType + '.';
			return symbolTable
				.filter(entry => entry.symbolName.startsWith(objectTypePrefix))
				.map(entry => {
					const label = entry.symbolName.replace(objectTypePrefix, '');
					const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Method);
		
					// Add parameter info as detail
					if (entry.paramInfo && entry.paramInfo.length > 0) {
						const params = entry.paramInfo.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ');
						item.detail = `(${params})`;
					}
					
					return item;
				});
		}
    }