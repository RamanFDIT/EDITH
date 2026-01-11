import express from 'express';
import { agentExecutor } from './agent.js'; 
import cors from 'cors'; // <-- 1. Import cors

const app = express();
const port = 3000;

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

    // FIX: Pass "configurable" with a sessionId
    const result = await agentExecutor.invoke(
      { input: question }, 
      { configurable: { sessionId: "user-1" } } // <--- This key enables memory!
    );

    const finalAnswer = typeof result.output === 'string' 
        ? result.output 
        : JSON.stringify(result.output);

    console.log(`[Server] Sending answer: ${finalAnswer}`);
    res.json({ answer: finalAnswer });
  } catch (error) {
    console.error('[Server] Error calling agent:', error);
    res.json({ answer: "Tactical error. Check server logs." }); 
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