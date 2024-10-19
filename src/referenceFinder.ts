import * as vscode from 'vscode';

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

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

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

    for (const folder of workspaceFolders) {
        const excludePattern = '{**/node_modules/**,temp/*,**/temp/**,**/build/**,**/release/**,**/Release/**,**/debug/**,**/Debug/**,**/simulator/**,**/*.d.ts,**/*.min.js,**/*.asm.js}';
        const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{js,ts}'), excludePattern);

        for (const file of files) {
            const document = await vscode.workspace.openTextDocument(file);
            const text = document.getText();
            const lines = text.split('\n');

            const specificCallRegex = new RegExp(`\\b${namespace}\\.${functionName}\\s*\\(`);
            lines.forEach((line, lineNumber) => {
                if (specificCallRegex.test(line)) {
                    const index = line.indexOf(`${namespace}.${functionName}`);
                    if (index !== -1) {
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