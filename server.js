import express from 'express';
import { agentExecutor, streamWithSemanticRouting } from './agent.js'; 
import cors from 'cors'; 
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { transcribeAudio, generateSpeech } from './audioTool.js';

const execAsync = promisify(exec);

const app = express();
const port = 3000;

// --- SSE Clients for Push Notifications ---
const sseClients = new Set();

// --- CONFIG: Multer (File Uploads) ---
const uploadDir = 'temp';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `voice-${Date.now()}.webm`)
});
const upload = multer({ storage: storage });

// --- Middlewares ---
app.use(express.json());
app.use(cors()); // <-- 2. Use cors (This tells your server to accept requests)
app.use(express.static('.')); // Serve static files from current directory

// --- STATE: Simple Access Control ---
let isUnlocked = false; 
const PASSWORD = "Protocol Zero"; 

// --- API Endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // 🔒 THE INITIAL LOCK
    if (!isUnlocked) {
         if (question.toLowerCase() === PASSWORD.toLowerCase()) {
             isUnlocked = true;
             // Send as SSE 
             res.setHeader('Content-Type', 'text/event-stream');
             res.write(`data: ${JSON.stringify({ type: "token", content: "✅ AUTHENTICATION VERIFIED. E.D.I.T.H. Online. Awaiting orders." })}\n\n`);
             res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
             res.end();
             return;
         } else {
             // Send as SSE
             res.setHeader('Content-Type', 'text/event-stream');
             res.write(`data: ${JSON.stringify({ type: "token", content: "🔒 ACCESS DENIED. Authorization Code Required." })}\n\n`);
             res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
             res.end();
             return;
         }
    }

    console.log(`[Server] Received question: ${question}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use the Traffic Cop streaming function
    const stream = streamWithSemanticRouting(question, "user-1");
    
    let completeResponse = "";

    for await (const event of stream) {
        const eventType = event.event;
        
        if (eventType === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) {
                completeResponse += content;
                res.write(`data: ${JSON.stringify({ type: "token", content })}\n\n`);
            }
        } else if (eventType === "on_tool_start") {
             res.write(`data: ${JSON.stringify({ type: "tool_start", name: event.name, input: event.data?.input })}\n\n`);
        } else if (eventType === "on_tool_end") {
             res.write(`data: ${JSON.stringify({ type: "tool_end", name: event.name, output: event.data?.output })}\n\n`);
        }
    }

    // --- TTS Generation ---
    // - Replace lines ~88 to ~119 with this logic

    let sentenceBuffer = "";

    for await (const event of stream) {
        const eventType = event.event;
        
        if (eventType === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) {
                res.write(`data: ${JSON.stringify({ type: "token", content })}\n\n`);
                
                // Add to buffer and check for sentence end
                sentenceBuffer += content;
                if (/[.?!]\s$/.test(sentenceBuffer) && sentenceBuffer.length > 5) {
                    // Send this chunk to TTS immediately (don't await!)
                    generateAudioChunk(sentenceBuffer.trim());
                    sentenceBuffer = ""; // Clear buffer
                }
            }
        } else if (eventType === "on_tool_start") {
             res.write(`data: ${JSON.stringify({ type: "tool_start", name: event.name, input: event.data?.input })}\n\n`);
        } else if (eventType === "on_tool_end") {
             res.write(`data: ${JSON.stringify({ type: "tool_end", name: event.name, output: event.data?.output })}\n\n`);
        }
    }

    // Process any remaining text in the buffer
    if (sentenceBuffer.trim().length > 0) {
        generateAudioChunk(sentenceBuffer.trim());
    }
    
    // Helper function for Fire-and-Forget Audio
    async function generateAudioChunk(text) {
        try {
             // console.log("Generating audio chunk:", text);
             const audioPath = await generateSpeech({ text });
             if (audioPath && !audioPath.startsWith("Error")) {
                  const audioUrl = '/temp/' + path.basename(audioPath);
                  // Send a new type 'audio' or 'audio_chunk'
                  res.write(`data: ${JSON.stringify({ type: "audio", url: audioUrl })}\n\n`);
             }
        } catch (e) { console.error("TTS Chunk Error:", e); }
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

  } catch (error) {
    console.error("[Server] Error processing request:", error);
    res.write(`data: ${JSON.stringify({ type: "error", content: error.message })}\n\n`);
    res.end();
  }
});

// --- API: Voice Interaction ---
app.post('/api/voice', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error("No audio file uploaded.");
    
    const audioPath = req.file.path;
    
    // 1. Transcribe
    let userText;
    try {
        userText = await transcribeAudio({ filePath: audioPath });
    } finally {
        // Delete the file strictly after use so we don't save recordings
        fs.unlink(audioPath, (err) => {
            if (err) console.error(`[Server] Failed to delete voice file: ${err.message}`);
        });
    }

    if (typeof userText === 'string' && userText.startsWith("Error")) throw new Error(userText);
    
    console.log(`[Voice] User said: "${userText}"`);

    // 2. Ask Agent
    // We use a separate session for voice or share? Let's use "voice-session" for now to keep context clean-ish.
    const result = await agentExecutor.invoke(
      { input: userText },
      { configurable: { sessionId: "voice-session" } }
    );
    
    const assistantText = result.output; 

    // 3. Generate Speech
    const outputAudioPath = await generateSpeech({ text: assistantText });
    
    let audioUrl = null;
    if (outputAudioPath && !outputAudioPath.startsWith("Error")) {
        audioUrl = '/temp/' + path.basename(outputAudioPath);
    }

    res.json({
        userText,
        answer: assistantText, 
        audioUrl
    });

  } catch (error) {
    console.error("[Voice] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// GIT HOOK INTEGRATION - Post-Commit Analysis
// =============================================================================

// SSE endpoint for push notifications (EDITH can talk to you unprompted)
app.get('/api/notifications', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: "connected", message: "EDITH notification channel open." })}\n\n`);
    
    // Add this client to our set
    sseClients.add(res);
    console.log(`[Notifications] Client connected. Total: ${sseClients.size}`);
    
    // Remove client when they disconnect
    req.on('close', () => {
        sseClients.delete(res);
        console.log(`[Notifications] Client disconnected. Total: ${sseClients.size}`);
    });
});

