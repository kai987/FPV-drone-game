import { Bomb, Crosshair } from 'lucide-react';
import type { Status } from '../game/types';
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
  const remaining = Math.max(0, Math.min(6, Math.trunc(ammo)));
  const reloading = reloadRemaining > 0;
  const disabled = status !== 'flying' || remaining === 0 || reloading;

  return (
    <section className={`weapon-panel${reloading ? ' weapon-panel-reloading' : ''}`} aria-label="无人机投弹系统">
      <div className="weapon-panel-heading">
        <Bomb size={13} strokeWidth={1.7} aria-hidden="true" />
        <span>投弹系统</span>
        <small>{reloading ? '装填中' : status === 'flying' ? '就绪' : '待命'}</small>
      </div>
      <div className="weapon-panel-readout">
        <div className="weapon-panel-ammo" aria-label={`剩余炸弹 ${remaining} 枚，共 6 枚`}>
          <div><strong>{String(remaining).padStart(2, '0')}</strong><span>/ 06</span></div>
          <div className="weapon-panel-rounds" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <i className={index < remaining ? 'loaded' : ''} key={index} />)}
          </div>
        </div>
        <dl className="weapon-panel-stats">
          <div><dt><Crosshair size={10} strokeWidth={1.8} aria-hidden="true" />命中</dt><dd>{hits}<span>/ 5</span></dd></div>
          <div><dt>得分</dt><dd>{score}</dd></div>
        </dl>
      </div>
      <button
        className="weapon-panel-drop"
        type="button"
        aria-label="投弹"
        title="投弹（B）；按 V 切换俯视瞄准"
        disabled={disabled}
        onClick={onDrop}
      >
        <Bomb size={16} strokeWidth={1.8} aria-hidden="true" />
        <span>{reloading ? `装填 ${Math.max(0, reloadRemaining).toFixed(1)} s` : '投弹'}</span>
        <kbd aria-hidden="true">B</kbd>
      </button>
      <p className="weapon-panel-hint"><span>V</span> 切换俯视瞄准</p>
    </section>
  );
}
