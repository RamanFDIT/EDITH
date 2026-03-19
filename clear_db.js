import { connectDB, User, Chat } from './db.js';
import dotenv from 'dotenv';
dotenv.config();

async function clearDatabase() {
  console.log('🧹 Preparing to clear database...');
  
  try {
    await connectDB();
    
    const chatResult = await Chat.deleteMany({});
    console.log(`✅ Cleared ${chatResult.deletedCount} chat sessions.`);
    
    const userResult = await User.deleteMany({});
    console.log(`✅ Cleared ${userResult.deletedCount} user profiles.`);
    
    console.log('✨ Database is now fresh and empty.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

clearDatabase();
