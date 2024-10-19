import * as ts from 'typescript';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface SymbolEntry {
    filePath: string;
    symbolName: string;
    lineNum: number;
    paramCount: number;
    paramInfo?: { name: string; type?: string }[]; // Add parameter info
}

export function getClassName(lineText:string):string{
      // Match against class expressions assigned to a variable or object property
      const classExpressionMatch = lineText.match(/^([\w.]+)\s*=\s*class\s*(?:extends\s+[\w.]+\s*)?{/);
      if (classExpressionMatch) {
        return classExpressionMatch[1] || "";
      }
      // Match against direct class declarations
      const classDeclarationMatch = lineText.match(/^class\s+([\w.]+)/);
      if (classDeclarationMatch) {
          return classDeclarationMatch[1] || "";
      }
      return "";
}

export function parseSourceFile(sourceFile: ts.SourceFile, filePath: string, symbolEntries: SymbolEntry[], rootPath: string) {
    const recordedProperties = new Set<string>();
    const recordedVariables = new Set<string>(); // Track global variables or outside class variables
    var symbolMap:any={};

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
                    recordFunction(methodName, member.parameters.length, member.getStart(), classScope,member.parameters);
                } else if (ts.isConstructorDeclaration(member)) {
                    recordFunction('constructor', member.parameters.length, member.getStart(),classScope,member.parameters);
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
                recordFunction(functionName, node.parameters.length, node.getStart(),scope,node.parameters);
            }
        } else if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
                const functionName = node.parent.name.text;
                const fullScope = scope.concat(functionName).join('.');
                if (!recordedVariables.has(fullScope)) {
                    recordedVariables.add(fullScope);
                    recordFunction(functionName, node.parameters.length, node.getStart(),scope,node.parameters);
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
                    recordFunction(name, initializer.parameters.length, property.getStart(), currentScope,initializer.parameters);
                } else if (ts.isObjectLiteralExpression(initializer)) {
                    const name = (property.name as ts.Identifier).text;
                    parseObjectLiteral(name, initializer, currentScope);
                }
            } else if (ts.isMethodDeclaration(property)) {
                const name = property.name.getText();
                recordFunction(name, property.parameters.length, property.getStart(), currentScope,property.parameters);
            }
        });
    }

    function parseClassExpression(baseName: string, node: ts.ClassExpression, parentScope: string[]) {
        const currentScope = parentScope.concat(baseName.split('.'));
        recordClassDefinition(currentScope.join('.'), node.getStart());
        node.members.forEach(member => {
            if (ts.isMethodDeclaration(member) && member.name) {
                const name = member.name.getText();
                recordFunction(name, member.parameters.length, member.getStart(), currentScope,member.parameters);
            } else if (ts.isConstructorDeclaration(member)) {
                recordFunction('constructor', member.parameters.length, member.getStart(), currentScope,member.parameters);
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
        let key=relativePath+name+lineNumber;
        if(symbolMap[key])
            return;
        symbolMap[key]=1;
        symbolEntries.push({ filePath: relativePath, symbolName: name, lineNum: lineNumber, paramCount: 0 });
    }

    // function recordFunction(name: string, paramCount: number, start: number, currentScope: string[]) {
    //     const fullScope = currentScope.concat(name).join('.');
    //     const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
    //     const relativePath = path.relative(rootPath, filePath);
    //     let key=relativePath+name+lineNumber;
    //     if(symbolMap[key])
    //         return;
    //     symbolMap[key]=1;
    //     symbolEntries.push({ filePath: relativePath, symbolName: fullScope, lineNum: lineNumber, paramCount });
    // }
    function recordFunction(name: string, paramCount: number, start: number, currentScope: string[], parameters: ts.NodeArray<ts.ParameterDeclaration>) {
        const fullScope = currentScope.concat(name).join('.');
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
    
        // Extract parameter names and types
        const paramInfo = parameters.map(param => {
            const paramName = (param.name as ts.Identifier).text;
            const paramType = param.type ? param.type.getText() : undefined;
            return { name: paramName, type: paramType };
        });
    
        let key = relativePath + name + lineNumber;
        if (symbolMap[key])
            return;
        symbolMap[key] = 1;
     
        symbolEntries.push({ filePath: relativePath, symbolName: fullScope, lineNum: lineNumber, paramCount, paramInfo });
    }

    function recordProperty(name: string, start: number, currentScope: string[]) {
        const fullScope = currentScope.concat(name).join('.');
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        let key=relativePath+name+lineNumber;
        if(symbolMap[key])
            return;
        symbolMap[key]=1;
        symbolEntries.push({ filePath: relativePath, symbolName: fullScope, lineNum: lineNumber, paramCount: 0 });
    }

    function recordObjectAssignment(name: string, start: number) {
        const lineNumber = sourceFile.getLineAndCharacterOfPosition(start).line + 1;
        const relativePath = path.relative(rootPath, filePath);
        let key=relativePath+name+lineNumber;
        if(symbolMap[key])
            return;
        symbolMap[key]=1;
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

    // const newSymbolData = updatedSymbolTable
    //     .map(entry => `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount}`)
    //     .join('\n');
	const newSymbolData = updatedSymbolTable
		.map(entry => {
			const paramInfoStr = entry.paramInfo
				? entry.paramInfo.map(param => `${param.name}:${param.type || 'unknown'}`).join(';')
				: '';
                if(!entry.symbolName)
                    entry.symbolName='';
			return `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount},${paramInfoStr}`;
		})
		.join('\n');        
    fs.writeFileSync(path.join(rootPath, 'symbols.index'), newSymbolData, 'utf-8');
}

export function removeSymbolsForFile(filePath: string, symbolTable: SymbolEntry[], rootPath: string) {
    const relativePath = path.relative(rootPath, filePath);
    const updatedSymbolTable = symbolTable.filter(entry => entry.filePath !== relativePath);

    symbolTable.length = 0;
    symbolTable.push(...updatedSymbolTable);

    // const newSymbolData = updatedSymbolTable
    //     .map(entry => `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount}`)
    //     .join('\n');
    const newSymbolData = updatedSymbolTable
		.map(entry => {
			const paramInfoStr = entry.paramInfo
				? entry.paramInfo.map(param => `${param.name}:${param.type || 'unknown'}`).join(';')
				: '';
                if(!entry.symbolName)
                    entry.symbolName='';
			return `${entry.filePath},${entry.symbolName},${entry.lineNum},${entry.paramCount},${paramInfoStr}`;
		})
		.join('\n');        fs.writeFileSync(path.join(rootPath, 'symbols.index'), newSymbolData, 'utf-8');
}

export function determineObjectTypeFromContext(document:vscode.TextDocument, position:vscode.Position,symbolTable:SymbolEntry[]):string {
    const variableTypes = parseVariableTypes(document);
    const lineText = document.lineAt(position).text.substr(0, position.character);
    const prefixMatch = lineText.match(/([\w.]+)\.$/);
    if (prefixMatch) {
        const objectPath = prefixMatch[1];
        console.log(`Detected object path: ${objectPath}`); // Debug log
        // Check if the objectPath is a known variable
        if (variableTypes.has(objectPath)) {
            return variableTypes.get(objectPath) || "";
        }
        // Check if the object path corresponds to any known symbol in the symbol table
        const matchingSymbol = symbolTable.find(entry => {
            if (!entry.symbolName)
                return false;
            return entry.symbolName.startsWith(objectPath);
        });
        if (matchingSymbol) {
            console.log(`Matching symbol found: ${matchingSymbol.filePath}`); // Debug log
            if (objectPath && matchingSymbol.symbolName.includes(objectPath))
                return objectPath;
            console.log(`Matching symbol found: ${matchingSymbol.symbolName}`); // Debug log
            return matchingSymbol.symbolName;
        }
    }
    return '';
}

export function parseVariableTypes(document: vscode.TextDocument): Map<string, string> {
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