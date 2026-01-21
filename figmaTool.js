import fetch from 'node-fetch';
import './envConfig.js';

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const BASE_URL = 'https://api.figma.com/v1';

const getHeaders = () => {
    return {
        'X-Figma-Token': FIGMA_TOKEN,
        'Content-Type': 'application/json'
    };
};

// --- TOOL 1: GET FILE METADATA ---
// We don't fetch the whole file (it's too big). We just get the structure.
export async function getFigmaFileStructure(input) {
    console.log("🎨 Figma File Scan:", JSON.stringify(input));
    const { fileKey } = input; // The ID in the URL: figma.com/file/KEY/Name

    if (!FIGMA_TOKEN) throw new Error("Missing FIGMA_TOKEN");

    try {
        // depth=1 keeps it light (just pages and top-level frames)
        const response = await fetch(`${BASE_URL}/files/${fileKey}?depth=2`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            // Handle specific error cases
            if (response.status === 400 && errorData.err?.includes("not supported")) {
                return `Error: This file type is not supported. The file key "${fileKey}" may be a FigJam board or Figma Slides, not a regular Figma design file. Only Figma design files (.fig) are supported by this tool.`;
            }
            if (response.status === 403) {
                return `Error: Access denied. The FIGMA_TOKEN may not have permission to access this file, or the file is private.`;
            }
            if (response.status === 404) {
                return `Error: File not found. The file key "${fileKey}" does not exist or has been deleted.`;
            }
            
            throw new Error(`Figma API Error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        const data = await response.json();
        const pages = data.document.children.map(p => ({
            id: p.id,
            name: p.name,
            frames: p.children?.map(f => ({ id: f.id, name: f.name, type: f.type })) || []
        }));

        return JSON.stringify({
            name: data.name,
            lastModified: data.lastModified,
            editorType: data.editorType,
            structure: pages
        });

    } catch (error) {
        return `Error scanning Figma file: ${error.message}`;
    }
}

// --- TOOL 2: GET COMMENTS ---
export async function getFigmaComments(input) {
    console.log("💬 Checking Figma Comms:", JSON.stringify(input));
    const { fileKey } = input;

    try {
        const response = await fetch(`${BASE_URL}/files/${fileKey}/comments`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (!response.ok) throw new Error(`Figma API Error: ${response.status}`);
        
        const data = await response.json();
        const comments = data.comments.map(c => ({
            user: c.user.handle,
            message: c.message,
            created_at: c.created_at,
            resolved: c.resolved ? "Resolved" : "Open"
        })).slice(0, 10); // Limit to last 10 to save token space

        return JSON.stringify(comments);
    } catch (error) {
        return `Error reading comments: ${error.message}`;
    }
}

// --- TOOL 3: POST COMMENT ---
export async function postFigmaComment(input) {
    console.log("📝 Posting Figma Directive:", JSON.stringify(input));
    const { fileKey, message, node_id } = input;

    if (!message) throw new Error("Message is required.");

    try {
        // Figma API requires client_meta with vector coordinates
        // For file-level comments, we post to the first page at position (0,0)
        const body = { 
            message,
        };
        
        // If a specific node (frame/button) is targeted, attach comment to it
        if (node_id) {
            body.client_meta = { 
                node_id: node_id,
                node_offset: { x: 0, y: 0 } 
            };
        } else {
            // For general file comments, we need to provide a vector position
            // This places the comment at the top-left of the canvas
            body.client_meta = {
                x: 0,
                y: 0
            };
        }

        const response = await fetch(`${BASE_URL}/files/${fileKey}/comments`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Figma Post Error: ${response.status} - ${JSON.stringify(errorData)}`);
        }
        
        const data = await response.json();
        return `Comment posted successfully by E.D.I.T.H. (ID: ${data.id})`;

    } catch (error) {
        return `Error posting comment: ${error.message}`;
    }
}