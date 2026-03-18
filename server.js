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
import { connectDB, Chat, User } from './db.js';

// Connect to Database
connectDB();

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
app.use(cors()); 
app.use(express.static('.')); // Serve static files from current directory

// --- Global Request Logger ---
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

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

import { 
    buildAuthUrl, 
    exchangeCodeForTokens, 
    storeTokens, 
    getConnectionStatus, 
    clearTokens,
    discoverJiraCloudId
} from './oauthService.js';
import crypto from 'crypto';

// --- API: OAuth ---

// 1. Get Auth URL
app.get('/api/oauth/connect/:provider', async (req, res) => {
    try {
        const { provider } = req.params;
        // Encode provider in state so callback knows who sent it
        const state = `${provider}_${crypto.randomBytes(16).toString('hex')}`;
        
        const authUrl = buildAuthUrl(provider, state);
        res.json({ url: authUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. OAuth Callback
app.get('/api/oauth/callback', async (req, res) => {
    try {
        const { code, state, error } = req.query;

        if (!state) return res.status(400).send("Missing state parameter");

        // Extract provider from state (e.g. "google_...")
        const provider = state.split('_')[0]; 

        if (error) return res.status(400).send(`OAuth Error: ${error}`);

        const tokenData = await exchangeCodeForTokens(provider, code);
        
        if (provider === 'jira') {
            const jiraInfo = await discoverJiraCloudId(tokenData.access_token);
            tokenData.cloud_id = jiraInfo.cloud_id;
            tokenData.cloud_url = jiraInfo.cloud_url;
        }

        // Get default user for now
        let user = await User.findOne({ email: 'default@edith.local' });
        if (!user) {
            user = await User.create({ 
                email: 'default@edith.local', 
                name: 'Default User',
                authProvider: 'local'
            });
        }
        await storeTokens(user._id, provider, tokenData);

        res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
        res.send(`
            <html>
                <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#00ff88">
                    <h2>Successfully Connected!</h2>
                    <p>You can close this tab and return to EDITH.</p>
                    <script>
                        try {
                            if (window.opener) {
                                window.opener.postMessage({ type: 'OAUTH_COMPLETE', provider: '${provider}' }, '*');
                            }
                        } catch (e) {}
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send(`Authentication failed: ${error.message}`);
    }
});

// 3. Status
app.get('/api/oauth/status', async (req, res) => {
    try {
        let user = await User.findOne({ email: 'default@edith.local' });
        if (!user) return res.json({});
        const status = await getConnectionStatus(user._id);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Disconnect
app.post('/api/oauth/disconnect/:provider', async (req, res) => {
    try {
        const { provider } = req.params;
        let user = await User.findOne({ email: 'default@edith.local' });
        if (user) {
            await clearTokens(user._id, provider);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    const { question, files } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    let fullQuestion = question;
    if (files && files.length > 0) {
        const fileList = files.map(f => `- "${f.path}" (${f.originalName})`).join('\n');
        fullQuestion = `The user has attached the following file(s) for you to use. Read them using your file tools before answering:\n${fileList}\n\nUser's message: ${question}`;
        console.log(`[Server] ${files.length} file(s) attached to question`);
    }

    console.log(`[Server] Received question: ${question}`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = streamWithSemanticRouting(fullQuestion, "user-1");
    
    let sentenceBuffer = "";
    
    // --- Audio Generation Logic ---
    const ttsPromises = [];

    function generateAudioChunk(text) {
        console.log(`[Server] Triggering TTS for chunk: "${text.substring(0, 40)}..."`);
        const promise = (async () => {
            try {
                console.log(`[Server] Generating speech...`);
                const audioResult = await generateSpeech({ text });
                console.log(`[Server] TTS result type: ${typeof audioResult}, length: ${audioResult ? audioResult.length : 0}`);
                
                if (typeof audioResult === 'string') {
                    try {
                        const parsed = JSON.parse(audioResult);
                        if (parsed.fallback === 'web-speech-api') {
                            console.log(`[Server] Sending tts_fallback event`);
                            res.write(`data: ${JSON.stringify({ type: "tts_fallback", text: parsed.text })}\n\n`);
                            return;
                        }
                    } catch (e) {}

                    if (audioResult && !audioResult.startsWith("Error")) {
                        console.log(`[Server] Sending audio event (Base64 length: ${audioResult.length})`);
                        res.write(`data: ${JSON.stringify({ type: "audio", url: audioResult })}\n\n`);
                    } else {
                        console.warn(`[Server] TTS returned error string:`, audioResult);
                    }
                }
            } catch (e) { console.error("[Server] TTS Error caught:", e); }
        })();
        ttsPromises.push(promise);
    }

    for await (const event of stream) {
        const eventType = event.event;
        
        if (eventType === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) {
                res.write(`data: ${JSON.stringify({ type: "token", content })}\n\n`);
                sentenceBuffer += content;
                if (/[.?!](\s|$)/.test(sentenceBuffer) && sentenceBuffer.length > 20) {
                    generateAudioChunk(sentenceBuffer.trim());
                    sentenceBuffer = "";
                }
            }
        } else if (eventType === "on_tool_start") {
             res.write(`data: ${JSON.stringify({ type: "tool_start", name: event.name, input: event.data?.input })}\n\n`);
        } else if (eventType === "on_tool_end") {
             const rawOutput = event.data?.output;
             const toolOutput = typeof rawOutput === 'object' && rawOutput !== null
                 ? (rawOutput.content || rawOutput.text || JSON.stringify(rawOutput))
                 : rawOutput;
             res.write(`data: ${JSON.stringify({ type: "tool_end", name: event.name, output: toolOutput })}\n\n`);

             const outputStr = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
             if (outputStr) {
                 try {
                     const parsed = JSON.parse(outputStr);
                     if (parsed.success && parsed.localUrl && parsed.localUrl.startsWith('/temp/')) {
                                                  res.write(`data: ${JSON.stringify({ type: "image", url: `${process.env.APP_URL}${parsed.localUrl}`, caption: parsed.caption || null })}\n\n`);
                     }
                 } catch (e) { }
             }
        }
    }

    // Flush remaining text in the sentence buffer
    if (sentenceBuffer.trim().length > 0) {
        generateAudioChunk(sentenceBuffer.trim());
    }

    // Wait for ALL TTS processing to complete before closing the stream
    if (ttsPromises.length > 0) {
        console.log('[TTS] Awaiting TTS queue drain...');
        await Promise.all(ttsPromises);
        console.log('[TTS] Queue drained.');
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();

  } catch (error) {
    console.error("[Server] Ask Error:", error);
    res.write(`data: ${JSON.stringify({ type: "error", content: error.message })}\n\n`);
    res.end();
  }
});

// --- API: Voice Interaction (Streaming SSE) ---
app.post('/api/voice', voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error("No audio file uploaded.");

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const base64Audio = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'audio/webm';

    let userText = await transcribeAudio({ base64Audio, mimeType });
    if (typeof userText === 'string' && userText.startsWith("Error")) throw new Error(userText);

    console.log(`[Voice] User said: "${userText}"`);
    res.write(`data: ${JSON.stringify({ type: 'user_text', content: userText })}\n\n`);

    const stream = streamWithSemanticRouting(userText, "user-1");
    let sentenceBuffer = "";
    
    // --- Audio Queue System (properly awaited) ---
    const ttsQueue = [];
    let ttsProcessingPromise = null;

    async function processTTSQueue() {
        while (ttsQueue.length > 0) {
            const currentItem = ttsQueue.shift();
            console.log(`[Voice TTS Queue] Generating for: "${currentItem.text.substring(0, 50)}..."`);
            try {
                const audioResult = await generateSpeech({ text: currentItem.text });
                if (typeof audioResult === 'string') {
                    try {
                        const parsed = JSON.parse(audioResult);
                        if (parsed.fallback === 'web-speech-api') {
                            res.write(`data: ${JSON.stringify({ type: "tts_fallback", text: parsed.text })}\n\n`);
                            continue;
                        }
                    } catch (e) {}
                    if (audioResult && !audioResult.startsWith('Error')) {
                        const audioUrl = audioResult.startsWith('data:') ? audioResult : '/temp/' + path.basename(audioResult);
                        res.write(`data: ${JSON.stringify({ type: 'audio', url: audioUrl })}\n\n`);
                    }
                }
            } catch (e) { console.error('[Voice TTS Error]', e); }
        }
    }

    function queueAudioChunk(text) {
        ttsQueue.push({ text });
        if (ttsProcessingPromise) {
            ttsProcessingPromise = ttsProcessingPromise.then(() => processTTSQueue());
        } else {
            ttsProcessingPromise = processTTSQueue();
        }
    }

    for await (const event of stream) {
      const eventType = event.event;
      if (eventType === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
          sentenceBuffer += content;
          if (/[.?!](\s|$)/.test(sentenceBuffer) && sentenceBuffer.length > 20) {
            queueAudioChunk(sentenceBuffer.trim());
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

    if (sentenceBuffer.trim().length > 0) {
      queueAudioChunk(sentenceBuffer.trim());
    }

    // Wait for ALL TTS processing to complete before closing
    if (ttsProcessingPromise) {
        await ttsProcessingPromise;
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();

  } catch (error) {
    console.error('[Voice Error]', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      res.end();
    } catch (e) { }
  }
});

// --- API: Chat History ---
app.get('/api/history', async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'user-1';
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 20;

        // In a real web app, we would get userId from the session/JWT
        // For now, we'll find or create a default user for testing
        let user = await User.findOne({ email: 'default@edith.local' });
        if (!user) {
            user = await User.create({ 
                email: 'default@edith.local', 
                name: 'Default User',
                authProvider: 'local'
            });
        }

        const chat = await Chat.findOne({ userId: user._id, sessionId });
        if (!chat) return res.json({ messages: [], total: 0, hasMore: false });

        const total = chat.messages.length;
        const start = Math.max(0, total - offset - limit);
        const end = Math.max(0, total - offset);
        const slice = chat.messages.slice(start, end);
        
        res.json({ messages: slice, total, hasMore: start > 0 });
    } catch (error) {
        console.error('[History Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// --- NEW API: Deepgram WebSocket Proxy ---
import { WebSocketServer, WebSocket } from 'ws';
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
    let deepgramWs = null;
    if (!process.env.DEEPGRAM_API_KEY) { ws.close(); return; }
    try {
        deepgramWs = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true', {
            headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
        });
        deepgramWs.on('open', () => ws.send(JSON.stringify({ type: 'ready' })));
        deepgramWs.on('message', (data) => {
            try {
               const parsed = JSON.parse(data);
               if (parsed.channel?.alternatives?.[0]) {
                   const transcript = parsed.channel.alternatives[0].transcript;
                   if (transcript) ws.send(JSON.stringify({ type: 'transcript', isFinal: parsed.is_final, text: transcript }));
               }
            } catch (e) { }
        });
        deepgramWs.on('close', () => ws.close());
        deepgramWs.on('error', () => ws.close());
    } catch(err) { ws.close(); }
    ws.on('message', (message) => { if (deepgramWs?.readyState === WebSocket.OPEN) deepgramWs.send(message); });
    ws.on('close', () => { if (deepgramWs?.readyState === WebSocket.OPEN) deepgramWs.close(); });
});

// --- Start Server ---
const server = app.listen(port, () => console.log(`Server is listening at http://localhost:${port}`));
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\n[CRITICAL] Port ${port} is already in use!`);
        console.error(`[CRITICAL] Another instance of EDITH or node is likely running.`);
        console.error(`[CRITICAL] Please kill the zombie process and restart.\n`);
        process.exit(1);
    } else {
        console.error('[CRITICAL] Server error:', e);
    }
});
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/live-transcription') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else { socket.destroy(); }
});
setInterval(() => console.log('[Heartbeat] Server is alive...'), 300000);
process.on('uncaughtException', (err) => console.error('[CRITICAL] Uncaught Exception:', err));
process.on('SIGINT', () => process.exit(0));
process.on('unhandledRejection', (reason, promise) => console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason));
