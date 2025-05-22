// Improved version of the server.js file
require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const fs = require('fs/promises'); // Using promises version for consistency
const path = require('path');
const bodyParser = require('body-parser');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const morgan = require('morgan');
const winston = require('winston');
const cors = require('cors');
const mammoth = require('mammoth');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const rules = require('./rules');

const app = express();
const port = 3002;

// === Middleware ===
app.use(cors({
    origin: [
        'http://127.0.0.1:49311',
        'http://127.0.0.1:5500',
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'http://127.0.0.1:62220'
    ],
    credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(morgan('combined'));
app.use(session({
    store: new FileStore({
        path: './sessions',
        ttl: 86400
    }),
    secret: 'knoxx',
    resave: true,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 86400000,
        sameSite: 'lax'
    }
}));

// === Logger ===
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({
            filename: 'error.log',
            level: 'error'
        }),
        new winston.transports.File({
            filename: 'combined.log'
        }),
    ],
});

// === MySQL Connection ===
let db;
(async () => {
    try {
        db = await mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
        });
        
        // Test database connection
        const [result] = await db.query('SELECT 1');
        if (result[0]['1'] === 1) {
            logger.info('MySQL connected successfully');
        }
    } catch (error) {
        logger.error('MySQL connection error', {
            error: error.stack,
            details: error.message
        });
        console.error('Database connection failed:', error.message);
        // Don't exit the process, allow the application to continue with limited functionality
    }
})();

// === Load DOCX ===
let docContent = '';
const docPath = path.join(__dirname, 'knoxxfoods_kb.docx');

(async () => {
    try {
        // First check if the file exists
        try {
            await fs.access(docPath);
            logger.info(`DOCX file exists at ${docPath}`);
        } catch (err) {
            logger.error(`DOCX file not found at ${docPath}`, { error: err.message });
            console.error(`CRITICAL: Knowledge base file not found at ${docPath}`);
            return; // Don't attempt to load the file if it doesn't exist
        }
        
        const { value } = await mammoth.extractRawText({ path: docPath });
        
        if (!value || value.trim() === '') {
            logger.error('DOCX loaded but content is empty');
            console.error('CRITICAL: Knowledge base file is empty or could not be read properly');
            return;
        }
        
        docContent = value;
        logger.info('DOCX loaded successfully', { 
            contentLength: value.length,
            contentPreview: value.substring(0, 100) + '...' 
        });
        console.log(`Knowledge base loaded successfully (${value.length} characters)`);
    } catch (err) {
        logger.error('Failed to load DOCX', {
            error: err.stack,
            path: docPath,
            message: err.message
        });
        console.error('CRITICAL: Failed to load knowledge base:', err.message);
    }
})();

// === Gemini Setup ===
let genAI, model;

try {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        logger.error('Gemini API key is missing in environment variables');
        console.error('CRITICAL: Gemini API key is not configured');
    } else {
        genAI = new GoogleGenerativeAI(apiKey);
        model = genAI.getGenerativeModel({
            model: "gemini-1.5-pro"
        });
        
        logger.info('Gemini API initialized successfully');
        console.log('Gemini API initialized successfully');
    }
} catch (error) {
    logger.error('Failed to initialize Gemini API', {
        error: error.stack,
        message: error.message
    });
    console.error('CRITICAL: Failed to initialize Gemini API:', error.message);
}

// === Test Gemini API ===
(async () => {
    if (!model) return;
    
    try {
        const testResult = await model.generateContent("Respond with 'API working' if you can read this message.");
        const testResponse = testResult.response.text();
        
        if (testResponse.includes('API working')) {
            logger.info('Gemini API connection test successful');
            console.log('Gemini API connection test successful');
        } else {
            logger.warn('Gemini API responded but with unexpected content', { response: testResponse });
            console.warn('WARNING: Gemini API responded with unexpected content');
        }
    } catch (error) {
        logger.error('Gemini API test failed', {
            error: error.stack,
            message: error.message
        });
        console.error('CRITICAL: Gemini API test failed:', error.message);
    }
})();

// === Rate Limiting ===
const initRateLimiter = rateLimit({
    windowMs: 60 * 1000,     // 1 minute window
    max: 5,                  // 5 requests per minute  
    message: {
        error: "Too many init requests, please try again shortly."
    },
    standardHeaders: true,   // Return rate limit info in RateLimit-* headers
    legacyHeaders: false     // Disable the X-RateLimit-* headers
});

const chatRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: {
        error: "You're sending messages too fast. Please slow down."
    }
});