// Helper to broadcast to all connected clients
function broadcastNotification(notification) {
    const message = `data: ${JSON.stringify(notification)}\n\n`;
    for (const client of sseClients) {
        client.write(message);
    }
}

// Git Hook Endpoint - Called by post-commit hook
app.post('/api/hooks/commit-event', async (req, res) => {
    console.log("[Git Hook] 🔔 Commit event received!");
    
    try {
        // Get commit info
        const { stdout: commitId } = await execAsync('git rev-parse HEAD');
        const { stdout: commitMessage } = await execAsync('git log -1 --pretty=%B');
        const { stdout: commitAuthor } = await execAsync('git log -1 --pretty=%an');
        const { stdout: diffStat } = await execAsync('git diff --stat HEAD~1 HEAD');
        const { stdout: diffContent } = await execAsync('git diff HEAD~1 HEAD --no-color');
        
        const commitInfo = {
            id: commitId.trim().substring(0, 8),
            fullId: commitId.trim(),
            message: commitMessage.trim(),
            author: commitAuthor.trim(),
            filesChanged: diffStat.trim(),
        };
        
        console.log(`[Git Hook] Commit: ${commitInfo.id} - "${commitInfo.message}"`);
        
        // Limit diff size to avoid token explosion
        const maxDiffLength = 4000;
        const truncatedDiff = diffContent.length > maxDiffLength 
            ? diffContent.substring(0, maxDiffLength) + "\n... [DIFF TRUNCATED FOR BREVITY]"
            : diffContent;
        
        // Analyze with EDITH
        const analysisPrompt = `
[SYSTEM: Git Commit Analysis Mode]
A new commit was just made. Analyze it and provide brief, actionable feedback.

COMMIT INFO:
- ID: ${commitInfo.id}
- Message: "${commitInfo.message}"
- Author: ${commitInfo.author}
- Files Changed:
${commitInfo.filesChanged}

CODE DIFF:
\`\`\`diff
${truncatedDiff}
\`\`\`

ANALYSIS TASKS:
1. Summarize what changed in 1-2 sentences.
2. Did any function signatures or API endpoints change? If yes, suggest documentation updates.
3. Are there any potential issues (missing error handling, hardcoded values, etc.)?
4. Should the README or any docs be updated?

Keep response concise (under 100 words). End with a clear question if action is needed.
`;

        // Use the agent to analyze
        const result = await agentExecutor.invoke(
            { input: analysisPrompt },
            { configurable: { sessionId: "git-hook-session" } }
        );
        
        const analysis = result.output;
        console.log(`[Git Hook] EDITH Analysis: ${analysis.substring(0, 100)}...`);
        
        // Broadcast to any connected frontend clients
        broadcastNotification({
            type: "commit_analysis",
            commit: commitInfo,
            analysis: analysis,
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            success: true, 
            commit: commitInfo,
            analysis: analysis 
        });
        
    } catch (error) {
        console.error("[Git Hook] Error:", error.message);
        
        // Handle case where there's no previous commit (first commit)
        if (error.message.includes("ambiguous argument 'HEAD~1'")) {
            res.json({ 
                success: true, 
                message: "First commit detected. No diff to analyze.",
                commit: { message: "Initial commit" }
            });
            return;
        }
        
        res.status(500).json({ error: error.message });
    }
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`Server is listening at http://localhost:3000`);
});

// Keep-alive to prevent process exit if something is weird
setInterval(() => {
  console.log('[Heartbeat] Server is alive...');
}, 10000);

// Global Error Handlers
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
});

process.on('exit', (code) => {
    console.log(`[Server] Process exited with code: ${code}`);
});


process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});