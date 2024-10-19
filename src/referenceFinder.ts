import * as vscode from 'vscode';
import {getClassName} from './core';

export let savedReferences: vscode.Location[] = [];
export let savedItems: (vscode.QuickPickItem & { location: vscode.Location })[] = [];

let lastSelectedIndex: number | undefined;

export async function findNamespaceAndFunctionAtCursor(editor: vscode.TextEditor): Promise<{ namespace: string, functionName: string } | null> {
    const document = editor.document;
    const position = editor.selection.active;
    const wordRange = document.getWordRangeAtPosition(position, /\w+/);

    if (!wordRange) {
        return null;
    }

    const word = document.getText(wordRange);
    const text = document.getText();
    const lines = text.split('\n');

    const namespaceStack: string[] = [];
    let currentNamespace = '';
    let currentClass = '';
    let insideClass = false;
    let braceDepth = 0; // Track the depth of the braces

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if(!line) continue;

        // Check for class declarations
        const newClass = getClassName(line);
        if (newClass) {
            currentClass = newClass;
            insideClass = true;
            braceDepth = 0; // Reset brace depth for new class
        }
        // Adjust brace depth
        if (insideClass) {
            braceDepth += (line.match(/{/g) || []).length;
            braceDepth -= (line.match(/}/g) || []).length;
            if (braceDepth <= 0) {
                insideClass = false;
                currentClass = '';
            }
        }

        const namespaceMatch = line.match(/(\w+(?:\.\w+)*)\s*=\s*{(?![^}]*};)/);
        if (namespaceMatch) {
            currentNamespace = namespaceMatch[1];
            namespaceStack.push(currentNamespace);
        }

        if (line.includes('{')) {
            if (!namespaceMatch) {
                namespaceStack.push('{');
            }
        }

        if (line.includes('}')) {
            const lastEntry = namespaceStack.pop();
            if (lastEntry !== '{') {
                currentNamespace = namespaceStack.length > 0 ? namespaceStack[namespaceStack.length - 1] : '';
            }
        }

        const functionDefMatch = line.match(new RegExp(`\\b${word}\\s*:\\s*function\\s*\\(`));
        if (functionDefMatch && i === position.line) {
            return { namespace: currentNamespace, functionName: word };
        }
        // Check for method definitions in classes
        if (insideClass) {
            const methodDefMatch = line.match(new RegExp(`\\b${word}\\s*\\(`));
            if (methodDefMatch && i === position.line) {
                return { namespace: currentClass, functionName: word };
            }
        }
    }
    return null;
}

