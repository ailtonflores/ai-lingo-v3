
export const blobToBase64 = (blob: Blob): Promise<string> => {
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

export const getAudioDuration = (blob: Blob): Promise<number> => {
  return new Promise((resolve) => {
    const audio = new Audio(URL.createObjectURL(blob));
    audio.onloadedmetadata = () => {
      resolve(audio.duration);
    };
    audio.onerror = () => {
      resolve(0); // Fallback if metadata fails
    };
  });
};

export const formatTime = (seconds: number): string => {
  if (isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const playTextToSpeech = (
  text: string, 
  lang: 'en-US' | 'pt-BR' = 'en-US',
  onStart?: () => void,
  onEnd?: () => void
) => {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = lang === 'en-US' ? 0.9 : 1.1;
    
    const voices = window.speechSynthesis.getVoices();
    const targetVoice = voices.find(v => v.lang.replace('_', '-').includes(lang) && v.name.includes('Google')) || 
                        voices.find(v => v.lang.replace('_', '-').includes(lang));
                        
    if (targetVoice) utterance.voice = targetVoice;

    utterance.onstart = () => { if (onStart) onStart(); };
    utterance.onend = () => { if (onEnd) onEnd(); };
    utterance.onerror = () => { if (onEnd) onEnd(); };

    window.speechSynthesis.speak(utterance);
  } else {
    console.warn("Speech Synthesis not supported");
    if (onEnd) onEnd();
  }
};

// --- REAL-TIME AUDIO UTILS FOR GEMINI LIVE ---

export class AudioStreamPlayer {
  private audioContext: AudioContext | null = null;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;
  private onStateChange: (isPlaying: boolean) => void;
  private queue: AudioBuffer[] = [];
  private processingQueue: boolean = false;

  constructor(onStateChange: (isPlaying: boolean) => void) {
    this.onStateChange = onStateChange;
  }

  async initialize() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  addPCMChunk(base64String: string) {
    if (!this.audioContext || this.audioContext.state === 'closed') return;

    // Decode Base64 to Int16 PCM
    const binaryString = atob(base64String);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Convert Int16 to Float32
    const int16Data = new Int16Array(bytes.buffer);
    const float32Data = new Float32Array(int16Data.length);
    for (let i = 0; i < int16Data.length; i++) {
      float32Data[i] = int16Data[i] / 32768.0;
    }

    const buffer = this.audioContext.createBuffer(1, float32Data.length, 24000);
    buffer.getChannelData(0).set(float32Data);
    
    this.queue.push(buffer);
    this.processQueue();
  }

  private processQueue() {
    if (this.processingQueue || this.queue.length === 0 || !this.audioContext || this.audioContext.state === 'closed') return;
    
    this.processingQueue = true;
    
    // Ensure we don't schedule in the past
    const currentTime = this.audioContext.currentTime;
    if (this.nextStartTime < currentTime) {
      this.nextStartTime = currentTime;
    }

    while (this.queue.length > 0) {
      const buffer = this.queue.shift();
      if (!buffer) break;

      const source = this.audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext.destination);
      
      source.start(this.nextStartTime);
      
      // Update state tracking
      if (!this.isPlaying) {
        this.isPlaying = true;
        this.onStateChange(true);
      }

      // Schedule stop callback
      const duration = buffer.duration;
      const endTime = this.nextStartTime + duration;
      
      // We set a timeout to check if we stopped playing roughly when this chunk ends
      setTimeout(() => {
        if (this.audioContext && this.audioContext.state === 'running' && this.audioContext.currentTime >= this.nextStartTime - 0.1 && this.queue.length === 0) {
           this.isPlaying = false;
           this.onStateChange(false);
        }
      }, (endTime - currentTime) * 1000 + 100);

      this.nextStartTime += duration;
    }

    this.processingQueue = false;
  }

  stop() {
    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      if (ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    }
    this.queue = [];
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.onStateChange(false);
  }
}

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onDataAvailable: (data: string) => void;
  private onVolumeChange?: (volume: number) => void;

  constructor(onDataAvailable: (data: string) => void, onVolumeChange?: (volume: number) => void) {
    this.onDataAvailable = onDataAvailable;
    this.onVolumeChange = onVolumeChange;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000
      }});

      this.audioContext = new AudioContext({ sampleRate: 16000 });
      // IMPORTANT: Resume context for browsers that suspend it
      await this.audioContext.resume();

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      
      // 2048 buffer size = ~128ms latency, good balance
      this.processor = this.audioContext.createScriptProcessor(2048, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        
        // Calculate Volume (RMS)
        if (this.onVolumeChange) {
          let sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            sum += inputData[i] * inputData[i];
          }
          const rms = Math.sqrt(sum / inputData.length);
          // Normalize 0-1 (with boost)
          const volume = Math.min(1, rms * 5); 
          this.onVolumeChange(volume);
        }
        
        // Convert Float32 to Int16 PCM
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          // Clamp and scale
          let s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Encode bytes to Base64
        let binary = '';
        const bytes = new Uint8Array(pcmData.buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        
        this.onDataAvailable(base64);
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
    } catch (error) {
      console.error("Error starting AudioRecorder:", error);
      this.stop();
    }
  }

  stop() {
    if (this.stream) {
       this.stream.getTracks().forEach(t => t.stop());
       this.stream = null;
    }
    if (this.processor) {
       this.processor.disconnect();
       this.processor = null;
    }
    if (this.source) {
       this.source.disconnect();
       this.source = null;
    }
    if (this.audioContext) {
      const ctx = this.audioContext;
      this.audioContext = null;
      if (ctx.state !== 'closed') {
        ctx.close().catch(() => {});
      }
    }
  }
}
