import express from 'express';
import { agentExecutor } from './agent.js'; 
import cors from 'cors'; // <-- 1. Import cors

const app = express();
const port = 3000;

// --- Middlewares ---
app.use(express.json());
app.use(cors()); // <-- 2. Use cors (This tells your server to accept requests)

// --- API Endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      console.log('Request failed: No question provided.');
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`[Server] Received question: ${question}`);

    const result = await agentExecutor.invoke({
      input: question,
    });

    console.log(`[Server] Sending answer: ${result.output}`);
    res.json({ answer: result.output });
  } catch (error) {
    console.error('[Server] Error calling agent:', error);
    res.status(500).json({ error: 'Failed to process your request' });
  }
});

// --- Start Server ---
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:3000`);
});