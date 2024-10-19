import * as vscode from 'vscode';
// import * as ts from 'typescript';
// import * as fs from 'fs';
// import * as path from 'path';
import {  updateSymbolsForFile, removeSymbolsForFile } from './core';
import { findReferences,showSavedReferences } from './referenceFinder';

import {registerMethodCompletion} from './methodCompletion';
import {registerFunctionParamTip} from './functionParamTip';
import {findSymbol} from './symbolLookup';

import {symbolTable,loadSymbolsToMemory,parseWorkspace} from './symbolIndexer';

export async function activate(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const rootPath = workspaceFolder?.uri.fsPath || '';

    await loadSymbolsToMemory();
    console.log(`Loaded ${symbolTable.length} symbols to memory`);

    //符号解析
    let generateIndexDisposable = vscode.commands.registerCommand('cocos.parse', parseWorkspace);
    context.subscriptions.push(generateIndexDisposable);
    //监听文件变化
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.{js,ts}', false, false, false);
    fileWatcher.onDidChange(uri => updateSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    fileWatcher.onDidCreate(uri => updateSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    fileWatcher.onDidDelete(uri => removeSymbolsForFile(uri.fsPath, symbolTable, rootPath));
    context.subscriptions.push(fileWatcher);

    //符号跳转
    let findSymbolDisposable = vscode.commands.registerCommand('cocos.goto',findSymbol);
    context.subscriptions.push(findSymbolDisposable);
	
	//类或命名空间成员函数提示
    registerMethodCompletion(context, symbolTable);
    
    //函数参数提示
    registerFunctionParamTip(context, symbolTable);
	
    //符号的引用
    const findReferencesCommand = vscode.commands.registerCommand('cocos.findReferences', findReferences );
    const showSavedReferencesCommand = vscode.commands.registerCommand('cocos.showSavedReferences',showSavedReferences);
    context.subscriptions.push(findReferencesCommand, showSavedReferencesCommand);

}

export function deactivate() {}
