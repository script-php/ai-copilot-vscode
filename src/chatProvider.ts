import * as vscode from 'vscode';
import axios from 'axios';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    attachments?: Array<{
        type: 'file' | 'selection';
        name: string;
        content: string;
        lines?: { start: number; end: number };
    }>;
}

interface AttachedItem {
    type: 'file' | 'selection';
    name: string;
    content: string;
    lines?: { start: number; end: number };
}

export class ChatProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'aiCopilotChat';

    private _view?: vscode.WebviewView;
    private _messages: ChatMessage[] = [];
    private _pendingAttachments: AttachedItem[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'sendMessage':
                        this._handleSendMessage(message.text);
                        break;
                    case 'removeAttachment':
                        this._removeAttachment(message.index);
                        break;
                    case 'clearChat':
                        this._clearChat();
                        break;
                }
            }
        );
    }

    public addFileToChat(fileName: string, content: string) {
        this._pendingAttachments.push({
            type: 'file',
            name: fileName,
            content: content
        });
        this._updateAttachments();
    }

    public addSelectionToChat(fileName: string, content: string, startLine: number, endLine: number) {
        this._pendingAttachments.push({
            type: 'selection',
            name: fileName,
            content: content,
            lines: { start: startLine, end: endLine }
        });
        this._updateAttachments();
    }

    private _removeAttachment(index: number) {
        this._pendingAttachments.splice(index, 1);
        this._updateAttachments();
    }

    private _updateAttachments() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateAttachments',
                attachments: this._pendingAttachments
            });
        }
    }

    private async _handleSendMessage(text: string) {
        if (!text.trim() && this._pendingAttachments.length === 0) {
            return;
        }

        const userMessage: ChatMessage = {
            role: 'user',
            content: text,
            attachments: this._pendingAttachments.length > 0 ? [...this._pendingAttachments] : undefined
        };

        this._messages.push(userMessage);
        this._pendingAttachments = [];

        // Update UI
        this._updateChat();
        this._updateAttachments();

        // Send to AI
        try {
            const response = await this._sendToAI(this._messages);
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: response
            };
            this._messages.push(assistantMessage);
            this._updateChat();
        } catch (error) {
            const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`
            };
            this._messages.push(errorMessage);
            this._updateChat();
        }
    }

    private async _sendToAI(messages: ChatMessage[]): Promise<string> {
        const config = vscode.workspace.getConfiguration('aiCopilot');
        const serverUrl = config.get<string>('serverUrl') || 'http://localhost:1234';
        const apiKey = config.get<string>('apiKey') || '';
        const model = config.get<string>('model') || 'local-model';

        // Convert messages to API format
        const apiMessages = messages.map(msg => {
            let content = msg.content;
            
            if (msg.attachments) {
                content += '\n\nAttached files/code:\n';
                msg.attachments.forEach(attachment => {
                    if (attachment.type === 'file') {
                        content += `\n--- File: ${attachment.name} ---\n${attachment.content}\n`;
                    } else if (attachment.type === 'selection') {
                        content += `\n--- Code from ${attachment.name} (lines ${attachment.lines?.start}-${attachment.lines?.end}) ---\n${attachment.content}\n`;
                    }
                });
            }
            
            return {
                role: msg.role,
                content: content
            };
        });

        const headers: any = {
            'Content-Type': 'application/json'
        };

        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await axios.post(
            `${serverUrl}/v1/chat/completions`,
            {
                model: model,
                messages: apiMessages,
                temperature: 0.7,
                max_tokens: 2000
            },
            { headers }
        );

        return response.data.choices[0].message.content;
    }

    private _clearChat() {
        this._messages = [];
        this._pendingAttachments = [];
        this._updateChat();
        this._updateAttachments();
    }

    private _updateChat() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateChat',
                messages: this._messages
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Copilot Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .chat-header {
            padding: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .chat-messages {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        
        .message {
            max-width: 100%;
            word-wrap: break-word;
        }
        
        .message.user {
            background: var(--vscode-inputValidation-infoBorder);
            padding: 8px 12px;
            border-radius: 8px;
            margin-left: 20px;
        }
        
        .message.assistant {
            background: var(--vscode-editor-selectionHighlightBackground);
            padding: 8px 12px;
            border-radius: 8px;
            margin-right: 20px;
        }
        
        .attachments {
            margin: 8px 0;
        }
        
        .attachment {
            display: inline-flex;
            align-items: center;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 11px;
            margin: 2px 4px 2px 0;
            cursor: pointer;
        }
        
        .attachment:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .pending-attachments {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 10px;
            background: var(--vscode-editor-background);
        }
        
        .input-container {
            border-top: 1px solid var(--vscode-panel-border);
            padding: 10px;
            display: flex;
            gap: 8px;
        }
        
        .message-input {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            font-family: inherit;
            font-size: inherit;
        }
        
        .send-button, .clear-button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            padding: 8px 12px;
            cursor: pointer;
            font-family: inherit;
        }
        
        .send-button:hover, .clear-button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .clear-button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        pre {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-textBlockQuote-border);
            border-radius: 4px;
            padding: 8px;
            overflow-x: auto;
            margin: 8px 0;
        }
        
        code {
            background: var(--vscode-textPreformat-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
    </style>
</head>
<body>
    <div class="chat-header">
        <h3>AI Copilot Chat</h3>
        <button class="clear-button" onclick="clearChat()">Clear</button>
    </div>
    
    <div class="chat-messages" id="chatMessages"></div>
    
    <div class="pending-attachments" id="pendingAttachments" style="display: none;">
        <div style="margin-bottom: 5px; font-size: 12px; opacity: 0.8;">Attached files:</div>
        <div id="attachmentList"></div>
    </div>
    
    <div class="input-container">
        <input type="text" class="message-input" id="messageInput" placeholder="Type your message..." />
        <button class="send-button" onclick="sendMessage()">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let messages = [];
        let pendingAttachments = [];

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateChat':
                    messages = message.messages;
                    updateChatUI();
                    break;
                case 'updateAttachments':
                    pendingAttachments = message.attachments;
                    updateAttachmentsUI();
                    break;
            }
        });

        // Add this helper function to escape HTML
        function escapeHtml(unsafe) {
            if (!unsafe) return '';
            return unsafe
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        function updateChatUI() {
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            
            messages.forEach(message => {
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${message.role}\`;
                
                let content = escapeHtml(message.content);
                // Simple markdown-like formatting
                content = content.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>');
                content = content.replace(/\`([^\`]*)\`/g, '<code>$1</code>');
                content = content.replace(/\\n/g, '<br>');
                
                messageDiv.innerHTML = content;
                
                if (message.attachments) {
                    const attachmentsDiv = document.createElement('div');
                    attachmentsDiv.className = 'attachments';
                    message.attachments.forEach(attachment => {
                        const attachmentSpan = document.createElement('span');
                        attachmentSpan.className = 'attachment';
                        attachmentSpan.textContent = attachment.type === 'file' ? 
                            \`📄 \${attachment.name}\` : 
                            \`📝 \${attachment.name} (\${attachment.lines?.start}-\${attachment.lines?.end})\`;
                        attachmentsDiv.appendChild(attachmentSpan);
                    });
                    messageDiv.appendChild(attachmentsDiv);
                }
                
                chatMessages.appendChild(messageDiv);
            });
            
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function updateAttachmentsUI() {
            const pendingDiv = document.getElementById('pendingAttachments');
            const attachmentList = document.getElementById('attachmentList');
            
            if (pendingAttachments.length > 0) {
                pendingDiv.style.display = 'block';
                attachmentList.innerHTML = '';
                
                pendingAttachments.forEach((attachment, index) => {
                    const attachmentSpan = document.createElement('span');
                    attachmentSpan.className = 'attachment';
                    attachmentSpan.innerHTML = \`\${attachment.type === 'file' ? '📄' : '📝'} \${attachment.name}\${attachment.lines ? \` (\${attachment.lines.start}-\${attachment.lines.end})\` : ''} ❌\`;
                    attachmentSpan.onclick = () => removeAttachment(index);
                    attachmentList.appendChild(attachmentSpan);
                });
            } else {
                pendingDiv.style.display = 'none';
            }
        }

        function sendMessage() {
            const input = document.getElementById('messageInput');
            const text = input.value.trim();
            
            if (text || pendingAttachments.length > 0) {
                vscode.postMessage({
                    type: 'sendMessage',
                    text: text
                });
                input.value = '';
            }
        }

        function removeAttachment(index) {
            vscode.postMessage({
                type: 'removeAttachment',
                index: index
            });
        }

        function clearChat() {
            vscode.postMessage({
                type: 'clearChat'
            });
        }

        // Enter key to send message
        document.getElementById('messageInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });
    </script>
</body>
</html>`;
    }


    
}