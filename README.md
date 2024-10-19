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
1、Search for symbols: cmd+d  
2、Parse all: cmd+shift+1  

You can create a symbolic link in the current project and link the engine directory to index the engine symbol.  
mkdir scripting  
cd scripting  
ln -s /Users/xxx/cocos-engine-git/cocos engine  
ln -s /Users/xxx/cocos-engine-git/native native

用于解决cocos creator项目中，当不使用import * as foo from './bar'时，或者使用全局变量，或者使用命名空间时，无法找到函数定义的问题。  
支持函数调用时，显示参数提示。  
可以把引擎目录链接到当前项目，这样就可以全局索引引擎代码的各种符号定义。  
会在项目根目录生成文件symbols.index，用于保存所有符号定义。  
支持CocosCreator3.x 


## Features
符号定位  
goto  symbol definition  
![image](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExYXFpNnZxa3FhcnNwbDBuYXNreGlxNDdpa3dtZjhhYTN0YXdrejB4biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GQTRvfDGBKZHBYIFj8/giphy.gif)  
函数参数提示   
function call parameter prompt  
![image](https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExbHZ0cmJydXhiczNoMWZiOG5qZ3M4MGpxeGlxamNqdXdvMHMwbzFiYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cvFGv8ykwpsGtNt97E/giphy.gif)  


## Requirements
cd ~/.vscode/extensions/flyingkisser.cocossymbol-0.0.2  
npm install  
or cnpm install if you're in China

## Extension Settings
no settings

## Known Issues
n/a

### 0.0.2
Add prompts for function parameters when calling functions

### 0.0.1
1.parse all symbols in current project directory  
2.search symbol definition