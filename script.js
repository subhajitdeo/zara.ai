// ==================== FINAL SCRIPT - NO EMOJIS, GOOGLE UK FEMALE VOICE ====================
// Removes emojis from AI responses + forces Google UK English Female voice

// ---------- DOM Elements ----------
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveApiKeyBtn = document.getElementById('saveApiKeyBtn');
const thinkingIndicator = document.getElementById('thinkingIndicator');
const thinkingTextSpan = document.getElementById('thinkingText');
const voiceStatusSpan = document.getElementById('voiceStatus');
const aiOrb = document.getElementById('aiOrb');
const soundWave = document.getElementById('soundWave');
const continuousModeToggle = document.getElementById('continuousModeToggle');
const modelSelect = document.getElementById('modelSelect');

// ---------- App State ----------
let openRouterApiKey = localStorage.getItem('zara_openrouter_key') || '';
let isListening = false;
let recognition = null;
let synth = window.speechSynthesis;
let continuousMode = true;
let isSpeaking = false;
let pendingRestart = false;
let restartCounter = 0;
let abortController = null;

// Memory (default name "boss")
let zaraMemory = JSON.parse(localStorage.getItem('zara_memory')) || {
    name: "boss",
    interests: ["technology", "AI"],
    preferences: { continuousMode: true },
    lastSeen: Date.now(),
    conversationCount: 0
};
function saveMemory() { localStorage.setItem('zara_memory', JSON.stringify(zaraMemory)); }
saveMemory();

// Voice loading
let availableVoices = [];
function loadVoices() { availableVoices = speechSynthesis.getVoices(); }
loadVoices();
if (speechSynthesis.onvoiceschanged !== undefined) speechSynthesis.onvoiceschanged = loadVoices;

// Model selector persistence
if (modelSelect) {
    const savedModel = localStorage.getItem('zara_selected_model');
    if (savedModel) modelSelect.value = savedModel;
    modelSelect.addEventListener('change', () => {
        localStorage.setItem('zara_selected_model', modelSelect.value);
        addSystemMessage(`Model switched to ${modelSelect.options[modelSelect.selectedIndex].text}`, false);
    });
}

// Site map
const siteMap = {
    youtube: 'https://youtube.com', gmail: 'https://mail.google.com', whatsapp: 'https://web.whatsapp.com',
    instagram: 'https://instagram.com', github: 'https://github.com', twitter: 'https://x.com',
    reddit: 'https://reddit.com', spotify: 'https://spotify.com', netflix: 'https://netflix.com',
    facebook: 'https://facebook.com', linkedin: 'https://linkedin.com', amazon: 'https://amazon.com',
    twitch: 'https://twitch.tv', discord: 'https://discord.com', google: 'https://google.com',
    bing: 'https://bing.com', cnn: 'https://cnn.com', bbc: 'https://bbc.com', reuters: 'https://reuters.com',
    wikipedia: 'https://wikipedia.org'
};

// ---------- Helper: Strip emojis from text ----------
function stripEmojis(text) {
    return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F201}-\u{1F202}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F250}-\u{1F251}\u{FE0F}]/gu, '');
}

// ---------- Secure URL validation ----------
function isSafeUrl(url) {
    try {
        const u = new URL(url);
        return ['http:', 'https:'].includes(u.protocol);
    } catch { return false; }
}

// ---------- Safe math evaluator ----------
function safeMathEvaluate(expr) {
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;
    try {
        const result = Function('"use strict"; return (' + expr + ')')();
        if (typeof result === 'number' && isFinite(result)) return result;
        return null;
    } catch { return null; }
}

