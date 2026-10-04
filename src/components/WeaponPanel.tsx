import { Bomb, Crosshair } from 'lucide-react';
import type { Status } from '../game/types';
import { useI18n } from '../i18n/context';
import './WeaponPanel.css';

interface WeaponPanelProps {
  ammo: number;
  reloadRemaining: number;
  score: number;
  hits: number;
  status: Status;
  onDrop: () => void;
}

export default function WeaponPanel({ ammo, reloadRemaining, score, hits, status, onDrop }: WeaponPanelProps) {
  const { t } = useI18n();
  const remaining = Math.max(0, Math.min(6, Math.trunc(ammo)));
  const reloading = reloadRemaining > 0;
  const disabled = status !== 'flying' || remaining === 0 || reloading;

  return (
    <section className={`weapon-panel${reloading ? ' weapon-panel-reloading' : ''}`} aria-label={t('无人机投弹系统')}>
      <div className="weapon-panel-heading">
        <Bomb size={13} strokeWidth={1.7} aria-hidden="true" />
        <span>{t('投弹系统')}</span>
        <small>{t(reloading ? '装填中' : status === 'flying' ? '就绪' : '待命')}</small>
      </div>
      <div className="weapon-panel-readout">
        <div className="weapon-panel-ammo" aria-label={t('剩余炸弹 {count} 枚，共 6 枚', { count: remaining })}>
          <div><strong>{String(remaining).padStart(2, '0')}</strong><span>/ 06</span></div>
          <div className="weapon-panel-rounds" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <i className={index < remaining ? 'loaded' : ''} key={index} />)}
          </div>
        </div>
        <dl className="weapon-panel-stats">
          <div><dt><Crosshair size={10} strokeWidth={1.8} aria-hidden="true" />{t('命中')}</dt><dd>{hits}<span>/ 5</span></dd></div>
          <div><dt>{t('得分')}</dt><dd>{score}</dd></div>
        </dl>
      </div>
      <button
        className="weapon-panel-drop"
        type="button"
        aria-label={t('投弹')}
        title={t('投弹（B）；按 V 切换俯视瞄准')}
        disabled={disabled}
        onClick={onDrop}
      >
        <Bomb size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{reloading ? t('装填 {seconds} s', { seconds: Math.max(0, reloadRemaining).toFixed(1) }) : t('投弹')}</span>
        <kbd aria-hidden="true">B</kbd>
      </button>
      <p className="weapon-panel-hint"><span>V</span> {t('切换俯视瞄准')}</p>
    </section>
  );
}
