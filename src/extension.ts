/* eslint-disable @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as jsFormatter from 'js-beautify';
import { FormatOptionsWithLanguage, format } from 'sql-formatter';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const Mixpanel = require('mixpanel');
const { v4: uuidv4 } = require('uuid');

const MP_PROJECT_TOKEN = '95bdbf1403923d872234d15671de43ab';

let applyCommand: vscode.Disposable;
let explainCommand: vscode.Disposable;
let currentDiffText: string;
let mixpanel: any;
let session_uuid: string;

export async function activate(context: vscode.ExtensionContext) {

    // initialize mixpanel
    try {
        mixpanel = Mixpanel.init(MP_PROJECT_TOKEN, {keepAlive: false});
    } catch (error) {
        console.log(error);
    }

    // close dnagling diff editor and clean up old diff files
    await cleanup();

    // create tmp directory and clean up old diff files
    await exec('mkdir -p /tmp/style50/backup');
    await exec(`mkdir -p /tmp/style50/diff`);

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

            // check if e.fileName exists
            if (fs.existsSync(e.fileName)) {
                await exec(`rm ${e.fileName}`);
            }

            await logEvent('diff_editor_closed');
            currentDiffText = undefined;
        }
    }));

    // register style50.run command
    vscode.commands.registerCommand('style50.run', () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const filePath = editor.document.fileName;
            runStyle50(filePath);
        } catch (error) {
            console.log(error);
            vscode.window.showErrorMessage(error.message);
        }
    });

    // register style50.runFromTerminal command
    vscode.commands.registerCommand('style50.runFromTerminal', (args) => {
        let passArgCheck = true;

        // check if file exists
        if (!fs.existsSync(args[0])) {
            vscode.window.showErrorMessage(`File ${args[0]} does not exist.`);
            passArgCheck = false;
        }

        // check if there is already a diff editor open
        vscode.window.visibleTextEditors.forEach((editor) => {
            if (editor.document.fileName.startsWith("/tmp/style50/diff/diff_")) {
                vscode.window.showErrorMessage('Please close the current style50 window first.');
                passArgCheck = false;
            }
        });

        // run style50
        passArgCheck ? runStyle50(args[0]) : null;
    });

    async function runStyle50(filePath: string) {
        try {

            const sourceFileUri = vscode.Uri.file(filePath);
            const fileName = filePath.split('/').pop();
            const fileExt = fileName.split('.').pop();

            const diffTitle = `style50 ${fileName}`;

            const diffDir = `/tmp/style50/diff/diff_${Date.now()}`;
            await exec(`mkdir -p ${diffDir}`);

            const formattedFilePath = `${diffDir}/${fileName}`;

            // python
            if (fileExt === 'py') {
                const sourcePath = `${sourceFileUri.fsPath.replace(/ /g, '\\ ')}`;
                const stepCopy = `cp ${sourcePath} ${formattedFilePath}`;
                const stepBlackFormat = `black ${formattedFilePath}`;

                try {
                    await exec(stepCopy);
                    await exec(stepBlackFormat);
                    showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                } catch (error) {
                    if (error.cmd === stepCopy) {
                        console.log("Error while copying the file: ", error);
                        vscode.window.showErrorMessage("An error occurred while copying the file. Please try again.");
                        return;
                    }
                    if (error.cmd === stepBlackFormat) {
                        console.log("style50 runs into an error: ", error);
                        vscode.window.showErrorMessage("Can't check your style just yet! Try running your code, fix any errors, then check its style again!");
                        return;
                    }
                }
            }

            // c, cpp, java
            if (['c', 'cpp', 'h', 'hpp', 'java'].includes(fileExt)) {

                // VS Code C/CPP formatting
                // https://code.visualstudio.com/docs/cpp/cpp-ide#_code-formatting
                const vscodeDefaultStyle = `'${JSON.stringify({
                    UseTab: vscode.workspace.getConfiguration('editor').get('useTabStops'),
                    IndentWidth: vscode.workspace.getConfiguration('editor').get('tabSize'),
                    BreakBeforeBraces: 'Allman',
                    AllowShortIfStatementsOnASingleLine: false,
                    IndentCaseLabels: false,
                    ColumnLimit: 0
                })}'`;

                // Use fallback style settings, if any (need to surround settings with single quotes)
                let styleConfigs = vscode.workspace.getConfiguration('C_Cpp').get('clang_format_style');
                const fallbackStyle = `'${vscode.workspace.getConfiguration('C_Cpp').get('clang_format_fallbackStyle')}'`;
                fallbackStyle !== "'Visual Studio'" ? styleConfigs = fallbackStyle : styleConfigs = vscodeDefaultStyle;

                // Recursively search for .clang-format file from the current directory and up the tree to the root of workspace (if any)
                const dir = sourceFileUri.fsPath.replace(/ /g, '\\ ').split('/');
                while (dir.length > 0) {
                    const clangFormatFile = dir.join('/') + '/.clang-format';
                    if (fs.existsSync(clangFormatFile)) {

                        // create vscode.Uri object so the URI starts with 'file://' (required by clang-format)
                        styleConfigs = String(vscode.Uri.file(clangFormatFile));
                        break;
                    }
                    dir.pop();
                }

                // sanitize style string
                styleConfigs = String(styleConfigs).replace(/\$/g, '\\$');

                const stepClangFsyntax = `clang -fsyntax-only ${sourceFileUri.fsPath.replace(/ /g, '\\ ')}`;
                const stepCopy = `cp ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} ${formattedFilePath}`;
                const stepClangFormat = `clang-format -i -style=${styleConfigs} ${formattedFilePath}`;

                // run style50
                try {
                    await exec(stepClangFsyntax);
                    await exec(stepCopy);
                    await exec(stepClangFormat);
                    showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                } catch (error) {
                    if (error.cmd === stepCopy) {
                        console.log("Error while copying the file: ", error);
                        vscode.window.showErrorMessage("An error occurred while copying the file. Please try again.");
                        return;
                    }
                    if (error.cmd === stepClangFsyntax || error.cmd === stepClangFormat) {
                        console.log("style50 runs into an error: ", error);
                        vscode.window.showErrorMessage("Can't check your style just yet! Try compiling your code, fix any errors, then check its style again!");
                        return;
                    }
                }
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
                    fs.writeFile(formattedFilePath, jsFormatter[fileExt](data, options), async() => {
                        if (fileExt === 'html') {
                            await exec(`djhtml ${formattedFilePath}`);
                        }
                        showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                    });
                });
            }

            // SQL
            if (fileExt === 'sql') {
                const styleConfig = vscode.workspace.getConfiguration('Prettier-SQL') as FormatOptionsWithLanguage;
                fs.readFile(sourceFileUri.fsPath, 'utf8', function (err, data) {
                    if (err) {
                        console.log(err);
                        vscode.window.showErrorMessage(err.message);
                        return;
                    }
                    fs.writeFile(formattedFilePath, format(data, styleConfig), () => {
                        showDiffEditor(sourceFileUri, vscode.Uri.file(formattedFilePath), diffTitle);
                    });
                });
            }
        } catch (error) {
            console.log(error);
            vscode.window.showErrorMessage("style50 runs into an error. Please try again. If the problem persists, please check browser console for more details.");
        }
    }
}


async function showDiffEditor(sourceFileUri: vscode.Uri, formattedFileUri: vscode.Uri, title: string) {
    session_uuid = uuidv4();

    // check if two files are different
    await exec(`diff ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} ${formattedFileUri.fsPath}`, async (err, stdout, stderr) => {
        if (stdout) {

            // set context to control apply button
            await vscode.commands.executeCommand("setContext", "style50.currentDiff", [
                formattedFileUri.fsPath.split('/').pop(),
                sourceFileUri.fsPath.replace(/ /g, '\\ ').split('/').pop(),
            ]);

            // dispose apply command, if any
            if (applyCommand || explainCommand) {
                currentDiffText = '';
                applyCommand.dispose();
                explainCommand.dispose();
            }

            // re-register apply command
            applyCommand = vscode.commands.registerCommand('style50.apply', async () => {

                await exec(`diff ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} ${formattedFileUri.fsPath}`, async (err, stdout, stderr) => {
                    if (stdout) {

                        // backup original file
                        await exec(`cp ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} /tmp/style50/backup/backup_${Date.now()}_${sourceFileUri.fsPath.replace(/ /g, '\\ ').split('/').pop()}`);

                        // apply changes and remove formatted file
                        await exec(`cp ${formattedFileUri.fsPath} ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} && rm ${formattedFileUri.fsPath}`);

                        await logEvent('user_ran_style50_and_applied_changes');
                    }

                    // reset context and close diff editor
                    await vscode.commands.executeCommand("setContext", "style50.currentDiff", false);
                    vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                    currentDiffText = '';
                });
            });

            explainCommand = vscode.commands.registerCommand('style50.explain', async () => {
                try {
                    await exec(`diff ${sourceFileUri.fsPath.replace(/ /g, '\\ ')} ${formattedFileUri.fsPath}`, async (err, stdout, stderr) => {
                        if (stdout) {
                            try {

                                // extract first 3 diff blocks
                                const blocks = extractDiffBlocks(stdout, 3);
                                let diffText = '';
                                for (const block of blocks){
                                    if((diffText.length + block.length) > 950) {
                                        break;
                                    }
                                    diffText += block;
                                }

                                const displayMessage = "Explain Changes";
                                const contextMessage = `${displayMessage}:\n\`\`\`bash\n${diffText}`;
                                const payload = {
                                    "api": "/api/v1/style",
                                    "config": "chat_cs50",
                                    "diff": diffText,
                                    "stream": true
                                };

                                const ddb50 = vscode.extensions.getExtension('cs50.ddb50');
                                const api = ddb50.exports;
                                api.requestGptResponse(displayMessage, contextMessage, payload);
                            } catch (error) {
                                console.log(error);
                            }
                        }
                    });
                } catch (error) {
                    console.log(error);
                }
            });

            // show diff editor
            await vscode.commands.executeCommand('vscode.diff', sourceFileUri, formattedFileUri, title);

            // get current diff document text
            currentDiffText = vscode.window.activeTextEditor?.document.getText() || '';
            logEvent('user_ran_style50');
        } else {

            // no diff, remove formatted file
            await exec(`rm ${formattedFileUri.fsPath}`);
            showNotification('Looks good!');
            await logEvent('user_ran_style50_but_no_diff');
        }
    });
}

function extractDiffBlocks(input: string, n: number): string[] {
    const blockSeparator = /\n(?=\d+,\d+c\d+,\d+\n)/g; // This matches the newline before each new block
    const blocks = input.split(blockSeparator);
    return blocks.slice(0, n);
}

async function cleanup() {
    await exec(`rm -rf /tmp/style50/diff/*`);
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