// ---------- UI Helpers (with DOMPurify & emoji stripping) ----------
function renderMessage(text, isUser, toolData = null, isError = false) {
    // Strip emojis from AI messages only (keep user's original for display)
    let cleanText = text;
    if (!isUser && !isError) {
        cleanText = stripEmojis(text);
    }
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isUser ? 'user-message' : 'ai-message'}`;
    if (isError) messageDiv.style.opacity = '0.7';
    const avatarIcon = isUser ? '<i class="fas fa-user-astronaut"></i>' : '<i class="fas fa-microchip"></i>';
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute:'2-digit' });
    let sourceHtml = '';
    if (toolData?.sourceLinks?.length) {
        sourceHtml = `<div class="source-links">${toolData.sourceLinks.map(link => `<a href="${link.url}" target="_blank" class="source-link"><i class="fas fa-external-link-alt"></i> ${link.label}</a>`).join('')}</div>`;
    }
    messageDiv.innerHTML = `
        <div class="avatar">${avatarIcon}</div>
        <div class="content"><div class="message-text"></div>${sourceHtml}</div>
        <div class="timestamp">${timestamp}</div>
    `;
    chatMessages.appendChild(messageDiv);
    const contentDiv = messageDiv.querySelector('.message-text');
    if (isUser || isError) {
        const cleanHtml = DOMPurify.sanitize(marked.parse(cleanText));
        contentDiv.innerHTML = cleanHtml;
        messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        typeText(contentDiv, cleanText, () => {
            messageDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }
    return messageDiv;
}

// Word-by-word typing using requestAnimationFrame
async function typeText(container, fullText, onComplete) {
    container.innerHTML = '';
    const words = fullText.split(/(\s+)/);
    let index = 0;
    let accumulated = '';
    function addNextChunk() {
        if (index < words.length) {
            accumulated += words[index];
            container.textContent = accumulated;
            index++;
            requestAnimationFrame(addNextChunk);
        } else {
            const cleanHtml = DOMPurify.sanitize(marked.parse(fullText));
            container.innerHTML = cleanHtml;
            if (onComplete) onComplete();
        }
    }
    requestAnimationFrame(addNextChunk);
}

function addSystemMessage(text, isError = false) { renderMessage(text, false, null, isError); }
function addMessage(text, isUser, toolData = null) {
    renderMessage(text, isUser, toolData);
    let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
    history.push({ role: isUser ? 'user' : 'assistant', content: text, timestamp: Date.now() });
    if (history.length > 100) history = history.slice(-100);
    localStorage.setItem('zara_chat_history', JSON.stringify(history));
    zaraMemory.conversationCount++;
    saveMemory();
}

// ---------- Speech with Google UK Female priority & emoji stripping ----------
function speakText(text) {
    if (!synth) return;
    // Strip emojis and extra spaces before speaking
    let cleanText = stripEmojis(text).replace(/\s+/g, ' ').trim();
    if (!cleanText) return;
    
    synth.cancel();
    isSpeaking = true;
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    
    const voices = availableVoices.length ? availableVoices : synth.getVoices();
    
    // Priority: exact "Google UK English Female"
    let selectedVoice = voices.find(v => v.name === "Google UK English Female");
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.name.includes("UK") && v.name.includes("Female"));
    }
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.name === "Microsoft Hazel");
    }
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.name === "Samantha");
    }
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang === "en-US" && v.name.includes("Female"));
    }
    if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang.startsWith("en"));
    }
    utterance.voice = selectedVoice || voices[0];
    
    utterance.onend = () => {
        isSpeaking = false;
        if (continuousMode && !isListening && !pendingRestart && !userInput.value.trim()) {
            pendingRestart = true;
            setTimeout(() => {
                if (continuousMode && !isListening && !isSpeaking) startListening();
                pendingRestart = false;
            }, 500);
        }
    };
    setTimeout(() => synth.speak(utterance), 100);
}

// ---------- Weather ----------
async function fetchDetailedWeather(location) {
    try {
        const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
        const geoRes = await fetch(geoUrl);
        const geoData = await geoRes.json();
        if (!geoData.results?.length) return null;
        const { latitude, longitude, name } = geoData.results[0];
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=relative_humidity_2m,apparent_temperature,precipitation_probability&timezone=auto`;
        const wRes = await fetch(weatherUrl);
        const wData = await wRes.json();
        if (!wData.current_weather) return null;
        const temp = wData.current_weather.temperature;
        const wind = wData.current_weather.windspeed;
        const weatherCode = wData.current_weather.weathercode;
        const humidity = wData.hourly?.relative_humidity_2m?.[0] || "N/A";
        const feelsLike = wData.hourly?.apparent_temperature?.[0] || temp;
        const rainProb = wData.hourly?.precipitation_probability?.[0] || 0;
        let condition = "Clear";
        if (weatherCode >= 51 && weatherCode <= 67) condition = "Drizzle/Rain";
        else if (weatherCode >= 71 && weatherCode <= 77) condition = "Snow";
        else if (weatherCode >= 80 && weatherCode <= 99) condition = "Thunderstorm";
        let clothingTip = temp > 30 ? "Wear light clothes." : (temp < 10 ? "Heavy jacket needed." : "Comfortable.");
        let umbrellaTip = rainProb > 50 ? "Bring an umbrella!" : (rainProb > 20 ? "Maybe an umbrella." : "");
        let travelWarning = wind > 30 ? "Strong winds – be careful." : "";
        return { summary: `${name}: ${temp}C, feels like ${feelsLike}C. Humidity ${humidity}%, wind ${wind} km/h, ${condition}. Rain chance ${rainProb}%. ${clothingTip} ${umbrellaTip} ${travelWarning}` };
    } catch(e) { return null; }
}

