import express from 'express';
// 1. Import your exported agent
import { agentExecutor } from './agent.js'; 

const app = express();
const port = 3000;

// This is crucial! It tells Express to parse JSON in request bodies
app.use(express.json());

// --- This is your new "brain" endpoint ---
app.post('/api/ask', async (req, res) => {
  try {
    // 2. Get the user's question from the request body
    const { question } = req.body;

    if (!question) {
      console.log("Request failed: No question provided.");
      return res.status(400).json({ error: 'Question is required' });
    }

    console.log(`[Server] Received question: ${question}`);

    // 3. Call your agent with the question
    // The "input" key must match the placeholder in your prompt
    const result = await agentExecutor.invoke({
      input: question,
    });

    // 4. Send the agent's final answer back
    console.log(`[Server] Sending answer: ${result.output}`);
    res.json({ answer: result.output });

  } catch (error) {
    console.error('[Server] Error calling agent:', error);
    res.status(500).json({ error: 'Failed to process your request' });
  }
});

// This starts the server
app.listen(port, () => {
  console.log(`Server is listening at http://localhost:${port}`);
  console.log("Ready to receive POST requests at http://localhost:3000/api/ask");
});