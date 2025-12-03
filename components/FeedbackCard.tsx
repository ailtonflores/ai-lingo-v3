import React from 'react';
import { FeedbackItem } from '../types';
import { AlertTriangle, CheckCircle, Mic, Bookmark } from 'lucide-react';

interface FeedbackCardProps {
  feedback: FeedbackItem;
  onSave?: (item: FeedbackItem) => void;
  isSaved?: boolean;
}

export const FeedbackCard: React.FC<FeedbackCardProps> = ({ feedback, onSave, isSaved = false }) => {
  const getIcon = () => {
    switch (feedback.type) {
      case 'pronunciation': return <Mic className="w-4 h-4 text-purple-600" />;
      case 'grammar': return <AlertTriangle className="w-4 h-4 text-amber-600" />;
      case 'vocabulary': return <CheckCircle className="w-4 h-4 text-blue-600" />;
    }
  };

  const getStyles = () => {
    switch (feedback.type) {
      case 'pronunciation': return { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-900' };
      case 'grammar': return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-900' };
      case 'vocabulary': return { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-900' };
    }
  };

  const style = getStyles();

  return (
    <div className={`p-3 rounded-xl border ${style.bg} ${style.border} mb-2 relative group transition-all hover:shadow-sm`}>
      <div className="flex justify-between items-start mb-1">
        <div className={`flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider ${style.text}`}>
          {getIcon()}
          <span>{feedback.type === 'pronunciation' ? 'Pronúncia' : feedback.type === 'grammar' ? 'Gramática' : 'Vocabulário'}</span>
        </div>
        
        {onSave && (
          <button 
            onClick={() => onSave(feedback)}
            className={`p-1.5 rounded-full transition-colors ${isSaved ? 'text-brand-600 bg-brand-100' : 'text-gray-400 hover:text-brand-500 hover:bg-white'}`}
            title="Salvar para revisão"
          >
            <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} />
          </button>
        )}
      </div>
      
      <div className="space-y-1 pr-6">
        <div className="text-red-500 line-through text-sm decoration-red-300 decoration-2">"{feedback.error}"</div>
        <div className="text-green-700 font-bold text-base">"{feedback.correction}"</div>
        <div className="text-gray-600 text-xs pt-1 mt-1 border-t border-black/5 leading-relaxed">
          {feedback.portugueseExplanation}
        </div>
      </div>
    </div>
  );
};