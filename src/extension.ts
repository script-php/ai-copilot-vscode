import * as vscode from 'vscode';
import { ChatProvider } from './chatProvider';

let chatProvider: ChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('AI Copilot Chat extension is now active!');

    // Initialize chat provider
    chatProvider = new ChatProvider(context.extensionUri);

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

    context.subscriptions.push(toggleChatCommand, addFileCommand, addSelectionCommand);

    // Set initial context
    vscode.commands.executeCommand('setContext', 'aiCopilot.chatVisible', true);
}

export function deactivate() {}