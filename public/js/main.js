// KnoxxFoods Chat Application - main.js
// Modified to use AI agent to collect user information conversationally

document.addEventListener('DOMContentLoaded', function () {
    console.log("Page Loaded");

    // DOM Elements
    const welcomeScreen = document.getElementById('welcomeScreen');
    const proceedToRoleBtn = document.getElementById('proceedToRoleBtn');
    const userTypeSelector = document.getElementById('userTypeSelector');
    const chatMessages = document.getElementById('chatMessages');
    const chatInput = document.getElementById('chatInput');

    const clientBtn = document.getElementById('clientBtn');
    const distributorBtn = document.getElementById('distributorBtn');
    const chefBtn = document.getElementById('chefBtn');
    const jobseekerBtn = document.getElementById('jobseekerBtn');
    const visitorBtn = document.getElementById('visitorBtn');

    const messageInput = document.getElementById('messageInput');
    const sendMessageBtn = document.getElementById('sendMessageBtn');

    // Reset and Minimize Chat Buttons
    const resetChatBtn = document.getElementById('resetChatBtn');
    // const minimizeChatBtn = document.getElementById('minimizeChatBtn');
    const chatContainer = document.querySelector('.chat-container');

    // User session data
    let currentUser = {
        type: null,
        details: {
            name: null,
            email: null,
            phone: null,
            company: null
        },
        detailsCollected: false,
        currentQuestion: null // Tracks which user detail we're currently asking about
    };

    // Session ID
    let sessionId = generateSessionId();

    // Flag to ensure the initial message is only sent once
    let initialMessageSent = false;

    // Request queue system to prevent multiple simultaneous requests
    let requestQueue = [];
    let isProcessingRequest = false;
    window.requestInProgress = false;

    // First show welcome screen, hide others
    welcomeScreen.style.display = 'block';
    userTypeSelector.style.display = 'none';

    // Event listener for welcome screen proceed button
    proceedToRoleBtn.addEventListener('click', () => {
        welcomeScreen.style.display = 'none';
        userTypeSelector.style.display = 'block';
        checkExistingSession(); // Check for existing session after welcome
    });

    // Check if user has an existing session
    checkExistingSession();

    // Event Listeners
    clientBtn.addEventListener('click', () => selectUserType('manufacturer'));
    distributorBtn.addEventListener('click', () => selectUserType('distributor'));
    chefBtn.addEventListener('click', () => selectUserType('chef/npd/food'));
    jobseekerBtn.addEventListener('click', () => selectUserType('jobseeker'));
    visitorBtn.addEventListener('click', () => selectUserType('visitor'));

    sendMessageBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Auto-resize textarea
    messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
        if (this.scrollHeight > 100) {
            this.style.overflowY = 'auto';
        } else {
            this.style.overflowY = 'hidden';
        }
    });

    // Reset Chat Button functionality
    if (resetChatBtn) {
        resetChatBtn.addEventListener('click', resetChat);
    }
    
    // Minimize Chat Button functionality
    // if (minimizeChatBtn && chatContainer) {
    //     minimizeChatBtn.addEventListener('click', toggleChatMinimize);
    // }

    // Functions
    function checkExistingSession() {
        const savedSession = localStorage.getItem('knoxxChatSession');
        console.log("Checking saved session...");

        if (savedSession) {
            try {
                const sessionData = JSON.parse(savedSession);
                currentUser = sessionData.user;
                sessionId = sessionData.sessionId;

                console.log("Found existing session: ", sessionData);
                // Make sure welcome screen is hidden for returning users
                welcomeScreen.style.display = 'none';
                
                // Only proceed if no request is in progress
                if (!window.requestInProgress) {
                    window.requestInProgress = true;
                    startChat(true);
                }
            } catch (e) {
                console.error("Error parsing saved session:", e);
                localStorage.removeItem('knoxxChatSession');
                sessionId = generateSessionId();
            }
        } else {
            console.log("No existing session found.");
            // For new users, UI will be handled by the rest of the flow
        }
    }

    function selectUserType(type) {
        console.log("User selected type: ", type);
        currentUser.type = type;

        // Highlight selected button
        document.querySelectorAll('.user-type-selector button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');

        // Hide welcome screen (just to be sure)
        welcomeScreen.style.display = 'none';
        
        // Hide type selector
        userTypeSelector.style.display = 'none';
        
        // Initialize user details collection
        currentUser.detailsCollected = false;
        currentUser.currentQuestion = 'name';
        
        // Start chat directly
        startChat(false);
    }

    // Fix: Update the saveUserToServer function to use the same domain
