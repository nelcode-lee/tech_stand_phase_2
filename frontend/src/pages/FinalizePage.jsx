import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RebuildScreen } from '../components/RebuildScreen';

export default function FinalizePage({ mode = 'review' }) {
  const navigate = useNavigate();
  const [rebuilding, setRebuilding] = useState(true);

  function handleRebuildComplete() {
    setRebuilding(false);
    setTimeout(() => navigate('/library'), 800);
  }

  if (rebuilding) {
    return <RebuildScreen onComplete={handleRebuildComplete} mode={mode} />;
  }

  return null;
}
