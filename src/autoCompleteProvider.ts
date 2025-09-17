// autoCompleteProvider.ts
import * as vscode from 'vscode';
import axios from 'axios';
import { ContextService, EditHistory, ViewedSnippet, FileContext } from './contextService';
import { AILogger } from './logger'; // TODO: to remove later

// Prompt element interface for structured prompt building
interface PromptElement {
    priority: number;
    content: string;
    isBreak?: boolean;
    metadata?: any;
}

// Add this class to handle consistent formatting 
class PromptFormatter {
    static singleBreak(): PromptElement {
        return { priority: 0, content: "", isBreak: true };
    }
    
    static doubleBreak(): PromptElement {
        return { priority: 0, content: "\n", isBreak: true };
    }
    
    static sectionHeader(content: string, priority: number): PromptElement {
        return { priority, content: content + "\n" };
    }
    
    static tagWrapper(content: string, tag: string, priority: number): PromptElement[] {
        return [
            { priority, content: `<|${tag}|>` }, // Use <|tag|> syntax consistently
            PromptFormatter.singleBreak(),
            { priority: priority - 1, content: content },
            PromptFormatter.singleBreak(),
            { priority: priority - 2, content: `<|/${tag}|>` }, // Use <|/tag|> syntax consistently
            PromptFormatter.doubleBreak()
        ];
    }
}

export class AutoCompleteProvider implements vscode.InlineCompletionItemProvider {
    private lastRequestTime = 0;
    private readonly debounceMs = 300; // Debounce requests
    private contextService: ContextService;
    private logger: AILogger; // Add logger instance // TODO: to remove later
    private isManualTrigger = false;