async function executeToolCommand(toolObj) {
    const { tool, speak, open: urlToOpen, query } = toolObj;
    if (speak) {
        speakText(speak);
        addMessage(speak, false, { sourceLinks: urlToOpen ? [{ label: `Open ${tool.toUpperCase()}`, url: urlToOpen }] : [] });
    } else addMessage("Action completed.", false);
    if (urlToOpen && isSafeUrl(urlToOpen)) {
        setTimeout(() => {
            const win = window.open('', '_blank');
            if (win) win.location.href = urlToOpen;
            else addSystemMessage("Popup blocked. Please allow popups.", true);
        }, 800);
    } else if (urlToOpen) {
        addSystemMessage("Unsafe URL blocked.", true);
    }
    if (tool === 'weather' && query) {
        let loc = query.replace(/weather|in|for|current/gi, '').trim() || "London";
        const data = await fetchDetailedWeather(loc);
        if (data) { addMessage(data.summary, false); speakText(data.summary); } 
        else addMessage("Weather fetch failed.", false);
    }
    if (tool === 'news') {
        setTimeout(() => {
            const win = window.open('', '_blank');
            if (win) win.location.href = 'https://www.reuters.com/';
            else addSystemMessage("Popup blocked.", true);
        }, 1000);
    }
}

// ---------- Declarative Command System (emoji-free) ----------
const commands = [
    { pattern: /\btime\b/i, action: () => { const now = new Date(); const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }); addMessage(`The current time is ${timeStr}.`, false); speakText(`The current time is ${timeStr}.`); return true; } },
    { pattern: /\bdate\b/i, action: () => { const now = new Date(); const dateStr = now.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' }); addMessage(`Today is ${dateStr}.`, false); speakText(`Today is ${dateStr}.`); return true; } },
    { pattern: /^[\d\s+\-*/().]+$/, action: (text) => { const result = safeMathEvaluate(text); if (result !== null) { addMessage(`${text} = ${result}`, false); speakText(`${text} = ${result}`); return true; } return false; } },
    { pattern: /\bweather\b/i, action: (text) => { executeToolCommand({ tool:"weather", query:text }); return true; } },
    { pattern: /^open\s+\w+/i, action: (text) => { const site = text.replace(/^open\s+/i, '').trim().toLowerCase(); if (siteMap[site]) { executeToolCommand({ tool:"open_site", speak:`Opening ${site}.`, open:siteMap[site], query:site }); return true; } else { const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(site)}`; executeToolCommand({ tool:"open_site", speak:`Searching Google for "${site}".`, open:searchUrl, query:site }); return true; } } },
    { pattern: /\bsearch.*youtube\b|\byoutube.*search\b/i, action: (text) => { let query = text.replace(/search|on|youtube/gi, '').trim(); if (query) { const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`; executeToolCommand({ tool:"youtube", speak:`Searching YouTube for ${query}.`, open:url, query }); return true; } return false; } },
    { pattern: /\b(hi|hello|hey|good morning|good afternoon|good evening)\b/i, action: () => { const hour = new Date().getHours(); let greeting = "Hello"; if (hour < 12) greeting = "Good morning"; else if (hour < 18) greeting = "Good afternoon"; else greeting = "Good evening"; addMessage(`${greeting}, ${zaraMemory.name}! I'm Zara. How can I help you today?`, false); speakText(`${greeting}, ${zaraMemory.name}! I'm Zara. How can I help you today?`); return true; } },
    { pattern: /\b(thank|thanks)\b/i, action: () => { addMessage("You're very welcome! I'm happy to help.", false); speakText("You're very welcome! I'm happy to help."); return true; } },
    { pattern: /\b(goodbye|bye)\b/i, action: () => { addMessage("Goodbye! Come back anytime.", false); speakText("Goodbye! Come back anytime."); return true; } },
    { pattern: /\b(what can you do|help|capabilities)\b/i, action: () => { const reply = "I can tell time and date, do math, open websites, search YouTube, fetch live weather, get news, answer questions, and remember our conversation."; addMessage(reply, false); speakText(reply); return true; } },
    { pattern: /my name is (\w+)/i, action: (text) => { const match = text.match(/my name is (\w+)/i); if (match) { zaraMemory.name = match[1]; saveMemory(); addMessage(`Nice to meet you, ${zaraMemory.name}! I'll remember that.`, false); speakText(`Nice to meet you, ${zaraMemory.name}! I'll remember that.`); return true; } return false; } }
];

