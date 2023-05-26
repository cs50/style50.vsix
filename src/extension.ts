import * as vscode from 'vscode';
import { exec } from 'child_process';

export function activate(context: vscode.ExtensionContext) {

    vscode.commands.registerCommand('style50.run', () => {

        // get the active file
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const diffTitle = `style50: ${activeEditor.document.fileName.split('/').pop()}`;
        const activeFileUri = activeEditor.document.uri;
        const tmpOutFile = `/tmp/style50_diff_${Date.now()}_${activeEditor.document.fileName.split('/').pop()}`;

        // run formatter on python files
        if (activeEditor.document.languageId === 'python') {
            exec(`cp ${activeFileUri.fsPath} ${tmpOutFile} && black ${tmpOutFile}`, (err, stdout, stderr) => {
                console.log(stdout);
                showDiff(activeFileUri, tmpOutFile, diffTitle);
            });
        }

        // run formatter on c/cpp/java files
        if (['c', 'cpp', 'h', 'hpp', 'java'].includes(activeEditor.document.languageId)) {
            const astyle = [
                "astyle", "--ascii", "--add-braces", "--break-one-line-headers",
                "--align-pointer=name", "--pad-comma", "--unpad-paren",
                "--pad-header", "--pad-oper", "--max-code-length=132",
                "--convert-tabs", "--indent=spaces=4",
                "--indent-continuation=1", "--indent-switches",
                "--lineend=linux", "--min-conditional-indent=1",
                "--options=none", "--style=allman"
            ].join(" ");

            exec(`cp ${activeFileUri.fsPath} ${tmpOutFile} && ${astyle} ${tmpOutFile}`, (err, stdout, stderr) => {
                showDiff(activeFileUri, tmpOutFile, diffTitle);
            });
        }

    });
}

function showDiff(leftUri: vscode.Uri, rightUri: string, title: string) {
    vscode.commands.executeCommand('vscode.diff', leftUri, vscode.Uri.file(rightUri), title);
}
