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

// --- API Endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`[Server] Received question: ${question}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use the Traffic Cop streaming function
    const stream = streamWithSemanticRouting(question, "user-1");
    
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
             const audioResult = await generateSpeech({ text });
             // Check if it's a file path or a Web Speech API fallback
             if (typeof audioResult === 'string') {
                  try {
                    const parsed = JSON.parse(audioResult);
                    if (parsed.fallback === 'web-speech-api') {
                      // Tell frontend to use browser TTS
                      res.write(`data: ${JSON.stringify({ type: "tts_fallback", text: parsed.text })}\n\n`);
                      return;
                    }
                  } catch (e) {
                    // Not JSON — treat as file path
                  }
                  if (audioResult && !audioResult.startsWith("Error")) {
                      const audioUrl = '/temp/' + path.basename(audioResult);
                      res.write(`data: ${JSON.stringify({ type: "audio", url: audioUrl })}\n\n`);
                  }
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
    const outputAudioResult = await generateSpeech({ text: assistantText });
    
    let audioUrl = null;
    let ttsFallback = false;

    if (typeof outputAudioResult === 'string') {
        try {
            const parsed = JSON.parse(outputAudioResult);
            if (parsed.fallback === 'web-speech-api') {
                ttsFallback = true;
            }
        } catch (e) {
            // Not JSON — treat as file path
            if (outputAudioResult && !outputAudioResult.startsWith("Error")) {
                audioUrl = '/temp/' + path.basename(outputAudioResult);
            }
        }
    }

    res.json({
        userText,
        answer: assistantText, 
        audioUrl,
        ttsFallback,
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

process.on('SIGINT', async () => {
    console.log('[Server] Shutting down...');
    process.exit(0);
});


process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});