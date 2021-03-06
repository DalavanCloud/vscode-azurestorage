/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as azureStorage from "azure-storage";
import * as copypaste from 'copy-paste';
import * as path from 'path';
import { Uri, window } from 'vscode';
import { DialogResponses, IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { StorageAccountKeyWrapper, StorageAccountWrapper } from "../../components/storageWrappers";
import { ext } from "../../extensionVariables";
import { ICopyUrl } from '../../ICopyUrl';
import { askAndCreateChildDirectory, deleteDirectoryAndContents, listFilesInDirectory } from './directoryUtils';
import { FileNode } from './fileNode';
import { askAndCreateEmptyTextFile } from './fileUtils';

export class DirectoryNode implements IAzureParentTreeItem, ICopyUrl {
    constructor(
        public readonly parentPath: string,
        public readonly directory: azureStorage.FileService.DirectoryResult, // directory.name should not include parent path
        public readonly share: azureStorage.FileService.ShareResult,
        public readonly storageAccount: StorageAccountWrapper,
        public readonly key: StorageAccountKeyWrapper) {

    }

    private _continuationToken: azureStorage.common.ContinuationToken | undefined;
    public label: string = this.directory.name;
    public static contextValue: string = 'azureFileShareDirectory';
    public contextValue: string = DirectoryNode.contextValue;
    public iconPath: { light: string | Uri; dark: string | Uri } = {
        light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'light', 'folder.svg'),
        dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'dark', 'folder.svg')
    };

    private get fullPath(): string {
        return path.posix.join(this.parentPath, this.directory.name);
    }

    hasMoreChildren(): boolean {
        return !!this._continuationToken;
    }

    async loadMoreChildren(_node: IAzureNode, clearCache: boolean): Promise<IAzureTreeItem[]> {
        if (clearCache) {
            this._continuationToken = undefined;
        }

        // tslint:disable-next-line:no-non-null-assertion // currentToken argument typed incorrectly in SDK
        let fileResults = await this.listFiles(<azureStorage.common.ContinuationToken>this._continuationToken!);
        let { entries, continuationToken } = fileResults;
        this._continuationToken = continuationToken;

        return (<IAzureTreeItem[]>[])
            .concat(entries.directories.map((directory: azureStorage.FileService.DirectoryResult) => {
                return new DirectoryNode(this.fullPath, directory, this.share, this.storageAccount, this.key);
            }))
            .concat(entries.files.map((file: azureStorage.FileService.FileResult) => {
                return new FileNode(file, this.fullPath, this.share, this.storageAccount, this.key);
            }));
    }

    public async copyUrl(_node: IAzureNode): Promise<void> {
        let fileService = azureStorage.createFileService(this.storageAccount.name, this.key.value);
        let url = fileService.getUrl(this.share.name, this.fullPath);
        copypaste.copy(url);
        ext.outputChannel.show();
        ext.outputChannel.appendLine(`Directory URL copied to clipboard: ${url}`);
    }

    // tslint:disable-next-line:promise-function-async // Grandfathered in
    listFiles(currentToken: azureStorage.common.ContinuationToken | undefined): Promise<azureStorage.FileService.ListFilesAndDirectoriesResult> {
        return listFilesInDirectory(this.fullPath, this.share.name, this.storageAccount.name, this.key.value, 50, currentToken);
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void, userOptions?: {}): Promise<IAzureTreeItem> {
        if (userOptions === FileNode.contextValue) {
            return askAndCreateEmptyTextFile(this.fullPath, this.share, this.storageAccount, this.key, showCreatingNode);
        } else {
            return askAndCreateChildDirectory(this.fullPath, this.share, this.storageAccount, this.key, showCreatingNode);
        }
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        // Note: Azure will fail the directory delete if it's not empty, so no need to ask about deleting contents
        const message: string = `Are you sure you want to delete the directory '${this.label}' and all of its files and subdirectories?`;
        const result = await window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            ext.outputChannel.show();
            await deleteDirectoryAndContents(this.fullPath, this.share.name, this.storageAccount.name, this.key.value);
        } else {
            throw new UserCancelledError();
        }
    }
}
