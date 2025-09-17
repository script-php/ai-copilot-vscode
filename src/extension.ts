import * as vscode from 'vscode';
import * as fs from 'fs'; // TODO: to remove later
import { ChatProvider } from './chatProvider';
import { AutoCompleteProvider } from './autoCompleteProvider';
import { ContextService } from './contextService';
import { AILogger } from './logger'; // TODO: to remove later

let chatProvider: ChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Copilot Chat extension is now active!');

    // Initialize chat provider
    chatProvider = new ChatProvider(context.extensionUri);

    // Initialize logger
    const logger = new AILogger(); // TODO: to remove later

    // Log extension activation
    // TODO: to remove later
    logger.log('Extension activated', 'SYSTEM', {
        vscodeVersion: vscode.version,
        extensionVersion: context.extension.packageJSON.version
    });

    // Create a single instance of the context service
    const contextService = new ContextService();
    
    // Create the autocomplete provider with the context service
    const autoCompleteProvider = new AutoCompleteProvider(contextService);
    
    // Register the inline completion provider
    const completionProvider = vscode.languages.registerInlineCompletionItemProvider(
        { pattern: '**' }, // Apply to all files, or specify specific languages
        autoCompleteProvider
    );

    // Register webview provider
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'aiCopilotChat',
            chatProvider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    const manualCompleteCommand = vscode.commands.registerCommand('aiCopilot.triggerCompletion', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const position = editor.selection.active;
            const completion = await autoCompleteProvider.triggerManualCompletion(editor.document, position);
            
            if (completion) {
                // Insert the completion at the cursor position
                await editor.edit(editBuilder => {
                    editBuilder.insert(position, completion);
                });
                
                vscode.window.showInformationMessage('AI completion applied');
            } else {
                vscode.window.showInformationMessage('No completion available');
            }
        }
    });

    // Command to toggle chat visibility
    const toggleChatCommand = vscode.commands.registerCommand('aiCopilot.toggleChat', () => {
        const config = vscode.workspace.getConfiguration('aiCopilot');
        const isVisible = vscode.commands.executeCommand('setContext', 'aiCopilot.chatVisible', true);
        vscode.commands.executeCommand('aiCopilotChat.focus');
    });

    // Command to add file to chat
    const addFileCommand = vscode.commands.registerCommand('aiCopilot.addFileToChat', async (uri: vscode.Uri) => {
        if (chatProvider && uri) {
            try {
                const document = await vscode.workspace.openTextDocument(uri);
                const content = document.getText();
                const relativePath = vscode.workspace.asRelativePath(uri);
                
                chatProvider.addFileToChat(relativePath, content);
                
                // Show chat panel
                vscode.commands.executeCommand('setContext', 'aiCopilot.chatVisible', true);
                vscode.commands.executeCommand('aiCopilotChat.focus');
                
                vscode.window.showInformationMessage(`Added ${relativePath} to chat`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to read file: ${error}`);
            }
        }
    });

    // Command to add selected code to chat
    const addSelectionCommand = vscode.commands.registerCommand('aiCopilot.addSelectionToChat', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && chatProvider) {
            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);
            
            if (selectedText) {
                const relativePath = vscode.workspace.asRelativePath(editor.document.uri);
                const startLine = selection.start.line + 1;
                const endLine = selection.end.line + 1;
                
                chatProvider.addSelectionToChat(relativePath, selectedText, startLine, endLine);
                
                // Show chat panel
                vscode.commands.executeCommand('setContext', 'aiCopilot.chatVisible', true);
                vscode.commands.executeCommand('aiCopilotChat.focus');
                
                vscode.window.showInformationMessage(`Added selection from ${relativePath} to chat`);
            }
        }
    });

    // TODO: to remove later
    // 
    const openLogCommand = vscode.commands.registerCommand('aiCopilot.openLogFile', async () => {
        const logPath = logger.getLogFilePath();
        if (logPath && fs.existsSync(logPath)) {
            const document = await vscode.workspace.openTextDocument(logPath);
            await vscode.window.showTextDocument(document);
        } else {
            vscode.window.showInformationMessage('No log file found or workspace not open');
        }
    });

    context.subscriptions.push(toggleChatCommand, addFileCommand, addSelectionCommand, completionProvider, openLogCommand, manualCompleteCommand);

    // Set initial context
    vscode.commands.executeCommand('setContext', 'aiCopilot.chatVisible', true);

    // Status bar item with more info
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    
    const updateStatusBar = () => {
        const config = vscode.workspace.getConfiguration('aiCopilot');
        const enabled = config.get<boolean>('completionsEnabled', true);
        statusBarItem.text = `$(copilot) AI Copilot ${enabled ? 'âœ“' : 'âœ—'}`;
        statusBarItem.tooltip = `AI Copilot ${enabled ? 'enabled' : 'disabled'} - Click to toggle chat`;
        statusBarItem.command = 'aiCopilot.toggleChat';

        statusBarItem.text = `$(copilot) AI Copilot ${enabled ? 'Auto' : 'Manual'}`;
        statusBarItem.tooltip = `AI Copilot ${enabled ? 'Auto-complete enabled' : 'Click for manual completion'} - Click to toggle`;
        
    };
    
    updateStatusBar();
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Listen for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('aiCopilot')) {
                updateStatusBar();
                console.log('AI Copilot configuration changed');
            }
        })
    );

    // Log when extension is fully loaded
    setTimeout(() => {
        console.log('AI Copilot extension fully activated');
        const config = vscode.workspace.getConfiguration('aiCopilot');
        console.log('Current configuration:', {
            serverUrl: config.get('serverUrl'),
            model: config.get('model'),
            completionsEnabled: config.get('completionsEnabled')
        });
    }, 1000);
}

export function deactivate() {}