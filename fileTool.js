import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import mammoth from 'mammoth';
import './envConfig.js';

// pdf-parse is CommonJS, need to use createRequire
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// Common user directories
const USER_DIRS = {
    downloads: path.join(os.homedir(), 'Downloads'),
    documents: path.join(os.homedir(), 'Documents'),
    desktop: path.join(os.homedir(), 'Desktop'),
};

/**
 * Resolve a file path - handles relative paths and common shortcuts
 */
function resolvePath(filePath) {
    // Handle shortcuts like "~/Downloads/file.txt" or "Downloads/file.txt"
    if (filePath.startsWith('~/')) {
        return path.join(os.homedir(), filePath.slice(2));
    }
    
    // Handle common folder shortcuts
    const lowerPath = filePath.toLowerCase();
    for (const [key, dir] of Object.entries(USER_DIRS)) {
        if (lowerPath.startsWith(key + '/') || lowerPath.startsWith(key + '\\')) {
            return path.join(dir, filePath.slice(key.length + 1));
        }
    }
    
    // Return as-is if it's already absolute
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    
    // Otherwise, assume it's relative to cwd
    return path.resolve(filePath);
}

// --- TOOL 1: READ TEXT FILE ---
export async function readTextFile(input) {
    console.log("📄 Read Text File Invoked:", JSON.stringify(input));
    
    const { filePath, encoding = 'utf-8' } = input;
    
    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }
    
    const resolvedPath = resolvePath(filePath);
    
    try {
        if (!fs.existsSync(resolvedPath)) {
            return `Error: File not found at "${resolvedPath}"`;
        }
        
        const content = await fs.promises.readFile(resolvedPath, encoding);
        const stats = fs.statSync(resolvedPath);
        
        return JSON.stringify({
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            content: content,
            charCount: content.length
        });
    } catch (error) {
        console.error("File Read Error:", error);
        return `Error reading file: ${error.message}`;
    }
}

// --- TOOL 2: READ WORD DOCUMENT (.docx) ---
export async function readWordDocument(input) {
    console.log("📝 Read Word Document Invoked:", JSON.stringify(input));
    
    const { filePath } = input;
    
    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }
    
    const resolvedPath = resolvePath(filePath);
    
    try {
        if (!fs.existsSync(resolvedPath)) {
            return `Error: File not found at "${resolvedPath}"`;
        }
        
        const ext = path.extname(resolvedPath).toLowerCase();
        if (ext !== '.docx') {
            return `Error: Expected .docx file, got "${ext}". Use readTextFile for plain text files.`;
        }
        
        const buffer = await fs.promises.readFile(resolvedPath);
        const result = await mammoth.extractRawText({ buffer });
        const stats = fs.statSync(resolvedPath);
        
        return JSON.stringify({
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            content: result.value,
            charCount: result.value.length,
            warnings: result.messages.length > 0 ? result.messages : undefined
        });
    } catch (error) {
        console.error("Word Document Error:", error);
        return `Error reading Word document: ${error.message}`;
    }
}

// --- TOOL 3: READ PDF ---
export async function readPdfDocument(input) {
    console.log("📕 Read PDF Invoked:", JSON.stringify(input));
    
    const { filePath } = input;
    
    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }
    
    const resolvedPath = resolvePath(filePath);
    
    try {
        if (!fs.existsSync(resolvedPath)) {
            return `Error: File not found at "${resolvedPath}"`;
        }
        
        const ext = path.extname(resolvedPath).toLowerCase();
        if (ext !== '.pdf') {
            return `Error: Expected .pdf file, got "${ext}"`;
        }
        
        const buffer = await fs.promises.readFile(resolvedPath);
        const data = await pdfParse(buffer);
        const stats = fs.statSync(resolvedPath);
        
        return JSON.stringify({
            filePath: resolvedPath,
            fileName: path.basename(resolvedPath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            pageCount: data.numpages,
            content: data.text,
            charCount: data.text.length,
            info: data.info
        });
    } catch (error) {
        console.error("PDF Read Error:", error);
        return `Error reading PDF: ${error.message}`;
    }
}