    constructor(contextService: ContextService) {
        this.contextService = contextService;
        this.logger = new AILogger(); // Initialize logger // TODO: to remove later
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null> {

        const config = vscode.workspace.getConfiguration('aiCopilot');
        const autoCompleteEnabled = config.get<boolean>('completionsEnabled', true);

        if (!this.isManualTrigger && !autoCompleteEnabled) {
            return null;
        }
        
        // Reset manual trigger flag after use
        if (this.isManualTrigger) {
            this.isManualTrigger = false;
        }
        
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
    
     public async triggerManualCompletion(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<string | null> {
        this.isManualTrigger = true;
        try {
            return await this.generateCompletion(document, position, new vscode.CancellationTokenSource().token);
        } finally {
            this.isManualTrigger = false;
        }
    }

    //
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

        // Adjust token limit based on model size
        let maxPromptTokens = config.get<number>('maxTokens') || 500; // Default for larger models

        // if (model.includes('1.5b') || model.includes('small') || model.includes('tiny')) {
        //     maxPromptTokens = 1500; // Much smaller for tiny models
        // } else if (model.includes('7b') || model.includes('8b')) {
        //     maxPromptTokens = 2500; // Medium for 7B models
        // }

        
        // Create the structured prompt using the copilot format
        // const promptElements = this.buildStructuredPrompt(context);
        // const finalPrompt = this.optimizePromptLength(this.renderPromptElements(promptElements));

        // Create the structured prompt with token awareness
        const promptElements = this.buildStructuredPrompt(context, maxPromptTokens);
        const finalPrompt = this.renderPromptElements(promptElements);

        // Log the prompt before sending 
        this.logger.logPrompt(finalPrompt, context); // TODO: to remove later

        

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
                            content: this.getInstructions()
                        },
                        {
                            role: 'user',
                            content: finalPrompt
                        }
                    ],
                    temperature: config.get<number>('temperature', 0.2),
                    max_tokens: config.get<number>('maxTokens', 200),
                    stop: ['```', '\n\n\n'] // Stop at code block end or too many newlines
                },
                { 
                    headers,
                    timeout: 500000 //config.get<number>('timeout', 5000) // 5 second timeout for autocomplete
                }
            );

            // 
            if (token.isCancellationRequested) {
                return null;
            }

            let completion = response.data.choices[0].message.content.trim();
            
            // Clean up the response
            completion = this.cleanCompletion(completion, context);
            
            // Log the successful response
            this.logger.logPrompt(finalPrompt, context, completion); // TODO: to remove later
            
            return completion;
        } catch (error) {
            // Log the error
            // TODO: to remove later
            if (axios.isAxiosError(error)) {
                this.logger.log(`AI Request Failed: ${error.message}`, 'ERROR', {
                    code: error.code,
                    url: serverUrl
                });
            }

            if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
                // Timeout - don't show error, just return null
                return null;
            }
            throw error;
        }
    }

    //
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
            fileContext,
            fileName,
            language: document.languageId
        };
    }

    // Add this helper method to estimate tokens
    private estimateTokens(text: string): number {
        // Simple estimation: 1 token ≈ 4 characters for English
        // More accurate: count words + special tokens
        return Math.ceil(text.length / 4);
    }

    private getCurrentTokenCount(elements: PromptElement[]): number {
        return this.estimateTokens(this.renderPromptElements(elements));
    }

    private buildTokenAwareCopilotSections(context: any, availableTokens: number): { content: string; tokensUsed: number } {
        const sections: string[] = [];
        let tokensUsed = 0;

        // Add recently viewed code snippets (truncate if needed)
        if (availableTokens - tokensUsed > 500) {
            sections.push(`<|recently_viewed_code_snippets|>`);
            tokensUsed += 30;
            
            let snippetCount = 0;
            for (const snippet of context.viewedSnippets) {
                const snippetContent = `<|recently_viewed_code_snippet|>\nFile: ${snippet.fileName} (${snippet.language})\n${this.addLineNumbers(snippet.content)}\n<|/recently_viewed_code_snippet|>\n`;
                const snippetTokens = this.estimateTokens(snippetContent);
                
                if (tokensUsed + snippetTokens > availableTokens * 0.3) {
                    break; // Stop adding snippets if we're using too many tokens
                }
                
                sections.push(snippetContent);
                tokensUsed += snippetTokens;
                snippetCount++;
                
                if (snippetCount >= 3) break; // Limit to 3 snippets max
            }
            sections.push(`<|/recently_viewed_code_snippets|>\n`);
            tokensUsed += 30;
        }

        // Add current file content (truncated if needed)
        if (availableTokens - tokensUsed > 300) {
            const maxFileTokens = Math.min(availableTokens - tokensUsed - 100, 1000);
            let fileContent = context.currentFileContent;
            
            if (this.estimateTokens(fileContent) > maxFileTokens) {
                // Truncate file content while preserving structure
                const lines = fileContent.split('\n');
                fileContent = lines.slice(0, 50).join('\n') + '\n// ... [file content truncated] ...\n';
            }
            
            sections.push(`<|current_file_content|>\n${fileContent}\n<|/current_file_content|>\n`);
            tokensUsed += this.estimateTokens(fileContent) + 30;
        }

        // Add edit diff history (brief summary only)
        if (availableTokens - tokensUsed > 200 && context.editHistory.length > 0) {
            sections.push(`<|edit_diff_history|>\n`);
            tokensUsed += 25;
            
            // Only include most recent 3 edits
            const recentEdits = context.editHistory.slice(-3);
            for (const edit of recentEdits) {
                const changeDescription = edit.oldText ? 
                    `"${edit.oldText}" -> "${edit.newText}"` : 
                    `Added: "${edit.newText}"`;
                const editText = `Change at line ${edit.range.start.line + 1}: ${changeDescription}\n`;
                
                if (tokensUsed + this.estimateTokens(editText) > availableTokens * 0.1) {
                    break;
                }
                
                sections.push(editText);
                tokensUsed += this.estimateTokens(editText);
            }
            sections.push(`<|/edit_diff_history|>\n`);
            tokensUsed += 25;
        }

        // Add file analysis (only if we have space)
        if (availableTokens - tokensUsed > 150 && context.fileContext) {
            sections.push(`<|file_analysis|>\n`);
            sections.push(`Language: ${context.fileContext.language}\n`);
            
            if (context.fileContext.imports.length > 0) {
                sections.push(`Imports: ${context.fileContext.imports.slice(0, 3).join(', ')}\n`);
            }
            if (context.fileContext.functions.length > 0) {
                sections.push(`Functions: ${context.fileContext.functions.slice(0, 3).join(', ')}\n`);
            }
            
            sections.push(`<|/file_analysis|>\n`);
            tokensUsed += 100; // Estimate
        }

        // ALWAYS include area around code and code to edit (most critical)
        sections.push(`<|area_around_code_to_edit|>\n${context.areaAroundCode}\n<|/area_around_code_to_edit|>\n`);
        sections.push(`<|code_to_edit|>\n${context.codeToEdit}\n<|/code_to_edit|>\n`);
        
        // Add final instruction
        // sections.push(`Complete the code at the cursor position.`);

        sections.push(`The developer was working on a section of code within the tags \`code_to_edit\` in the file located at \`${context.fileName}\`. Using the given \`recently_viewed_code_snippets\`, \`current_file_content\`, \`edit_diff_history\`, \`area_around_code_to_edit\`, and the cursor position marked as \`<|cursor|>\`, please continue the developer's work. Update the \`code_to_edit\` section by predicting and completing the changes they would have made next. Provide the revised code that was between the \`<|code_to_edit|>\` and \`<|/code_to_edit|>\` tags with the following format, but do not include the tags themselves.

\`\`\`
// Your revised code goes here
\`\`\`\n\n`); // Use template literal for multi-line

        sections.push(`Please provide the completed code for the cursor position:`); // Final instruction
        
        tokensUsed += this.estimateTokens(context.areaAroundCode) + 
                    this.estimateTokens(context.codeToEdit) + 100; // Estimate for final instruction 

        return {
            content: sections.join('\n'),
            tokensUsed: tokensUsed
        };
    }

    private buildStructuredPrompt(context: any, maxTokens: number = 3500): PromptElement[] {
        const elements: PromptElement[] = [];
        let currentTokens = 0;

        // System message with high priority - using original copilot format
        const systemMessage = "These are the files I'm working on, before I started making changes to them:";
        elements.push({
            priority: 1000,
            content: systemMessage
        });
        currentTokens += this.estimateTokens(systemMessage) + 2; // +2 for breaks

        // Original code section - only include if we have space
        const originalCodeContent = this.renderOriginalDocument(context);
        if (currentTokens + this.estimateTokens(originalCodeContent) < maxTokens * 0.6) { // Limit to 60% of max tokens
            elements.push({ priority: 998, content: "<|original_code|>" });
            elements.push(PromptFormatter.singleBreak());
            elements.push({ priority: 300, content: originalCodeContent });
            elements.push(PromptFormatter.singleBreak());
            elements.push({ priority: 995, content: "<|/original_code|>" });
            elements.push(PromptFormatter.doubleBreak());
            currentTokens += this.estimateTokens(originalCodeContent) + 50;
        }

        // Edit history section - only include recent edits if space allows
        const editHistoryContent = this.renderDocumentDiffs(context);
        if (currentTokens + this.estimateTokens(editHistoryContent) < maxTokens * 0.7) { // Limit to 70% of max tokens
            elements.push({
                priority: 900,
                content: "This is a sequence of edits that I made on these files, starting from the oldest to the newest:"
            });
            elements.push(PromptFormatter.singleBreak());
            elements.push({ priority: 898, content: "<|edits_to_original_code|>" });
            elements.push(PromptFormatter.singleBreak());
            elements.push({ priority: 300, content: editHistoryContent });
            elements.push(PromptFormatter.singleBreak());
            elements.push({ priority: 895, content: "<|/edits_to_original_code|>" });
            elements.push(PromptFormatter.doubleBreak());
            currentTokens += this.estimateTokens(editHistoryContent) + 100;
        }

        // Current editing section - always include
        const currentEditHeader = `Here is the piece of code I am currently editing in ${context.fileName}:`;
        elements.push({ priority: 300, content: currentEditHeader });
        elements.push(PromptFormatter.doubleBreak());
        currentTokens += this.estimateTokens(currentEditHeader) + 2;

        // Build copilot sections with token awareness
        const copilotSections = this.buildTokenAwareCopilotSections(context, maxTokens - currentTokens - 200); // Leave room for final instruction
        elements.push({ priority: 350, content: copilotSections.content });
        currentTokens += copilotSections.tokensUsed;

        elements.push(PromptFormatter.doubleBreak());

        // Final instruction - always include
        const finalInstruction = "Based on my most recent edits, what will I do next? Rewrite the code between <|code_to_edit|> and <|/code_to_edit|> based on what I will do next. Do not skip any lines. Do not be lazy.";
        elements.push({ priority: 280, content: finalInstruction });
        currentTokens += this.estimateTokens(finalInstruction);

        return elements;
    }

    

    private renderOriginalDocument(context: any): string {
        const lines: string[] = [];
        const fileLines = context.currentFileContent.split('\n');
        
        for (let i = 0; i < fileLines.length; i++) {
            lines.push(`${i + 1}|${fileLines[i]}`);
        }
        
        return `${context.fileName}:\n${lines.join('\n')}`;
    }

    private renderDocumentDiffs(context: any): string {
        const lines: string[] = [];
        lines.push("```");
        lines.push(`---${context.fileName}:`);
        lines.push(`+++${context.fileName}:`);
        
        // Add edit history as diff format
        context.editHistory.forEach((edit: EditHistory) => {
            const lineNum = edit.range.start.line + 1;
            if (edit.oldText) {
                lines.push(`@@ -${lineNum},1 +${lineNum},1 @@`);
                lines.push(`-${edit.oldText}`);
                lines.push(`+${edit.newText}`);
            } else {
                lines.push(`@@ -${lineNum},0 +${lineNum},1 @@`);
                lines.push(`+${edit.newText}`);
            }
        });
        
        lines.push("```");
        return lines.join('\n');
    }

    private renderPromptElements(elements: PromptElement[]): string {
        // Sort by priority (highest first)
        const sortedElements = elements.sort((a, b) => b.priority - a.priority);
        
        const result: string[] = [];
        let lastWasBreak = false;
        
        for (const element of sortedElements) {
            if (element.isBreak) {
                if (!lastWasBreak) {
                    result.push('\n');
                    lastWasBreak = true;
                }
            } else {
                result.push(element.content);
                lastWasBreak = false;
            }
        }
        
        return result.join('').replace(/\n\n\n+/g, '\n\n').trim();
    }

    private optimizePromptLength(prompt: string, maxTokens: number = 4000): string {
        // Simple token estimation (1 token ≈ 4 characters for English)
        const estimatedTokens = prompt.length / 4;
        
        if (estimatedTokens <= maxTokens) {
            return prompt;
        }
        
        // Truncate less important sections while maintaining structure
        const lines = prompt.split('\n');
        const importantSections = new Set(['<|code_to_edit|>', '<|area_around_code_to_edit|>']);
        
        let optimizedLines: string[] = [];
        let currentSection = '';
        let tokenCount = 0;
        
        for (const line of lines) {
            if (line.match(/^<\|[a-z_|]+\|>$/i)) {
                currentSection = line;
            }
            
            const lineTokens = line.length / 4;
            
            if (tokenCount + lineTokens > maxTokens && !importantSections.has(currentSection)) {
                // Skip non-essential lines when approaching token limit
                continue;
            }
            
            optimizedLines.push(line);
            tokenCount += lineTokens;
        }
        
        return optimizedLines.join('\n');
    }



    private getInstructions(): string {
        return `Your role as an AI assistant is to help developers complete their code tasks by assisting in editing specific sections of code marked by the <|code_to_edit|> and <|/code_to_edit|> tags, while adhering to Microsoft's content policies and avoiding the creation of content that violates copyrights.

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
- Don't include the line numbers of the form #| in your response.`;
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