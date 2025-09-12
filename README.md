# AI Copilot Chat - VS Code Extension

A VS Code extension that provides a chat interface with AI assistance, supporting file attachments and code selections.

## Features

- 💬 **Chat Panel**: Toggleable chat interface on the right side
- 📁 **File Attachment**: Right-click files to add them to chat
- 📝 **Code Selection**: Right-click selected code to add to chat
- ⚙️ **Configurable**: Set your AI server URL and settings
- 🔄 **LM Studio Compatible**: Works with LM Studio and similar API endpoints

## Setup Instructions

### 1. Project Structure
Create a new folder for your extension and organize files like this:
```
ai-copilot-chat/
├── src/
│   ├── extension.ts
│   └── chatProvider.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 2. Install Dependencies
```bash
npm install
npm install --save-dev @types/vscode @types/node typescript
npm install axios
```

### 3. Build the Extension
```bash
npm run compile
```

### 4. Install and Test
1. Press `F5` in VS Code to open a new Extension Development Host window
2. Or package the extension:
   ```bash
   npm install -g vsce
   vsce package
   ```

### 5. Configure Settings
Go to VS Code Settings and configure:
- **AI Copilot: Server Url**: Your AI server URL (default: `http://localhost:1234`)
- **AI Copilot: Api Key**: API key if required
- **AI Copilot: Model**: Model name to use

## Usage

### Opening the Chat
- Use Command Palette (`Ctrl+Shift+P`) → "Toggle AI Chat"
- Or look for the chat icon in the activity bar

### Adding Files to Chat
1. Right-click any file in the Explorer
2. Select "Add to Copilot"
3. File content will be attached to your next message

### Adding Code Selections
1. Select code in any editor
2. Right-click the selection
3. Choose "Add Selection to Copilot"
4. The selected code with line numbers will be attached

### Chat Features
- Type messages and press Enter or click Send
- View attached files/code before sending
- Remove attachments by clicking the ❌ icon
- Clear entire chat history with the Clear button

## AI Server Compatibility

This extension works with any OpenAI-compatible API endpoint, including:
- LM Studio (default port 1234)
- Ollama with OpenAI compatibility
- Any custom API following the OpenAI chat completions format

### LM Studio Setup
1. Download and install LM Studio
2. Load a model
3. Start the local server (usually on port 1234)
4. Set the extension's server URL to `http://localhost:1234`

## Development

### File Structure
- `extension.ts`: Main extension activation and command registration
- `chatProvider.ts`: WebView provider handling chat UI and AI communication

### Adding New Features
The extension is designed to be extensible. You can:
- Add new context menu options
- Modify the chat UI in the HTML template
- Add new AI providers by modifying the API call format
- Extend attachment types

### API Format
The extension sends requests in OpenAI chat completion format:
```json
{
  "model": "your-model",
  "messages": [
    {"role": "user", "content": "message with attachments"}
  ],
  "temperature": 0.7,
  "max_tokens": 2000
}
```

## Troubleshooting

### Common Issues
1. **Chat not appearing**: Check if the command is registered and the webview provider is working
2. **AI not responding**: Verify server URL and that your AI server is running
3. **Files not attaching**: Check file permissions and that the file can be read

### Debug Mode
Enable VS Code's developer tools in the Extension Development Host to see console logs and debug the webview.

## License
MIT License - Feel free to modify and distribute.