// === Helper Function ===
function formatTimestampForMySQL(isoDate) {
    const date = new Date(isoDate);
    const year = date.getUTCFullYear();
    const month = ('0' + (date.getUTCMonth() + 1)).slice(-2);
    const day = ('0' + date.getUTCDate()).slice(-2);
    const hours = ('0' + date.getUTCHours()).slice(-2);
    const minutes = ('0' + date.getUTCMinutes()).slice(-2);
    const seconds = ('0' + date.getUTCSeconds()).slice(-2);

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// === Health Check Endpoint ===
app.get('/health', async (req, res) => {
    const status = {
        server: 'ok',
        database: db ? 'connected' : 'disconnected',
        knowledgeBase: docContent ? `loaded (${docContent.length} chars)` : 'not loaded',
        geminiAPI: model ? 'initialized' : 'not initialized'
    };
    
    const isHealthy = status.database === 'connected' && 
                      status.knowledgeBase.startsWith('loaded') && 
                      status.geminiAPI === 'initialized';
    
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'degraded',
        components: status,
        timestamp: new Date().toISOString()
    });
});

// Set User
app.post('/set-user', async (req, res) => {
    console.log('Received data:', req.body);
    const { name, email, phone, company, userType } = req.body;
    const sessionId = req.sessionID;

    req.session.user = {
        sessionId,
        name,
        email,
        phone,
        company,
        userType,
        created: new Date().toISOString()
    };

    req.session.save(async (err) => {
        if (err) {
            logger.error('Session save failed', { error: err.stack });
            return res.status(500).json({ error: 'Session save failed' });
        }

        try {
            if (!db) {
                logger.warn('Database not available for user save');
                return res.status(207).json({
                    message: 'Session initialized but user not saved to database',
                    user: req.session.user,
                    sessionId,
                    warning: 'Database connection not available'
                });
            }
            
            await db.execute(`
                INSERT INTO users (session_id, name, email, phone, company, user_type)
                VALUES (?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE name=?, phone=?, company=?, user_type=?`,
                [sessionId, name, email, phone, company, userType, name, phone, company, userType]
            );

            res.cookie('sessionId', sessionId, {
                maxAge: 86400000,
                httpOnly: true,
                sameSite: 'lax'
            });
            
            res.json({
                message: 'Session initialized',
                user: req.session.user,
                sessionId
            });
            
        } catch (dbErr) {
            logger.error('User save error', { error: dbErr.stack });
            
            res.status(207).json({
                message: 'Session initialized but user not saved to database',
                user: req.session.user,
                sessionId,
                error: 'Database save failed'
            });
        }
    });
});

// Initial Chat
app.post('/chat/init', initRateLimiter, async (req, res) => {
    const { sessionId, userType } = req.body;
    if (!sessionId) {
        return res.status(400).json({ error: "Session ID is required" });
    }

    try {
        const welcomeMessage = `Welcome! I am Kooka How can I assist you today? (User Type: ${userType || 'Unknown'})`;
        
        // Try to save to database but don't block if it fails
        if (db) {
            try {
                const formattedTimestamp = formatTimestampForMySQL(new Date().toISOString());
                await db.execute(
                    'INSERT INTO chats (session_id, sender, content, timestamp) VALUES (?, ?, ?, ?)', 
                    [sessionId, 'bot', welcomeMessage, formattedTimestamp]
                );
            } catch (dbErr) {
                logger.error('Failed to save welcome message to database', { error: dbErr.stack });
                // Continue without database save
            }
        }
        
        res.json({ response: welcomeMessage });
        
    } catch (error) {
        logger.error("Error sending initial message", { error: error.stack });
        res.status(500).json({ 
            error: "Failed to send initial message",
            details: error.message
        });
    }
});

