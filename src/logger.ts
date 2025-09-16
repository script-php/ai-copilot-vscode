// logger.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// TODO: to remove later

export class AILogger {
    private logFile: string | null = null;

    constructor() {
        this.initializeLogFile();
    }

    private initializeLogFile() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            this.logFile = path.join(workspaceRoot, `ai-copilot-logs-${timestamp}.txt`);
            
            // Create initial log entry
            this.log('AI Copilot Log File Created', 'SYSTEM');
        }
    }

    public log(message: string, type: string = 'PROMPT', metadata: any = {}) {
        if (!this.logFile) {
            console.warn('No workspace found for logging');
            return;
        }

        try {
            const timestamp = new Date().toISOString();
            const logEntry = `
=== ${type} - ${timestamp} ===
${message}
${Object.keys(metadata).length > 0 ? `Metadata: ${JSON.stringify(metadata, null, 2)}` : ''}
=== END ===

`;

            fs.appendFileSync(this.logFile, logEntry, 'utf8');
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    public logPrompt(prompt: string, context: any, response: string | null = null) {
        const metadata = {
            fileName: context.fileContext?.fileName,
            language: context.fileContext?.language,
            cursorPosition: context.cursor,
            timestamp: new Date().toISOString(),
            responseLength: response ? response.length : 0
        };

        const logContent = `PROMPT SENT TO AI:
${prompt}

${response ? `AI RESPONSE:
${response}` : 'No response from AI'}`;

        this.log(logContent, 'AUTOCOMPLETE_PROMPT', metadata);
    }

    public getLogFilePath(): string | null {
        return this.logFile;
    }
}