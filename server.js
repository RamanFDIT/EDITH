import express from 'express';
import { agentExecutor, streamWithSemanticRouting } from './agent.js'; 
import cors from 'cors'; 
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { transcribeAudio, generateSpeech } from './audioTool.js';

const app = express();
const port = 3000;

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
    try {
        if (completeResponse.trim().length > 0) {
             console.log("Generating speech for response...");
             const audioPath = await generateSpeech({ text: completeResponse });
             if (audioPath && !audioPath.startsWith("Error")) {
                  const audioUrl = '/temp/' + path.basename(audioPath);
                  res.write(`data: ${JSON.stringify({ type: "audio", url: audioUrl })}\n\n`);
             } else {
                 console.log("TTS Error:", audioPath);
             }
        }
    } catch (e) {
        console.error("Auto-TTS Exception:", e);
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

  } catch (error) {
    if (error.message && error.message.includes("AbortError")) {
        console.log('[Server] Stream aborted by user or timeout.');
        return;
    }

    console.error('[Server] Error calling agent:', error);
    // If headers already sent, we can't send JSON error, but we can send an SSE error event
    if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: "error", content: error.message || "Tactical error." })}\n\n`);
        res.end();
    } else {
        res.status(500).json({ answer: `Tactical error: ${error.message}` }); 
    }
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