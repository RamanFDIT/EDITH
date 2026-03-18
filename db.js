import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  name: String,
  authProvider: String, // 'github' or 'google'
  tokens: {
    google: {
      access_token: String,
      refresh_token: String,
      expires_at: Date
    },
    github: {
      access_token: String,
      expires_at: Date
    },
    slack: { access_token: String },
    figma: { access_token: String },
    jira: {
      access_token: String,
      refresh_token: String,
      cloud_id: String,
      cloud_url: String
    }
  },
  settings: {
    llmProvider: { type: String, default: 'auto' },
    githubModel: { type: String, default: 'gpt-4o' },
    ollamaModel: { type: String, default: 'llama3.2' },
    ollamaBaseUrl: { type: String, default: 'http://localhost:11434' }
  },
  createdAt: { type: Date, default: Date.now },
});

const chatSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, default: 'user-1' },
  messages: [{
    role: { type: String, enum: ['user', 'ai'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    files: [String],
    images: [{ url: String, caption: String }]
  }],
  lastUpdatedAt: { type: Date, default: Date.now }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Chat = mongoose.models.Chat || mongoose.model('Chat', chatSchema);

export async function connectDB() {
  if (mongoose.connection.readyState >= 1) return;
  
  if (!process.env.MONGODB_URI) {
    console.warn('[DB] MONGODB_URI not found in environment variables. DB functionality will be disabled.');
    return;
  }

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('[DB] Connected to MongoDB Atlas');
  } catch (err) {
    console.error('[DB] Connection error:', err);
  }
}

export { User, Chat };
