import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolEntry,determineObjectTypeFromContext } from './core';
import { symbolTable,parseWorkspace } from './symbolIndexer';

function determineObjectTypeFromContext2(document: vscode.TextDocument, position: vscode.Position): Map<string, string> {
    const variableTypes = new Map<string, string>();
    const text = document.getText();
    const lines = text.split('\n');

    lines.forEach(line => {
         // Match let, var, or const declarations with instantiation like `let x = new ClassName()`
         const declarationMatch = line.match(/(let|var|const)\s+(\w+)\s*=\s*new\s+([\w.]+)\(/);
         if (declarationMatch) {
             const [, , variableName, className] = declarationMatch;
             variableTypes.set(variableName, className);
         }
 
         // Match assignments to 'this' properties like `this.x = new ClassName()`
         const thisAssignmentMatch = line.match(/this\.(\w+)\s*=\s*new\s+([\w.]+)\(/);
         if (thisAssignmentMatch) {
             const [, propertyName, className] = thisAssignmentMatch;
             variableTypes.set(propertyName, className); // Store without 'this.' for easier matching
         }
 
         // Match variable assignment from another variable like `let x = y;` or `let d = this._drawNode;`
         const assignmentMatch = line.match(/(let|var|const)?\s*(\w+)\s*=\s*([\w.]+);/);
         if (assignmentMatch) {
             const [, , variableName, sourceVariable] = assignmentMatch;
             const sourceType = variableTypes.get(sourceVariable) || variableTypes.get(sourceVariable.replace(/^this\./, ''));
             if (sourceType) {
                 variableTypes.set(variableName, sourceType);
             }
         }
    });

    return variableTypes;
}

export async function findSymbol() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('No workspace folder found');
        return;
    }
    const rootPath = workspaceFolder?.uri.fsPath || '';

    if (symbolTable.length === 0) {
        await parseWorkspace(); // Assuming parseWorkspace is exported from symbolIndexer
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

    // Extract variable name by looking back from the word position
    const lineBeforeCursor = lineText.substring(0, wordRange.start.character);
    const variableMatch = lineBeforeCursor.match(/(\w+)\.\s*$/);
    const variableName = variableMatch ? variableMatch[1] : null;

    const pattern = new RegExp(`([a-zA-Z_][a-zA-Z0-9_\\.]*\\.)${word}\\b`);
    const match = lineText.match(pattern);
    let fullWord = '';
    if (match) fullWord = match[0];

    const isThisReference = lineText.includes(`this.${word}`);
    const parameterCount = determineParameterCountFromContext(document, position);
    const currentClassName = determineCurrentClassName(document, position);
    const variableTypes = determineObjectTypeFromContext2(document, position);
    const exactParamMatches: SymbolEntry[] = [];
    const exactOtherMatches: SymbolEntry[] = [];
    const otherParamMatches: SymbolEntry[] = [];

    for (const entry of symbolTable) {
        if(entry.filePath.includes('alignColumn'))
            console.log("findSymbol",entry);

        if (!entry.symbolName) continue;
        const inferredType = variableName ? variableTypes.get(variableName) : currentClassName;

        if (isThisReference && currentClassName && entry.symbolName.startsWith(`${currentClassName}.`) && entry.symbolName.endsWith(`.${word}`)) {
            exactParamMatches.push(entry);
        } else if (entry.symbolName === word && entry.paramCount === parameterCount) {
            exactParamMatches.push(entry);
        } else if (entry.symbolName === `${inferredType}.${word}` && entry.paramCount === parameterCount) {
            exactParamMatches.push(entry);
        } else if (entry.symbolName === `${inferredType}.${word}`) {
            exactOtherMatches.push(entry);
        }else if (fullWord && entry.symbolName === fullWord) {
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
    const objectType = determineObjectTypeFromContext(document, position,symbolTable);

    let localFileMatchOnce = false;
    if (isThisReference) {
        const currentFileExactMatches = exactParamMatches.filter(entry => {
            const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
            return entryRelativePath === currentFilePath;
        });
        const otherFileExactMatches = exactParamMatches.filter(entry => {
            const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
            return entryRelativePath !== currentFilePath;
        });
        const currentFileOtherMatches1 = exactOtherMatches.filter(entry => {
            const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
            return entryRelativePath === currentFilePath;
        });        
        const currentFileOtherMatches2 = otherParamMatches.filter(entry => {
            const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
            return entryRelativePath === currentFilePath;
        });
        const otherFileOtherMatches = otherParamMatches.filter(entry => {
            const entryRelativePath = vscode.workspace.asRelativePath(path.join(rootPath, entry.filePath));
            return entryRelativePath !== currentFilePath;
        });

        matches = [
            ...currentFileExactMatches,
            ...currentFileOtherMatches1,
            ...currentFileOtherMatches2,
            ...otherFileExactMatches,
            ...otherFileOtherMatches,
        ];
        if (currentFileExactMatches.length === 1) {
            localFileMatchOnce = true;
        }
    } else {
        const prioritizedExactMatches1 = exactParamMatches.filter(entry => entry.symbolName.includes(objectType));
        const prioritizedExactMatches2 = exactOtherMatches.filter(entry => entry.symbolName.includes(objectType));
        const otherExactMatches = exactParamMatches.filter(entry => !entry.symbolName.includes(objectType));

        const prioritizedOtherMatches = otherParamMatches.filter(entry => entry.symbolName.includes(objectType));
        const otherOtherMatches = otherParamMatches.filter(entry => !entry.symbolName.includes(objectType));

        matches = [
            ...prioritizedExactMatches1,
            ...prioritizedExactMatches2,
            ...prioritizedOtherMatches,
            ...otherExactMatches,
            ...otherOtherMatches,
        ];
    }

    if (matches.length === 0) {
        vscode.window.showInformationMessage(`No matches found for ${word} with ${parameterCount} parameters.`);
        return;
    }

    if (matches.length === 1 || localFileMatchOnce || exactParamMatches.length === 1 || exactOtherMatches.length === 1) {
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
}

// Helper functions
function determineParameterCountFromContext(document: vscode.TextDocument, position: vscode.Position): number {
    let lineText = document.lineAt(position.line).text;
    // const match = lineText.match(/(\w+)\s*\(([^)]*)\)/);
    // if (match) {
    //     const params = match[2].split(',').map(param => param.trim()).filter(param => param.length > 0);
    //     return params.length;
    // }
    // return 0;
    let openParenIndex = lineText.indexOf('(', position.character);

    // If no opening parenthesis found after the cursor position, return 0
    if (openParenIndex === -1) {
        return 0;
    }

    // Collect text until we find the closing parenthesis
    let collectedText = '';
    let openParens = 0;
    let lineIndex = position.line;

    while (lineIndex < document.lineCount) {
        lineText = document.lineAt(lineIndex).text;
        for (let i = openParenIndex; i < lineText.length; i++) {
            const char = lineText[i];
            collectedText += char;

            if (char === '(') {
                openParens++;
            } else if (char === ')') {
                openParens--;
                if (openParens === 0) {
                    break;
                }
            }
        }

        if (openParens === 0) {
            break;
        }

        lineIndex++;
        openParenIndex = 0; // reset to start of the next line
    }

    // Match function parameters within the parentheses
    const match = collectedText.match(/\(([^)]*)\)/);
    if (match) {
        const params = match[1].split(',').map(param => param.trim()).filter(param => param.length > 0);
        return params.length;
    }
    return 0;
}

function determineCurrentClassName(document: vscode.TextDocument, position: vscode.Position): string | null {
    for (let i = position.line; i >= 0; i--) {
        const lineText = document.lineAt(i).text.trim();
        const classExpressionMatch = lineText.match(/^([\w.]+)\s*=\s*class\s*(?:extends\s+[\w.]+\s*)?{/);
        if (classExpressionMatch) {
            return classExpressionMatch[1];
        }
        const classDeclarationMatch = lineText.match(/^class\s+([\w.]+)/);
        if (classDeclarationMatch) {
            return classDeclarationMatch[1];
        }
    }
    return null;
}



