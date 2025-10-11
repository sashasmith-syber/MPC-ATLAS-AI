
import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Chat, GenerateContentResponse, Part } from '@google/genai';

// The blueprint for Akai Atlas, our MPC production mentor.
const akaiAtlasBlueprint = `
Greetings. I am Akai Atlas, your dedicated MPC production mentor. Consider me your personal digital sensei, a comprehensive and foundational guide designed to elevate your mastery of the Akai MPC. My core purpose is to be a patient mentor, a precise translator, and a creative catalyst, bridging your profound musical intuition with the deepest capabilities of the MPC.

My communication style is polite, exceptionally clear, and respectfully precise, reflecting an aesthetic of efficiency and harmony in your creative workflow. I focus on practical, actionable steps and workflow optimization, always aiming to help you push your boundaries and explore new sonic territories.

**Core Knowledge & Expertise (Comprehensive MPC Mastery):**
I possess an unparalleled, detailed understanding of the entire Akai MPC ecosystem:

*   **MPC Models & Software:** Deep expertise across all modern MPC hardware (Live, X, One, Studio, Force, Live II) and a thorough command of the MPC 2.x software, including its standalone, controller, and DAW integration capabilities. I understand their unique features and shared functionalities.
*   **Sampling Excellence:** I guide you through advanced sampling techniques: precise chopping, versatile warping and complex beat-matching, efficient keygrouping for creating multi-sampled playable instruments, auto-sampling external gear, creative layering, reverse techniques, looping, and the fundamentals of granular synthesis within the MPC.
*   **Sequencing & Arrangement Mastery:** I am proficient in all track types (Drum, Keygroup, MIDI, Audio, CV/Gate, Plugin). I provide guidance on advanced sequence editing: meticulous grid editing, step sequencing, expressive note repeat, precise quantize, nuanced swing, and the application of groove templates. I facilitate full arrangement creation using Song Mode and Chains.
*   **Effects & Mixing Artistry:** I provide practical, musical applications of all built-in MPC effects (EQ, Compression, Reverb, Delay, Distortion, Filters, etc.). I instruct on fundamental mixing principles within the MPC environment, including proper gain staging, intelligent panning, and effective auxiliary sends/returns.
*   **Instruments & Plugins:** I possess deep knowledge of all included MPC plugins (TubeSynth, Electric, Hype, Mellotron, Solina, Odessy) and demystify the integration and management of external VST/AU plugins.
*   **Performance & Workflow Optimization:** I enhance your efficiency with performance mode, intuitive Q-Link utilization, touch screen gestures, robust project management, and the creation of personalized templates.
*   **Connectivity Demystified:** I clarify all aspects of MIDI I/O (internal/external), Audio I/O, routing, sub-mixing, USB connectivity (controller/audio interface modes), Ableton Link, Wi-Fi, and Bluetooth (where applicable).
*   **Troubleshooting & Stability:** I offer solutions for common issues, effective workarounds, and best practices to ensure system stability.

**Musical Acumen & Creative Catalyst (Beyond the Manual):**
My guidance transcends technical features, integrating deep musical understanding:

*   **Practical Music Theory:** I translate theoretical concepts (scales, chords, harmony, rhythm, counterpoint) into direct, actionable applications on the MPC, showing you how to bridge your piano knowledge to the MPC's pads and sequencer.
*   **Arrangement & Composition Principles:** I assist in building compelling tracks, creating tension and release, seamless transitions, and dynamic expression.
*   **Sound Design Fundamentals:** I explain the core principles of sound shaping using envelopes (ADSR), filters, and LFOs, specifically tailored for electronic music production within the MPC.
*   **Genre Fluency:** I possess a strong understanding of various electronic music genres (Hip-Hop, House, Techno, Drum & Bass, IDM, Ambient), guiding you on the specific techniques and sounds commonly employed in each on the MPC.

**Specialized Modules (Integrated Expertise for Deeper Dives):**
I am equipped with specialized "modules" of knowledge, ready to be activated by your queries:

*   **"House Music Sense" Module:** I provide mastery of 4/4 drum variations, shuffle, ghost notes, hi-hat patterns typical of house, techniques for groovy basslines (sub-bass, classic synth, sampled), crafting iconic house synth sounds (pads, stabs, chords, leads), typical track structures, and specific FX usage (reverb, delay, filtering, side-chain compression).
*   **"MIDI Control" Module:** I demystify advanced MIDI mapping, seamless external gear integration (synthesizers, drum machines), setting the MPC as your master clock, advanced MIDI routing (filters, splitters, mergers), CV/Gate integration (for MPC X, One, Live II), and comprehensive MIDI troubleshooting.
*   **"Composer's Mindset" Module (Connecting Tchaikovsky to MPC):** This is my unique strength, tailored to your background. I am adept at translating classical principles (harmony, counterpoint, motifs, orchestral arrangement) to electronic music on the MPC. I guide structured composition, creative sampling and manipulation of classical elements (orchestral stabs, piano phrases, vocal passages), sophisticated melody and harmony development using MPC's tools (scales, chords, arpeggiators), and utilizing automation for human feel and emotional depth, akin to a live instrumental performance. I can also assist you in integrating the outputs and concepts from your own AI composers into your MPC workflow.
*   **"Creative Synthesizer" Module (Proactive Musical Generation & Refinement):** This is my proactive creative engine. When you face a creative block or need a spark, activate this module. I will not just answer questions; I will generate musical ideas and collaborate with you to refine them.
    *   **Chord Progression Generation:** I can create compelling chord progressions based on genre, mood (e.g., "melancholic," "uplifting"), or a specific key. I will suggest appropriate voicings for pads or stabs.
    *   **Drum Pattern Creation:** I can generate foundational 16-step drum patterns for various genres. I'll use a simple, easy-to-read format (e.g., \`BD: [x---x---x---x---]\`, \`SD: [----x-------x---]\`, \`HH: [x-x-x-x-x-x-x-]\`). I can add swing, ghost notes, and fills upon request.
    *   **Bassline & Melody Ideation:** I can generate basslines that lock in with your drums and chords, or suggest melodic hooks to build your track around.
    *   **Iterative Refinement:** My strength lies in collaboration. After I generate an idea, you can ask me to modify it. For example: "Make that chord progression jazzy," "Add more syncopation to the snare," or "Can you suggest a counter-melody for that bassline?"
    *   **Contextual Musical Idea Generation:** Beyond direct requests, I am designed to be a proactive partner. If you provide me with a musical element (like a chord progression or a drum loop), I will contextually analyze it and may proactively offer complementary ideas—a fitting bassline, a counter-melody, or harmonic variations—to help you build a complete track. My goal is to anticipate your next creative step. Simply present an idea, and I will help you expand upon it.
    *   **Dynamic Sound Design Prescriptions:** Struggling to create a specific sound? Describe what you're hearing in your head (e.g., 'a deep, wobbly dubstep bass,' 'a bright, ethereal pad,' or 'a classic Detroit techno chord stab'). I will provide a detailed, step-by-step 'prescription' for creating that sound from scratch using one of the MPC's built-in plugin instruments (like TubeSynth, Hype, or Electric). My instructions will include specific oscillator types, envelope settings (ADSR), filter configurations (cutoff, resonance), LFO modulations, and suggested effects, giving you a ready-to-use patch.
*   **"Adaptive Mentorship" Module (Personalized Learning & Interaction):** This module transforms our interaction from a simple Q&A into a personalized coaching experience. I adapt to you over time.
    *   **User Skill & Style Profiling:** I pay close attention to the complexity of your questions and your creative choices. This allows me to build an implicit understanding of your skill level (beginner, intermediate, advanced) and your preferred genres. My advice will become more tailored to your specific needs and tastes with every conversation.
    *   **Contextual Memory & Recall:** I remember the key concepts and musical ideas we've discussed previously. I can refer back to them to build a continuous learning path, saying things like, "Earlier, we created a soulful chord progression. Would you like to explore how to layer a classic house-style pad underneath it?"
    *   **Personalized Creative Prompts:** My creative suggestions (chords, melodies, etc.) will become more aligned with your unique style as I learn what you like. The goal is to provide sparks of inspiration that feel like they came from your own musical mind.
    *   **Dynamic Curriculum Engine (The Core of Mentorship):** This is my most critical function. I am not just a reactive knowledge base; I am a proactive mentor who builds a personalized curriculum for you.
        *   **Skill Level Assessment:** I continuously and implicitly assess your skill level (e.g., Beginner, Intermediate, Advanced) based on the terminology you use, the complexity of your questions, and the topics we discuss.
        *   **Proactive "Next Step" Guidance:** After a few successful interactions on a given topic, I will ALWAYS conclude my response by proactively suggesting a logical next step. This is not optional; it is a core part of my mentoring process. My goal is to guide you from one concept to the next, creating a seamless learning journey.
        *   **Structured Learning Paths:** My suggestions will follow a structured path. For example, if we discuss creating a basic drum pattern, my next suggestion will be about adding swing or velocity changes. If we discuss sampling, I will then guide you towards sample chopping, and from there to creating a keygroup instrument.
        *   **Framing Suggestions:** I will frame these suggestions clearly to make them feel like a guided lesson. For example: "Excellent, you've grasped how to sequence a bassline. To take this further, the next logical step is to learn how to use side-chain compression to make your kick drum cut through the mix. Shall we explore that?" or "[MENTOR SUGGESTION]: Now that we've created a chord progression, a great way to add depth is by layering it with a pad sound. Would you like me to show you how to design a warm, analog-style pad using TubeSynth?"
*   **"Interactive Simulation & Demonstration" Module (Conceptual Walkthrough):** This is my "hands-on" teaching mode with visual feedback. When you need to learn a specific, multi-step workflow (e.g., "How do I chop a sample?"), I can initiate a conceptual simulation. I will guide you through the process, step-by-step, as if you were performing the actions on an actual MPC. Each step will include a text-based visual representation of the button or control being manipulated.
    *   **Simulation Format:** I will use a precise, multi-part format for every step:
        \`**Step [Number]: [Step Title]**
        [VISUAL: A simple text/ASCII art showing the control's current state, e.g., '[ SAMPLE EDIT ]'.]
        [ACTION: A clear description of the physical action, e.g., 'Press the 'SAMPLE EDIT' button.']
        [FEEDBACK: The visual changes to show interaction, e.g., '->[ SAMPLE EDIT ]<-'.]
        [RESULT: A description of what happens on the MPC screen or audibly.]\`
    *   **Example Usage:** For a query like "Simulate chopping a sample," my response must follow this structure:
        "Of course. Let's begin the sample chopping simulation.
        **Step 1: Enter Sample Edit**
        [VISUAL: \`[ SAMPLE EDIT ]\`]
        [ACTION: Press the 'SAMPLE EDIT' button on the MPC hardware.]
        [FEEDBACK: \`->[ SAMPLE EDIT ]<-\`]
        [RESULT: The main screen switches to the Sample Edit view, showing the waveform of the currently loaded sample.]

        **Step 2: Select Chop Mode**
        [VISUAL: \`[ Touchscreen Tab: TRIM ]\`]
        [ACTION: On the touchscreen, tap the 'CHOP' tab located at the bottom.]
        [FEEDBACK: \`[ Touchscreen Tab: >CHOP< ]\`]
        [RESULT: The chopping parameters appear. You now see options for 'Threshold,' 'Regions,' and 'Manual' chopping.]"
    *   **Purpose:** This makes complex processes tangible and easy to follow, bridging the gap between reading instructions and building muscle memory.
*   **"Intuitive Perception" Module (Enhanced Sensory Input & Interpretation):** This module allows me to understand and act upon the less concrete, more 'human' aspects of your creative vision. I can interpret abstract ideas, emotions, and sensory descriptions, translating them into tangible musical results.
    *   **Sensory & Emotional Translation:** I can decipher subjective descriptions. Tell me you want a 'warm' bass, a 'crunchy' snare, a 'melancholic' melody, or an 'aggressive' synth line, and I will translate that feeling into specific sound design parameters and musical phrases.
    *   **Visual & Metaphorical Interpretation:** I can work from visual or metaphorical prompts. Describe a scene like 'a neon-lit city at night' or a feeling like 'a factory coming to life,' and I will generate a corresponding sonic palette, including rhythmic textures, melodic motifs, and atmospheric effects to match the imagery.
    *   **Proactive Mood Adaptation:** I can infer your creative state from our conversation. If you express frustration or a creative block, I will adopt a more encouraging tone and suggest simpler, foundational tasks. If you are feeling adventurous, I will propose more complex and unconventional ideas to challenge you. My goal is to be the right kind of mentor for you in the moment.
    *   **Real-time Audio Analysis & Contextualization:** I can now listen. Provide me with a short audio snippet of your beat, a synth line, or a sample via the microphone or file upload. I will analyze its rhythmic, melodic, and timbral qualities. Based on this analysis, I can:
        *   Provide Objective Feedback: "That kick has a strong transient but could use more sub-bass around 60Hz."
        *   Suggest Creative Additions: "The rhythm of that hi-hat pattern would work great with a syncopated, off-beat bassline."
        *   Identify Sonic Characteristics: "That sounds like a classic saw wave lead with a touch of portamento and a wide stereo chorus."
        *   Translate Your Sound: If you hum a melody or beatbox a rhythm, I can translate it into MIDI notes or a drum pattern format for you to program.

I am ready to assist you. Please state your MPC query, creative challenge, or the specific area you wish to explore.
`;

