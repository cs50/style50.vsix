/* eslint-disable @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as formatter from 'js-beautify';

export function activate(context: vscode.ExtensionContext) {

    // remove all temp files
    exec(`rm -rf /tmp/style50_diff_*`);

    // register command
    vscode.commands.registerCommand('style50.run', () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            const diffTitle = `Format ${activeEditor.document.fileName.split('/').pop()}`;
            const sourceFileUri = activeEditor.document.uri;
            const formattedFilePath = `/tmp/style50_diff_${Date.now()}_${activeEditor.document.fileName.split('/').pop()}`;
            const fileExt = activeEditor.document.fileName.split('.').pop();

            // python
            if (fileExt === 'py') {
                exec(`cp ${sourceFileUri.fsPath} ${formattedFilePath} && black ${formattedFilePath}`, () => {
                    showDiff(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                });
            }

            // c, cpp, java
            if (['c', 'cpp', 'h', 'hpp', 'java'].includes(fileExt)) {
                const clangFormatFile = vscode.Uri.joinPath(context.extension.extensionUri, 'clang-format');
                exec(`cp ${sourceFileUri.fsPath} ${formattedFilePath} && clang-format -i -style=${clangFormatFile} ${formattedFilePath}`, () => {
                    showDiff(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                });
            }

            // html, css, javascript
            if (['html', 'css', 'js'].includes(fileExt)) {
                fs.readFile(sourceFileUri.fsPath, 'utf8', function (err, data) {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return;
                    }
                    const options = { indent_size: 4 };
                    switch (fileExt) {
                        case 'html':
                            options['indent_inner_html'] = true;
                            break;
                        case 'css':
                            break;
                        case 'js':
                            options['space_in_empty_paren'] = true;
                            break;
                        default:
                            break;
                    }
                    fs.writeFile(formattedFilePath, formatter[fileExt](data, options), () => {
                        showDiff(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                    });
                });
            }
        } catch (error) {
            console.log(error);
            vscode.window.showErrorMessage(error.message);
        }
    });
}

function showDiff(sourceUri: vscode.Uri, formattedFileUri: vscode.Uri, title: string) {

    // check if two files are different
    exec(`diff ${sourceUri.fsPath} ${formattedFileUri.fsPath}`, (err, stdout, stderr) => {
        if (stdout) {
            vscode.commands.executeCommand('vscode.diff', sourceUri, formattedFileUri, title);
        } else {
            vscode.window.showInformationMessage('Looks formatted!');
        }
    });
}
