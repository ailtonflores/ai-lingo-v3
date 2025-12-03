import React, { useState, useRef, useEffect } from 'react';
import { AppScreen, Topic, ChatMessage, UserStats, FeedbackItem, SavedLesson, PronunciationResult, ShadowingSegment, ListeningSegment } from './types';
import { generateTutorResponse, analyzePronunciation, analyzeTextOnly, transcribeForShadowing } from './services/geminiService';
import { blobToBase64, playTextToSpeech, AudioStreamPlayer, AudioRecorder, formatTime, getAudioDuration } from './utils/audio';
import { Button } from './components/Button';
import { FeedbackCard } from './components/FeedbackCard';
import { Avatar } from './components/Avatar';
import { GoogleGenAI, Modality } from "@google/genai";
import { 
  Mic, Square, Send, BarChart2, GraduationCap, 
  AlertCircle, ChevronRight, BookOpen, Award, RefreshCcw, Volume2,
  Save, Clock, Trash2, ArrowLeft, PlayCircle, Check, Settings, User, MessageCircle, Phone, PhoneOff, MicOff,
  Activity, Bookmark, ChevronUp, LogOut, Upload, Layers, Headphones, Repeat, RotateCcw, ChevronLeft, PauseCircle, MousePointerClick, ToggleLeft, ToggleRight, Eye, EyeOff, Ear
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip, ResponsiveContainer, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';

// --- Mock Data for Initial State ---
const INITIAL_STATS: UserStats = {
  xp: 1250,
  streak: 5,
  pronunciationScore: 65,
  grammarScore: 72,
  vocabularyScore: 58,
  weakPoints: ["Present Perfect", "'TH' Sound", "Prepositions 'IN/ON'"]
};

const App: React.FC = () => {
  const [screen, setScreen] = useState<AppScreen>(AppScreen.ONBOARDING);
  const [topic, setTopic] = useState<Topic>(Topic.COTIDIANO);
  const [stats, setStats] = useState<UserStats>(INITIAL_STATS);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  
  // Persistência de Aulas
  const [savedLessons, setSavedLessons] = useState<SavedLesson[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('aiLingoSavedLessons');
        return stored ? JSON.parse(stored) : [];
      } catch { return []; }
    }
    return [];
  });
  
  // Persistência de Feedback (Correções Salvas)
  const [savedFeedback, setSavedFeedback] = useState<FeedbackItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('aiLingoSavedFeedback');
        return stored ? JSON.parse(stored) : [];
      } catch { return []; }
    }
    return [];
  });

  // Efeitos de Persistência
  useEffect(() => {
    try { localStorage.setItem('aiLingoSavedLessons', JSON.stringify(savedLessons)); } catch {}
  }, [savedLessons]);

  useEffect(() => {
    try { localStorage.setItem('aiLingoSavedFeedback', JSON.stringify(savedFeedback)); } catch {}
  }, [savedFeedback]);
  
  // Standard Recording State (Legacy for Coach/Mock)
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const [supportedMimeType, setSupportedMimeType] = useState<string>('audio/webm');
  
  // LIVE API State
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  
  // Mute Logic with Ref to avoid stale closures in callbacks
  const [isMicMuted, setIsMicMuted] = useState(false);
  const isMicMutedRef = useRef(false);

  const [userVolume, setUserVolume] = useState(0); 
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const liveSessionRef = useRef<Promise<any> | null>(null); 
  
  // Live Transcription Buffers
  const currentInputTranscription = useRef('');
  const currentOutputTranscription = useRef('');

  // Avatar State
  const [isAvatarSpeaking, setIsAvatarSpeaking] = useState(false);
  
  // Coach State
  const [coachText, setCoachText] = useState('');
  const [coachResult, setCoachResult] = useState<PronunciationResult | null>(null);
  const [userAudioUrl, setUserAudioUrl] = useState<string | null>(null);

  // Shadowing & Listening State
  const [shadowingAudioBlob, setShadowingAudioBlob] = useState<Blob | null>(null);
  const [shadowingAudioUrl, setShadowingAudioUrl] = useState<string | null>(null);
  const [shadowingSegments, setShadowingSegments] = useState<ShadowingSegment[]>([]);
  const [listeningSegments, setListeningSegments] = useState<ListeningSegment[]>([]); // Separate state for Listening mode
  const [activeShadowingSegmentId, setActiveShadowingSegmentId] = useState<string | null>(null);
  const [shadowingPage, setShadowingPage] = useState(1);
  const [selectedShadowingId, setSelectedShadowingId] = useState<string | null>(null); // New state for keyboard shortcuts
  const ITEMS_PER_PAGE = 10;
  const [isPlayingSegmentId, setIsPlayingSegmentId] = useState<string | null>(null);
  
  // NEW: Shadowing Controls State
  const [autoAnalyze, setAutoAnalyze] = useState(true);

  const shadowingAudioRef = useRef<HTMLAudioElement>(null);
  // Ref for high-precision animation loop
  const shadowingPlayRequestRef = useRef<number | null>(null);

  // UI State
  const [textInput, setTextInput] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadVoices = () => { window.speechSynthesis.getVoices(); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    if (typeof MediaRecorder !== 'undefined') {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
          setSupportedMimeType(type);
          break;
        }
      }
    }
  }, []);

  // Time-based XP
  useEffect(() => {
    let intervalId: any;
    const isLearningActive = 
      screen === AppScreen.TUTOR || 
      screen === AppScreen.MOCK_TEST || 
      screen === AppScreen.REVIEW ||
      screen === AppScreen.PRONUNCIATION_COACH ||
      screen === AppScreen.SHADOWING ||
      screen === AppScreen.LISTENING;

    if (isLearningActive) {
      intervalId = setInterval(() => {
        setStats((prev) => ({ ...prev, xp: prev.xp + 10 }));
      }, 60000);
    }
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [screen]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, screen, isLiveConnected]); 
  
  useEffect(() => {
    return () => {
      disconnectLiveSession();
    };
  }, [screen]);

  // Sync ref with state
  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  // Auto-select first segment when segments load or page changes
  useEffect(() => {
    if (screen === AppScreen.SHADOWING && shadowingSegments.length > 0) {
      const startIndex = (shadowingPage - 1) * ITEMS_PER_PAGE;
      if (shadowingSegments[startIndex]) {
        setSelectedShadowingId(shadowingSegments[startIndex].id);
      }
    } else if (screen === AppScreen.LISTENING && listeningSegments.length > 0) {
      const startIndex = (shadowingPage - 1) * ITEMS_PER_PAGE;
      if (listeningSegments[startIndex]) {
        setSelectedShadowingId(listeningSegments[startIndex].id);
      }
    }
  }, [shadowingSegments, listeningSegments, shadowingPage, screen]);

  // --- LIVE API LOGIC ---

  const connectLiveSession = async () => {
    if (isLiveConnected) return;

    try {
      setIsProcessing(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      audioPlayerRef.current = new AudioStreamPlayer((isPlaying) => {
        setIsAvatarSpeaking(isPlaying);
      });
      await audioPlayerRef.current.initialize();

      if (audioRecorderRef.current) {
        audioRecorderRef.current.stop();
      }

      currentInputTranscription.current = '';
      currentOutputTranscription.current = '';

      const newSessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: async () => {
            console.log("Live Session Connected");
            setIsLiveConnected(true);
            setIsProcessing(false);
            
            const session = await newSessionPromise;

            try {
                audioRecorderRef.current = new AudioRecorder(
                  (base64Data) => {
                     // Check REF instead of state to avoid stale closure
                     if (!isMicMutedRef.current) {
                        // @ts-ignore
                        session.sendRealtimeInput({ 
                          media: { mimeType: 'audio/pcm;rate=16000', data: base64Data } 
                        });
                     }
                  },
                  (volume) => {
                     setUserVolume(volume * 100); 
                  }
                );
                await audioRecorderRef.current.start();
                console.log("Mic Started");
            } catch (micError) {
                console.error("Mic error:", micError);
                disconnectLiveSession();
            }
          },
          onmessage: async (msg) => {
            // 1. Audio Handling
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
              audioPlayerRef.current?.addPCMChunk(base64Audio);
            }
            
            // 2. Model Text Handling (Prioritize Output Transcription)
            // Use outputTranscription if available as it matches the audio.
            const outputTranscript = msg.serverContent?.outputTranscription?.text;
            if (outputTranscript) {
              currentOutputTranscription.current += outputTranscript;
              setMessages(prev => {
                  const last = prev[prev.length - 1];
                  // If last message is model and not 'static' (from older sessions), append.
                  if (last && last.role === 'model' && !last.id.includes('static')) {
                    return [...prev.slice(0, -1), { ...last, text: currentOutputTranscription.current }];
                  } else {
                    return [...prev, { id: Date.now().toString(), role: 'model', text: outputTranscript }];
                  }
               });
            } 
            
            // 3. User Text Handling
            const userText = msg.serverContent?.inputTranscription?.text;
            if (userText) {
               currentInputTranscription.current += userText;
               
               // Update or create streaming user message
               setMessages(prev => {
                  const streamingId = 'streaming-user';
                  const existingIndex = prev.findIndex(m => m.id === streamingId);
                  
                  if (existingIndex !== -1) {
                     const newArr = [...prev];
                     newArr[existingIndex] = { ...newArr[existingIndex], text: currentInputTranscription.current };
                     return newArr;
                  } else {
                     return [...prev, { id: streamingId, role: 'user', text: currentInputTranscription.current }];
                  }
               });
            }

            // 4. Turn Complete (User stopped speaking)
            if (msg.serverContent?.turnComplete) {
               const finalText = currentInputTranscription.current;
               const finalId = Date.now().toString();

               if (finalText.trim().length > 0) {
                 // Finalize message: replace streaming-user with permanent ID
                 setMessages(prev => {
                    return prev.map(m => 
                      m.id === 'streaming-user' 
                        ? { ...m, id: finalId, text: finalText } 
                        : m
                    );
                 });

                 // Side-channel analysis for Grammar AND Pronunciation Suggestions
                 analyzeTextOnly(finalText).then(result => {
                    if (result.feedback && result.feedback.length > 0) {
                       setMessages(prev => prev.map(m => 
                          m.id === finalId 
                             ? { ...m, feedback: result.feedback } 
                             : m
                       ));
                    }
                 });
               }

               // Reset user buffer. Keep model buffer until interrupted or new turn start logic? 
               // Actually clearing output buffer here might clear text while audio is still playing.
               // Better to clear output buffer only when model starts a NEW unrelated turn, but simple approach:
               currentInputTranscription.current = '';
               // We DON'T clear outputTranscription here immediately because model might still be streaming text/audio parts
            }
            
            if (msg.serverContent?.interrupted) {
              audioPlayerRef.current?.stop();
              audioPlayerRef.current?.initialize(); 
              currentOutputTranscription.current = '';
            }
          },
          onclose: () => {
            console.log("Live Session Closed");
            setIsLiveConnected(false);
          },
          onerror: (err) => {
            console.error("Live Session Error:", err);
            // Don't disconnect immediately on error, logs show 'invalid argument' often but session might persist
            // setIsLiveConnected(false); 
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {}, 
          outputAudioTranscription: {},
          speechConfig: {
            // 'Aoede' is not supported in Live Preview, 'Zephyr' is.
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: `You are AI-Lingo Tutor, a friendly English teacher for Brazilian students.
          Your current topic is: ${topic}.
          Start the conversation immediately by greeting the user and asking a question about the topic.
          Speak naturally and concisely.`,
        }
      });
      
      liveSessionRef.current = newSessionPromise;

    } catch (error) {
      console.error("Failed to connect", error);
      setIsProcessing(false);
    }
  };

  const disconnectLiveSession = async () => {
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
      audioPlayerRef.current = null;
    }
    
    if (liveSessionRef.current) {
      try {
        const session = await liveSessionRef.current;
        // @ts-ignore
        if (session && typeof session.close === 'function') session.close();
      } catch (e) { console.error(e); }
      liveSessionRef.current = null;
    }

    setIsLiveConnected(false);
    setIsAvatarSpeaking(false);
    setUserVolume(0);
  };

  const toggleMic = () => {
    // We update both state (for UI) and Ref (for Logic)
    const newState = !isMicMuted;
    setIsMicMuted(newState);
    isMicMutedRef.current = newState;
    
    if (newState) {
      // PAUSE: Stop AI talking
      audioPlayerRef.current?.stop();
      audioPlayerRef.current?.initialize(); 
      setIsAvatarSpeaking(false);
    }
  };

  // --- RECORDING HANDLERS ---
  const startRecording = async (forCoach: boolean = false) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length === 0) return;
        const audioBlob = new Blob(audioChunksRef.current, { type: supportedMimeType });
        if (forCoach) await handleAnalyzePronunciation(audioBlob);
        else await handleSendMessage(audioBlob);
      };
      mediaRecorder.start(); 
      setIsRecording(true);
    } catch (error) {
      console.error("Mic error:", error);
      alert("Erro no microfone.");
    }
  };

  const toggleSegmentAnalysis = (segmentId: string) => {
    setShadowingSegments(prev => prev.map(s => 
      s.id === segmentId ? { ...s, showAnalysis: !s.showAnalysis } : s
    ));
  };

  const toggleAllAnalysisVisibility = () => {
    const anyVisible = shadowingSegments.some(s => s.analysis && s.showAnalysis);
    // If any visible, turn all OFF. If none visible, turn all ON.
    const targetState = !anyVisible;
    
    setShadowingSegments(prev => prev.map(s => 
      s.analysis ? { ...s, showAnalysis: targetState } : s
    ));
  };

  const startShadowingRecording = async (segmentId: string, segmentText: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: supportedMimeType });
        const url = URL.createObjectURL(audioBlob);
        
        // Update UI
        const updateState = (isListeningMode: boolean) => {
           const updateFn = (prev: any[]) => prev.map(s => s.id === segmentId ? { ...s, userAudioUrl: url, isAnalyzing: autoAnalyze } : s);
           if (isListeningMode) setListeningSegments(updateFn as any);
           else setShadowingSegments(updateFn as any);
        }
        updateState(screen === AppScreen.LISTENING);
        
        setActiveShadowingSegmentId(null);

        if (autoAnalyze) {
          try {
             const base64 = await blobToBase64(audioBlob);
             const result = await analyzePronunciation(segmentText, { mimeType: supportedMimeType, data: base64 });
             
             if (screen === AppScreen.SHADOWING) {
                setShadowingSegments(prev => prev.map(s => 
                   s.id === segmentId ? { ...s, isAnalyzing: false, analysis: result, showAnalysis: true } : s
                ));
             } else if (screen === AppScreen.LISTENING) {
                // LISTENING LOGIC: Reveal correctly spoken words
                setListeningSegments(prev => prev.map(s => {
                   if (s.id !== segmentId) return s;
                   
                   const newRevealed = [...s.revealedIndices];
                   const originalWords = s.text.split(' ');
                   
                   // Map analysis words back to original indices (simple mapping)
                   result.words.forEach((w, idx) => {
                      if (w.status === 'correct' && idx < originalWords.length) {
                         if (!newRevealed.includes(idx)) newRevealed.push(idx);
                      }
                   });

                   return { ...s, isAnalyzing: false, analysis: result, showAnalysis: true, revealedIndices: newRevealed };
                }));
             }
          } catch (e) {
             console.error("Analysis failed", e);
             const updateFn = (prev: any[]) => prev.map(s => s.id === segmentId ? { ...s, isAnalyzing: false } : s);
             if (screen === AppScreen.LISTENING) setListeningSegments(updateFn as any);
             else setShadowingSegments(updateFn as any);
          }
        } else {
            const updateFn = (prev: any[]) => prev.map(s => s.id === segmentId ? { ...s, isAnalyzing: false } : s);
            if (screen === AppScreen.LISTENING) setListeningSegments(updateFn as any);
            else setShadowingSegments(updateFn as any);
        }
      };

      mediaRecorder.start();
      setActiveShadowingSegmentId(segmentId);
    } catch (error) {
      console.error("Mic error:", error);
    }
  };

  const stopShadowingRecording = () => {
    if (mediaRecorderRef.current && activeShadowingSegmentId) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  // Shadowing Logic: Play specific segment with high precision
  const playOriginalSegment = (segmentId: string, start: number, end: number) => {
    if (!shadowingAudioRef.current) return;
    const audio = shadowingAudioRef.current;
    const duration = audio.duration || 10000;
    const safeEnd = Math.min(end, duration);

    if (shadowingPlayRequestRef.current) {
        cancelAnimationFrame(shadowingPlayRequestRef.current);
        shadowingPlayRequestRef.current = null;
    }

    if (isPlayingSegmentId === segmentId) {
       audio.pause();
       setIsPlayingSegmentId(null);
       return;
    }

    const startPlayback = () => {
        setIsPlayingSegmentId(segmentId);
        audio.play();
        const checkTime = () => {
            if (audio.paused || audio.currentTime >= safeEnd) {
                audio.pause();
                setIsPlayingSegmentId(null);
                shadowingPlayRequestRef.current = null;
            } else {
                shadowingPlayRequestRef.current = requestAnimationFrame(checkTime);
            }
        };
        shadowingPlayRequestRef.current = requestAnimationFrame(checkTime);
    };

    const onSeeked = () => {
        audio.removeEventListener('seeked', onSeeked);
        startPlayback();
    };

    audio.addEventListener('seeked', onSeeked);
    audio.currentTime = start;
  };

  // LISTENING MODE: Text Input Logic
  const handleListeningTextChange = (segmentId: string, input: string) => {
      setListeningSegments(prev => prev.map(s => {
          if (s.id !== segmentId) return s;

          const words = s.text.split(' ');
          const inputWords = input.trim().split(/\s+/);
          const newRevealed = [...s.revealedIndices];

          // Check word by word match (case insensitive, ignore punctuation)
          words.forEach((word, idx) => {
             const cleanWord = word.toLowerCase().replace(/[.,!?;:]/g, '');
             const match = inputWords.some(iw => iw.toLowerCase().replace(/[.,!?;:]/g, '') === cleanWord);
             if (match && !newRevealed.includes(idx)) {
                newRevealed.push(idx);
             }
          });

          return { ...s, typedText: input, revealedIndices: newRevealed };
      }));
  };

  const toggleListeningReveal = (segmentId: string) => {
      setListeningSegments(prev => prev.map(s => 
         s.id === segmentId ? { ...s, isFullyRevealed: !s.isFullyRevealed } : s
      ));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global shortcut for other screens
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        if (screen === AppScreen.PRONUNCIATION_COACH) {
          e.preventDefault();
          isRecording ? stopRecording() : (coachText && startRecording(true));
        } else if (screen === AppScreen.MOCK_TEST) {
          e.preventDefault();
          isRecording ? stopRecording() : startRecording(false);
        } else if (screen === AppScreen.TUTOR && isLiveConnected) {
          e.preventDefault();
          toggleMic();
        }
      }

      // Shortcuts for Shadowing/Listening
      if ((screen === AppScreen.SHADOWING || screen === AppScreen.LISTENING) && selectedShadowingId) {
        const segments = screen === AppScreen.SHADOWING ? shadowingSegments : listeningSegments;
        const segment = segments.find(s => s.id === selectedShadowingId);
        
        if (segment) {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
             e.preventDefault();
             playOriginalSegment(segment.id, segment.start, segment.end);
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
             e.preventDefault();
             if (activeShadowingSegmentId === segment.id) {
               stopShadowingRecording();
             } else if (!activeShadowingSegmentId) {
               startShadowingRecording(segment.id, segment.text);
             }
          }
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
             e.preventDefault();
             if (segment.userAudioUrl) {
                const audio = new Audio(segment.userAudioUrl);
                audio.play().catch(console.error);
             }
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screen, isRecording, isLiveConnected, isMicMuted, coachText, selectedShadowingId, shadowingSegments, listeningSegments, activeShadowingSegmentId, autoAnalyze]);

  const handleSendMessage = async (input: Blob | string) => {
    // ... existing logic ...
    setIsProcessing(true); setIsSaved(false);
    if (typeof input === 'string') { setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: input }]); } else { const audioUrl = URL.createObjectURL(input); setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: "🎤 Áudio enviado", audioUrl }]); }
    try { let apiInput; if (typeof input === 'string') { apiInput = input; } else { const base64Audio = await blobToBase64(input); apiInput = { mimeType: input.type.split(';')[0], data: base64Audio }; } const history = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })); const response = await generateTutorResponse(history, apiInput, topic, screen === AppScreen.MOCK_TEST); setStats(prev => ({ ...prev, xp: prev.xp + response.xpEarned, })); setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: response.reply, feedback: response.feedback }]); if (screen !== AppScreen.TUTOR) { playTextToSpeech(response.reply, 'en-US', () => setIsAvatarSpeaking(true), () => setIsAvatarSpeaking(false)); } } catch (error) { console.error("Error", error); } finally { setIsProcessing(false); setTextInput(''); }
  };

  const handleAnalyzePronunciation = async (audioBlob: Blob) => {
    // ... existing logic ...
    if (!coachText.trim()) return alert("Cole um texto primeiro."); setIsProcessing(true); setUserAudioUrl(URL.createObjectURL(audioBlob)); setCoachResult(null); try { const base64Audio = await blobToBase64(audioBlob); const result = await analyzePronunciation(coachText, { mimeType: audioBlob.type.split(';')[0], data: base64Audio }); setCoachResult(result); setStats(prev => ({ ...prev, xp: prev.xp + 20 })); } catch (error) { alert("Erro ao analisar."); } finally { setIsProcessing(false); }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) { alert("Arquivo muito grande. O limite é 10MB."); return; }
    if (!file.type.startsWith('audio/')) { alert("Por favor, selecione um arquivo de áudio."); return; }

    setIsProcessing(true);
    const url = URL.createObjectURL(file);
    setShadowingAudioUrl(url);
    setShadowingAudioBlob(file);
    
    // Clear both states
    setShadowingSegments([]);
    setListeningSegments([]);
    setShadowingPage(1); 
    setSelectedShadowingId(null);

    try {
       const duration = await getAudioDuration(file);
       if (duration === 0) console.warn("Failed to get audio duration.");
       const base64 = await blobToBase64(file);
       const mimeType = file.type || 'audio/mp3';
       
       const segments = await transcribeForShadowing({ mimeType, data: base64 }, duration);
       
       // Initialize states based on current screen, or populate both? 
       // Populate both so user can switch modes with same audio
       setShadowingSegments(segments);
       setListeningSegments(segments.map(s => ({ 
           ...s, 
           revealedIndices: [], 
           isFullyRevealed: false, 
           typedText: '' 
       })));

       if(segments.length > 0) setSelectedShadowingId(segments[0].id);

    } catch (e) {
        alert("Erro ao transcrever áudio."); console.error(e);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleSaveLesson = () => {
    // ... existing logic ...
    if (messages.length === 0) return; const newLesson: SavedLesson = { id: Date.now().toString(), date: new Date().toISOString(), topic: topic, messages: [...messages], previewText: messages[0].text.substring(0, 50) + "..." }; setSavedLessons(prev => [newLesson, ...prev]); setIsSaved(true); setTimeout(() => setIsSaved(false), 2000);
  };

  const handleDeleteLesson = (id: string, e: React.MouseEvent) => {
    // ... existing logic ...
    e.preventDefault(); e.stopPropagation(); if (window.confirm("Tem certeza que deseja excluir esta aula?")) { const updatedLessons = savedLessons.filter(l => l.id !== id); try { localStorage.setItem('aiLingoSavedLessons', JSON.stringify(updatedLessons)); } catch (err) {} setSavedLessons(updatedLessons); }
  };

  const handleSaveFeedback = (item: FeedbackItem) => {
    if (!savedFeedback.some(f => f.error === item.error && f.correction === item.correction)) { setSavedFeedback(prev => [item, ...prev]); }
  };
  const handleDeleteFeedback = (index: number) => { setSavedFeedback(prev => prev.filter((_, i) => i !== index)); };

  // --- RENDERERS ---

  const renderShadowingScreen = () => {
    // Pagination
    const startIndex = (shadowingPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentSegments = shadowingSegments.slice(startIndex, endIndex);
    const totalPages = Math.ceil(shadowingSegments.length / ITEMS_PER_PAGE);
    const hasAnyAnalysis = shadowingSegments.some(s => s.analysis);
    const allVisible = shadowingSegments.filter(s => s.analysis).every(s => s.showAnalysis);

    return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
       <div className="bg-white border-b p-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Layers className="text-brand-500 w-5 h-5" /> Prática de Shadowing</h1>
        </div>
        
        {shadowingSegments.length > 0 && (
          <div className="flex items-center gap-4">
             <button onClick={() => setAutoAnalyze(!autoAnalyze)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-all ${autoAnalyze ? 'bg-purple-100 border-purple-300 text-purple-700 shadow-sm' : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'}`} title="Analisar automaticamente após gravar"> {autoAnalyze ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />} <span>Analisar Pronúncia</span> </button>
             {hasAnyAnalysis && (<button onClick={toggleAllAnalysisVisibility} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold border transition-all ${allVisible ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`} > {allVisible ? <EyeOff size={18} /> : <Eye size={18} />} <span>{allVisible ? "Ocultar Análise" : "Mostrar Análise"}</span> </button>)}
          </div>
        )}
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full p-6 space-y-6">
         <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            {!shadowingAudioUrl ? (
               <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
                  <Upload size={48} className="mb-4 text-brand-400" />
                  <p className="font-bold mb-1">Faça upload do seu áudio (MP3)</p>
                  <p className="text-sm mb-4">A IA irá transcrever e dividir em segmentos para você.</p>
                  <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" id="audio-upload" />
                  <label htmlFor="audio-upload" className="bg-brand-500 text-white px-6 py-2 rounded-full cursor-pointer hover:bg-brand-600 font-semibold shadow-md">{isProcessing ? 'Processando...' : 'Selecionar Arquivo'}</label>
               </div>
            ) : (
               <div className="space-y-4">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2"><Headphones size={20}/> Áudio Original</h3>
                  <audio ref={shadowingAudioRef} controls src={shadowingAudioUrl} className="w-full" />
                  <div className="flex justify-end"><button onClick={() => { setShadowingAudioUrl(null); setShadowingSegments([]); setListeningSegments([]); }} className="text-sm text-red-500 hover:underline">Trocar arquivo</button></div>
                  {shadowingSegments.length > 0 && (
                    <div className="flex gap-4 text-xs text-gray-500 justify-center border-t pt-2">
                       <span className="flex items-center gap-1"><span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-mono">Ctrl + R</span> Repetir Trecho</span>
                       <span className="flex items-center gap-1"><span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-mono">Ctrl + G</span> Gravar</span>
                       <span className="flex items-center gap-1"><span className="bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded font-mono">Ctrl + M</span> Ouvir Minha Voz</span>
                    </div>
                  )}
               </div>
            )}
         </div>

         {shadowingSegments.length > 0 && (
           <div className="space-y-4 pb-20">
              <div className="flex justify-between items-center px-2"><h3 className="font-bold text-gray-700">Pratique por Segmentos</h3><span className="text-xs text-gray-500 font-medium bg-gray-100 px-2 py-1 rounded-full">Página {shadowingPage} de {totalPages}</span></div>
              {currentSegments.map((segment, index) => {
                const globalIndex = startIndex + index;
                const isPlayingThis = isPlayingSegmentId === segment.id;
                const isSelected = selectedShadowingId === segment.id;
                return (
                <div key={segment.id} onClick={() => setSelectedShadowingId(segment.id)} className={`bg-white p-5 rounded-2xl shadow-sm border transition-all cursor-pointer ${isSelected ? 'border-brand-400 ring-2 ring-brand-100 shadow-md transform scale-[1.01]' : 'border-gray-200 hover:shadow-md'}`}>
                   <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2"><span className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded">{formatTime(segment.start)} - {formatTime(segment.end)}</span>{(segment.end - segment.start) > 20 && <span className="text-[10px] text-amber-500 bg-amber-50 px-1 rounded border border-amber-200">Longo</span>}</div>
                      <div className="flex items-center gap-3">
                         {segment.analysis && (<button onClick={(e) => { e.stopPropagation(); toggleSegmentAnalysis(segment.id); }} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${segment.showAnalysis ? 'bg-brand-500' : 'bg-gray-200'}`} title={segment.showAnalysis ? "Ocultar Análise" : "Mostrar Análise"}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${segment.showAnalysis ? 'translate-x-6' : 'translate-x-1'}`} /></button>)}
                         <span className="text-brand-300 font-bold">#{globalIndex + 1}</span>
                      </div>
                   </div>
                   <div className="mb-4">
                      {segment.analysis && segment.showAnalysis && segment.analysis.words && segment.analysis.words.length > 0 ? (
                        <div className="space-y-4">
                           <div className="flex flex-wrap gap-x-2 gap-y-3 leading-loose text-lg">
                              {segment.analysis.words.map((w, i) => (
                                <div key={i} className="group relative inline-block">
                                  <span className={`px-2 py-1 rounded-lg cursor-pointer transition-all border-b-2 select-none ${w.status === 'correct' ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200' : w.status === 'fair' ? 'bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100' : 'bg-red-100 text-red-800 border-red-200 hover:bg-red-200'}`} onMouseEnter={() => playTextToSpeech(w.word, 'en-US')}>{w.word}</span>
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 hidden group-hover:block bg-gray-900 text-white text-sm p-4 rounded-xl w-64 z-50 shadow-2xl pointer-events-none transform transition-opacity duration-200"><div className="flex items-center gap-2 mb-2 font-bold text-base border-b border-gray-700 pb-2"><Volume2 size={16} className="text-brand-400" /> {w.word}</div><div className="grid grid-cols-2 gap-2 mb-2"><div><div className="text-gray-400 text-[10px] uppercase tracking-wide">Rachel's Style</div><div className="font-mono text-green-400 text-sm tracking-wide">/{w.phoneticCorrect}/</div></div>{w.phoneticUser && (<div><div className="text-gray-400 text-[10px] uppercase tracking-wide">Você disse</div><div className="font-mono text-red-400 text-sm tracking-wide">/{w.phoneticUser}/</div></div>)}</div>{/* @ts-ignore */}{w.details && <div className="text-gray-300 text-xs italic mt-1">{w.details}</div>}<div className="absolute top-full left-1/2 -translate-x-1/2 w-3 h-3 bg-gray-900 rotate-45 -mt-1.5"></div></div>
                                </div>
                              ))}
                           </div>
                           {segment.analysis.generalFeedback && (<div className="text-xs bg-blue-50 p-3 rounded-lg text-blue-800 border-l-4 border-blue-400"><span className="font-bold block mb-1">Feedback do Coach:</span> {segment.analysis.generalFeedback}</div>)}
                        </div>
                      ) : (<div className="text-lg text-gray-800 leading-relaxed font-medium">{segment.text}</div>)}
                   </div>
                   <div className="flex items-center justify-between border-t pt-4">
                      <div className="flex items-center gap-3">
                         <button onClick={(e) => { e.stopPropagation(); playOriginalSegment(segment.id, segment.start, segment.end); }} className={`p-3 rounded-full transition-colors flex items-center gap-2 ${isPlayingThis ? 'bg-blue-100 text-blue-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`} title="Repetir Áudio Original (Ctrl + R)">{isPlayingThis ? <PauseCircle size={20} /> : <Repeat size={20} />}{isPlayingThis && <span className="text-xs font-bold">Ouvindo...</span>}</button>
                         <div className="h-6 w-px bg-gray-200 mx-2"></div>
                         <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Gravar:</div>
                         <button onMouseDown={(e) => { e.stopPropagation(); startShadowingRecording(segment.id, segment.text); }} onMouseUp={(e) => { e.stopPropagation(); stopShadowingRecording(); }} className={`p-3 rounded-full transition-all ${activeShadowingSegmentId === segment.id ? 'bg-red-500 text-white scale-110 shadow-red-200' : 'bg-gray-100 text-gray-600 hover:bg-brand-50 hover:text-brand-600'}`} title="Segure para gravar (Ctrl + G)">{activeShadowingSegmentId === segment.id ? <Square size={20} fill="currentColor" /> : <Mic size={20} />}</button>
                      </div>
                      <div className="flex items-center gap-3">
                         {segment.isAnalyzing && (<span className="text-xs font-bold text-brand-600 animate-pulse flex items-center gap-1"><Activity size={12} /> Analisando...</span>)}
                         {segment.userAudioUrl && !segment.isAnalyzing && (<div className="flex items-center gap-2 bg-brand-50 px-3 py-1.5 rounded-full border border-brand-100"><PlayCircle size={18} className="text-brand-600" /><audio controls src={segment.userAudioUrl} className="h-6 w-32" /></div>)}
                         {segment.analysis && (<button onClick={(e) => { e.stopPropagation(); setShadowingSegments(prev => prev.map(s => s.id === segment.id ? { ...s, analysis: null } : s)); }} className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-full" title="Tentar novamente / Limpar"><RotateCcw size={16} /></button>)}
                      </div>
                   </div>
                </div>
              );
              })}
              {totalPages > 1 && (<div className="flex justify-center items-center gap-4 mt-8"><button onClick={() => setShadowingPage(p => Math.max(1, p - 1))} disabled={shadowingPage === 1} className="p-3 rounded-full bg-white border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronLeft size={20} /></button><span className="font-semibold text-gray-700">Página {shadowingPage} de {totalPages}</span><button onClick={() => setShadowingPage(p => Math.min(totalPages, p + 1))} disabled={shadowingPage === totalPages} className="p-3 rounded-full bg-white border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronRight size={20} /></button></div>)}
           </div>
         )}
         {isProcessing && (<div className="flex flex-col items-center justify-center py-20 text-brand-600"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mb-4"></div><p className="font-semibold">Transcrevendo e segmentando áudio...</p></div>)}
      </div>
    </div>
    );
  };

  const renderListeningScreen = () => {
    const startIndex = (shadowingPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const currentSegments = listeningSegments.slice(startIndex, endIndex);
    const totalPages = Math.ceil(listeningSegments.length / ITEMS_PER_PAGE);

    return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
       <div className="bg-white border-b p-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-2">
          <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Ear className="text-brand-500 w-5 h-5" /> Listening Practice</h1>
        </div>
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full p-6 space-y-6">
         <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
            {!shadowingAudioUrl ? (
               <div className="border-2 border-dashed border-gray-300 rounded-xl p-10 flex flex-col items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors">
                  <Upload size={48} className="mb-4 text-brand-400" />
                  <p className="font-bold mb-1">Faça upload do seu áudio (MP3)</p>
                  <p className="text-sm mb-4">Modo Listening: Texto oculto até você acertar.</p>
                  <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" id="audio-upload-listening" />
                  <label htmlFor="audio-upload-listening" className="bg-brand-500 text-white px-6 py-2 rounded-full cursor-pointer hover:bg-brand-600 font-semibold shadow-md">{isProcessing ? 'Processando...' : 'Selecionar Arquivo'}</label>
               </div>
            ) : (
               <div className="space-y-4">
                  <h3 className="font-bold text-gray-700 flex items-center gap-2"><Headphones size={20}/> Áudio Original</h3>
                  <audio ref={shadowingAudioRef} controls src={shadowingAudioUrl} className="w-full" />
                  <div className="flex justify-end"><button onClick={() => { setShadowingAudioUrl(null); setShadowingSegments([]); setListeningSegments([]); }} className="text-sm text-red-500 hover:underline">Trocar arquivo</button></div>
               </div>
            )}
         </div>

         {listeningSegments.length > 0 && (
           <div className="space-y-4 pb-20">
              <div className="flex justify-between items-center px-2"><h3 className="font-bold text-gray-700">Escute e Complete</h3><span className="text-xs text-gray-500 font-medium bg-gray-100 px-2 py-1 rounded-full">Página {shadowingPage} de {totalPages}</span></div>
              {currentSegments.map((segment, index) => {
                const globalIndex = startIndex + index;
                const isPlayingThis = isPlayingSegmentId === segment.id;
                const isSelected = selectedShadowingId === segment.id;
                const words = segment.text.split(' ');

                return (
                <div key={segment.id} onClick={() => setSelectedShadowingId(segment.id)} className={`bg-white p-5 rounded-2xl shadow-sm border transition-all cursor-pointer ${isSelected ? 'border-brand-400 ring-2 ring-brand-100 shadow-md transform scale-[1.01]' : 'border-gray-200 hover:shadow-md'}`}>
                   <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-2"><span className="text-xs font-mono text-gray-400 bg-gray-50 px-2 py-1 rounded">{formatTime(segment.start)} - {formatTime(segment.end)}</span></div>
                      <span className="text-brand-300 font-bold">#{globalIndex + 1}</span>
                   </div>
                   
                   {/* Listening Content */}
                   <div className="mb-4 space-y-4">
                      {/* Hidden Words Area */}
                      <div className="flex flex-wrap gap-2 text-lg leading-relaxed font-medium text-gray-800">
                         {words.map((word, i) => {
                            const isRevealed = segment.isFullyRevealed || segment.revealedIndices.includes(i);
                            return (
                               <span key={i} className={`px-2 py-1 rounded transition-all ${isRevealed ? 'bg-green-50 text-green-900' : 'bg-gray-100 text-gray-400 min-w-[60px] text-center'}`}>
                                  {isRevealed ? word : '_____'}
                               </span>
                            );
                         })}
                      </div>

                      {/* Input Area */}
                      <div className="flex items-center gap-2">
                         <input 
                           type="text" 
                           value={segment.typedText || ''}
                           onChange={(e) => handleListeningTextChange(segment.id, e.target.value)}
                           onClick={(e) => e.stopPropagation()}
                           placeholder="Digite o que você ouviu..." 
                           className="flex-1 p-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-brand-500 outline-none text-sm"
                         />
                      </div>
                   </div>

                   <div className="flex items-center justify-between border-t pt-4">
                      <div className="flex items-center gap-3">
                         <button onClick={(e) => { e.stopPropagation(); playOriginalSegment(segment.id, segment.start, segment.end); }} className={`p-3 rounded-full transition-colors flex items-center gap-2 ${isPlayingThis ? 'bg-blue-100 text-blue-700' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`} title="Repetir Áudio Original (Ctrl + R)">{isPlayingThis ? <PauseCircle size={20} /> : <Repeat size={20} />}</button>
                         <div className="h-6 w-px bg-gray-200 mx-2"></div>
                         <button onMouseDown={(e) => { e.stopPropagation(); startShadowingRecording(segment.id, segment.text); }} onMouseUp={(e) => { e.stopPropagation(); stopShadowingRecording(); }} className={`p-3 rounded-full transition-all ${activeShadowingSegmentId === segment.id ? 'bg-red-500 text-white scale-110 shadow-red-200' : 'bg-gray-100 text-gray-600 hover:bg-brand-50 hover:text-brand-600'}`} title="Fale para completar (Ctrl + G)">{activeShadowingSegmentId === segment.id ? <Square size={20} fill="currentColor" /> : <Mic size={20} />}</button>
                      </div>
                      <div className="flex items-center gap-3">
                         {segment.isAnalyzing && (<span className="text-xs font-bold text-brand-600 animate-pulse flex items-center gap-1"><Activity size={12} /> Verificando...</span>)}
                         <button 
                           onClick={(e) => { e.stopPropagation(); toggleListeningReveal(segment.id); }}
                           className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${segment.isFullyRevealed ? 'bg-gray-100 text-gray-500' : 'bg-white text-brand-600 border-brand-200 hover:bg-brand-50'}`}
                         >
                            {segment.isFullyRevealed ? <EyeOff size={14} /> : <Eye size={14} />} {segment.isFullyRevealed ? 'Ocultar' : 'Exibir Transcrição'}
                         </button>
                      </div>
                   </div>
                </div>
              );
              })}
              {totalPages > 1 && (<div className="flex justify-center items-center gap-4 mt-8"><button onClick={() => setShadowingPage(p => Math.max(1, p - 1))} disabled={shadowingPage === 1} className="p-3 rounded-full bg-white border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronLeft size={20} /></button><span className="font-semibold text-gray-700">Página {shadowingPage} de {totalPages}</span><button onClick={() => setShadowingPage(p => Math.min(totalPages, p + 1))} disabled={shadowingPage === totalPages} className="p-3 rounded-full bg-white border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50 transition-colors"><ChevronRight size={20} /></button></div>)}
           </div>
         )}
         {isProcessing && (<div className="flex flex-col items-center justify-center py-20 text-brand-600"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mb-4"></div><p className="font-semibold">Transcrevendo áudio...</p></div>)}
      </div>
    </div>
    );
  };

  const renderMainMenuScreen = () => (
    <div className="min-h-screen bg-gray-50 p-6">
       <div className="max-w-4xl mx-auto">
          <button onClick={() => setScreen(AppScreen.ONBOARDING)} className="mb-6 flex items-center text-gray-500 hover:text-brand-600 transition-colors">
             <ArrowLeft size={20} className="mr-1" /> Voltar
          </button>
          
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Menu Principal</h1>
          <p className="text-gray-600 mb-8">Escolha como você quer aprender hoje.</p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
             
             <button
               onClick={() => setScreen(AppScreen.DASHBOARD)}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-brand-300 hover:shadow-md transition-all text-left flex items-start gap-4"
             >
                <div className="bg-brand-100 p-3 rounded-xl text-brand-600"><BarChart2 size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Meu Progresso</h3>
                   <p className="text-sm text-gray-500">Estatísticas, XP e itens salvos.</p>
                </div>
             </button>

             <button
               onClick={() => setScreen(AppScreen.TOPIC_SELECTION)}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-teal-300 hover:shadow-md transition-all text-left flex items-start gap-4"
             >
                <div className="bg-teal-100 p-3 rounded-xl text-teal-600"><MessageCircle size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Conversação (Live)</h3>
                   <p className="text-sm text-gray-500">Fale com a IA em tempo real.</p>
                </div>
             </button>

             <button
               onClick={() => setScreen(AppScreen.PRONUNCIATION_COACH)}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-purple-300 hover:shadow-md transition-all text-left flex items-start gap-4"
             >
                <div className="bg-purple-100 p-3 rounded-xl text-purple-600"><Mic size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Coach de Pronúncia</h3>
                   <p className="text-sm text-gray-500">Feedback detalhado de sotaque.</p>
                </div>
             </button>

             <button
               onClick={() => setScreen(AppScreen.SHADOWING)}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md transition-all text-left flex items-start gap-4"
             >
                <div className="bg-blue-100 p-3 rounded-xl text-blue-600"><Layers size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Shadowing</h3>
                   <p className="text-sm text-gray-500">Imite nativos com seus próprios áudios.</p>
                </div>
             </button>

             <button
               onClick={() => setScreen(AppScreen.LISTENING)}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-indigo-300 hover:shadow-md transition-all text-left flex items-start gap-4"
             >
                <div className="bg-indigo-100 p-3 rounded-xl text-indigo-600"><Ear size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Listening</h3>
                   <p className="text-sm text-gray-500">Complete a transcrição ouvindo.</p>
                </div>
             </button>

             <button
               onClick={() => { setTopic(Topic.COTIDIANO); setScreen(AppScreen.MOCK_TEST); }}
               className="p-6 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-amber-300 hover:shadow-md transition-all text-left flex items-start gap-4 md:col-span-2"
             >
                <div className="bg-amber-100 p-3 rounded-xl text-amber-600"><Award size={28} /></div>
                <div>
                   <h3 className="font-bold text-lg text-gray-800">Mock Test (Simulado)</h3>
                   <p className="text-sm text-gray-500">Teste formal estilo IELTS/TOEFL.</p>
                </div>
             </button>
          </div>
       </div>
    </div>
  );

  const renderOnboardingScreen = () => (
    <div className="min-h-screen bg-brand-500 flex flex-col items-center justify-center p-6 text-white text-center">
      <div className="bg-white/20 p-6 rounded-full mb-8">
        <GraduationCap size={64} />
      </div>
      <h1 className="text-4xl font-bold mb-4">AI-Lingo Tutor</h1>
      <p className="text-xl opacity-90 mb-12 max-w-md">
        Domine o inglês com a ajuda de inteligência artificial em tempo real.
      </p>
      <Button 
        onClick={() => setScreen(AppScreen.MAIN_MENU)} 
        className="bg-white text-brand-600 hover:bg-gray-100 text-lg px-12 py-4 shadow-xl"
      >
        Começar Agora
      </Button>
    </div>
  );

  const renderTopicSelectionScreen = () => (
    <div className="min-h-screen bg-gray-50 p-6 flex flex-col items-center justify-center">
      <div className="max-w-2xl w-full">
        <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="mb-8 flex items-center text-gray-500 hover:text-brand-600 transition-colors">
          <ArrowLeft size={20} className="mr-1" /> Voltar
        </button>
        <h2 className="text-3xl font-bold text-gray-900 mb-2 text-center">Sobre o que vamos falar?</h2>
        <p className="text-gray-500 text-center mb-10">Escolha um tópico para sua conversa em tempo real.</p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.values(Topic).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTopic(t);
                setScreen(AppScreen.TUTOR);
              }}
              className="p-6 bg-white rounded-2xl border border-gray-200 hover:border-brand-500 hover:shadow-lg hover:bg-brand-50 transition-all text-left group"
            >
              <h3 className="font-bold text-lg text-gray-800 group-hover:text-brand-700">{t}</h3>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const renderDashboardScreen = () => (
    <div className="min-h-screen bg-gray-50 p-6">
       <div className="max-w-5xl mx-auto space-y-8">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><ArrowLeft className="w-6 h-6 text-gray-600" /></button>
            <h1 className="text-2xl font-bold text-gray-800">Seu Progresso</h1>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
                <div className="p-3 bg-yellow-100 text-yellow-600 rounded-full mb-2"><Award size={24} /></div>
                <div className="text-3xl font-bold text-gray-800">{stats.xp}</div>
                <div className="text-xs text-gray-500 font-semibold uppercase">Total XP</div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center">
                <div className="p-3 bg-orange-100 text-orange-600 rounded-full mb-2"><Activity size={24} /></div>
                <div className="text-3xl font-bold text-gray-800">{stats.streak}</div>
                <div className="text-xs text-gray-500 font-semibold uppercase">Dias de Ofensiva</div>
             </div>
             <div className="col-span-1 md:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div className="h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { name: 'Pronúncia', score: stats.pronunciationScore },
                      { name: 'Gramática', score: stats.grammarScore },
                      { name: 'Vocabulário', score: stats.vocabularyScore },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12}} />
                      <YAxis hide />
                      <RechartTooltip />
                      <Bar dataKey="score" fill="#6366f1" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
             </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Weak Points */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><AlertCircle size={20} className="text-red-500" /> Pontos de Atenção</h3>
              <div className="flex flex-wrap gap-2">
                {stats.weakPoints.map((wp, i) => (
                  <span key={i} className="px-3 py-1 bg-red-50 text-red-700 rounded-full text-sm font-medium border border-red-100">{wp}</span>
                ))}
              </div>
            </div>

            {/* Saved Feedback */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><Bookmark size={20} className="text-brand-500" /> Correções Salvas</h3>
              <div className="space-y-3 max-h-60 overflow-y-auto pr-2">
                {savedFeedback.length === 0 ? (
                  <p className="text-gray-400 text-sm italic">Nenhuma correção salva ainda.</p>
                ) : (
                  savedFeedback.map((fb, i) => (
                    <div key={i} className="relative group">
                      <FeedbackCard feedback={fb} />
                      <button onClick={() => handleDeleteFeedback(i)} className="absolute top-2 right-2 p-1 bg-white text-red-500 rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 size={14} /></button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          
          {/* Saved Lessons */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2"><BookOpen size={20} className="text-blue-500" /> Aulas Anteriores</h3>
               <div className="space-y-2">
                {savedLessons.length === 0 ? (
                   <p className="text-gray-400 text-sm italic">Nenhuma aula salva.</p>
                ) : (
                  savedLessons.map((lesson) => (
                    <div key={lesson.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100 hover:bg-gray-100 transition-colors flex justify-between items-center group">
                       <div>
                          <div className="flex items-center gap-2 mb-1">
                             <span className="font-bold text-gray-800">{lesson.topic}</span>
                             <span className="text-xs text-gray-400">{new Date(lesson.date).toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm text-gray-600 line-clamp-1">{lesson.previewText}</p>
                       </div>
                       <button onClick={(e) => handleDeleteLesson(lesson.id, e)} className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"><Trash2 size={18} /></button>
                    </div>
                  ))
                )}
               </div>
          </div>
       </div>
    </div>
  );

  const renderCoachScreen = () => (
    <div className="min-h-screen bg-gray-50 flex flex-col">
       <div className="bg-white border-b p-4 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-2">
          <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="p-2 hover:bg-gray-100 rounded-full"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Mic className="text-purple-500 w-5 h-5" /> Coach de Pronúncia</h1>
        </div>
      </div>
      
      <div className="flex-1 max-w-2xl mx-auto w-full p-6 flex flex-col gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
          <label className="block text-sm font-bold text-gray-700 mb-2">Texto para Treinar</label>
          <textarea 
            value={coachText}
            onChange={(e) => setCoachText(e.target.value)}
            placeholder="Cole ou digite aqui o texto que você quer treinar (Inglês)..."
            className="w-full h-32 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none resize-none bg-gray-50"
          />
        </div>

        <div className="flex items-center justify-center py-8">
           {isRecording ? (
             <button onClick={() => stopRecording()} className="h-20 w-20 rounded-full bg-red-500 flex items-center justify-center animate-pulse shadow-lg shadow-red-500/30 border-4 border-red-100">
                <Square size={32} fill="white" className="text-white" />
             </button>
           ) : (
             <button 
                onClick={() => startRecording(true)}
                disabled={!coachText.trim() || isProcessing}
                className="h-20 w-20 rounded-full bg-purple-600 flex items-center justify-center shadow-lg shadow-purple-600/30 border-4 border-purple-100 hover:scale-105 transition-transform disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
             >
                {isProcessing ? <div className="animate-spin h-8 w-8 border-4 border-white border-t-transparent rounded-full" /> : <Mic size={32} className="text-white" />}
             </button>
           )}
        </div>
        
        {/* Analysis Result */}
        {coachResult && (
           <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-purple-50 p-6 border-b border-purple-100 flex items-center justify-between">
                 <div>
                   <h3 className="font-bold text-purple-900 text-lg">Resultado da Análise</h3>
                   <p className="text-purple-700 text-sm">{coachResult.generalFeedback}</p>
                 </div>
                 <div className="text-center">
                    <div className="text-3xl font-black text-purple-600">{coachResult.overallScore}</div>
                    <div className="text-xs uppercase font-bold text-purple-400">Score</div>
                 </div>
              </div>
              <div className="p-6">
                 {userAudioUrl && (
                   <div className="mb-6 bg-gray-50 p-3 rounded-xl flex items-center gap-3">
                     <button onClick={() => new Audio(userAudioUrl).play()} className="p-2 bg-purple-600 text-white rounded-full hover:bg-purple-700"><PlayCircle size={20} /></button>
                     <div className="text-sm font-semibold text-gray-600">Sua gravação</div>
                   </div>
                 )}
                 
                 <div className="flex flex-wrap gap-2 text-lg leading-loose">
                    {coachResult.words.map((w, i) => (
                       <span 
                         key={i} 
                         className={`px-2 py-1 rounded-lg border-b-2 cursor-help relative group ${
                            w.status === 'correct' ? 'bg-green-50 text-green-800 border-green-200' : 
                            w.status === 'fair' ? 'bg-yellow-50 text-yellow-800 border-yellow-200' : 
                            'bg-red-50 text-red-800 border-red-200'
                         }`}
                       >
                          {w.word}
                          {/* Tooltip */}
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-900 text-white text-xs p-3 rounded-lg w-48 z-50 shadow-xl pointer-events-none">
                             <div className="flex justify-between mb-1">
                                <span className="text-gray-400">Correto:</span>
                                <span className="font-mono text-green-400">/{w.phoneticCorrect}/</span>
                             </div>
                             {w.phoneticUser && (
                               <div className="flex justify-between mb-2">
                                  <span className="text-gray-400">Você:</span>
                                  <span className="font-mono text-red-400">/{w.phoneticUser}/</span>
                               </div>
                             )}
                             {w.details && <div className="border-t border-gray-700 pt-1 mt-1 text-gray-300">{w.details}</div>}
                          </div>
                       </span>
                    ))}
                 </div>
              </div>
           </div>
        )}
      </div>
    </div>
  );

  const renderTutorScreen = () => {
    // Mode distinction
    const isMock = screen === AppScreen.MOCK_TEST;
    const isLiveMode = screen === AppScreen.TUTOR && !isMock; 

    // Auto connect for live mode
    useEffect(() => {
       if (isLiveMode && !isLiveConnected) {
          connectLiveSession();
       }
    }, [isLiveMode]);

    return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0 shadow-sm z-10">
        <div className="flex items-center gap-3">
          <button onClick={() => setScreen(AppScreen.MAIN_MENU)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-bold text-gray-800 flex items-center gap-2">
              {isMock ? <Award className="text-amber-500 w-5 h-5" /> : <MessageCircle className="text-brand-500 w-5 h-5" />}
              {isMock ? 'Mock Test' : 'Conversação'}
            </h1>
            <p className="text-xs text-gray-500 font-medium">{topic}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
           {!isMock && (
              <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 ${isLiveConnected ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-gray-100 text-gray-500'}`}>
                 <div className={`w-2 h-2 rounded-full ${isLiveConnected ? 'bg-red-600' : 'bg-gray-400'}`}></div>
                 {isLiveConnected ? 'LIVE' : 'OFFLINE'}
              </div>
           )}
           <button onClick={handleSaveLesson} disabled={isSaved} className={`p-2 rounded-full transition-all ${isSaved ? 'text-green-600 bg-green-50' : 'text-gray-400 hover:text-brand-600 hover:bg-gray-100'}`}>
             {isSaved ? <Check size={20} /> : <Save size={20} />}
           </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        
        {/* Left/Top: Avatar & Live Controls (Visible in Live Mode) */}
        {(isLiveMode || isMock) && (
        <div className={`bg-gray-100 flex flex-col items-center justify-center p-6 transition-all duration-500 relative ${isLiveMode ? 'flex-1 md:flex-[4]' : 'h-48 md:h-auto md:w-80 border-r border-gray-200'}`}>
           
           <Avatar isSpeaking={isAvatarSpeaking} className={isLiveMode ? 'scale-125 mb-8' : 'scale-90'} />
           
           {isLiveMode && (
              <div className="flex items-center gap-6 mt-8">
                 <button 
                    onClick={toggleMic} 
                    className={`p-6 rounded-full transition-all duration-300 shadow-xl ${isMicMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-white text-gray-800 hover:bg-gray-50'}`}
                 >
                    {isMicMuted ? <MicOff size={32} /> : <Mic size={32} />}
                 </button>
                 <button 
                    onClick={disconnectLiveSession}
                    className="p-6 rounded-full bg-red-100 text-red-600 hover:bg-red-200 transition-colors"
                 >
                    <PhoneOff size={32} />
                 </button>
              </div>
           )}
           
           {/* Live Audio Visualizer (Fake) */}
           {isLiveMode && !isMicMuted && (
             <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex gap-1 h-8 items-end opacity-50">
               {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="w-1.5 bg-gray-400 rounded-full animate-bounce" style={{ height: `${20 + Math.random() * 60}%`, animationDelay: `${i * 0.1}s` }} />
               ))}
             </div>
           )}
        </div>
        )}

        {/* Right/Bottom: Chat & Feedback */}
        <div className={`flex flex-col bg-white ${isLiveMode ? 'flex-1 md:flex-[3] border-l border-gray-200' : 'flex-1'}`}>
           
           {/* Messages Area */}
           <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-white/50">
              {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center opacity-60">
                   <MessageCircle size={48} className="mb-2" />
                   <p>Inicie a conversa...</p>
                </div>
              )}
              
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`px-5 py-3 rounded-2xl text-base leading-relaxed shadow-sm ${
                         msg.role === 'user' 
                           ? 'bg-brand-600 text-white rounded-tr-none' 
                           : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none'
                      }`}>
                         {msg.audioUrl && (
                           <div className="mb-2 bg-black/10 p-2 rounded-lg"><audio controls src={msg.audioUrl} className="h-8 w-48 opacity-80" /></div>
                         )}
                         {msg.text}
                      </div>
                      
                      {/* Feedback Cards Inline */}
                      {msg.feedback && msg.feedback.length > 0 && (
                        <div className="mt-3 space-y-2 w-full max-w-md">
                           {msg.feedback.map((fb, i) => (
                              <FeedbackCard 
                                key={i} 
                                feedback={fb} 
                                onSave={handleSaveFeedback} 
                                isSaved={savedFeedback.some(s => s.error === fb.error && s.correction === fb.correction)}
                              />
                           ))}
                        </div>
                      )}
                   </div>
                </div>
              ))}
              <div ref={chatEndRef} />
           </div>

           {/* Input Area (Only for Mock Test or if Live is disconnected/legacy) */}
           {!isLiveMode && (
             <div className="p-4 border-t bg-gray-50 flex gap-2 items-end">
                <div className="flex-1 bg-white rounded-2xl border border-gray-200 focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-transparent transition-shadow shadow-sm flex items-center px-4 py-2">
                   <textarea
                     value={textInput}
                     onChange={(e) => setTextInput(e.target.value)}
                     onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(textInput); } }}
                     placeholder={isRecording ? "Gravando áudio..." : "Digite sua resposta..."}
                     className="flex-1 max-h-32 bg-transparent border-none focus:ring-0 resize-none outline-none py-2 text-gray-700 placeholder:text-gray-400"
                     rows={1}
                     disabled={isRecording || isProcessing}
                   />
                   {isProcessing && <div className="animate-spin h-5 w-5 text-brand-500 border-2 border-current border-t-transparent rounded-full ml-2" />}
                </div>
                
                {textInput.trim() ? (
                   <button 
                     onClick={() => handleSendMessage(textInput)}
                     disabled={isProcessing}
                     className="p-4 bg-brand-600 text-white rounded-full hover:bg-brand-700 shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:scale-100 hover:scale-105 active:scale-95"
                   >
                      <Send size={20} />
                   </button>
                ) : (
                   <button 
                     onMouseDown={() => startRecording(false)}
                     onMouseUp={() => stopRecording()}
                     disabled={isProcessing}
                     className={`p-4 rounded-full transition-all shadow-lg ${isRecording ? 'bg-red-500 text-white scale-110 shadow-red-500/30' : 'bg-gray-800 text-white hover:bg-gray-900 hover:scale-105'}`}
                   >
                      {isRecording ? <Square size={20} fill="currentColor" /> : <Mic size={20} />}
                   </button>
                )}
             </div>
           )}
        </div>
      </div>
    </div>
    );
  };

  return (
    <div className="font-sans text-gray-900 antialiased selection:bg-brand-200">
      {screen === AppScreen.ONBOARDING && renderOnboardingScreen()}
      {screen === AppScreen.MAIN_MENU && renderMainMenuScreen()}
      {screen === AppScreen.TOPIC_SELECTION && renderTopicSelectionScreen()}
      {(screen === AppScreen.TUTOR || screen === AppScreen.MOCK_TEST || screen === AppScreen.REVIEW) && renderTutorScreen()}
      {screen === AppScreen.PRONUNCIATION_COACH && renderCoachScreen()}
      {screen === AppScreen.SHADOWING && renderShadowingScreen()}
      {screen === AppScreen.LISTENING && renderListeningScreen()}
      {screen === AppScreen.DASHBOARD && renderDashboardScreen()}
    </div>
  );
};

export default App;