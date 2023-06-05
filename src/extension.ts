/* eslint-disable @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as formatter from 'js-beautify';
const Mixpanel = require('mixpanel');
const { v4: uuidv4 } = require('uuid');

const MP_PROJECT_TOKEN = '95bdbf1403923d872234d15671de43ab';

let applyCommand: vscode.Disposable;
let currentDiffText: string;
let mixpanel: any;
let session_uuid: string;

export function activate(context: vscode.ExtensionContext) {

    // initialize mixpanel
    try {
        mixpanel = Mixpanel.init(MP_PROJECT_TOKEN, {keepAlive: false});
    } catch (error) {
        console.log(error);
    }

    // close dnagling diff editor and clean up old diff files
    cleanup();

    // create tmp directory and clean up old diff files
    exec('mkdir -p /tmp/style50/backup');
    exec(`mkdir -p /tmp/style50/diff`);

    context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (e) => {

        // make diff editor effectively read-only
        if (e.document.fileName.startsWith("/tmp/style50/diff/diff_")) {
            await vscode.commands.executeCommand('undo');
        }

        // when formatting is fixed manually, close diff editor and save file
        else if (e.document.getText() === currentDiffText) {
            currentDiffText = undefined;
            vscode.commands.executeCommand("setContext", "style50.currentDiff", false);
            vscode.commands.executeCommand('workbench.action.closeActiveEditor').then(async () => {
                e.document.save();
                await logEvent('user_ran_style50_and_fixed_formatting');
                showNotification('Good job fixing the formatting!');
            });
        }
    }));

    context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(async (e) => {

         // remove diff when diff editor is closed
        if (e.fileName.startsWith("/tmp/style50/diff/diff_")) {
            exec(`rm ${e.fileName}`);
            await logEvent('diff_editor_closed');
            currentDiffText = undefined;
        }
    }));

    // register command
    vscode.commands.registerCommand('style50.run', () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            const diffTitle = `style50 ${activeEditor.document.fileName.split('/').pop()}`;
            const sourceFileUri = activeEditor.document.uri;
            const formattedFilePath = `/tmp/style50/diff/diff_${Date.now()}_${activeEditor.document.fileName.split('/').pop()}`;
            const fileExt = activeEditor.document.fileName.split('.').pop();

            // python
            if (fileExt === 'py') {
                exec(`cp ${sourceFileUri.fsPath} ${formattedFilePath} && black ${formattedFilePath}`, (err) => {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return;
                    }
                    showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
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
                    showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
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
                        showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                    });
                });
            }
        } catch (error) {
            console.log(error);
            vscode.window.showErrorMessage(error.message);
        }
    });
}

async function showDiffEditor(sourceUri: vscode.Uri, formattedFileUri: vscode.Uri, title: string) {
    session_uuid = uuidv4();

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
                currentDiffText = '';
                applyCommand.dispose();
            }

            // re-register apply command
            applyCommand = vscode.commands.registerCommand('style50.apply', async () => {

                exec(`diff ${sourceUri.fsPath} ${formattedFileUri.fsPath}`, async (err, stdout, stderr) => {
                    if (stdout) {

                        // backup original file
                        exec(`cp ${sourceUri.fsPath} /tmp/style50/backup/backup_${Date.now()}_${sourceUri.fsPath.split('/').pop()}`);

                        // apply changes and remove formatted file
                        exec(`cp ${formattedFileUri.fsPath} ${sourceUri.fsPath} && rm ${formattedFileUri.fsPath}`);

                        await logEvent('user_ran_style50_and_applied_changes');
                    }

                    // reset context and close diff editor
                    await vscode.commands.executeCommand("setContext", "style50.currentDiff", false);
                    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                });
            });

            // show diff editor
            await vscode.commands.executeCommand('vscode.diff', sourceUri, formattedFileUri, title);

            // get current diff document text
            currentDiffText = vscode.window.activeTextEditor?.document.getText() || '';
            logEvent('user_ran_style50');
        } else {

            // no diff, remove formatted file
            exec(`rm ${formattedFileUri.fsPath}`);
            showNotification('Looks good!');
            await logEvent('user_ran_style50_but_no_diff');
        }
    });
}

function cleanup() {

    // close dnagling diff editor
    exec('ls -t /tmp/style50/diff/diff_* | head -1', (err, stdout, stderr) => {
        if (stdout) {
            const fileName = stdout.trim();
            vscode.window.showTextDocument(vscode.Uri.file(fileName), { preview: true, preserveFocus: false })
            .then(() => {
                vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                exec(`rm ${fileName}`);
                exec(`rm /tmp/style50/diff/diff_*`);
            });
        }
    });
}

async function logEvent(eventType: string, sessionUuid = session_uuid) {
    const telemetryLevel = vscode.workspace.getConfiguration().get('telemetry.telemetryLevel');
    if (mixpanel && telemetryLevel === 'all') {
        await mixpanel.track(eventType, {
            "distinct_id": "style50-vsix",
            "session_uuid": sessionUuid,
            "remote_name": vscode.env.remoteName || 'local',
        });
    }
}

function showNotification(message: string) {
    vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: message,
        cancellable: false
    }, async (progress, token) => {
        progress.report({ increment: 100 });
        await new Promise(resolve => setTimeout(resolve, 3000));
    });
}
