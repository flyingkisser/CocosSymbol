import * as ts from 'typescript';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface SymbolEntry {
    filePath: string;
    symbolName: string;
    lineNum: number;
    paramCount: number;
}


export function parseSourceFile(sourceFile: ts.SourceFile, filePath: string, symbolEntries: SymbolEntry[], rootPath: string) {
    const recordedProperties = new Set<string>();
    const recordedVariables = new Set<string>(); // Track global variables or outside class variables

    function getClassName(node: ts.ClassLikeDeclaration): string {
        if (node.name) {
            return node.name.text;
        }
        // Check if the class is assigned to a variable or property
        const parent = node.parent;
        if (parent && ts.isBinaryExpression(parent)) {
            if (ts.isIdentifier(parent.left)) {
                return parent.left.text; // Simple variable assignment
            } else if (ts.isPropertyAccessExpression(parent.left)) {
                return getScopeChainFromPropertyAccess(parent.left).join('.');
            }
        }
        if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
            return parent.name.text;
        }
        return "<anonymous>";
    }

    function visit(node: ts.Node, scope: string[]) {
        if ((ts.isClassDeclaration(node) || ts.isClassExpression(node))) {
            const className = getClassName(node);
            const classScope = scope.concat(className);
            recordClassDefinition(classScope.join('.'), node.getStart());

            node.members.forEach(member => {
                if (ts.isPropertyDeclaration(member) && member.name) {
                    const propertyName = member.name.getText();
                    const fullScope = classScope.concat(propertyName).join('.');
                    if (!recordedProperties.has(fullScope)) {
                        recordedProperties.add(fullScope);
                        recordProperty(propertyName, member.getStart(),classScope);
                    }
                } else if (ts.isMethodDeclaration(member) && member.name) {
                    const methodName = member.name.getText();
                    recordFunction(methodName, member.parameters.length, member.getStart(), classScope);
                } else if (ts.isConstructorDeclaration(member)) {
                    recordFunction('constructor', member.parameters.length, member.getStart(),classScope);
                }
            });
        }

        // Process variable declarations and object literals
        if (ts.isVariableStatement(node)) {
            node.declarationList.declarations.forEach(declaration => {
                if (declaration.initializer) {
                    if (ts.isBinaryExpression(declaration.initializer)) {
                        const { left, right } = declaration.initializer;
                        if (ts.isIdentifier(left) && ts.isObjectLiteralExpression(right)) {
                            const baseName = left.text;
                            parseObjectLiteral(baseName, right, scope);
                        }
                    } else if (ts.isObjectLiteralExpression(declaration.initializer)) {
                        const varName = (declaration.name as ts.Identifier).text;
                        parseObjectLiteral(varName, declaration.initializer, scope);
                    }
                }
            });
        }

        // Process expressions like assignments
        if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
            const { left, right } = node.expression;
            if (ts.isPropertyAccessExpression(left)) {
                const scopeChain = getScopeChainFromPropertyAccess(left);
                if (ts.isObjectLiteralExpression(right)) {
                    parseObjectLiteral(scopeChain.join('.'), right, scope);
                }
                // Record the object assignment like ccsp.string
                recordObjectAssignment(scopeChain.join('.'), node.getStart());
            }
        }

        // Process function declarations
        if (ts.isFunctionDeclaration(node) && node.name) {
            const functionName = node.name.text;
            const fullScope = scope.concat(functionName).join('.');
            if (!recordedVariables.has(fullScope)) {
                recordedVariables.add(fullScope);
                recordFunction(functionName, node.parameters.length, node.getStart(),scope);
            }
        } else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
                const functionName = node.parent.name.text;
                const fullScope = scope.concat(functionName).join('.');
                if (!recordedVariables.has(fullScope)) {
                    recordedVariables.add(fullScope);
                    recordFunction(functionName, node.parameters.length, node.getStart(),scope);
                }
            }
        }

        ts.forEachChild(node, child => visit(child, scope));
    }

    function parseObjectLiteral(baseName: string | undefined, node: ts.ObjectLiteralExpression, parentScope: string[]) {
        const currentScope = baseName ? parentScope.concat(baseName.split('.')) : parentScope;
        node.properties.forEach(property => {
            if (ts.isPropertyAssignment(property)) {
                const initializer = property.initializer;
                if (ts.isFunctionExpression(initializer) || ts.isArrowFunction(initializer)) {
                    const name = (property.name as ts.Identifier).text;
                    recordFunction(name, initializer.parameters.length, property.getStart(), currentScope);
                } else if (ts.isObjectLiteralExpression(initializer)) {
                    const name = (property.name as ts.Identifier).text;
                    parseObjectLiteral(name, initializer, currentScope);
                }
            } else if (ts.isMethodDeclaration(property)) {
                const name = property.name.getText();
                recordFunction(name, property.parameters.length, property.getStart(), currentScope);
            }
        });
    }

    function parseClassExpression(baseName: string, node: ts.ClassExpression, parentScope: string[]) {
        const currentScope = parentScope.concat(baseName.split('.'));
        recordClassDefinition(currentScope.join('.'), node.getStart());
        node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
                const name = member.name.getText();
                recordFunction(name, member.parameters.length, member.getStart(), currentScope);
            } else if (ts.isConstructorDeclaration(member)) {
                recordFunction('constructor', member.parameters.length, member.getStart(), currentScope);
            } else if (ts.isPropertyDeclaration(member) && member.name) {
                const propertyName = member.name.getText();
                recordProperty(propertyName, member.getStart(), currentScope);
            }
        });
    }

    function getScopeChainFromPropertyAccess(node: ts.PropertyAccessExpression): string[] {
        const chain: string[] = [];
        let current: ts.Expression = node;
        while (ts.isPropertyAccessExpression(current)) {
            chain.unshift(current.name.text);
            current = current.expression;
        }
        if (ts.isIdentifier(current)) {
            chain.unshift(current.text);
        }
        return chain;
    }

    function recordClassDefinition(name: string, start: number) {
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        symbolEntries.push({ filePath: relativePath, symbolName: name, lineNum: lineNumber, paramCount: 0 });
    }

    function recordFunction(name: string, paramCount: number, start: number, currentScope: string[]) {
        const fullScope = currentScope.concat(name).join('.');
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        symbolEntries.push({ filePath: relativePath, symbolName: fullScope, lineNum: lineNumber, paramCount });
    }

    function recordProperty(name: string, start: number, currentScope: string[]) {
        const fullScope = currentScope.concat(name).join('.');
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        symbolEntries.push({ filePath: relativePath, symbolName: fullScope, lineNum: lineNumber, paramCount: 0 });
    }

    function recordObjectAssignment(name: string, start: number) {
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        symbolEntries.push({ filePath: relativePath, symbolName: name, lineNum: lineNumber, paramCount: 0 });
    }

    visit(sourceFile, []);
}


