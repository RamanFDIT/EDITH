import mongoose from 'mongoose';
import { User, connectDB } from './db.js';
import dotenv from 'dotenv';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

dotenv.config({ path: '.env' });

async function testOAuthTokens() {
  await connectDB();
  
  // Find a user with tokens
  const user = await User.findOne({ 'tokens.github.access_token': { $exists: true } });
  if (!user) {
      console.log("No user found with GitHub token");
  } else {
      const githubToken = user.tokens.github.access_token;
      console.log("Found GitHub Token:", githubToken.substring(0, 5) + "...");
      
      try {
          const llm = new ChatOpenAI({
              modelName: 'gpt-4o-mini',
              openAIApiKey: githubToken,
              configuration: { baseURL: 'https://models.inference.ai.azure.com' }
          });
          console.log("Testing GitHub Models with OAuth token...");
          const res = await llm.invoke([new HumanMessage("Say hello!")]);
          console.log("Success! GitHub Models accepts this OAuth token:", res.content);
      } catch (e) {
          console.error("FAIL: GitHub Models rejected the OAuth token:", e.message);
      }
  }
  process.exit(0);
}

testOAuthTokens();
