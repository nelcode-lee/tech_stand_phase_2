import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Settings, CheckCircle } from 'lucide-react';
import './RebuildScreen.css';

export function RebuildScreen({ onComplete }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer1 = setTimeout(() => setStep(1), 1500);
    const timer2 = setTimeout(() => setStep(2), 3000);
    const timer3 = setTimeout(() => onComplete?.(), 4500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  return (
    <div className="rebuild-screen">
      <div className="rebuild-card">
        <div className="rebuild-spinner-wrap">
          <motion.div className="rebuild-spinner-ring rebuild-spinner-bg" />
          <motion.div
            className="rebuild-spinner-ring rebuild-spinner-progress"
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
          />
          <div className="rebuild-spinner-icon">
            <Settings size={32} />
          </div>
        </div>
        <h2 className="rebuild-title">Rebuilding Document</h2>
        <p className="rebuild-subtitle">Applying your decisions and formatting...</p>
        <div className="rebuild-checklist">
          <div className="rebuild-item">
            <div className={`rebuild-check ${step >= 0 ? 'done' : ''}`}>
              <CheckCircle size={14} />
            </div>
            <span className={step >= 0 ? 'rebuild-item-done' : ''}>Applying accepted edits</span>
          </div>
          <div className="rebuild-item">
            <div className={`rebuild-check ${step >= 1 ? 'done' : ''}`}>
              <CheckCircle size={14} />
            </div>
            <span className={step >= 1 ? 'rebuild-item-done' : ''}>Reconstructing document structure</span>
          </div>
          <div className="rebuild-item">
            <div className={`rebuild-check ${step >= 2 ? 'done' : ''}`}>
              <CheckCircle size={14} />
            </div>
            <span className={step >= 2 ? 'rebuild-item-done' : ''}>Running final protocol validation</span>
          </div>
        </div>
      </div>
    </div>
  );
}