function handleLocalCommand(text) {
    for (const cmd of commands) {
        if (cmd.pattern.test(text)) {
            if (cmd.action(text)) return true;
        }
    }
    return false;
}

// ---------- Robust JSON extraction (balanced braces) ----------
function extractJSONObject(str) {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '{') {
            if (depth === 0) start = i;
            depth++;
        } else if (str[i] === '}') {
            depth--;
            if (depth === 0 && start !== -1) {
                return str.slice(start, i + 1);
            }
        }
    }
    return null;
}

// ---------- AI Call with GK detection, no-emoji system prompt ----------
async function askZara(userPrompt) {
    if (handleLocalCommand(userPrompt)) return;

    openRouterApiKey = localStorage.getItem('zara_openrouter_key') || '';
    if (!openRouterApiKey.trim()) {
        addSystemMessage("No API key found. Please enter your OpenRouter API key.", true);
        speakText("Please set your API key first.");
        return;
    }

    thinkingIndicator.classList.add('active');
    thinkingTextSpan.innerText = "Zara is thinking...";

    if (abortController) abortController.abort();
    abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 25000);

    try {
        let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
        let recent = history.slice(-30);
        
        // Updated system prompt: NO EMOJIS
        const systemPrompt = `You are Zara, a futuristic AI assistant. The user's name is ${zaraMemory.name}. Their interests include ${zaraMemory.interests.join(', ')}. Be conversational, warm, and helpful.

Important:
- Do not use emojis, emoticons, or special symbols. Use plain text only.
- If you need to use a tool (weather, news, open website, YouTube, Wikipedia, Google), respond in JSON format: {"tool":"tool_name","speak":"your spoken response","open":"optional url","query":"optional query"}
- For normal questions (explanations, general knowledge, conversation), respond in plain text under the "speak" field WITHOUT using a tool: {"tool":"none","speak":"your natural answer"}
- Keep answers concise but informative.
- Never add extra text outside the JSON.`;

        const messages = [
            { role: "system", content: systemPrompt },
            ...recent.map(m => ({ role: m.role, content: m.content })),
            { role: "user", content: userPrompt }
        ];

        const model = localStorage.getItem('zara_selected_model') || "ring-2.6-1t:free";

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${openRouterApiKey.trim()}`,
                "Content-Type": "application/json",
                "HTTP-Referer": window.location.origin,
                "X-Title": "Zara AI Assistant"
            },
            body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 700 }),
            signal: abortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`API Error ${response.status}`);
        const data = await response.json();
        if (!data.choices || !data.choices.length) throw new Error("No AI response received");

        let aiRaw = data.choices[0].message.content;
        console.log("RAW AI RESPONSE:", aiRaw);

        // Safer JSON parsing
        let aiJson = null;
        try {
            aiJson = JSON.parse(aiRaw);
        } catch(e) {
            console.warn("Direct JSON parse failed, trying balanced extraction");
            const jsonStr = extractJSONObject(aiRaw);
            if (jsonStr) {
                try { aiJson = JSON.parse(jsonStr); } catch(e2) { console.warn("Extraction parse also failed"); }
            }
        }
        console.log("PARSED JSON:", aiJson);

        const isGK = /what|who|why|how|explain|define/i.test(userPrompt);
        if (isGK && (!aiJson || aiJson.tool === "none")) {
            let replyText = (typeof aiRaw === "string" && aiRaw.trim().length) ? aiRaw.trim() : "I'm not sure how to answer that.";
            // Strip emojis from raw AI before showing/speaking
            replyText = stripEmojis(replyText);
            addMessage(replyText, false);
            speakText(replyText);
            return;
        }

        if (!aiJson) {
            aiJson = { tool: "none", speak: (typeof aiRaw === "string" && aiRaw.trim().length) ? aiRaw.trim() : "I couldn't generate a proper response." };
        }
        if (!aiJson.speak || typeof aiJson.speak !== "string") aiJson.speak = "I couldn't understand the response properly.";
        // Strip emojis from speak field
        aiJson.speak = stripEmojis(aiJson.speak);

        const validTools = ['weather', 'news', 'youtube', 'wikipedia', 'google', 'open_site', 'none'];
        if (!validTools.includes(aiJson.tool)) aiJson.tool = 'none';

        if (aiJson.tool === 'youtube' && aiJson.query) aiJson.open = `https://www.youtube.com/results?search_query=${encodeURIComponent(aiJson.query)}`;
        else if (aiJson.tool === 'wikipedia' && aiJson.query) aiJson.open = `https://en.wikipedia.org/wiki/${encodeURIComponent(aiJson.query.replace(/ /g, '_'))}`;
        else if (aiJson.tool === 'google' && aiJson.query) aiJson.open = `https://www.google.com/search?q=${encodeURIComponent(aiJson.query)}`;
        else if (aiJson.tool === 'open_site' && aiJson.query) {
            const siteKey = aiJson.query.toLowerCase().trim();
            aiJson.open = siteMap[siteKey] || `https://www.google.com/search?q=${encodeURIComponent(siteKey)}`;
            if (!siteMap[siteKey] && !aiJson.speak) aiJson.speak = `Searching Google for "${siteKey}".`;
        } else if (aiJson.tool === 'weather' && !aiJson.open) aiJson.open = "https://windy.com";
        else if (aiJson.tool === 'news' && !aiJson.open) aiJson.open = "https://reuters.com";

        if (aiJson.open && !isSafeUrl(aiJson.open)) aiJson.open = null;

        if (aiJson.tool !== 'none') await executeToolCommand(aiJson);
        else {
            let replyText = aiJson.speak;
            if (!replyText || replyText.length < 2) replyText = "I'm not sure how to answer that.";
            addMessage(replyText, false);
            speakText(replyText);
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            addSystemMessage("Request timed out. Please try again.", true);
            speakText("Request timed out.");
        } else {
            console.error(error);
            addSystemMessage(`Error: ${error.message}.`, true);
            speakText("I encountered an error. Please try again.");
        }
    } finally {
        clearTimeout(timeoutId);
        thinkingIndicator.classList.remove('active');
        abortController = null;
    }
}

