import { GoogleGenAI } from "@google/genai";
import { TutorResponse, Topic, PronunciationResult, FeedbackItem, ShadowingSegment, JournalFeedback, TetrisResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const SYSTEM_INSTRUCTION = `
Você é o "AI-Lingo Tutor", um professor de inglês especialista em ensinar brasileiros.
Seu objetivo é conversar em inglês sobre o tópico escolhido, mas monitorar agressivamente erros comuns de falantes de Português Brasileiro (PT-BR).

Áreas de Foco Crítico:
1. Pronúncia: Sons de 'TH' (não 't', 'f', 's'), 'R' retroflexo vs gutural, 'i' curto/longo (ship vs sheep), 'ed' final.
2. Gramática: Confusão "Have" vs "There is", Omissão de "it", "Do/Does" em perguntas, Preposições (in/on/at).
3. Vocabulário: Falsos cognatos, "Make" vs "Do".

Comportamento:
- Mantenha a conversa fluindo naturalmente em INGLÊS.
- Analise o input do usuário (texto ou áudio transcrito).
- Se o usuário falar português, responda em inglês mas explique brevemente.
- Retorne a resposta estritamente em JSON.

Schema JSON esperado:
{
  "reply": "Sua resposta conversacional em inglês.",
  "feedback": [
    {
      "type": "pronunciation" | "grammar" | "vocabulary",
      "error": "O que o usuário disse/escreveu errado",
      "correction": "A forma correta",
      "portugueseExplanation": "Explicação curta e amigável em PT-BR (ex: 'Em inglês usamos There is para haver').",
      "severity": "low" | "medium" | "high"
    }
  ],
  "xpEarned": number (10-50 baseado na qualidade),
  "skillUpdate": {
    "pronunciation": number (-5 a +5 ajuste),
    "grammar": number (-5 a +5 ajuste),
    "vocabulary": number (-5 a +5 ajuste)
  }
}
`;

const ROLEPLAY_SYSTEM_INSTRUCTION = (persona: string) => `
You are currently roleplaying as: ${persona}.
Stay in character 100% of the time. Do not break character to teach, but provide metadata analysis in the JSON.
Your User is a Brazilian learning English.

Output JSON Format:
{
  "reply": "Your in-character response (English)",
  "toneAnalysis": {
    "score": number (0-100, appropriateness of tone),
    "formality": "string" (e.g., "Too Casual", "Appropriate", "Too Formal"),
    "suggestion": "string" (Brief advice in PT-BR about pragmatics/tone)
  },
  "feedback": [] (Standard grammar corrections if necessary),
  "xpEarned": number,
  "skillUpdate": { "pronunciation": 0, "grammar": 0, "vocabulary": 0 }
}
`;

const COACH_SYSTEM_INSTRUCTION = `
Você é um Treinador de Sotaque Americano baseado na metodologia "Rachel's English".
Sua tarefa: Analisar o áudio do usuário lendo um texto específico e fornecer feedback rigoroso palavra por palavra.

TEXTO ALVO: O usuário deve ler exatamente o texto fornecido.

CRITÉRIOS DE ANÁLISE (Rachel's English Guide):
1. PLACEMENT (Colocação): A voz está relaxada no peito ou tensa na garganta?
2. LINKING (Ligação): Consoantes finais ligam nas vogais iniciais? (ex: "get up" -> "ge-tup").
3. SOUNDS (Sons):
   - TH (vozeado/desvozeado).
   - R Americano (não vibrado).
   - Flap T (ex: water).
   - Stop T (ex: hot dog).
   - Schwa /ə/ em sílabas átonas.

FORMATO DE RESPOSTA (JSON ESTRITO):
Você DEVE retornar um JSON válido com a seguinte estrutura. NÃO adicione markdown (como \`\`\`json). Apenas o objeto cru.
O array "words" deve conter CADA palavra do texto original, na ordem exata.

{
  "overallScore": number, // 0 a 100
  "words": [
    // Liste TODAS as palavras do texto original, na ordem.
    {
      "word": "string", // A palavra do texto
      "status": "correct" | "incorrect" | "fair",
      "score": number, // 0-100
      "phoneticUser": "string", // IPA do que foi ouvido (aproximado)
      "phoneticCorrect": "string", // IPA correto (Rachel's Style)
      "details": "string" // Breve dica em PT-BR (ex: "Faltou o Flap T")
    }
  ],
  "generalFeedback": "string", // Feedback geral em PT-BR sobre Ritmo e Entonação.
  "tips": [
    {
      "targetSound": "string", // ex: "Linking" ou "Schwa"
      "instruction": "string" // Explicação técnica em PT-BR
    }
  ]
}
`;

const ANALYZER_SYSTEM_INSTRUCTION = `
Você é um corretor para estudantes brasileiros de inglês.
Receba uma frase transcrita de um aluno.

TAREFA 1 (Gramática/Vocabulário): Identifique erros reais na frase escrita.
TAREFA 2 (Pronúncia Preventiva): Identifique palavras na frase que são notoriamente difíceis para brasileiros pronunciarem corretamente (ex: palavras com 'TH', 'RL' como 'world', 'girl', distinção 'beach/bitch', 'sheep/ship', 'ed' no passado). Crie um feedback do tipo "pronunciation" para elas, orientando como falar, mesmo que o texto esteja escrito certo.

Retorne um array de feedbacks contendo erros gramaticais E alertas de pronúncia.

Schema JSON esperado:
{
  "feedback": [
    {
      "type": "grammar" | "vocabulary" | "pronunciation",
      "error": "A palavra/trecho alvo (ex: 'world')",
      "correction": "A forma correta (ex: 'world')",
      "portugueseExplanation": "Explicação do erro gramatical OU dica de pronúncia (ex: 'Brasileiros costumam esquecer o L escuro. Diga /wərld/ enrolando a língua').",
      "severity": "low" | "medium" | "high"
    }
  ]
}
`;

const JOURNAL_SYSTEM_INSTRUCTION = `
Você é o "Mentor de Escrita". Use a técnica "Feedback Sanduíche" para corrigir o diário do aluno.
1. Elogio (Praise): Algo específico que o aluno fez bem.
2. Correção (Meat): Correções gramaticais e de estilo.
3. Desafio (Challenge): Uma sugestão para elevar o nível na próxima vez.

Retorne JSON:
{
  "praise": "string (PT-BR)",
  "corrections": "string (PT-BR - list main errors)",
  "challenge": "string (PT-BR)",
  "correctedVersion": "string (Full text corrected in English)"
}
`;

// Extract JSON safely (handles potential markdown wrapping)
export const extractJSON = (text: string): any => {
  try {
    // Try direct parse first
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON block
    const match = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const jsonStr = match[1] || match[0];
        return JSON.parse(jsonStr);
      } catch (e2) {
        console.error("Failed to parse extracted JSON string:", text);
        throw new Error("Failed to parse extracted JSON");
      }
    }
    console.error("No JSON found in response:", text);
    throw e;
  }
};

