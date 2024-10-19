import * as vscode from 'vscode';
import { SymbolEntry,parseVariableTypes } from './core'; // Import the SymbolEntry type from your symbol indexer module

export function registerFunctionParamTip(context: vscode.ExtensionContext, symbolTable: SymbolEntry[]) {
    context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(
        [
            { language: 'javascript', scheme: 'file' },
            { language: 'typescript', scheme: 'file' }
        ],
        {
            provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position): vscode.SignatureHelp | null {
                const lineText = document.lineAt(position.line).text;
                let prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\((.*)$/);

                if (!prefixMatch) return null;

                let [_, variableName, methodName, args] = prefixMatch;
                const variableTypes = parseVariableTypes(document);
                let variableType = variableTypes.get(variableName);
                if (!variableType) {
                    prefixMatch = lineText.substr(0, position.character).match(/(\w+(?:\.\w+)*)\.(\w+)\s*\((.*)$/);
                    if (!prefixMatch) return null;
                    [_, variableType, methodName, args] = prefixMatch;
                }

                const methodFullName = `${variableType}.${methodName}`;
                const symbolEntry = symbolTable.find(entry => entry.symbolName === methodFullName);

                if (symbolEntry && symbolEntry.paramInfo) {
                    const signature = new vscode.SignatureInformation(
                        `${methodName}(${symbolEntry.paramInfo.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ')})`
                    );
                    signature.parameters = symbolEntry.paramInfo.map(p => new vscode.ParameterInformation(p.name));

                    const signatureHelp = new vscode.SignatureHelp();
                    signatureHelp.signatures = [signature];
                    signatureHelp.activeSignature = 0;
                    const activeParameter = args.split(',').length - 1;
                    signatureHelp.activeParameter = Math.min(activeParameter, symbolEntry.paramInfo.length - 1);

                    return signatureHelp;
                }

                return null;
            }
        }, '(', ',' // Trigger characters for signature help
    ));
}