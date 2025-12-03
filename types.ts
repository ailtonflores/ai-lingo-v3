

export enum AppScreen {
  ONBOARDING = 'ONBOARDING',
  MAIN_MENU = 'MAIN_MENU',
  TUTOR = 'TUTOR',
  DASHBOARD = 'DASHBOARD',
  REVIEW = 'REVIEW',
  MOCK_TEST = 'MOCK_TEST',
  PRONUNCIATION_COACH = 'PRONUNCIATION_COACH',
  TOPIC_SELECTION = 'TOPIC_SELECTION',
  SHADOWING = 'SHADOWING',
  LISTENING = 'LISTENING',
  WRITING_MENU = 'WRITING_MENU',
  WRITING_ROLEPLAY = 'WRITING_ROLEPLAY',
  WRITING_VISUAL = 'WRITING_VISUAL',
  WRITING_TETRIS = 'WRITING_TETRIS',
  WRITING_JOURNAL = 'WRITING_JOURNAL'
}

export enum Topic {
  VIAGEM = 'Viagem',
  NEGOCIOS = 'Negócios',
  CULINARIA = 'Culinária',
  TECNOLOGIA = 'Tecnologia',
  COTIDIANO = 'Cotidiano'
}

export interface FeedbackItem {
  type: 'pronunciation' | 'grammar' | 'vocabulary';
  error: string;
  correction: string;
  portugueseExplanation: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  feedback?: FeedbackItem[];
  audioUrl?: string;
  toneAnalysis?: {
    score: number;
    formality: string;
    suggestion: string;
  };
}

export interface UserStats {
  xp: number;
  streak: number;
  pronunciationScore: number; // 0-100
  grammarScore: number; // 0-100
  vocabularyScore: number; // 0-100
  weakPoints: string[];
}

export interface TutorResponse {
  reply: string;
  feedback: FeedbackItem[];
  xpEarned: number;
  skillUpdate: {
    pronunciation: number;
    grammar: number;
    vocabulary: number;
  };
  toneAnalysis?: {
    score: number;
    formality: string;
    suggestion: string;
  };
}

export interface SavedLesson {
  id: string;
  date: string; // ISO string
  topic: Topic;
  messages: ChatMessage[];
  previewText: string;
}

// --- Pronunciation Coach Types ---

export interface WordAnalysis {
  word: string;
  status: 'correct' | 'incorrect' | 'fair';
  score: number; // 0-100
  phoneticUser?: string; // IPA representation of what user said
  phoneticCorrect?: string; // IPA of correct pronunciation
  details?: string;
}

export interface PronunciationResult {
  overallScore: number;
  words: WordAnalysis[];
  generalFeedback: string; // PT-BR summary
  tips: {
    targetSound: string;
    instruction: string; // How to fix
  }[];
}

// --- Shadowing Types ---

export interface ShadowingSegment {
  id: string;
  text: string;
  start: number; // Start time in seconds
  end: number;   // End time in seconds
  userAudioUrl?: string; // Blob URL of user recording
  analysis?: PronunciationResult | null;
  isAnalyzing?: boolean;
  showAnalysis?: boolean; // Toggle state for showing/hiding feedback
}

export interface ListeningSegment extends ShadowingSegment {
  revealedIndices: number[]; // Indices of words that have been revealed
  isFullyRevealed: boolean; // If true, show full text
  typedText: string; // What the user typed
}

// --- Writing Types ---

export interface TetrisResult {
  success: boolean;
  feedback: string;
  usedWords: string[];
}

export interface JournalFeedback {
  praise: string;
  corrections: string;
  challenge: string;
  correctedVersion: string;
}