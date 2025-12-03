import React, { useEffect, useState, useRef } from 'react';

interface AvatarProps {
  isSpeaking: boolean;
  className?: string;
}

// URL Otimizada:
// fit=facearea & facepad=2.5 -> Garante que o rosto ocupe sempre a mesma proporção da imagem
const AVATAR_SRC = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?ixlib=rb-4.0.3&auto=format&fit=facearea&facepad=2.5&w=400&h=400&q=80";

export const Avatar: React.FC<AvatarProps> = ({ isSpeaking, className = '' }) => {
  const [renderOffset, setRenderOffset] = useState(0); // Estado para renderização React
  const [imageLoaded, setImageLoaded] = useState(false);
  
  // Refs para lógica de animação (evita re-renders desnecessários do React loop)
  const requestRef = useRef<number>(0);
  const currentOpenness = useRef(0); // Posição atual (0.0 a 1.0)
  const targetOpenness = useRef(0);  // Para onde a boca quer ir (0.0 a 1.0)
  const lastSyllableTime = useRef(0); // Última vez que mudamos de sílaba

  // --- Geometria Facial Calibrada ---
  const LIP_LINE_Y = 57; 
  const SIDE_CROP = 43; 
  const MOUTH_BG = "#4a2c2c"; 
  
  // Ajuste de Amplitude: Reduzido drasticamente para evitar o efeito "queixo deslocado".
  // 1.6px é sutil o suficiente para parecer vibração de fala natural.
  const MAX_AMPLITUDE_PX = 1.6; 

  const animate = (time: number) => {
    // 1. Definição do Alvo (Simulação de Sílabas)
    if (isSpeaking) {
      const now = Date.now();
      // Ritmo da fala humana (~120ms por fonema)
      if (now - lastSyllableTime.current > 120) {
        // Randomização controlada para vogais e consoantes
        const isConsonant = Math.random() < 0.25;
        targetOpenness.current = isConsonant ? 0 : 0.2 + (Math.random() * 0.8);
        lastSyllableTime.current = now;
      }
    } else {
      targetOpenness.current = 0; // Fechar boca
    }

    // 2. Interpolação Suave (Lerp)
    // Velocidade ajustada para acompanhar a menor amplitude
    const speed = 0.2;
    currentOpenness.current += (targetOpenness.current - currentOpenness.current) * speed;

    if (!isSpeaking && currentOpenness.current < 0.01) {
      currentOpenness.current = 0;
    }

    // 3. Atualizar Estado Visual
    setRenderOffset(currentOpenness.current * MAX_AMPLITUDE_PX);
    
    requestRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [isSpeaking]);

  return (
    <div className={`relative flex justify-center items-center ${className}`}>
      <div className="w-40 h-40 md:w-48 md:h-48 relative rounded-full overflow-hidden shadow-xl border-4 border-white bg-gray-100 ring-1 ring-gray-200">
        
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-50">
             <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}

        {/* --- CAMADA 1: Imagem Base (Totalmente Estática) --- */}
        <img 
          src={AVATAR_SRC} 
          alt="Avatar Base"
          onLoad={() => setImageLoaded(true)}
          className={`absolute inset-0 w-full h-full object-cover z-0 pointer-events-none select-none ${imageLoaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
        />

        {/* --- CAMADA 2: Void (Interior da Boca) --- */}
        <div 
          className="absolute z-10 rounded-full blur-[1px]" 
          style={{ 
            backgroundColor: MOUTH_BG,
            top: '57%',
            left: '48%', 
            right: '48%',
            height: '4%', 
          }}
        />

        {/* --- CAMADA 3: Patch Superior (Nariz/Lábio Superior) --- */}
        <img 
          src={AVATAR_SRC} 
          alt="Upper Lip Patch"
          className={`absolute inset-0 w-full h-full object-cover z-20 pointer-events-none select-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={{
            // Mask image para suavizar as laterais
            maskImage: 'linear-gradient(to right, transparent 5%, black 20%, black 80%, transparent 95%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 5%, black 20%, black 80%, transparent 95%)',
            clipPath: `inset(48% ${SIDE_CROP}% ${100 - (LIP_LINE_Y + 0.8)}% ${SIDE_CROP}%)` 
          }}
        />

        {/* --- CAMADA 4: Patch Inferior (Lábio Inferior - Animado) --- */}
        <img 
          src={AVATAR_SRC} 
          alt="Lower Lip Patch"
          className={`absolute inset-0 w-full h-full object-cover z-20 pointer-events-none select-none ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={{
            // Mask image para suavizar as laterais e evitar linhas duras
            maskImage: 'linear-gradient(to right, transparent 5%, black 20%, black 80%, transparent 95%)',
            WebkitMaskImage: 'linear-gradient(to right, transparent 5%, black 20%, black 80%, transparent 95%)',
            // 'round' cria a borda inferior arredondada (formato de queixo)
            clipPath: `inset(${LIP_LINE_Y}% ${SIDE_CROP}% 25% ${SIDE_CROP}% round 0 0 80% 80%)`,
            transform: `translateY(${renderOffset}px)` 
          }}
        />

        {/* Brilho Sutil (Vignette) */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-t from-black/10 to-transparent pointer-events-none z-30 opacity-50" />
      </div>
    </div>
  );
};