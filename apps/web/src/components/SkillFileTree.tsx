import { SkillFile } from '../api/skills';

type FileTreeNode = {
    name: string;
    path: string;
    fullPath: string;
    type: 'directory' | 'file';
    isEntrypoint?: boolean;
    children?: FileTreeNode[];
};

export function SkillFileTree({
    files,
    selectedPath,
    selectedDirectoryPath = null,
    onSelect,
    onSelectDirectory,
    displayRootPath = null,
    emptyLabel = 'No files available.',
}: {
    files: SkillFile[];
    selectedPath: string | null;
    selectedDirectoryPath?: string | null;
    onSelect: (path: string) => void;
    onSelectDirectory?: (path: string) => void;
    displayRootPath?: string | null;
    emptyLabel?: string;
}) {
    const tree = buildFileTree(files, displayRootPath);

    if (tree.length === 0) {
        return <p className="text-sm text-gray-500">{emptyLabel}</p>;
    }

    return (
        <div className="space-y-1">
            {tree.map((node) =>
                renderTreeNode(node, selectedPath, selectedDirectoryPath, onSelect, onSelectDirectory)
            )}
        </div>
    );
}

function renderTreeNode(
    node: FileTreeNode,
    selectedPath: string | null,
    selectedDirectoryPath: string | null,
    onSelect: (path: string) => void,
    onSelectDirectory?: (path: string) => void
): JSX.Element {
    if (node.type === 'directory') {
        return (
            <details key={node.path} open className="rounded border border-gray-100 px-2 py-1">
                <summary
                    className={`cursor-pointer rounded px-1 py-0.5 text-sm font-medium ${
                        selectedDirectoryPath === node.fullPath ? 'bg-slate-900 text-white' : 'text-gray-700'
                    }`}
                    onClick={() => onSelectDirectory?.(node.fullPath)}
                >
                    {node.name}
                </summary>
                <div className="ml-3 mt-2 space-y-1">
                    {node.children?.map((child) =>
                        renderTreeNode(child, selectedPath, selectedDirectoryPath, onSelect, onSelectDirectory)
                    )}
                </div>
            </details>
        );
    }

    return (
        <button
            key={node.path}
            type="button"
            onClick={() => onSelect(node.fullPath)}
            className={`block w-full rounded px-2 py-1 text-left text-sm ${
                selectedPath === node.fullPath ? 'bg-slate-900 text-white' : 'hover:bg-gray-100'
            }`}
        >
            {node.name}
        </button>
    );
}

function buildFileTree(files: SkillFile[], displayRootPath: string | null): FileTreeNode[] {
    const root = normalizePath(displayRootPath);
    return buildChildren(files.map((file) => ({
        ...file,
        displayPath: toDisplayPath(file.path, root),
    })));
}

function buildChildren(files: Array<SkillFile & { displayPath: string }>, prefix = ''): FileTreeNode[] {
    const directories = new Map<string, Array<SkillFile & { displayPath: string }>>();
    const leafFiles: Array<SkillFile & { displayPath: string }> = [];

    for (const file of files) {
        const relative = prefix ? file.displayPath.slice(prefix.length + 1) : file.displayPath;
        const [head, ...rest] = relative.split('/');
        if (rest.length === 0) {
            leafFiles.push(file);
            continue;
        }
        const group = directories.get(head) ?? [];
        group.push(file);
        directories.set(head, group);
    }

    const directoryNodes = [...directories.entries()].map(([name, groupedFiles]) => {
        const path = prefix ? `${prefix}/${name}` : name;
        return {
            name,
            path,
            fullPath: groupedFiles[0]?.path.split('/').slice(0, path.split('/').length).join('/') ?? path,
            type: 'directory' as const,
            children: buildChildren(groupedFiles, path),
        };
    });

    const fileNodes = leafFiles.map((file) => ({
        name: file.displayPath.split('/').pop() ?? file.displayPath,
        path: file.displayPath,
        fullPath: file.path,
        type: 'file' as const,
        isEntrypoint: file.role === 'entrypoint' || file.path === 'SKILL.md' || file.displayPath === 'SKILL.md',
    }));

    return [...directoryNodes, ...fileNodes].sort(sortTreeNodes);
}

function sortTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
    if (left.isEntrypoint !== right.isEntrypoint) {
        return left.isEntrypoint ? -1 : 1;
    }
    if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
}

function normalizePath(path: string | null): string | null {
    if (!path) {
        return null;
    }
    return path.replace(/^\/+|\/+$/g, '') || null;
}

function toDisplayPath(path: string, rootPath: string | null): string {
    if (!rootPath) {
        return path;
    }
    if (path.startsWith(`${rootPath}/`)) {
        return path.slice(rootPath.length + 1);
    }
    return path;
}
