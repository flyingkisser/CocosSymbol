import * as vscode from 'vscode';
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { parseSourceFile, SymbolEntry, updateSymbolsForFile, removeSymbolsForFile } from './core';

export async function activate(context: vscode.ExtensionContext) {
    const symbolTable: SymbolEntry[] = [];
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const rootPath = workspaceFolder?.uri.fsPath || '';

    async function loadSymbols() {
        if (!workspaceFolder) return;

        const symbolIndexPath = path.join(rootPath, 'symbols.index');

        if (!fs.existsSync(symbolIndexPath)) return;

        const symbolData = fs.readFileSync(symbolIndexPath, 'utf-8');
        const lines = symbolData.split('\n');

        symbolTable.length = 0;
        for (const line of lines) {
            if (line.trim() === '') continue;
            const [filePath, symbolName, lineNum, paramCount, paramInfoStr=''] = line.split(',');
            // symbolTable.push({ filePath, symbolName, lineNum: parseInt(lineNum), paramCount: parseInt(paramCount), paramInfo: paramInfo ? JSON.parse(paramInfo) : null });
			const paramInfo = paramInfoStr
            ? paramInfoStr.split(';').map(paramStr => {
                const [name, type] = paramStr.split(':');
                return { name, type: type === 'unknown' ? undefined : type };
            })
            : [];

        // Push the entry into the symbol table
			symbolTable.push({
				filePath,
				symbolName,
				lineNum: parseInt(lineNum, 10),
				paramCount: parseInt(paramCount, 10),
				paramInfo
			});
    	}
     }
    

    async function parseWorkspace() {
        if (!workspaceFolder) {
            vscode.window.showInformationMessage('No workspace folder found');
            return;
        }

        const symbolIndexPath = path.join(rootPath, 'symbols.index');

        // Delete existing symbols.index if exists
        if (fs.existsSync(symbolIndexPath)) {
            fs.unlinkSync(symbolIndexPath);
        }

        const files = await vscode.workspace.findFiles('**/*.{js,ts}', '{**/node_modules/**,temp/*,**/temp/**,**/build/**,**/release/**,**/Release/**,**/debug/**,**/Debug/**,**/simulator/**,**/*.d.ts,**/*.min.js,**/*.asm.js}');
        const newSymbolTable: SymbolEntry[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Window,
            title: "Parsing files",
            cancellable: false
        }, async (progress) => {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const filePath = file.fsPath;
                const sourceCode = fs.readFileSync(filePath, 'utf-8');
                const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

                progress.report({ message: `Parsing ${i + 1}/${files.length}` });

                parseSourceFile(sourceFile, filePath, newSymbolTable, rootPath);
            }
        });

		const newSymbolData = newSymbolTable
		.map(entry => {
			var paramInfoStr = entry.paramInfo
				? entry.paramInfo.map(param => `${param.name}:${param.type || 'unknown'}`).join(';')
				: '';
				//get rid of \n\r in paramInfoStr
				paramInfoStr = paramInfoStr.replace(/[\n\r]/g, '');
			return `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount},${paramInfoStr}`;
		})
		.join('\n');
        fs.writeFileSync(symbolIndexPath, newSymbolData, 'utf-8');
        vscode.window.showInformationMessage('Symbols indexed successfully!');

        await loadSymbols();
    }

    await loadSymbols();

    let generateIndexDisposable = vscode.commands.registerCommand('cocos.parse', parseWorkspace);

    context.subscriptions.push(generateIndexDisposable);

    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,ts}', false, false, false);
    fileWatcher.onDidChange(uri => updateSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    fileWatcher.onDidCreate(uri => updateSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    fileWatcher.onDidDelete(uri => removeSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    context.subscriptions.push(fileWatcher);

    let findSymbolDisposable = vscode.commands.registerCommand('cocos.goto', async () => {
        if (symbolTable.length === 0) {
            await parseWorkspace();
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const document = editor.document;
        const position = editor.selection.active;
        const currentFilePath = vscode.workspace.asRelativePath(document.uri);
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            vscode.window.showInformationMessage('No word found at cursor position.');
            return;
        }

        const word = document.getText(wordRange);
        const lineText = document.lineAt(position.line).text;
		const pattern = new RegExp(`([a-zA-Z_][a-zA-Z0-9_\\.]*\\.)${word}\\b`);
		const match = lineText.match(pattern);
		var fullWord='';
		if(match)
			fullWord = match[0];
	
        // Check if the call is made through `this.`
        const isThisReference = lineText.includes(`this.${word}`);

        // Determine the parameter count from the context
        const parameterCount = determineParameterCountFromContext(document, position);

        // Determine the current class context
        const currentClassName = determineCurrentClassName(document, position);

        // Collect matches with exact parameter count and others
        const exactParamMatches: SymbolEntry[] = [];
        const otherParamMatches: SymbolEntry[] = [];
		
        for (const entry of symbolTable) {
			if(!entry.symbolName)
				continue;
            if (isThisReference && currentClassName && entry.symbolName.startsWith(`${currentClassName}.`) && entry.symbolName.endsWith(`.${word}`)) {
                exactParamMatches.push(entry);
            } else if (entry.symbolName === word && entry.paramCount === parameterCount) {
                exactParamMatches.push(entry);
            } else if(fullWord && entry.symbolName === fullWord){
				exactParamMatches.push(entry);
			} else if (entry.symbolName === word) {
                otherParamMatches.push(entry);
            } else if (entry.symbolName.endsWith(`.${word}`)) {
                otherParamMatches.push(entry);
            } else if (entry.symbolName === `ccsp.${word}` && entry.paramCount === 0) {
                exactParamMatches.push(entry);
            }
        }

        let matches: SymbolEntry[] = [];

          // Try to determine the object type from the context by analyzing the variable declaration
        const objectType = determineObjectTypeFromContext(document, position);

        let localFileMatchOnce = false;
        if (isThisReference) {
            // Prioritize current file matches for `this.` references
            const currentFileExactMatches = exactParamMatches.filter(entry => {
                const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
                return entryRelativePath === currentFilePath;
            });
            const otherFileExactMatches = exactParamMatches.filter(entry => {
                const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
                return entryRelativePath !== currentFilePath;
            });
            const currentFileOtherMatches = otherParamMatches.filter(entry => {
                const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
                return entryRelativePath === currentFilePath;
            });
            const otherFileOtherMatches = otherParamMatches.filter(entry => {
                const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
                return entryRelativePath !== currentFilePath;
            });

            matches = [
                ...currentFileExactMatches,
                ...currentFileOtherMatches,
                ...otherFileExactMatches,
                ...otherFileOtherMatches,
            ];
            if (currentFileExactMatches.length === 1) {
                localFileMatchOnce = true;
            }
        } else {
           // Prioritize matches for the detected object type
            const prioritizedExactMatches = exactParamMatches.filter(entry => entry.symbolName.includes(objectType));
            const otherExactMatches = exactParamMatches.filter(entry => !entry.symbolName.includes(objectType));

            const prioritizedOtherMatches = otherParamMatches.filter(entry => entry.symbolName.includes(objectType));
            const otherOtherMatches = otherParamMatches.filter(entry => !entry.symbolName.includes(objectType));

            matches = [
                 ...prioritizedExactMatches,
                ...prioritizedOtherMatches,
                ...otherExactMatches,
                ...otherOtherMatches,
            ];
        }

        if (matches.length === 0) {
            vscode.window.showInformationMessage(`No matches found for ${word} with ${parameterCount} parameters.`);
            return;
        }

        if (matches.length === 1 || localFileMatchOnce || exactParamMatches.length === 1) {
            // Directly jump to the location if there's only one match
            const match = matches[0];
            const absoluteFilePath = path.join(rootPath, match.filePath);
            const document = await vscode.workspace.openTextDocument(absoluteFilePath);
            const editor = await vscode.window.showTextDocument(document);
            const position = new vscode.Position(match.lineNum - 1, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
            return;
        }

        const items = matches.map(match => ({
            label: match.symbolName,
            description: match.filePath,
            detail: `Line: ${match.lineNum}`,
            filePath: match.filePath,
            lineNum: match.lineNum - 1
        }));

        const selectedItem = await vscode.window.showQuickPick(items, {
            placeHolder: `Select a symbol for "${word}" with ${parameterCount} parameters to navigate to`,
        });

        if (selectedItem) {
            const absoluteFilePath = path.join(rootPath, selectedItem.filePath);
            const document = await vscode.workspace.openTextDocument(absoluteFilePath);
            const editor = await vscode.window.showTextDocument(document);
            const position = new vscode.Position(selectedItem.lineNum, 0);
            editor.selection = new vscode.Selection(position, position);
            editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    });

    // Helper function to determine parameter count from context
    function determineParameterCountFromContext(document: vscode.TextDocument, position: vscode.Position): number {
        const lineText = document.lineAt(position.line).text;
        const match = lineText.match(/(\w+)\s*\(([^)]*)\)/);
        if (match) {
            const params = match[2].split(',').map(param => param.trim()).filter(param => param.length > 0);
            return params.length;
        }
        return 0;
    }

    // Determine the current class name from the context
    function determineCurrentClassName(document: vscode.TextDocument, position: vscode.Position): string | null {
        // Traverse lines from the current position upwards
        for (let i = position.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text.trim();

            // Match against class expressions assigned to a variable or object property
            const classExpressionMatch = lineText.match(/^([\w.]+)\s*=\s*class\s*(?:extends\s+[\w.]+\s*)?{/);
            if (classExpressionMatch) {
                return classExpressionMatch[1];
            }
            // Match against direct class declarations
            const classDeclarationMatch = lineText.match(/^class\s+([\w.]+)/);
            if (classDeclarationMatch) {
                return classDeclarationMatch[1];
            }
        }
        return null;
    }

	function determineObjectTypeFromContext(document: vscode.TextDocument, position: vscode.Position): string {
		const variableTypes = parseVariableTypes(document);
	
		const lineText = document.lineAt(position).text.substr(0, position.character);
		const prefixMatch = lineText.match(/([\w.]+)\.$/);
	
		if (prefixMatch) {
			const objectPath = prefixMatch[1];
			console.log(`Detected object path: ${objectPath}`); // Debug log
	
			// Check if the objectPath is a known variable
			if (variableTypes.has(objectPath)) {
				return variableTypes.get(objectPath)!;
			}
	
			// Check if the object path corresponds to any known symbol in the symbol table
			const matchingSymbol = symbolTable.find(entry =>{
				if(!entry.symbolName)
					return false
				return entry.symbolName.startsWith(objectPath)
			});
			if (matchingSymbol) {
				console.log(`Matching symbol found: ${matchingSymbol.filePath}`); // Debug log
				if(objectPath && matchingSymbol.symbolName.includes(objectPath))
					return objectPath;
				console.log(`Matching symbol found: ${matchingSymbol.symbolName}`); // Debug log
				return matchingSymbol.symbolName;
			}
		}
	
		return '';
	}
	
    context.subscriptions.push(findSymbolDisposable);
	
	function parseVariableTypes(document: vscode.TextDocument): Map<string, string> {
		const variableTypes = new Map<string, string>();
		const functionParamsMap = new Map<string, string[]>();
	
		const text = document.getText();
		const lines = text.split('\n');
	
		lines.forEach(line => {
			// Match let, var, or const declarations with instantiation like `let x = new ClassName()`
			const declarationMatch = line.match(/(let|var|const)\s+(\w+)\s*=\s*new\s+([\w.]+)\(/);
			if (declarationMatch) {
				const [, , variableName, className] = declarationMatch;
				variableTypes.set(variableName, className);
			}
	
			// Match variable assignment from another variable like `let x = y;`
			const assignmentMatch = line.match(/(let|var|const)?\s*(\w+)\s*=\s*(\w+);/);
			if (assignmentMatch) {
				const [, , variableName, sourceVariable] = assignmentMatch;
				if (variableTypes.has(sourceVariable)) {
					const sourceType = variableTypes.get(sourceVariable);
					variableTypes.set(variableName, sourceType!);
				}
			}
	
			// Match function declarations and arrow functions to extract parameters
			 // Match function expressions with parameter types
			 const functionParamMatch = line.match(/function\s*\w*\s*\(([^)]+)\)/);
			 if (functionParamMatch) {
				 const paramList = functionParamMatch[1];
				 const params = paramList.split(',').map(param => param.trim());
	 
				 params.forEach(param => {
					 const paramTypeMatch = param.match(/(\w+)\s*:\s*([\w.]+)/);
					 if (paramTypeMatch) {
						 const [, paramName, paramType] = paramTypeMatch;
						 variableTypes.set(paramName, paramType);
					 }
				 });
			 }
		});
	
		return variableTypes;
	}
	
	// Register completion provider for both JavaScript and TypeScript
	// 注册代码补全的提示
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
			
				const objectType = determineObjectTypeFromContext(document, position);
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
			const objectType = determineObjectTypeFromContext(document, position);
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

	// 注册SignatureHelpProvider
	context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(
    [
        { language: 'javascript', scheme: 'file' },
        { language: 'typescript', scheme: 'file' }
    ],
    {
        provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.SignatureHelp | null {
            const lineText = document.lineAt(position.line).text;
			// const prefixMatch = lineText.substr(0, position.character).match(/(\w+)\.(\w+)\s*\($/);
			// var prefixMatch = lineText.substr(0, position.character).match(/(\w+)\.(\w+)\s*\(([^)]*)$/);
			// var prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\(([^)]*)$/);
			// var prefixMatch=  lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\(([^)]*)$/);
			var prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\((.*)$/);

			if (!prefixMatch) return null;
		
			var [_, variableName, methodName,args] = prefixMatch;
			var variableTypes = parseVariableTypes(document);
			var variableType = variableTypes.get(variableName);
			if (!variableType) {
				// prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\(([^)]*)$/);
				prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\((.*)$/);
				if (!prefixMatch) return null;
				[_, variableType, methodName, args] = prefixMatch;
			}
		
			var methodFullName = `${variableType}.${methodName}`;
			var symbolEntry = symbolTable.find(entry => entry.symbolName === methodFullName);

            if (symbolEntry && symbolEntry.paramInfo) {
                const signature = new vscode.SignatureInformation(`${methodName}(${symbolEntry.paramInfo.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ')})`);
                signature.parameters = symbolEntry.paramInfo.map(p => new vscode.ParameterInformation(p.name));

                const signatureHelp = new vscode.SignatureHelp();
                signatureHelp.signatures = [signature];
                signatureHelp.activeSignature = 0;
               // Determine the active parameter based on the number of commas
				const activeParameter = args.split(',').length - 1;
				signatureHelp.activeParameter = Math.min(activeParameter, symbolEntry.paramInfo.length - 1);

                return signatureHelp;
            }

            return null;
        }
    }, '(', ',' // 触发提示的字符	
	));

}

export function deactivate() {}