// --- TOOL 4: LIST DIRECTORY ---
export async function listDirectory(input) {
    console.log("📁 List Directory Invoked:", JSON.stringify(input));
    
    const { 
        directoryPath = USER_DIRS.downloads, 
        filter,
        sortBy = 'modified',
        limit = 20 
    } = input;
    
    const resolvedPath = resolvePath(directoryPath);
    
    try {
        if (!fs.existsSync(resolvedPath)) {
            return `Error: Directory not found at "${resolvedPath}"`;
        }
        
        const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
        
        let files = await Promise.all(
            entries
                .filter(entry => entry.isFile())
                .map(async (entry) => {
                    const fullPath = path.join(resolvedPath, entry.name);
                    const stats = await fs.promises.stat(fullPath);
                    return {
                        name: entry.name,
                        path: fullPath,
                        extension: path.extname(entry.name).toLowerCase(),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        modifiedTimestamp: stats.mtime.getTime()
                    };
                })
        );
        
        // Apply filter if provided
        if (filter) {
            const filterLower = filter.toLowerCase();
            files = files.filter(f => 
                f.name.toLowerCase().includes(filterLower) ||
                f.extension === filterLower ||
                f.extension === '.' + filterLower
            );
        }
        
        // Sort files
        if (sortBy === 'modified') {
            files.sort((a, b) => b.modifiedTimestamp - a.modifiedTimestamp);
        } else if (sortBy === 'name') {
            files.sort((a, b) => a.name.localeCompare(b.name));
        } else if (sortBy === 'size') {
            files.sort((a, b) => b.size - a.size);
        }
        
        // Limit results
        files = files.slice(0, limit);
        
        // Clean up output
        files = files.map(({ modifiedTimestamp, ...rest }) => rest);
        
        return JSON.stringify({
            directory: resolvedPath,
            totalFiles: files.length,
            files: files
        });
    } catch (error) {
        console.error("Directory List Error:", error);
        return `Error listing directory: ${error.message}`;
    }
}

// --- TOOL 5: GET LATEST FILE ---
export async function getLatestFile(input) {
    console.log("🔍 Get Latest File Invoked:", JSON.stringify(input));
    
    const { 
        directoryPath = USER_DIRS.downloads,
        extension
    } = input;
    
    const resolvedPath = resolvePath(directoryPath);
    
    try {
        if (!fs.existsSync(resolvedPath)) {
            return `Error: Directory not found at "${resolvedPath}"`;
        }
        
        const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true });
        
        let files = await Promise.all(
            entries
                .filter(entry => entry.isFile())
                .map(async (entry) => {
                    const fullPath = path.join(resolvedPath, entry.name);
                    const stats = await fs.promises.stat(fullPath);
                    return {
                        name: entry.name,
                        path: fullPath,
                        extension: path.extname(entry.name).toLowerCase(),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        modifiedTimestamp: stats.mtime.getTime()
                    };
                })
        );
        
        // Filter by extension if provided
        if (extension) {
            const ext = extension.startsWith('.') ? extension.toLowerCase() : '.' + extension.toLowerCase();
            files = files.filter(f => f.extension === ext);
        }
        
        if (files.length === 0) {
            return JSON.stringify({ 
                message: extension 
                    ? `No ${extension} files found in ${resolvedPath}` 
                    : `No files found in ${resolvedPath}`,
                file: null 
            });
        }
        
        // Get most recently modified
        files.sort((a, b) => b.modifiedTimestamp - a.modifiedTimestamp);
        const latest = files[0];
        
        return JSON.stringify({
            message: "Found latest file",
            file: {
                name: latest.name,
                path: latest.path,
                extension: latest.extension,
                size: latest.size,
                modified: latest.modified
            }
        });
    } catch (error) {
        console.error("Get Latest File Error:", error);
        return `Error finding latest file: ${error.message}`;
    }
}

// --- TOOL 6: SMART FILE READ (Auto-detects type) ---
export async function readFile(input) {
    console.log("📖 Smart Read File Invoked:", JSON.stringify(input));
    
    const { filePath } = input;
    
    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }
    
    const resolvedPath = resolvePath(filePath);
    const ext = path.extname(resolvedPath).toLowerCase();
    
    // Route to appropriate reader based on extension
    switch (ext) {
        case '.docx':
            return readWordDocument({ filePath: resolvedPath });
        case '.pdf':
            return readPdfDocument({ filePath: resolvedPath });
        case '.txt':
        case '.md':
        case '.json':
        case '.js':
        case '.ts':
        case '.css':
        case '.html':
        case '.xml':
        case '.csv':
        case '.yaml':
        case '.yml':
        case '.env':
        case '.log':
            return readTextFile({ filePath: resolvedPath });
        default:
            // Try as text, might work for unknown extensions
            return readTextFile({ filePath: resolvedPath });
    }
}