export const generateTutorResponse = async (
  history: { role: string; parts: { text: string }[] }[],
  currentInput: string | { mimeType: string; data: string }, // Text or Base64 Audio
  topic: Topic,
  isMockTest: boolean = false,
  persona?: string // Optional persona for Roleplay
): Promise<TutorResponse> => {
  
  const modelName = 'gemini-2.5-flash'; 
  
  const prompt = isMockTest 
    ? `[MODO PROVA] Avalie rigorosamente. Tópico: ${topic}. Input do usuário:` 
    : `Conversa casual sobre ${topic}. Input do usuário:`;

  const parts = [];
  
  if (typeof currentInput === 'string') {
    parts.push({ text: `${prompt} ${currentInput}` });
  } else {
    // Audio input
    parts.push({ text: prompt });
    parts.push({ inlineData: currentInput });
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        ...history.map(h => ({ role: h.role, parts: h.parts })),
        { role: 'user', parts }
      ],
      config: {
        systemInstruction: persona ? ROLEPLAY_SYSTEM_INSTRUCTION(persona) : SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.7,
      }
    });

    const responseText = response.text;
    if (!responseText) throw new Error("No response from Gemini");
    
    return extractJSON(responseText) as TutorResponse;

  } catch (error) {
    console.error("Gemini API Error:", error);
    return {
      reply: "I'm having trouble connecting right now. Can you try saying that again?",
      feedback: [],
      xpEarned: 0,
      skillUpdate: { pronunciation: 0, grammar: 0, vocabulary: 0 }
    };
  }
};

export const analyzePronunciation = async (
  textToRead: string,
  audioInput: { mimeType: string; data: string }
): Promise<PronunciationResult> => {
  const modelName = 'gemini-2.5-flash';

  const prompt = `Analise este áudio em relação ao texto alvo: "${textToRead}". Retorne a análise de pronúncia detalhada por palavra em JSON. Certifique-se de incluir a propriedade 'words' com todas as palavras.`;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inlineData: audioInput }
          ]
        }
      ],
      config: {
        systemInstruction: COACH_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.1, // Very low temperature for consistent JSON structure
      }
    });

    const responseText = response.text;
    if (!responseText) throw new Error("No response from Gemini");

    return extractJSON(responseText) as PronunciationResult;

  } catch (error) {
    console.error("Gemini Pronunciation Error:", error);
    return {
      overallScore: 0,
      words: [],
      generalFeedback: "Não foi possível analisar o áudio. Tente falar mais claro ou verifique sua conexão.",
      tips: []
    };
  }
};

