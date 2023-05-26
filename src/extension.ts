/* eslint-disable @typescript-eslint/no-var-requires */
import * as vscode from 'vscode';
import { exec } from 'child_process';

const js_beautify = require('js-beautify/js').js;
const html_beautify = require('js-beautify/js').html;
const css_beautify = require('js-beautify/js').css;
const fs = require('fs');

export function activate(context: vscode.ExtensionContext) {

    vscode.commands.registerCommand('style50.run', () => {

        // get the active file
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return;
        }
        const diffTitle = `Format ${activeEditor.document.fileName.split('/').pop()}`;
        const activeFileUri = activeEditor.document.uri;
        const tmpOutFile = `/tmp/style50_diff_${Date.now()}_${activeEditor.document.fileName.split('/').pop()}`;
        const fileExt = activeEditor.document.fileName.split('.').pop();

        // run formatter on python files
        if (fileExt === 'py') {
            exec(`cp ${activeFileUri.fsPath} ${tmpOutFile} && black ${tmpOutFile}`, (err, stdout, stderr) => {
                showDiff(activeFileUri, vscode.Uri.file(tmpOutFile), diffTitle);
            });
        }

        // run formatter on c/cpp/java files
        if (['c', 'cpp', 'h', 'hpp', 'java'].includes(fileExt)) {
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
                showDiff(activeFileUri, vscode.Uri.file(tmpOutFile), diffTitle);
            });
        }

        // run formatter on html/css/js files
        if (['html', 'css', 'js'].includes(fileExt)) {
            fs.readFile(activeFileUri.fsPath, 'utf8', function (err, data) {
                const options = { indent_size: 4 };

                if (fileExt === 'html') {
                    options['indent_inner_html'] = true;
                    fs.writeFile(tmpOutFile, html_beautify(data, options), () => {
                        showDiff(activeFileUri, vscode.Uri.file(tmpOutFile), diffTitle);
                    });
                }

                if (fileExt === 'css') {
                    fs.writeFile(tmpOutFile, css_beautify(data, options), () => {
                        showDiff(activeFileUri, vscode.Uri.file(tmpOutFile), diffTitle);
                    });
                }

                if (fileExt === 'js') {
                    options['space_in_empty_paren'] = true;
                    fs.writeFile(tmpOutFile, js_beautify(data, options), () => {
                        showDiff(activeFileUri, vscode.Uri.file(tmpOutFile), diffTitle);
                    });
                }
            });
        }
    });
}

function showDiff(leftUri: vscode.Uri, rightUri: vscode.Uri, title: string) {
    // check if two files are different
    exec(`diff ${leftUri.fsPath} ${rightUri.fsPath}`, (err, stdout, stderr) => {
        if (stdout) {
            vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
        } else {
            vscode.window.showInformationMessage('Looks formatted!');
        }
    });
}
