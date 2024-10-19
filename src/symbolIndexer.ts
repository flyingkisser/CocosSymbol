import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

import { parseSourceFile, SymbolEntry } from './core';


export let symbolTable: SymbolEntry[] = [];

export async function loadSymbolsToMemory() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('No workspace folder found');
        return;
    }
    const rootPath = workspaceFolder?.uri.fsPath || '';
    const symbolIndexPath = path.join(rootPath, 'symbols.index');

    if (!fs.existsSync(symbolIndexPath)) return;

    const symbolData = fs.readFileSync(symbolIndexPath, 'utf-8');
    const lines = symbolData.split('\n');

    symbolTable.length = 0;
    for (const line of lines) {
        if (line.trim() === '') continue;
        const [filePath, symbolName, lineNum, paramCount, paramInfoStr = ''] = line.split(',');
        const paramInfo = paramInfoStr
            ? paramInfoStr.split(';').map(paramStr => {
                const [name, type] = paramStr.split(':');
                return { name, type: type === 'unknown' ? undefined : type };
            })
            : [];

        symbolTable.push({
            filePath,
            symbolName,
            lineNum: parseInt(lineNum, 10),
            paramCount: parseInt(paramCount, 10),
            paramInfo
        });
    }
}

export async function parseWorkspace() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showInformationMessage('No workspace folder found');
        return;
    }

    const rootPath = workspaceFolder.uri.fsPath;
    const symbolIndexPath = path.join(rootPath, 'symbols.index');

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
            let paramInfoStr = entry.paramInfo
                ? entry.paramInfo.map(param => `${param.name}:${param.type || 'unknown'}`).join(';')
                : '';
            paramInfoStr = paramInfoStr.replace(/[\n\r]/g, '');
            return `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount},${paramInfoStr}`;
        })
        .join('\n');
    fs.writeFileSync(symbolIndexPath, newSymbolData, 'utf-8');
    vscode.window.showInformationMessage('Symbols indexed successfully!');

    await loadSymbolsToMemory();
}