// ---------- Voice Recognition (unchanged) ----------
function initSpeechRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        addSystemMessage("Voice recognition not supported.", true);
        micBtn.disabled = true;
        return null;
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SpeechRecognition();
    recog.continuous = false;
    recog.interimResults = false;
    recog.lang = 'en-US';

    recog.onstart = () => {
        isListening = true;
        micBtn.classList.add('listening');
        soundWave.classList.add('active');
        voiceStatusSpan.innerText = "Listening...";
        aiOrb.style.boxShadow = "0 0 30px #ff3399";
        restartCounter = 0;
    };
    recog.onend = () => {
        isListening = false;
        micBtn.classList.remove('listening');
        soundWave.classList.remove('active');
        voiceStatusSpan.innerText = "";
        aiOrb.style.boxShadow = "0 0 20px cyan";
        if (continuousMode && !isSpeaking && !pendingRestart && !userInput.value.trim() && restartCounter < 5) {
            restartCounter++;
            pendingRestart = true;
            setTimeout(() => {
                if (continuousMode && !isListening && !isSpeaking) {
                    try { recog.start(); } catch(e) {}
                }
                pendingRestart = false;
            }, 500);
        }
    };
    recog.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        userInput.value = transcript;
        voiceStatusSpan.innerText = `Recognized: "${transcript}"`;
        setTimeout(() => voiceStatusSpan.innerText = "", 2000);
        processUserInput(transcript);
    };
    recog.onerror = (e) => {
        voiceStatusSpan.innerText = `Error: ${e.error}`;
        setTimeout(() => voiceStatusSpan.innerText = "", 1500);
        micBtn.classList.remove('listening');
        soundWave.classList.remove('active');
        isListening = false;
    };
    return recog;
}