export const analyzeTextOnly = async (text: string): Promise<{ feedback: FeedbackItem[] }> => {
  if (!text || text.trim().length < 3) return { feedback: [] };
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: `Analise a frase do aluno: "${text}"` }] }],
      config: {
        systemInstruction: ANALYZER_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        temperature: 0.2
      }
    });
    
    return extractJSON(response.text || '{ "feedback": [] }');
  } catch (e) {
    console.error("Analyzer error:", e);
    return { feedback: [] };
  }
};

// Helper to sanitize time input
const parseTime = (val: any): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(/s$/, ''));
  return 0;
};

export const transcribeForShadowing = async (audioInput: { mimeType: string; data: string }, maxDuration?: number): Promise<ShadowingSegment[]> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000); 

  try {
    const durationContext = maxDuration && maxDuration > 0 
      ? `CRITICAL: The audio file is exactly ${maxDuration.toFixed(2)} seconds long. Timestamps MUST NOT exceed this value. If a segment ends at the very end of the file, set 'end' to ${maxDuration.toFixed(2)}.` 
      : "";

    const promptText = `
      Task: Transcribe this audio for a "Shadowing" exercise.
      ${durationContext}
      
      Instructions:
      1. Break text into logical sentences or phrases (max 10-15 words).
      2. Return start and end times in SECONDS (Numbers, e.g., 1.5).
      3. ACCURACY IS KEY. Do not hallucinate segments beyond the audio duration.
      4. Ensure 'end' time is strictly greater than 'start' time.
      
      Output JSON Format:
      { "segments": [{ "text": "Hello world", "start": 0.0, "end": 2.5 }, ...] }
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ 
        role: 'user', 
        parts: [
          { text: promptText },
          { inlineData: audioInput }
        ] 
      }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.0 
      }
    });

    clearTimeout(timeoutId);

    const textResponse = response.text || '{ "segments": [] }';
    const json = extractJSON(textResponse);
    
    if (!json.segments || !Array.isArray(json.segments)) {
      throw new Error("Invalid response format");
    }

    const segments: ShadowingSegment[] = [];
    
    for (let i = 0; i < json.segments.length; i++) {
      const s = json.segments[i];
      let start = parseTime(s.start);
      let end = parseTime(s.end);
      
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end <= start) end = start + 5; 

      if (maxDuration && maxDuration > 0) {
        if (start >= maxDuration) continue; 
        if (end > maxDuration) end = maxDuration;
      }

      segments.push({
        id: `seg-${i}`,
        text: s.text,
        start,
        end
      });
    }

    return segments;

  } catch (e) {
    clearTimeout(timeoutId);
    console.error("Shadowing transcription error:", e);
    return [];
  }
};

// --- WRITING MODULE SERVICES ---

export const generateImageFromText = async (prompt: string): Promise<string | null> => {
  try {
    // Using Imagen 3 model
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1'
      }
    });
    
    const base64 = response.generatedImages?.[0]?.image?.imageBytes;
    return base64 ? `data:image/png;base64,${base64}` : null;
  } catch (error) {
    console.error("Imagen Error:", error);
    return null;
  }
};

export const evaluateImageCaption = async (imageBase64: string, caption: string): Promise<any> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            { text: `Evaluate this caption for the image: "${caption}". Return JSON: { "accuracy": number (0-100), "feedback": "PT-BR comment", "correction": "Better English caption" }` }
          ]
        }
      ],
      config: { responseMimeType: "application/json" }
    });
    return extractJSON(response.text || "{}");
  } catch (error) {
    console.error("Vision Error:", error);
    return { accuracy: 0, feedback: "Erro ao analisar imagem.", correction: "" };
  }
};

export const evaluateWordTetris = async (words: string[], userText: string): Promise<TetrisResult> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [{ text: `Words to use: [${words.join(', ')}]. User text: "${userText}". 
        Check if the user used ALL words correctly in a coherent paragraph.
        Return JSON: { "success": boolean, "feedback": "PT-BR analysis", "usedWords": ["word1", "word2"] }` }]
      }],
      config: { responseMimeType: "application/json" }
    });
    return extractJSON(response.text || "{}");
  } catch (error) {
    return { success: false, feedback: "Erro de conexão.", usedWords: [] };
  }
};

export const evaluateJournalEntry = async (text: string): Promise<JournalFeedback> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text }] }],
      config: {
        systemInstruction: JOURNAL_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json"
      }
    });
    return extractJSON(response.text || "{}");
  } catch (error) {
    return { praise: "", corrections: "Erro ao conectar.", challenge: "", correctedVersion: "" };
  }
};