export async function findReferencesInWorkspace(namespace: string, functionName: string) {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders) {
        vscode.window.showWarningMessage('No workspace folder open');
        return;
    }

    const references: vscode.Location[] = [];
    const currentDocument = vscode.window.activeTextEditor?.document;
    const currentFilePath = currentDocument?.uri.fsPath;

    for (const folder of workspaceFolders) {
        const excludePattern = '{**/node_modules/**,temp/*,**/temp/**,**/build/**,**/release/**,**/Release/**,**/debug/**,**/Debug/**,**/simulator/**,**/*.d.ts,**/*.min.js,**/*.asm.js}';
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{js,ts}'), excludePattern);

        for (const file of files) {
            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            const lines = text.split('\n');

             // Regular expression to match both namespace.functionName and this.functionName
            // const specificCallRegex = new RegExp(`\\b(?:${namespace}\\.|this\\.)${functionName}\\s*\\(`);
            const specificCallRegex = new RegExp(`\\b(?:${namespace}\\.|this\\.|\\w+\\.)${functionName}\\s*\\(`);

            // Track object instances and their types
            const instanceMap: { [key: string]: string } = {};

            if(file.path.indexOf("ui_align")!==-1)
                console.log(file.path);

            lines.forEach((line, lineNumber) => {
                const trimmedLine = line.trim();

                // Attempt to capture object instances
                const instanceMatch = trimmedLine.match(/(?:var|let|const)\s+(\w+)\s*=\s*new\s+([\w.]+)\s*\(/);
                if (instanceMatch) {
                    const [_, instanceName, className] = instanceMatch;
                    instanceMap[instanceName] = className;
                }

                // Track assignments to capture aliasing
                const aliasMatch = trimmedLine.match(/(\w+)\s*=\s*(\w+)\s*;/);
                if (aliasMatch) {
                    const [_, aliasName, originalName] = aliasMatch;
                    if (instanceMap[originalName]) {
                        instanceMap[aliasName] = instanceMap[originalName];
                    }
                }

                // Check for method calls
                if (specificCallRegex.test(trimmedLine)) {
                    const namespaceIndex = trimmedLine.indexOf(`${namespace}.${functionName}`);
                    const thisIndex = trimmedLine.indexOf(`this.${functionName}`);
                    let objectMethodIndex = -1;
                    let objectName = '';

                    // Check for calls like object.functionName()
                    // const objectMethodMatch = trimmedLine.match(/(\w+)\.\b${functionName}\s*\(/);
                    const objectMethodMatch = trimmedLine.match(new RegExp(`(\\w+)\\.${functionName}\\s*\\(`));
                    if (objectMethodMatch) {
                        objectName = objectMethodMatch[1];
                        if (instanceMap[objectName] === namespace) {
                            objectMethodIndex = trimmedLine.indexOf(`${objectName}.${functionName}`);
                        }
                    }

                    // Determine which index to use (if both exist, use the first occurrence)
                    const index = namespaceIndex !== -1 ? namespaceIndex : (thisIndex !== -1 ? thisIndex : objectMethodIndex);

                    if (index !== -1) {
                        // If the reference is through "this", ensure it's in the same file
                        if (thisIndex !== -1 && file.fsPath !== currentFilePath) {
                            // It's a "this" reference but not in the same file, so skip it
                            return;
                        }
                        references.push(new vscode.Location(file, new vscode.Position(lineNumber, index)));
                    }
                }
            });
        }
    }

    if (references.length > 0) {
        savedReferences = references; // Save references globally
        savedItems = await Promise.all(references.map(async ref => {
            const document = await vscode.workspace.openTextDocument(ref.uri);
            const lines = document.getText().split('\n');
            const relativePath = vscode.workspace.asRelativePath(ref.uri.fsPath);
            const lineContent = ref.range.start.line;
            return {
                label: `${relativePath} - Line ${lineContent + 1}`,
                description: lines[lineContent].trim(),
                location: ref
            };
        }));
        showQuickPick(savedItems, namespace, functionName);
    } else {
        vscode.window.showInformationMessage(`No references found for ${namespace}.${functionName}.`);
    }
}

export function showQuickPick(items: (vscode.QuickPickItem & { location: vscode.Location })[], namespace: string, functionName: string) {
    const quickPick = vscode.window.createQuickPick();
    quickPick.items = items;
    quickPick.placeholder = `Found ${items.length} references to ${namespace}.${functionName}.`;
   // 设置初始选择项
   if (lastSelectedIndex !== undefined && lastSelectedIndex < items.length) {
    quickPick.activeItems = [items[lastSelectedIndex]];
}
    quickPick.onDidChangeSelection(async selection => {
        if (selection[0]) {
            const selectedItem = selection[0] as vscode.QuickPickItem & { location: vscode.Location };
            // 记录用户选择的行号
            lastSelectedIndex = items.indexOf(selectedItem);
            const document = await vscode.workspace.openTextDocument(selectedItem.location.uri);
            const editor = await vscode.window.showTextDocument(document);
            editor.revealRange(selectedItem.location.range, vscode.TextEditorRevealType.InCenter);
            editor.selection = new vscode.Selection(selectedItem.location.range.start, selectedItem.location.range.end);

            if (savedItems.length > 0) {
                showQuickPick(savedItems, 'Saved', 'References');
            }
        }
    });

    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
}