export async function updateSymbolsForFile(filePath: string, symbolTable: SymbolEntry[], rootPath: string) {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
    const newEntries: SymbolEntry[] = [];

    parseSourceFile(sourceFile, filePath, newEntries, rootPath);

    const relativePath = path.relative(rootPath, filePath);
    const updatedSymbolTable = symbolTable.filter(entry => entry.filePath !== relativePath);

    updatedSymbolTable.push(...newEntries);

    symbolTable.length = 0;
    symbolTable.push(...updatedSymbolTable);

    const newSymbolData = updatedSymbolTable
        .map(entry => `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount}`)
        .join('\n');
    fs.writeFileSync(path.join(rootPath, 'symbols.index'), newSymbolData, 'utf-8');
}

export function removeSymbolsForFile(filePath: string, symbolTable: SymbolEntry[], rootPath: string) {
    const relativePath = path.relative(rootPath, filePath);
    const updatedSymbolTable = symbolTable.filter(entry => entry.filePath !== relativePath);

    symbolTable.length = 0;
    symbolTable.push(...updatedSymbolTable);

    const newSymbolData = updatedSymbolTable
        .map(entry => `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount}`)
        .join('\n');
    fs.writeFileSync(path.join(rootPath, 'symbols.index'), newSymbolData, 'utf-8');
}
