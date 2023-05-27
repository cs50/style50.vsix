/* eslint-disable @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as formatter from 'js-beautify';

let applyCommand: vscode.Disposable;

export function activate(context: vscode.ExtensionContext) {

    // remove all temp files
    exec(`rm -rf /tmp/style50_diff_*`);

    // make diff editor read-only
    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (e) => {
        if (e.document.fileName.startsWith("/tmp/style50_diff_")) {
            await vscode.commands.executeCommand('undo');
        }
    }));

    // register command
    vscode.commands.registerCommand('style50.run', () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            const diffTitle = `style50 ${activeEditor.document.fileName.split('/').pop()}`;
            const sourceFileUri = activeEditor.document.uri;
            const formattedFilePath = `/tmp/style50_diff_${Date.now()}_${activeEditor.document.fileName.split('/').pop()}`;
            const fileExt = activeEditor.document.fileName.split('.').pop();

            // python
            if (fileExt === 'py') {
                exec(`cp ${sourceFileUri.fsPath} ${formattedFilePath} && black ${formattedFilePath}`, (err) => {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return;
                    }
                    showDiff(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                });
            }

            // c, cpp, java
            if (['c', 'cpp', 'h', 'hpp', 'java'].includes(fileExt)) {
                const clangFormatFile = vscode.Uri.joinPath(context.extension.extensionUri, 'clang-format');
                exec(`cp ${sourceFileUri.fsPath} ${formattedFilePath} && clang-format -i -style=${clangFormatFile} ${formattedFilePath}`, (err) => {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return;
                    }
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

async function showDiff(sourceUri: vscode.Uri, formattedFileUri: vscode.Uri, title: string) {

    // check if two files are different
    exec(`diff ${sourceUri.fsPath} ${formattedFileUri.fsPath}`, async (err, stdout, stderr) => {
        if (stdout) {

            // set context to control apply button
            await vscode.commands.executeCommand("setContext", "style50.currentDiff", [
                formattedFileUri.fsPath.split('/').pop(),
                sourceUri.fsPath.split('/').pop(),
            ]);

            // dispose apply command, if any
            if (applyCommand) {
                applyCommand.dispose();
            }

            // re-register apply command
            applyCommand = vscode.commands.registerCommand('style50.apply', async () => {
                exec(`cp ${formattedFileUri.fsPath} ${sourceUri.fsPath}`);
                await vscode.commands.executeCommand("setContext", "style50.currentDiff", false);

                // close diff editor
                vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            });

            // show diff
            vscode.commands.executeCommand('vscode.diff', sourceUri, formattedFileUri, title);
        } else {

            // create a progress notification window to show the message
            const progress = vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Looks good!',
                cancellable: false
            }, async (progress, token) => {
                progress.report({ increment: 100 });
                await new Promise(resolve => setTimeout(resolve, 3000));
            });
        }
    });
}