function saveUserToServer() {
    console.log("Saving user to server...");
    
    // Add to request queue instead of executing immediately
    addToRequestQueue(() => {
        return fetch('/api/set-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // Include cookies for cross-domain requests
            body: JSON.stringify({
                userType: currentUser.type,
                name: currentUser.details.name || 'Anonymous User',
                email: currentUser.details.email || '',
                phone: currentUser.details.phone || '',
                company: currentUser.details.company || '',
                sessionId: sessionId
            })
        })
        .then(response => response.json())
        .then(data => {
            console.log('User saved:', data);
            // Save to local storage
            localStorage.setItem('knoxxChatSession', JSON.stringify({
                user: currentUser,
                sessionId: sessionId
            }));
        })
        .catch(error => {
            console.error('Error saving user:', error);
        });
    });
    
    processNextRequest();
}

    function generateSessionId() {
        const sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        console.log("Generated session ID: ", sessionId);
        return sessionId;
    }

    function startChat(isReturningUser = false) {
        console.log("Starting chat... Returning user: ", isReturningUser);

        // Hide all UI components except chat
        welcomeScreen.style.display = 'none';
        userTypeSelector.style.display = 'none';
      
        // Show chat
        chatMessages.classList.remove('hidden');
        chatInput.classList.remove('hidden');
      
        if (isReturningUser) {
            loadChatHistory();
        } else {
            // Only send initial message if it hasn't been sent
            if (!initialMessageSent) {
                sendInitialMessage();
            }
        }
    }

    // Fix: Update the loadChatHistory function to use the same domain
function loadChatHistory() {
    console.log("Loading chat history for sessionId: ", sessionId);
    
    // Add to request queue instead of executing immediately
    addToRequestQueue(() => {
        return fetch(`/api/user/chats?sessionId=${sessionId}`, {
            credentials: 'include' // Include cookies for cross-domain requests
        })
            .then(response => response.json())
            .then(data => {
                if (data.chats && data.chats.length > 0) {
                    console.log("Chat history found:", data.chats.length, "messages");
                    data.chats.forEach(msg => {
                        addMessage(msg.sender, msg.content, msg.timestamp);
                    });

                    // Scroll to bottom
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                    
                    // Mark initial message as sent if we have history
                    initialMessageSent = true;
                    
                    // Mark user details as collected since this is a returning user
                    currentUser.detailsCollected = true;
                } else {
                    console.log("No chat history found. Sending initial message.");
                    sendInitialMessage();
                }
                
                // Reset the global flag
                window.requestInProgress = false;
            })
            .catch(error => {
                console.error('Error loading chat history:', error);
                sendInitialMessage();
                window.requestInProgress = false;
            });
    });
    
    processNextRequest();
}

    // Fix for HTTPS endpoint consistency in sendInitialMessage function
