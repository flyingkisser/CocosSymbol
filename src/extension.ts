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
            const [filePath, symbolName, lineNum, paramCount] = line.split(',');
            symbolTable.push({ filePath, symbolName, lineNum: parseInt(lineNum), paramCount: parseInt(paramCount) });
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
            .map(entry => `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount}`)
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
            if (isThisReference && currentClassName && entry.symbolName.startsWith(`${currentClassName}.`) && entry.symbolName.endsWith(`.${word}`)) {
                exactParamMatches.push(entry);
            } else if (entry.symbolName === word && entry.paramCount === parameterCount) {
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

        if (matches.length === 1 || localFileMatchOnce) {
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

    // Determine the object type from the context
    function determineObjectTypeFromContext(document: vscode.TextDocument, position: vscode.Position): string {
        for (let i = position.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text;
            const variableMatch = lineText.match(/let\s+(\w+)\s*=\s*new\s+([\w.]+)/);
            if (variableMatch) {
                const [_, variableName, className] = variableMatch;
                if (lineText.includes(variableName)) {
                    return className.split('.').pop() || '';
                }
            }
        }
        return '';
    }

    context.subscriptions.push(findSymbolDisposable);
}

export function deactivate() {}
