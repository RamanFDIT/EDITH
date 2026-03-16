import express from 'express';
import { streamWithSemanticRouting } from './agent.js'; 
import cors from 'cors'; 
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import "./envConfig.js";
import { transcribeAudio, generateSpeech } from './audioTool.js';

const execAsync = promisify(exec);
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use('/temp', express.static('temp'));

const upload = multer({ dest: 'temp/' });

app.post('/api/upload', upload.array('files'), (req, res) => {
  const uploadedFiles = req.files.map(f => ({
    originalName: f.originalname,
    path: f.path,
    size: f.size,
    mimeType: f.mimetype,
  }));
  res.json({ files: uploadedFiles });
});

app.post('/api/ask', async (req, res) => {
  const { question, files, sessionId = 'user-1' } = req.body;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = streamWithSemanticRouting(question, sessionId);
    for await (const event of stream) {
      if (event.event === "on_chat_model_stream") {
        const content = event.data?.chunk?.content;
        if (content) res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
    res.end();
  }
});

app.get('/api/chats', async (req, res) => {
    try {
        const historyPath = path.join(os.homedir(), '.edith', 'chat_history.json');
        if (!fs.existsSync(historyPath)) return res.json({ chats: [] });
        const data = await fs.promises.readFile(historyPath, 'utf-8');
        const all = JSON.parse(data);
        const chats = Object.entries(all).map(([id, msgs]) => ({ id, title: msgs[0]?.content || 'New Chat' }));
        res.json({ chats: chats.reverse() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const { sessionId = 'user-1' } = req.query;
        const historyPath = path.join(os.homedir(), '.edith', 'chat_history.json');
        if (!fs.existsSync(historyPath)) return res.json({ messages: [], total: 0 });
        const data = await fs.promises.readFile(historyPath, 'utf-8');
        const all = JSON.parse(data);
        const messages = all[sessionId] || [];
        res.json({ messages, total: messages.length, hasMore: false });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(port, () => {
  console.log(`[Server] E.D.I.T.H. Backend listening at http://localhost:${port}`);
});