function sendInitialMessage() {
    console.log("Sending initial message...");
    
    // Check if already sent to prevent duplicate requests
    if (initialMessageSent) {
        console.log("Initial message already sent, skipping");
        return;
    }
    
    // Add to request queue instead of executing immediately
    addToRequestQueue(() => {
        // Mark initial message as sent BEFORE making the request
        initialMessageSent = true;
        
        // Show typing indicator
        showTypingIndicator();

        // Fix: Use consistent protocol and hostname for all endpoints
        return fetch('/api/chat/init', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include', // Include cookies for cross-domain requests
                body: JSON.stringify({
                    userType: currentUser.type,
                    sessionId: sessionId
                })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                hideTypingIndicator();
                console.log("Initial message response received");
                const timestamp = new Date().toISOString();
                addMessage('bot', data.response, timestamp);
                
                // If this is a new user, ask for details after greeting
                if (!currentUser.detailsCollected) {
                    setTimeout(() => {
                        askForUserDetails();
                    }, 1000);
                }
            })
            .catch(error => {
                console.error("Error sending initial message", error);
                hideTypingIndicator();
                const timestamp = new Date().toISOString();
                addMessage('bot', 'Sorry, I encountered an error processing your request. Please try again.', timestamp);
            });
    });
    
    processNextRequest();
}

    function askForUserDetails() {
        if (currentUser.detailsCollected) return;
        
        let nextQuestion = '';
        
        switch(currentUser.currentQuestion) {
            case 'name':
                nextQuestion = "I'd love to help you better. Could you please tell me your name?";
                break;
            case 'email':
                nextQuestion = "Thank you! Could you also share your email address so we can stay in touch?";
                break;
            case 'phone':
                nextQuestion = "Great! If you'd like, you can also share your phone number (this is optional).";
                break;
            case 'company':
                nextQuestion = "Finally, what company or organization are you with? (You can skip this by typing 'skip')";
                break;
            default:
                // If all details collected, save to server
                currentUser.detailsCollected = true;
                saveUserToServer();
                return;
        }
        
        const timestamp = new Date().toISOString();
        showTypingIndicator();
        
        // Short delay to simulate typing
        setTimeout(() => {
            hideTypingIndicator();
            addMessage('bot', nextQuestion, timestamp);
        }, 1000);
    }

    function processUserDetailsResponse(message) {
        if (!currentUser.currentQuestion) return false;
        
        const normalizedMessage = message.trim().toLowerCase();
        
        // Process the user's response based on what question we're on
        switch(currentUser.currentQuestion) {
            case 'name':
                if (normalizedMessage === 'skip' || normalizedMessage === '') {
                    currentUser.details.name = 'Anonymous User';
                } else {
                    currentUser.details.name = message.trim();
                }
                currentUser.currentQuestion = 'email';
                break;
                
            case 'email':
                // Simple email validation
                if (normalizedMessage === 'skip' || normalizedMessage === '') {
                    currentUser.details.email = '';
                    currentUser.currentQuestion = 'phone';
                } else if (message.includes('@') && message.includes('.')) {
                    currentUser.details.email = message.trim();
                    currentUser.currentQuestion = 'phone';
                } else {
                    // Ask again for a valid email
                    const timestamp = new Date().toISOString();
                    setTimeout(() => {
                        addMessage('bot', "That doesn't look like a valid email. Please provide a valid email or type 'skip' to move on.", timestamp);
                    }, 500);
                    return true;
                }
                break;
                
            case 'phone':
                if (normalizedMessage === 'skip' || normalizedMessage === '') {
                    currentUser.details.phone = '';
                } else {
                    currentUser.details.phone = message.trim();
                }
                currentUser.currentQuestion = 'company';
                break;
                
            case 'company':
                if (normalizedMessage === 'skip' || normalizedMessage === '') {
                    currentUser.details.company = '';
                } else {
                    currentUser.details.company = message.trim();
                }
                currentUser.currentQuestion = null;
                break;
                
            default:
                return false;
        }
        
        // If we've reached this point, user provided a valid response
        if (currentUser.currentQuestion === null) {
            // All details collected
            currentUser.detailsCollected = true;
            
            // Save user information to server
            saveUserToServer();
            
            // Let the user know we're ready to help
            const timestamp = new Date().toISOString();
            setTimeout(() => {
                addMessage('bot', `Thank you for sharing your information! Now, how can I help you today?`, timestamp);
            }, 800);
        } else {
            // Ask the next question
            setTimeout(() => {
                askForUserDetails();
            }, 800);
        }
        
        return true;
    }

    // Fix: Update the sendMessage function to use the same domain
