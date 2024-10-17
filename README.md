# CocosSymbol README

In the cocos creator project, sometimes you don't have to import * as foo from './bar' to use the function defined in bar.
You may use the object method to define the function in bar, such as 
foo={ someFunc1:function(){}}
At this time, the symbol cannot be parsed in vscode, and the definition jump cannot be performed.
The main purpose of the CocosCreatorSymbol plug-in is to parse all js or ts files in the current project directory
(excluding *.d.ts, release directory, debug directory, min.js, asm.js),

parse the symbols defined in them, and match the symbols according to certain rules to accurately find its original definition.
If you have any bugs or functional requirements, please contact flyingkisser@163.com.
Pure spare time maintenance, no guarantee of functional integrity or timely response, but a loving heart :) 
There is no need to parse the symbol first.
When you use the shortcut key cmd+d to search for symbols for the first time, if there is no symbol file,
it will be automatically parsed.

The shortcut key for forcing the symbol file to be parsed is cmd+shift+1.
Default shortcut keys:
Search for symbols: cmd+d
Parse all: cmd+shift+1
You can create a symbolic link in the current project and link the engine directory to index the engine symbol.
mkdir engine
cd engine
ln -s /Users/xxx/cocos-engine-git/cocos engine
ln -s /Users/xxx/cocos-engine-git/native native


## Features
\!\[features\]\(images/a.gif\)

## Requirements
no requirements

## Extension Settings
no settings

## Known Issues
n/a

### 0.0.1
1.parse all symbols in current project directory
2.search symbol definition