// contextService.ts
import * as vscode from 'vscode';

export interface EditHistory {
    timestamp: number;
    range: vscode.Range;
    oldText: string;
    newText: string;
    fileName: string;
}

export interface ViewedSnippet {
    timestamp: number;
    fileName: string;
    content: string;
    range: vscode.Range;
    language: string;
}

export interface FileContext {
    fullContent: string;
    language: string;
    imports: string[];
    functions: string[];
    classes: string[];
    variables: string[];
}

export class ContextService {
    private editHistory: EditHistory[] = [];
    private viewedSnippets: ViewedSnippet[] = [];
    private fileContextCache: Map<string, FileContext> = new Map();
    private readonly maxHistoryItems = 20;
    private readonly maxSnippetItems = 10;
    private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

    constructor() {
        this.setupEventListeners();
    }

    private setupEventListeners() {
        // Track document changes
        vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this));
        
        // Track cursor movements and selections
        vscode.window.onDidChangeTextEditorSelection(this.onSelectionChange.bind(this));
        
        // Track active editor changes
        vscode.window.onDidChangeActiveTextEditor(this.onActiveEditorChange.bind(this));
        
        // Clear cache when documents are closed
        vscode.workspace.onDidCloseTextDocument(this.onDocumentClose.bind(this));
    }

    // Edit History Management
    public getRecentEditHistory(minutes: number = 5): EditHistory[] {
        const timeThreshold = Date.now() - (minutes * 60 * 1000);
        return this.editHistory.filter(edit => edit.timestamp > timeThreshold);
    }

    public getEditHistoryForFile(fileName: string, minutes: number = 5): EditHistory[] {
        return this.getRecentEditHistory(minutes).filter(edit => edit.fileName === fileName);
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.contentChanges.length === 0) return;
        
        const fileName = vscode.workspace.asRelativePath(event.document.uri);
        
        event.contentChanges.forEach(change => {
            const edit: EditHistory = {
                timestamp: Date.now(),
                range: change.range,
                oldText: change.text ? '' : event.document.getText(change.range),
                newText: change.text,
                fileName: fileName
            };
            
            this.editHistory.push(edit);
        });

        // Keep history manageable
        if (this.editHistory.length > this.maxHistoryItems) {
            this.editHistory = this.editHistory.slice(-this.maxHistoryItems);
        }

        // Invalidate cache for this file
        this.fileContextCache.delete(fileName);
    }

    // Viewed Snippets Management
    public getRecentViewedSnippets(minutes: number = 10): ViewedSnippet[] {
        const timeThreshold = Date.now() - (minutes * 60 * 1000);
        return this.viewedSnippets.filter(snippet => snippet.timestamp > timeThreshold);
    }

    public getSnippetsForLanguage(language: string, minutes: number = 10): ViewedSnippet[] {
        return this.getRecentViewedSnippets(minutes).filter(snippet => snippet.language === language);
    }

    private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
        if (!event.textEditor.selection.isEmpty) {
            const document = event.textEditor.document;
            const fileName = vscode.workspace.asRelativePath(document.uri);
            const language = document.languageId;
            
            const snippet: ViewedSnippet = {
                timestamp: Date.now(),
                fileName: fileName,
                content: document.getText(event.textEditor.selection),
                range: event.textEditor.selection,
                language: language
            };
            
            this.viewedSnippets.push(snippet);
            
            // Keep snippets manageable
            if (this.viewedSnippets.length > this.maxSnippetItems) {
                this.viewedSnippets = this.viewedSnippets.slice(-this.maxSnippetItems);
            }
        }
    }

    // File Context Management
    public async getFileContext(document: vscode.TextDocument): Promise<FileContext> {
        const fileName = vscode.workspace.asRelativePath(document.uri);
        const cached = this.fileContextCache.get(fileName);
        
        if (cached) {
            return cached;
        }

        const context = await this.analyzeFile(document);
        this.fileContextCache.set(fileName, context);
        
        // Set timeout to clear cache
        setTimeout(() => {
            this.fileContextCache.delete(fileName);
        }, this.cacheTimeout);

        return context;
    }

    private async analyzeFile(document: vscode.TextDocument): Promise<FileContext> {
        const content = document.getText();
        const language = document.languageId;
        
        return {
            fullContent: content,
            language: language,
            imports: this.extractImports(content, language),
            functions: this.extractFunctions(content, language),
            classes: this.extractClasses(content, language),
            variables: this.extractVariables(content, language)
        };
    }

    private extractImports(content: string, language: string): string[] {
        const importPatterns: { [key: string]: RegExp } = {
            'javascript': /(import\s+.*?from\s+['"][^'"]+['"]|require\(['"][^'"]+['"]\))/g,
            'typescript': /(import\s+.*?from\s+['"][^'"]+['"]|require\(['"][^'"]+['"]\))/g,
            'python': /(import\s+\w+|from\s+\w+\s+import)/g,
            'java': /(import\s+[a-zA-Z0-9_.*]+;)/g,
            'csharp': /(using\s+[a-zA-Z0-9_.]+;)/g,
            'ruby': /(require\s+['"][^'"]+['"])/g,
            'php': /(require\s+['"][^'"]+['"])/g,
            'css': /(import\s+['"][^'"]+['"])/g
        };

        const pattern = importPatterns[language] || /$/;
        const matches = content.match(pattern) || [];
        return matches.map(m => m.trim());
    }

    private extractFunctions(content: string, language: string): string[] {
        const functionPatterns: { [key: string]: RegExp } = {
            'javascript': /(function\s+\w+|const\s+\w+\s*=\s*\([^)]*\)\s*=>|async\s+function\s+\w+)/g,
            'typescript': /(function\s+\w+|const\s+\w+\s*:\s*\([^)]*\)\s*=>|async\s+function\s+\w+)/g,
            'python': /(def\s+\w+\([^)]*\):)/g,
            'java': /(public|private|protected)?\s*(static)?\s*\w+\s+\w+\([^)]*\)\s*\{/g,
            'csharp': /(public|private|protected)?\s*(static)?\s*\w+\s+\w+\([^)]*\)\s*\{/g,
            'ruby': /(def\s+\w+(\(.*\))?)/g,
            'php': /(function\s+\w+\s*\([^)]*\)\s*\{)/g,
            'css': /$/g // CSS does not have functions
        };

        const pattern = functionPatterns[language] || /$/;
        const matches = content.match(pattern) || [];
        return matches.map(m => m.trim());
    }

    private extractClasses(content: string, language: string): string[] {
        const classPatterns: { [key: string]: RegExp } = {
            'javascript': /(class\s+\w+)/g,
            'typescript': /(class\s+\w+)/g,
            'python': /(class\s+\w+)/g,
            'java': /(class\s+\w+)/g,
            'csharp': /(class\s+\w+)/g,
            'ruby': /(class\s+\w+)/g,
            'php': /(class\s+\w+)/g,
            'css': /(class\s+\w+)/g
        };

        const pattern = classPatterns[language] || /$/;
        const matches = content.match(pattern) || [];
        return matches.map(m => m.trim());
    }

    private extractVariables(content: string, language: string): string[] {
        const variablePatterns: { [key: string]: RegExp } = {
            'javascript': /(const|let|var)\s+\w+/g,
            'typescript': /(const|let|var)\s+\w+/g,
            'python': /(\w+)\s*=/g,
            'java': /(\w+)\s*=/g,
            'csharp': /(\w+)\s*=/g,
            'ruby': /(\w+)\s*=/g,
            'php': /(\$\w+)\s*=/g,
            'css': /$/g // CSS does not have variables in the traditional sense
        };

        const pattern = variablePatterns[language] || /$/;
        const matches = content.match(pattern) || [];
        return matches.map(m => m.trim());
    }

    private onActiveEditorChange(editor: vscode.TextEditor | undefined) {
        if (editor) {
            // Pre-cache context for the active file
            this.getFileContext(editor.document).catch(console.error);
        }
    }

    private onDocumentClose(document: vscode.TextDocument) {
        const fileName = vscode.workspace.asRelativePath(document.uri);
        this.fileContextCache.delete(fileName);
    }

    // Utility methods
    public clearCache() {
        this.fileContextCache.clear();
        this.editHistory = [];
        this.viewedSnippets = [];
    }

    public getStats() {
        return {
            editHistoryCount: this.editHistory.length,
            viewedSnippetsCount: this.viewedSnippets.length,
            cachedFilesCount: this.fileContextCache.size
        };
    }
}