function startListening() {
    if (isSpeaking) { addSystemMessage("Zara is speaking, please wait...", false); return; }
    if (!recognition) recognition = initSpeechRecognition();
    if (!recognition) return;
    if (isListening) recognition.stop();
    else recognition.start();
}

async function processUserInput(text) {
    if (!text.trim()) return;
    addMessage(text, true);
    userInput.value = "";
    await askZara(text);
}

// ---------- Event Listeners ----------
sendBtn.addEventListener('click', () => processUserInput(userInput.value));
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') processUserInput(userInput.value); });
micBtn.addEventListener('click', startListening);
continuousModeToggle.addEventListener('change', (e) => { continuousMode = e.target.checked; if (!continuousMode && isListening) recognition?.stop(); addSystemMessage(`Continuous mode ${continuousMode ? 'enabled' : 'disabled'}.`, false); });
saveApiKeyBtn.addEventListener('click', () => {
    let newKey = apiKeyInput.value.trim();
    if (!newKey) { addSystemMessage("Empty key.", true); return; }
    if (!newKey.startsWith("sk-or-")) { addSystemMessage("Invalid key format (must start with sk-or-).", true); return; }
    localStorage.setItem('zara_openrouter_key', newKey);
    openRouterApiKey = newKey;
    addSystemMessage("API key saved.", false);
    speakText("Key saved.");
});

function loadChatHistory() {
    let history = JSON.parse(localStorage.getItem('zara_chat_history') || '[]');
    if (!history.length) return;
    const lastMessages = history.slice(-12);
    chatMessages.innerHTML = '';
    lastMessages.forEach(msg => renderMessage(msg.content, msg.role === 'user'));
    addSystemMessage("Loaded previous conversation.", false);
}
loadChatHistory();

setTimeout(() => {
    if (openRouterApiKey) speakText(`Zara ready. Hello ${zaraMemory.name}.`);
    else speakText("Please set your API key.");
}, 800);
