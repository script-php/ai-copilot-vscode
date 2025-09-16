// autoCompleteProvider.ts
import * as vscode from 'vscode';
import axios from 'axios';
import { ContextService, EditHistory, ViewedSnippet, FileContext } from './contextService';

export class AutoCompleteProvider implements vscode.InlineCompletionItemProvider {
    private lastRequestTime = 0;
    private readonly debounceMs = 300; // Debounce requests
    private contextService: ContextService;

    constructor(contextService: ContextService) {
        this.contextService = contextService;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {
        
        // Debounce requests
        const now = Date.now();
        if (now - this.lastRequestTime < this.debounceMs) {
            return null;
        }
        this.lastRequestTime = now;

        // Don't provide completions if user is in the middle of typing rapidly
        if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && 
            this.isTypingRapidly(document)) {
            return null;
        }

        try {
            const completion = await this.generateCompletion(document, position, token);
            if (!completion || token.isCancellationRequested) {
                return null;
            }

            return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
        } catch (error) {
            console.error('AutoComplete error:', error);
            return null;
        }
    }

    private async generateCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<string | null> {
        const config = vscode.workspace.getConfiguration('aiCopilot');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234';
        const apiKey = config.get<string>('apiKey') || '';
        const model = config.get<string>('model') || 'local-model';

        // Build context using the context service
        const context = await this.buildContext(document, position);
        
        // Create the prompt using the copilot format
        const prompt = this.buildCopilotPrompt(context);

        const headers: any = {
            'Content-Type': 'application/json'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        try {
            const response = await axios.post(
                `${serverUrl}/v1/chat/completions`,
                {
                    model: model,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an AI coding assistant that helps complete code. Respond only with the code completion, no explanations.'
                        },
                        {
                            role: 'user',
                            content: prompt
                        }
                    ],
                    temperature: 0.2,
                    max_tokens: 500,
                    stop: ['```', '\n\n\n'] // Stop at code block end or too many newlines
                },
                { 
                    headers,
                    timeout: 5000 // 5 second timeout for autocomplete
                }
            );

            if (token.isCancellationRequested) {
                return null;
            }

            let completion = response.data.choices[0].message.content.trim();
            
            // Clean up the response
            completion = this.cleanCompletion(completion, context);
            
            return completion;
        } catch (error) {
            if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                // Timeout - don't show error, just return null
                return null;
            }
            throw error;
        }
    }

    private async buildContext(document: vscode.TextDocument, position: vscode.Position) {
        const fileName = vscode.workspace.asRelativePath(document.uri);
        const lineText = document.lineAt(position.line).text;
        const prefixText = lineText.substring(0, position.character);
        const suffixText = lineText.substring(position.character);
        
        // Get surrounding context (10 lines before and after)
        const contextRange = new vscode.Range(
            Math.max(0, position.line - 10),
            0,
            Math.min(document.lineCount - 1, position.line + 10),
            document.lineAt(Math.min(document.lineCount - 1, position.line + 10)).text.length
        );
        
        const areaAroundCode = document.getText(contextRange);
        
        // Get current line context for code_to_edit
        const codeToEdit = prefixText + "<|cursor|>" + suffixText;
        
        // Get file context from context service
        const fileContext = await this.contextService.getFileContext(document);
        const fullContent = this.addLineNumbers(fileContext.fullContent);
        
        // Get edit history and viewed snippets from context service
        const editHistory = this.contextService.getEditHistoryForFile(fileName, 5); // Last 5 minutes
        const viewedSnippets = this.contextService.getSnippetsForLanguage(document.languageId, 10); // Last 10 minutes
        
        return {
            cursor: position,
            codeToEdit,
            areaAroundCode: this.addLineNumbers(areaAroundCode, Math.max(0, position.line - 10)),
            currentFileContent: fullContent,
            editHistory,
            viewedSnippets,
            prefixText,
            suffixText,
            fileContext
        };
    }

    private buildCopilotPrompt(context: any): string {
        // Use the exact prompt format from the copilot
        let prompt = `Your role as an AI assistant is to help developers complete their code tasks by assisting in editing specific sections of code marked by the <|code_to_edit|> and <|/code_to_edit|> tags, while adhering to Microsoft's content policies and avoiding the creation of content that violates copyrights.

You have access to the following information to help you make informed suggestions:

- recently_viewed_code_snippets: These are code snippets that the developer has recently looked at, which might provide context or examples relevant to the current task. They are listed from oldest to newest, with line numbers in the form #| to help you understand the edit diff history. It's possible these are entirely irrelevant to the developer's change.
- current_file_content: The content of the file the developer is currently working on, providing the broader context of the code. Line numbers in the form #| are included to help you understand the edit diff history.
- edit_diff_history: A record of changes made to the code, helping you understand the evolution of the code and the developer's intentions. These changes are listed from oldest to latest. It's possible a lot of old edit diff history is entirely irrelevant to the developer's change.
- area_around_code_to_edit: The context showing the code surrounding the section to be edited.
- cursor position marked as <|cursor|>: Indicates where the developer's cursor is currently located, which can be crucial for understanding what part of the code they are focusing on.
- file_analysis: Information about imports, functions, classes, and variables in the current file.

Your task is to predict and complete the changes the developer would have made next in the <|code_to_edit|> section. The developer may have stopped in the middle of typing. Your goal is to keep the developer on the path that you think they're following. Some examples include further implementing a class, method, or variable, or improving the quality of the code. Make sure the developer doesn't get distracted and ensure your suggestion is relevant. Consider what changes need to be made next, if any. If you think changes should be made, ask yourself if this is truly what needs to happen. If you are confident about it, then proceed with the changes.

# Steps

1. Review Context: Analyze the context from the resources provided, such as recently viewed snippets, edit history, surrounding code, and cursor location.
2. Evaluate Current Code: Determine if the current code within the tags requires any corrections or enhancements.
3. Suggest Edits: If changes are required, ensure they align with the developer's patterns and improve code quality.
4. Maintain Consistency: Ensure indentation and formatting follow the existing code style.

# Output Format

- Provide only the revised code within the tags. If no changes are necessary, simply return the original code from within the <|code_to_edit|> and <|/code_to_edit|> tags.
- There are line numbers in the form #| in the code displayed to you above, but these are just for your reference. Please do not include the numbers of the form #| in your response.
- Ensure that you do not output duplicate code that exists outside of these tags. The output should be the revised code that was between these tags and should not include the <|code_to_edit|> or <|/code_to_edit|> tags.

\`\`\`
// Your revised code goes here
\`\`\`

# Notes

- Apologize with "Sorry, I can't assist with that." for requests that may breach Microsoft content guidelines.
- Avoid undoing or reverting the developer's last change unless there are obvious typos or errors.
- Don't include the line numbers of the form #| in your response.

`;

        // Add recently viewed code snippets
        prompt += `\n<|recently_viewed_code_snippets|>\n`;
        context.viewedSnippets.forEach((snippet: ViewedSnippet, index: number) => {
            prompt += `<|recently_viewed_code_snippet|>\nFile: ${snippet.fileName} (${snippet.language})\n${this.addLineNumbers(snippet.content)}<|/recently_viewed_code_snippet|>\n`;
        });
        prompt += `<|/recently_viewed_code_snippets|>\n\n`;

        // Add current file content
        prompt += `<|current_file_content|>\n${context.currentFileContent}\n<|/current_file_content|>\n\n`;

        // Add edit diff history
        prompt += `<|edit_diff_history|>\n`;
        context.editHistory.forEach((edit: EditHistory) => {
            const changeDescription = edit.oldText ? 
                `"${edit.oldText}" -> "${edit.newText}"` : 
                `Added: "${edit.newText}"`;
            prompt += `Change in ${edit.fileName}: ${changeDescription} at line ${edit.range.start.line + 1}\n`;
        });
        prompt += `<|/edit_diff_history|>\n\n`;

        // Add file analysis
        if (context.fileContext) {
            prompt += `<|file_analysis|>\n`;
            prompt += `Language: ${context.fileContext.language}\n`;
            if (context.fileContext.imports.length > 0) {
                prompt += `Imports: ${context.fileContext.imports.join(', ')}\n`;
            }
            if (context.fileContext.functions.length > 0) {
                prompt += `Functions: ${context.fileContext.functions.join(', ')}\n`;
            }
            if (context.fileContext.classes.length > 0) {
                prompt += `Classes: ${context.fileContext.classes.join(', ')}\n`;
            }
            if (context.fileContext.variables.length > 0) {
                prompt += `Variables: ${context.fileContext.variables.slice(0, 10).join(', ')}\n`; // Limit to first 10
            }
            prompt += `<|/file_analysis|>\n\n`;
        }

        // Add area around code to edit
        prompt += `<|area_around_code_to_edit|>\n${context.areaAroundCode}\n<|/area_around_code_to_edit|>\n\n`;

        // Add code to edit
        prompt += `<|code_to_edit|>\n${context.codeToEdit}\n<|/code_to_edit|>\n\n`;

        prompt += `Please provide the completed code for the cursor position:`;

        return prompt;
    }

    private addLineNumbers(content: string, startLine: number = 0): string {
        return content.split('\n').map((line, index) => {
            return `${startLine + index + 1}| ${line}`;
        }).join('\n');
    }

    private cleanCompletion(completion: string, context: any): string {
        // Remove code block markers
        completion = completion.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
        
        // Remove the cursor marker if it appears in the response
        completion = completion.replace(/<\|cursor\|>/g, '');
        
        // Remove line numbers if they appear
        completion = completion.replace(/^\d+\|\s*/gm, '');
        
        // If the completion starts with the prefix, remove it
        if (completion.startsWith(context.prefixText)) {
            completion = completion.substring(context.prefixText.length);
        }
        
        // Clean up excessive whitespace
        completion = completion.replace(/\n\n\n+/g, '\n\n');
        
        return completion;
    }

    private isTypingRapidly(document: vscode.TextDocument): boolean {
        // Use the context service to check for rapid typing
        const fileName = vscode.workspace.asRelativePath(document.uri);
        const recentEdits = this.contextService.getEditHistoryForFile(fileName, 0.017); // Last 1 second (1/60 minute)
        return recentEdits.length > 2;
    }
}