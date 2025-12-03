
import React, { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, RemoteTrack, RemoteTrackPublication, Track } from 'livekit-client';

interface RealtimeAvatarProps {
  url: string;
  token: string;
  className?: string;
}

export const RealtimeAvatar: React.FC<RealtimeAvatarProps> = ({ url, token, className = '' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let room: Room | null = null;

    const connectToRoom = async () => {
      try {
        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          videoCaptureDefaults: {
            resolution: { width: 1280, height: 720 },
          },
        });

        // Configura listeners para as trilhas (Tracks) de vídeo e áudio
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, publication: RemoteTrackPublication) => {
          console.log('LiveKit: Track subscribed', track.kind);
          if (track.kind === Track.Kind.Video) {
            if (videoRef.current) {
              track.attach(videoRef.current);
            }
          } else if (track.kind === Track.Kind.Audio) {
            if (audioRef.current) {
              track.attach(audioRef.current);
            }
          }
        });

        room.on(RoomEvent.Disconnected, () => {
          console.log('LiveKit: Disconnected');
          setIsConnected(false);
        });

        console.log('LiveKit: Connecting to', url);
        await room.connect(url, token);
        console.log('LiveKit: Connected successfully');
        setIsConnected(true);

      } catch (err) {
        console.error('LiveKit Connection Error:', err);
        setError('Falha ao conectar ao vídeo do avatar.');
      }
    };

    if (url && token) {
      connectToRoom();
    }

    return () => {
      if (room) {
        room.disconnect();
      }
    };
  }, [url, token]);

  return (
    <div className={`relative overflow-hidden bg-gray-900 rounded-2xl shadow-2xl ${className}`}>
      {/* Indicador de Carregamento */}
      {!isConnected && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/50 text-white">
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            <span className="text-sm font-medium">Conectando Avatar...</span>
          </div>
        </div>
      )}

      {/* Mensagem de Erro */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-black/80 text-white p-4 text-center">
          <span className="text-red-400 text-sm">{error}</span>
        </div>
      )}

      {/* Elementos de Mídia */}
      <video 
        ref={videoRef} 
        className="w-full h-full object-cover" 
        autoPlay 
        playsInline 
        muted={true} // O vídeo deve ser mudo para não duplicar áudio ou causar eco, o audio vem da tag audio
      />
      <audio 
        ref={audioRef} 
        autoPlay 
      />
      
      {/* Overlay Visual para Acabamento */}
      <div className="absolute inset-0 pointer-events-none ring-1 ring-white/10 rounded-2xl"></div>
    </div>
  );
};