function sendMessage() {
    const message = messageInput.value.trim();
    if (message === '') return;

    // Clear input and reset height
    messageInput.value = '';
    messageInput.style.height = 'auto';

    // Get current timestamp
    const timestamp = new Date().toISOString();

    // Add user message to chat
    console.log("User message: ", message.substring(0, 30) + (message.length > 30 ? '...' : ''));
    addMessage('user', message, timestamp);
    
    // Check if we're collecting user details
    if (!currentUser.detailsCollected && processUserDetailsResponse(message)) {
        // If the message was processed as a user detail response, don't send it to the backend
        return;
    }

    // Add to request queue instead of executing immediately
    addToRequestQueue(() => {
        // Show typing indicator
        showTypingIndicator();
        
        return fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include', // Include cookies for cross-domain requests
            body: JSON.stringify({
                message: message,
                sessionId: sessionId,
                userType: currentUser.type
            })
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            hideTypingIndicator();
            console.log("Bot response received");
            const aiTimestamp = new Date().toISOString();
            addMessage('bot', data.response, aiTimestamp); // Display the AI response
        })
        .catch(error => {
            console.error('Error sending message:', error);
            hideTypingIndicator();
            const errorTimestamp = new Date().toISOString();
            addMessage('bot', 'Sorry, I encountered an error processing your request. Please try again.', errorTimestamp);
        });
    });
    
    processNextRequest();
}

    function addMessage(sender, text, timestamp) {
        // Ensure text is a string
        text = typeof text === 'string' ? text : (text ? String(text) : '');

        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.classList.add(sender);

        const contentElement = document.createElement('div');
        contentElement.classList.add('message-content');

        // Convert URLs to links
        const linkedText = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');

        contentElement.innerHTML = linkedText;
        messageElement.appendChild(contentElement);

        const timeElement = document.createElement('span');
        timeElement.classList.add('message-time');
        timeElement.textContent = new Date(timestamp).toLocaleTimeString();
        messageElement.appendChild(timeElement);

        chatMessages.appendChild(messageElement);

        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showTypingIndicator() {
        const typingElement = document.getElementById('typingIndicator');
        if (!typingElement) {
            const newTypingElement = document.createElement('div');
            newTypingElement.id = 'typingIndicator';
            newTypingElement.classList.add('typing-indicator');
            newTypingElement.innerHTML = 'Typing...';
            chatMessages.appendChild(newTypingElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    function hideTypingIndicator() {
        const typingElement = document.getElementById('typingIndicator');
        if (typingElement) {
            typingElement.remove();
        }
    }
    
    // Request queue management functions
    function addToRequestQueue(requestFn) {
        requestQueue.push(requestFn);
        console.log(`Request added to queue. Queue length: ${requestQueue.length}`);
    }
    
    function processNextRequest() {
        if (isProcessingRequest || requestQueue.length === 0) {
            return;
        }
        
        console.log(`Processing next request. Queue length: ${requestQueue.length}`);
        isProcessingRequest = true;
        const nextRequest = requestQueue.shift();
        
        nextRequest()
            .catch(error => {
                console.error("Error in request:", error);
            })
            .finally(() => {
                console.log("Request completed. Continuing queue processing.");
                isProcessingRequest = false;
                
                // Small timeout to prevent race conditions
                setTimeout(() => {
                    processNextRequest(); // Process next request in queue
                }, 50);
            });
    }
    
    function resetChat() {
        console.log("Resetting chat...");
        // Clear local storage to reset the session
        localStorage.removeItem('knoxxChatSession');
        
        // Reset UI to initial state
        welcomeScreen.style.display = 'block';
        userTypeSelector.style.display = 'none';
        chatMessages.classList.add('hidden');
        chatInput.classList.add('hidden');
        
        // Clear chat messages
        chatMessages.innerHTML = '';
        messageInput.value = '';
        
        // Reset request queue
        requestQueue = [];
        isProcessingRequest = false;
        window.requestInProgress = false;
        
        // Reset user data and session
        currentUser = {
            type: null,
            details: {},
            detailsCollected: false,
            currentQuestion: null
        };
        sessionId = generateSessionId();
        initialMessageSent = false;
    }
    
});