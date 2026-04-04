import { PHASE_PRIMARY_FOCUS, DRAFT_ASSISTIVE_LINE } from '../config/productPhase';
import './PhasePositioningBanner.css';

/**
 * @param {'banner' | 'compact'} variant
 */
export function PhasePositioningBanner({ variant = 'banner', className = '' }) {
  if (variant === 'compact') {
    return (
      <p className={`phase-positioning-compact ${className}`.trim()} role="note">
        <strong>Phase focus:</strong> {PHASE_PRIMARY_FOCUS}{' '}
        <span className="phase-positioning-draft">{DRAFT_ASSISTIVE_LINE}</span>
      </p>
    );
  }
  return (
    <div className={`phase-positioning-banner ${className}`.trim()} role="note">
      <strong className="phase-positioning-banner-title">Phase positioning</strong>
      <p className="phase-positioning-banner-p">{PHASE_PRIMARY_FOCUS}</p>
      <p className="phase-positioning-banner-p phase-positioning-banner-muted">{DRAFT_ASSISTIVE_LINE}</p>
    </div>
  );
}
