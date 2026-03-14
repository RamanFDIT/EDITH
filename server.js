import express from 'express';
import { streamWithSemanticRouting } from './agent.js'; 
import cors from 'cors'; 
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import { transcribeAudio, generateSpeech } from './audioTool.js';

const execAsync = promisify(exec);

const app = express();
const port = 3000;

// --- CONFIG: Multer (File Uploads) ---
const uploadDir = path.join(os.tmpdir(), 'edith-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `voice-${Date.now()}.webm`)
});
const upload = multer({ storage: storage });
const voiceUpload = multer({ storage: multer.memoryStorage() });

// --- Middlewares ---
app.use(express.json());
app.use(cors()); // <-- 2. Use cors (This tells your server to accept requests)
app.use(express.static('.')); // Serve static files from current directory

// --- API: File Upload ---
const fileUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

app.post('/api/upload', fileUpload.array('files', 10), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }
    const uploaded = req.files.map(f => ({
        originalName: f.originalname,
        path: path.resolve(f.path),
        size: f.size,
    }));
    console.log(`[Server] Uploaded ${uploaded.length} file(s):`, uploaded.map(f => f.originalName));
    res.json({ files: uploaded });
});

// --- API Endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    const { question, files } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // If files were uploaded, prepend instructions to read them
    let fullQuestion = question;
    if (files && files.length > 0) {
        const fileList = files.map(f => `- "${f.path}" (${f.originalName})`).join('\n');
        fullQuestion = `The user has attached the following file(s) for you to use. Read them using your file tools before answering:\n${fileList}\n\nUser's message: ${question}`;
        console.log(`[Server] ${files.length} file(s) attached to question`);
    }

    console.log(`[Server] Received question: ${question}`);

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Use the Traffic Cop streaming function
    const stream = streamWithSemanticRouting(fullQuestion, "user-1");
    
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
             // LangGraph streamEvents v2: output may be a ToolMessage object or a plain string
             const rawOutput = event.data?.output;
             console.log(`[DEBUG on_tool_end] name=${event.name}, rawOutput type=${typeof rawOutput}, keys=${rawOutput && typeof rawOutput === 'object' ? Object.keys(rawOutput).join(',') : 'N/A'}, preview=${JSON.stringify(rawOutput).substring(0, 200)}`);
             const toolOutput = typeof rawOutput === 'object' && rawOutput !== null
                 ? (rawOutput.content || rawOutput.text || JSON.stringify(rawOutput))
                 : rawOutput;
             res.write(`data: ${JSON.stringify({ type: "tool_end", name: event.name, output: toolOutput })}\n\n`);

             // Detect generated images in tool output and send as dedicated event
             const outputStr = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
             if (outputStr) {
                 try {
                     const parsed = JSON.parse(outputStr);
                     if (parsed.success && parsed.localUrl && parsed.localUrl.startsWith('/temp/')) {
                         res.write(`data: ${JSON.stringify({ type: "image", url: `http://localhost:3000${parsed.localUrl}`, caption: parsed.caption || null })}\n\n`);
                     }
                 } catch (e) { /* not JSON, ignore */ }
             }
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
                      const audioUrl = audioResult.startsWith('data:') ? audioResult : '/temp/' + path.basename(audioResult);
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

// --- NEW API: Deepgram WebSocket Proxy (Live Transcription) ---
import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    console.log('[WebSocket] Client connected for live transcription');
    let deepgramWs = null;

    if (!process.env.DEEPGRAM_API_KEY) {
        console.error('[WebSocket] DEEPGRAM_API_KEY is missing');
        ws.send(JSON.stringify({ error: 'Deepgram API Key not configured' }));
        ws.close();
        return;
    }

    try {
        deepgramWs = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true', {
            headers: {
                Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`
            }
        });

        deepgramWs.on('open', () => {
             console.log('[Deepgram] WebSocket connected');
             ws.send(JSON.stringify({ type: 'ready' }));
        });

        deepgramWs.on('message', (data) => {
            try {
               const parsed = JSON.parse(data);
               if (parsed.channel && parsed.channel.alternatives && parsed.channel.alternatives[0]) {
                   const transcript = parsed.channel.alternatives[0].transcript;
                   if (transcript) {
                       ws.send(JSON.stringify({
                           type: 'transcript',
                           isFinal: parsed.is_final,
                           text: transcript
                       }));
                   }
               }
            } catch (e) { }
        });

        deepgramWs.on('close', () => {
             console.log('[Deepgram] WebSocket closed');
             ws.close();
        });

        deepgramWs.on('error', (err) => {
             console.error('[Deepgram] WebSocket Error:', err);
             ws.close();
        });
    } catch(err) {
        console.error('[WebSocket] Failed to connect to Deepgram:', err);
        ws.close();
    }

    ws.on('message', (message) => {
        // message is expected to be binary audio data from MediaRecorder
        if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
            deepgramWs.send(message);
        }
    });

    ws.on('close', () => {
        console.log('[WebSocket] Client disconnected');
        if (deepgramWs && deepgramWs.readyState === WebSocket.OPEN) {
            deepgramWs.close();
        }
    });
});

// --- API: Voice Interaction (Streaming SSE) ---
app.post('/api/voice', voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error("No audio file uploaded.");

    // Set headers for SSE streaming (same as /api/ask)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const base64Audio = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'audio/webm';

    // 1. Transcribe audio (in-memory, no temp files)
    let userText;
    try {
      userText = await transcribeAudio({ base64Audio, mimeType });
      if (typeof userText === 'string' && userText.startsWith("Error")) throw new Error(userText);
    } catch (transcribeErr) {
      res.write(`data: ${JSON.stringify({ type: 'error', content: transcribeErr.message })}\n\n`);
      res.end();
      return;
    }

    console.log(`[Voice] User said: "${userText}"`);

    // 2. Immediately tell the frontend what the user said (no waiting for agent)
    res.write(`data: ${JSON.stringify({ type: 'user_text', content: userText })}\n\n`);

    // 3. Stream agent response (same pipeline as /api/ask)
    const stream = streamWithSemanticRouting(userText, "user-1");

    let sentenceBuffer = "";

    // Helper: TTS for each sentence chunk
    async function generateAudioChunk(text) {
      try {
        const audioResult = await generateSpeech({ text });
        if (typeof audioResult === 'string') {
          try {
            const parsed = JSON.parse(audioResult);
            if (parsed.fallback === 'web-speech-api') {
              res.write(`data: ${JSON.stringify({ type: 'tts_fallback', text: parsed.text })}\n\n`);
              return;
            }
          } catch (e) { /* not JSON */ }
          if (audioResult && !audioResult.startsWith('Error')) {
            const audioUrl = audioResult.startsWith('data:') ? audioResult : '/temp/' + path.basename(audioResult);
            res.write(`data: ${JSON.stringify({ type: 'audio', url: audioUrl })}\n\n`);
          }
        }
      } catch (e) { console.error('[Voice] TTS Chunk Error:', e); }
    }

    for await (const event of stream) {
      const eventType = event.event;

      if (eventType === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);

          sentenceBuffer += content;
          if (/[.?!]\s$/.test(sentenceBuffer) && sentenceBuffer.length > 5) {
            generateAudioChunk(sentenceBuffer.trim()); // fire-and-forget
            sentenceBuffer = '';
          }
        }
      } else if (eventType === 'on_tool_start') {
        res.write(`data: ${JSON.stringify({ type: 'tool_start', name: event.name, input: event.data?.input })}\n\n`);
      } else if (eventType === 'on_tool_end') {
        const rawOutput = event.data?.output;
        const toolOutput = typeof rawOutput === 'object' && rawOutput !== null
          ? (rawOutput.content || rawOutput.text || JSON.stringify(rawOutput))
          : rawOutput;
        res.write(`data: ${JSON.stringify({ type: 'tool_end', name: event.name, output: toolOutput })}\n\n`);
      }
    }

    // Any leftover text in the buffer
    if (sentenceBuffer.trim().length > 0) {
      generateAudioChunk(sentenceBuffer.trim());
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('[Voice] Error:', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      res.end();
    } catch (e) { /* headers already sent */ }
  }
});

// --- API: Chat History ---
app.get('/api/history', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'user-1';
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 20;

        const historyPath = path.join(os.homedir(), '.edith', 'chat_history.json');

        if (!fs.existsSync(historyPath)) {
            return res.json({ messages: [], total: 0, hasMore: false });
        }

        const fileContent = await fs.promises.readFile(historyPath, 'utf-8');
        if (!fileContent || !fileContent.trim()) {
            return res.json({ messages: [], total: 0, hasMore: false });
        }

        const allHistory = JSON.parse(fileContent);
        const sessionHistory = allHistory[sessionId] || [];
        const total = sessionHistory.length;

        // offset 0 = most recent `limit` messages
        const start = Math.max(0, total - offset - limit);
        const end = Math.max(0, total - offset);
        const slice = sessionHistory.slice(start, end);

        res.json({
            messages: slice,
            total,
            hasMore: start > 0,
        });
    } catch (error) {
        console.error('[Server] Error reading history:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- Start Server ---
const server = app.listen(port, () => {
  console.log(`Server is listening at http://localhost:3000`);
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/live-transcription') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// Keep-alive to prevent process exit if something is weird
setInterval(() => {
  console.log('[Heartbeat] Server is alive...');
}, 300000); // 5 minutes

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