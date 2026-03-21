import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import './envConfig.js';

// --- READ TEXT FILE ---
export async function readTextFile(input) {
    console.log("📄 Read Text File Invoked:", JSON.stringify(input));

    const { filePath, encoding = 'utf-8' } = input;

    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }

    try {
        if (!fs.existsSync(filePath)) {
            return JSON.stringify({ status: "error", message: `File not found at "${filePath}"` });
        }

        const content = await fs.promises.readFile(filePath, encoding);
        const stats = fs.statSync(filePath);

        return JSON.stringify({
            status: "success",
            filePath: filePath,
            fileName: path.basename(filePath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            content: content,
            charCount: content.length
        });
    } catch (error) {
        console.error("File Read Error:", error);
        return JSON.stringify({ status: "error", message: `Error reading file: ${error.message}` });
    }
}

// --- READ WORD DOCUMENT (.docx) ---
export async function readWordDocument(input) {
    console.log("📝 Read Word Document Invoked:", JSON.stringify(input));

    const { filePath } = input;

    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }

    try {
        if (!fs.existsSync(filePath)) {
            return JSON.stringify({ status: "error", message: `File not found at "${filePath}"` });
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.docx') {
            return JSON.stringify({ status: "error", message: `Expected .docx file, got "${ext}".` });
        }

        const buffer = await fs.promises.readFile(filePath);
        const result = await mammoth.extractRawText({ buffer });
        const stats = fs.statSync(filePath);

        return JSON.stringify({
            status: "success",
            filePath: filePath,
            fileName: path.basename(filePath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            content: result.value,
            charCount: result.value.length,
            warnings: result.messages.length > 0 ? result.messages : undefined
        });
    } catch (error) {
        console.error("Word Document Error:", error);
        return JSON.stringify({ status: "error", message: `Error reading Word document: ${error.message}` });
    }
}

// --- READ PDF ---
export async function readPdfDocument(input) {
    console.log("📕 Read PDF Invoked:", JSON.stringify(input));

    const { filePath } = input;

    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }

    try {
        if (!fs.existsSync(filePath)) {
            return JSON.stringify({ status: "error", message: `File not found at "${filePath}"` });
        }

        const ext = path.extname(filePath).toLowerCase();
        if (ext !== '.pdf') {
            return JSON.stringify({ status: "error", message: `Expected .pdf file, got "${ext}"` });
        }

        const buffer = await fs.promises.readFile(filePath);

        // pdf-parse v2 class-based API
        const { PDFParse } = await import('pdf-parse');
        const parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        const infoResult = await parser.getInfo();
        const stats = fs.statSync(filePath);

        return JSON.stringify({
            status: "success",
            filePath: filePath,
            fileName: path.basename(filePath),
            size: stats.size,
            lastModified: stats.mtime.toISOString(),
            pageCount: textResult.total,
            content: textResult.text,
            charCount: textResult.text.length,
            info: infoResult.info
        });
    } catch (error) {
        console.error("PDF Read Error:", error);
        return JSON.stringify({ status: "error", message: `Error reading PDF: ${error.message}` });
    }
}

// --- SMART FILE READ (Auto-detects type) ---
export async function readFile(input) {
    console.log("📖 Smart Read File Invoked:", JSON.stringify(input));

    const { filePath } = input;

    if (!filePath) {
        throw new Error("Missing required field: filePath");
    }

    const ext = path.extname(filePath).toLowerCase();

    // Route to appropriate reader based on extension
    switch (ext) {
        case '.docx':
            return readWordDocument({ filePath });
        case '.pdf':
            return readPdfDocument({ filePath });
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
            return readTextFile({ filePath });
        default:
            // Try as text, might work for unknown extensions
            return readTextFile({ filePath });
    }
}