// Chat Message
app.post('/chat', chatRateLimiter, 
    body('message').isString().isLength({ min: 1 }), 
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { message, sessionId, userType } = req.body;
        
        // Improved logging
        logger.info('Received chat request', {
            sessionId,
            userType,
            messageLength: message.length,
            messagePreview: message.substring(0, 50) + (message.length > 50 ? '...' : '')
        });
        
        if (!sessionId) {
            logger.warn('Missing sessionId in request');
            return res.status(401).json({ error: 'Invalid session' });
        }
        
        // Check database connection - warn but continue
        if (!db) {
            logger.warn('Database connection not established, continuing without persistence');
            // Continue without database
        }

        // Check Gemini API - critical dependency
        if (!model) {
            logger.error('Gemini API not initialized');
            return res.status(503).json({
                error: 'AI service is currently unavailable',
                retry: true
            });
        }

        // Check knowledge base - critical dependency
        if (!docContent) {
            logger.warn('Knowledge base not loaded, using fallback response');
            const fallbackResponse = "I'm sorry, I don't have access to the knowledge base at the moment. Please try again later or contact support.";
            
            if (db) {
                try {
                    const botTimestamp = formatTimestampForMySQL(new Date().toISOString());
                    await db.execute('INSERT INTO chats (session_id, sender, content, timestamp) VALUES (?, ?, ?, ?)', 
                        [sessionId, 'bot', fallbackResponse, botTimestamp]);
                } catch (dbErr) {
                    logger.error('Failed to save fallback response', { error: dbErr.stack });
                }
            }
            
            return res.json({ response: fallbackResponse });
        }

        try {
            // Insert user message with error handling
            if (db) {
                try {
                    const userTimestamp = formatTimestampForMySQL(new Date().toISOString());
                    await db.execute('INSERT INTO chats (session_id, sender, content, timestamp) VALUES (?, ?, ?, ?)', 
                        [sessionId, 'user', message, userTimestamp]);
                } catch (dbErr) {
                    logger.error('Failed to save user message', { error: dbErr.stack });
                    // Continue processing even if DB write fails
                }
            }

            const chatSession = model.startChat({
                history: []
            });
            
            const prompt = `
You are an AI assistant for KnoxxFoods.

Follow these rules strictly:
${rules}

Here is KnoxxFoods' company information: """${docContent}"""

Now, answer the user's question professionally:

User's question: ${message}
`;

            // Add timeout to prevent hanging
            const result = await Promise.race([
                chatSession.sendMessage(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('API request timed out after 15 seconds')), 15000)
                )
            ]);
            
            const answer = result.response.text();
            logger.info('Generated response', {
                sessionId,
                responseLength: answer.length,
                responsePreview: answer.substring(0, 50) + (answer.length > 50 ? '...' : '')
            });

            // Save bot response with error handling
            if (db) {
                try {
                    const botTimestamp = formatTimestampForMySQL(new Date().toISOString());
                    await db.execute('INSERT INTO chats (session_id, sender, content, timestamp) VALUES (?, ?, ?, ?)', 
                        [sessionId, 'bot', answer, botTimestamp]);
                } catch (dbErr) {
                    logger.error('Failed to save bot response', { error: dbErr.stack });
                    // Continue processing even if DB write fails
                }
            }

            res.json({ response: answer });
            
        } catch (error) {
            logger.error('Chat error', {
                error: error.stack,
                message: error.message,
                sessionId
            });
            
            // Provide more specific error messages based on error type
            if (error.message.includes('timed out')) {
                return res.status(504).json({
                    error: 'The AI service is taking too long to respond. Please try a shorter question.',
                    retry: true
                });
            } else if (error.message.includes('API key')) {
                return res.status(500).json({
                    error: 'AI service configuration error. Please contact support.',
                    retry: false
                });
            } else if (error.response && error.response.promptFeedback) {
                // Handle content filtering/safety errors from Gemini
                return res.status(400).json({
                    error: 'Your request could not be processed due to content restrictions.',
                    details: error.response.promptFeedback,
                    retry: true
                });
            } else {
                return res.status(500).json({
                    error: 'Error processing chat. Please try again.',
                    details: error.message,
                    retry: true
                });
            }
        }
});

// Chat History
app.get('/user/chats', async (req, res) => {
    // Get sessionId from query parameter as fallback if session is not available
    const sessionIdFromQuery = req.query.sessionId;
    const sessionId = req.session?.user?.sessionId || sessionIdFromQuery;
    
    if (!sessionId) {
        return res.status(401).json({ error: 'Invalid session' });
    }

    if (!db) {
        return res.status(503).json({ 
            error: 'Database service unavailable',
            message: 'Chat history cannot be retrieved at this time' 
        });
    }

    try {
        const [chats] = await db.execute(
            'SELECT sender, content, timestamp FROM chats WHERE session_id = ? ORDER BY timestamp ASC', 
            [sessionId]
        );
        res.json({ chats });
    } catch (error) {
        logger.error('Fetch chats error', { error: error.stack });
        res.status(500).json({ error: 'Failed to fetch chats' });
    }
});

// User Count Stats
app.get('/stats/user-count', async (_, res) => {
    if (!db) {
        return res.status(503).json({ 
            error: 'Database service unavailable',
            message: 'User statistics cannot be retrieved at this time' 
        });
    }

    try {
        const [rows] = await db.execute('SELECT COUNT(DISTINCT session_id) as count FROM users');
        res.json({ uniqueUsers: rows[0].count });
    } catch (error) {
        logger.error('User count error', { error: error.stack });
        res.status(500).json({ error: 'Failed to fetch user count' });
    }
});

// Start Server
app.listen(port, () => {
    logger.info(`Server is running on http://localhost:${port}`);
    console.log(`Server is running on http://localhost:${port}`);
    
    // Log startup diagnostics
    console.log('=== STARTUP DIAGNOSTICS ===');
    console.log(`Database: ${db ? 'Connected' : 'Not connected'}`);
    console.log(`Knowledge Base: ${docContent ? 'Loaded' : 'Not loaded'}`);
    console.log(`Gemini API: ${model ? 'Initialized' : 'Not initialized'}`);
    console.log('=========================');
});