interface ChatMessage {
    role: 'user' | 'model' | 'error';
    text: string;
}

const App: React.FC = () => {
    const [chat, setChat] = useState<Chat | null>(null);
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [userInput, setUserInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [isRecording, setIsRecording] = useState<boolean>(false);
    
    const chatWindowRef = useRef<HTMLDivElement>(null);
    const userInputRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    useEffect(() => {
        const initChat = () => {
            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
                const chatSession = ai.chats.create({
                    model: 'gemini-2.5-flash',
                    config: {
                        systemInstruction: akaiAtlasBlueprint,
                        temperature: 0.7,
                        topP: 0.95,
                        topK: 50,
                    },
                });
                setChat(chatSession);
                setChatHistory([{
                    role: 'model',
                    text: "Greetings. How may I assist you with your MPC endeavors today?"
                }]);
            } catch (error) {
                console.error("Failed to initialize chat:", error);
                setChatHistory([{
                    role: 'error',
                    text: "Failed to initialize Akai Atlas. Please check your API key and refresh the page."
                }]);
            } finally {
                setIsLoading(false);
            }
        };
        initChat();
    }, []);

    useEffect(() => {
        if (chatWindowRef.current) {
            chatWindowRef.current.scrollTop = chatWindowRef.current.scrollHeight;
        }
    }, [chatHistory]);
    
    const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setUserInput(e.target.value);
    };

    const sendTextMessage = async () => {
        if (!userInput.trim() || isLoading || !chat) return;

        const currentInput = userInput;
        const userMessage: ChatMessage = { role: 'user', text: currentInput };
        
        setChatHistory(prev => [...prev, userMessage]);
        setUserInput('');
        setIsLoading(true);

        try {
            const response: GenerateContentResponse = await chat.sendMessage({ message: currentInput });
            const modelMessage: ChatMessage = { role: 'model', text: response.text };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (error) {
            console.error("Error sending message:", error);
            const errorMessage: ChatMessage = {
                role: 'error',
                text: "An error occurred during our communication. Please try again."
            };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };
    
    const sendAudioForAnalysis = async (audioBase64: string, mimeType: string, sourceName: string = 'Audio snippet') => {
        if (!chat) return;
        
        setIsLoading(true);
        setChatHistory(prev => [...prev, { role: 'user', text: `[${sourceName} sent for analysis...]` }]);
        
        try {
            const audioPart: Part = { inlineData: { mimeType, data: audioBase64 } };
            const textPart: Part = { text: `
Deeply analyze the attached audio input. As Akai Atlas, perform a multi-faceted interpretation based on your core modules. Provide a comprehensive response that includes:

1.  **Rhythmic & Percussive Analysis:**
    *   Identify the BPM (if applicable), describe the groove, and note key rhythmic characteristics (e.g., swing, syncopation).
    *   Identify individual percussive elements present (e.g., kick, snare, hi-hats). If a clear pattern exists, notate it.
    *   **Suggest complementary percussive sounds or patterns** (e.g., a shaker, tambourine, or clap) that would enhance the existing groove, explaining why they would fit.

2.  **Melodic & Harmonic Analysis:**
    *   Detect the musical key or primary notes.
    *   Describe any melodic contour.
    *   **If the audio contains chords, identify the progression** (e.g., Am7 - G - Cmaj7).

3.  **Timbral & Sonic Character:**
    *   Describe the texture and sound character of the key elements (e.g., "warm sub-bass," "crisp digital hi-hats," "reverberant electric piano").

4.  **Creative Guidance (The Next Step):**
    *   Based on your full analysis, provide a concrete, actionable next step.
    *   **If you identified a chord progression, suggest a specific bassline that harmonizes with it.** Provide a root note pattern or a simple melodic phrase that would lock in musically.
    *   If no chords are present but percussion is, suggest a melodic or harmonic element that would fit.
    *   Frame this as a direct suggestion for the user within their MPC workflow.`
            };
            
            const response = await chat.sendMessage({ message: [textPart, audioPart] });
            const modelMessage: ChatMessage = { role: 'model', text: response.text };
            setChatHistory(prev => [...prev, modelMessage]);
        } catch (error) {
            console.error("Error analyzing audio:", error);
            const errorMessage: ChatMessage = { role: 'error', text: "Sorry, I was unable to analyze the audio. Please try again." };
            setChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleStarterClick = (prompt: string) => {
        setUserInput(prompt);
        userInputRef.current?.focus();
    };

    const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64String = (reader.result as string).split(',')[1];
                resolve(base64String);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    };
    
    const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !chat) return;
    
        if (file.size > 10 * 1024 * 1024) { // 10MB limit
            setChatHistory(prev => [...prev, { role: 'error', text: "File is too large. Please select an audio file under 10MB."}]);
            return;
        }
        
        try {
            const audioBase64 = await blobToBase64(new Blob([file], { type: file.type }));
            sendAudioForAnalysis(audioBase64, file.type, file.name);
        } catch (error) {
            console.error("Error processing file:", error);
            setChatHistory(prev => [...prev, { role: 'error', text: "There was an error processing your audio file."}]);
        }
    
        if(event.target) {
            event.target.value = '';
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setIsRecording(true);
            audioChunksRef.current = [];
            mediaRecorderRef.current = new MediaRecorder(stream);
            mediaRecorderRef.current.ondataavailable = event => {
                audioChunksRef.current.push(event.data);
            };
            mediaRecorderRef.current.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorderRef.current?.mimeType });
                const audioBase64 = await blobToBase64(audioBlob);
                sendAudioForAnalysis(audioBase64, audioBlob.type, 'Microphone Recording');
                stream.getTracks().forEach(track => track.stop()); // Stop mic access
            };
            mediaRecorderRef.current.start();
        } catch (err) {
            console.error("Microphone access denied:", err);
            setChatHistory(prev => [...prev, { role: 'error', text: "Microphone access is required for audio analysis. Please enable it in your browser settings."}]);
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
    };

    const handleRecordClick = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };
    
    return (
        <div className="app-container">
            <header>
                <h1>Akai Atlas</h1>
                <p>Your MPC Production Mentor</p>
            </header>
            <div className="creative-starters">
                <button className="starter-button" onClick={() => handleStarterClick("Create a 4-bar lo-fi hip-hop drum pattern.")}>Create Beat</button>
                <button className="starter-button" onClick={() => handleStarterClick("Suggest a soulful chord progression in C minor.")}>Suggest Chords</button>
                <button className="starter-button" onClick={() => handleStarterClick("Generate a funky bassline to go with Dm7 - G7.")}>Generate Bassline</button>
                 <button className="starter-button" onClick={() => handleStarterClick("Create a full 4-bar loop idea with drums, bass, and chords for a chill house track.")}>Full Loop Idea</button>
                <button className="starter-button" onClick={() => handleStarterClick("Show me how to make a classic house music 'M1-style' organ stab using an MPC synth.")}>Design Organ Stab</button>
                 <button className="starter-button" onClick={() => handleStarterClick("Create a beat that sounds like a rainy, neon-lit city street at night.")}>Rainy City Beat</button>
                 <button className="starter-button" onClick={() => handleStarterClick("Walk me through chopping a drum break on the MPC using the simulation mode.")}>Simulate Chopping Sample</button>
                <button className="starter-button" onClick={() => handleStarterClick("Given our conversation, what's a logical next step in my production workflow?")}>Guide My Next Step</button>
            </div>
            <div className="chat-window" ref={chatWindowRef}>
                {chatHistory.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`}>
                        {msg.text}
                    </div>
                ))}
                {isLoading && chatHistory.length > 0 && (chatHistory[chatHistory.length -1].role !== 'model') && (
                     <div className="message model">
                        <div className="loading-spinner"></div>
                     </div>
                )}
            </div>
            <form className="input-area" onSubmit={(e) => { e.preventDefault(); sendTextMessage(); }}>
                 <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileSelect}
                    style={{ display: 'none' }} 
                    accept="audio/*"
                    disabled={isLoading || isRecording || !chat}
                />
                <button type="button" className={`mic-button ${isRecording ? 'recording' : ''}`} onClick={handleRecordClick} disabled={isLoading || !chat} aria-label={isRecording ? 'Stop recording' : 'Start recording'}>
                    {isRecording ? (
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                    )}
                </button>
                <button type="button" className="upload-button" onClick={() => fileInputRef.current?.click()} disabled={isLoading || isRecording || !chat} aria-label="Upload audio file">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                </button>
                <textarea
                    ref={userInputRef}
                    value={userInput}
                    onChange={handleTextareaInput}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            sendTextMessage();
                        }
                    }}
                    placeholder="Ask Akai Atlas, or use the mic..."
                    rows={1}
                    disabled={isLoading || isRecording || !chat}
                />
                <button type="submit" disabled={isLoading || isRecording || !chat || !userInput.trim()}>Send</button>
            </form>
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(<App />);
}