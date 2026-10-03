import { useEffect, useRef } from 'react';
import { X, Keyboard, MousePointer2 } from 'lucide-react';
export function Key({ children }: { children: React.ReactNode }) { return <kbd>{children}</kbd>; }
export function CompactControls() {
  return <section className="compact-controls" aria-label="键盘操作提示">
    <h3>掌握你的方向</h3>
    <div className="control-row"><div className="wasd"><Key>W</Key><span><Key>A</Key><Key>S</Key><Key>D</Key></span></div><span>前后 / 平移</span></div>
    <div className="control-row"><div className="keys"><Key>Q</Key><Key>E</Key></div><span>转向</span></div>
    <div className="control-row"><div className="keys"><Key>Space</Key><Key>Shift</Key></div><span>升降</span></div>
    <div className="control-row"><div className="keys"><Key>Esc</Key><Key>V</Key><Key>B</Key></div><span>暂停 / 视角 / 投弹</span></div>
  </section>;
}
export default function ControlsGuide({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="guide-dialog" onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="dialog-heading"><div><span className="section-index">FLIGHT MANUAL</span><h2>从第一步，到自由飞行。</h2></div><button className="icon-button" aria-label="关闭操作指南" onClick={onClose}><X size={20} /></button></div>
    <p>先试试辅助模式。机身会自动悬停，松开按键就能减速。</p>
    <div className="guide-section"><h3><Keyboard size={18} /> 键盘操作</h3><dl>
      <div><dt><Key>W</Key><Key>S</Key></dt><dd>向前 / 向后飞行</dd></div>
      <div><dt><Key>A</Key><Key>D</Key></dt><dd>向左 / 向右平移</dd></div>
      <div><dt><Key>Q</Key><Key>E</Key></dt><dd>向左 / 向右转向</dd></div>
      <div><dt><Key>Space</Key><Key>Shift</Key></dt><dd>上升 / 下降</dd></div>
      <div><dt><Key>↑</Key><Key>↓</Key></dt><dd>抬头 / 低头，前进方向随视角变化</dd></div>
      <div><dt><Key>Esc</Key><Key>P</Key></dt><dd>Esc 暂停，P 暂停或继续</dd></div>
      <div><dt><Key>R</Key></dt><dd>从起点重新开始</dd></div>
      <div><dt><Key>V</Key></dt><dd>循环切换追尾、俯视瞄准、第一视角</dd></div>
      <div><dt><Key>B</Key></dt><dd>向下投放一枚炸弹，飞行中可投弹</dd></div>
      <div><dt><Key>N</Key></dt><dd>随时切换日间 / 夜间，保留当前飞行进度</dd></div>
    </dl></div>
    <div className="guide-section"><h3><MousePointer2 size={18} /> 鼠标与触屏</h3><p>飞行时点击画面可启用鼠标视角，Esc 释放鼠标并暂停。手机上使用画面两侧的方向按钮，可同时操作多个方向；点击左侧「投弹」按钮投放炸弹，点击右上角的视角按钮切换俯视瞄准。</p></div>
    <div className="guide-note"><strong>怎样完成挑战？</strong><p>按顺序，从正面穿过 8 个飞行环。当前目标会亮起，小地图会标出航线。碰到地形或树木会减速，并增加 3 秒计时；自由飞行没有计时惩罚。</p></div>
    <div className="guide-note"><strong>沿河流，拜访乡间村落</strong><p>飞行区域为 3.6 × 3.6 公里，包含蜿蜒河道、翡翠湖与松影湖。沿河寻找小桥和乡间小屋，牧场里有牛羊，湖水里有游动的鱼。小地图可切换「航线 / 全域」；自由飞行默认显示全域。升高后更容易看清湖岸和远山，最高可飞到 450 米。接触水面会自动稳住机身。</p><p>点击右上角「日间 / 夜间」或按 N，可在飞行中切换昼夜；位置、计时和弹药都会保留。</p></div>
    <div className="guide-note"><strong>在山谷里练习投弹</strong><p>计时挑战和自由飞行都可投弹。按 V 切换俯视瞄准，从目标上方投放；炸弹会继承无人机的飞行速度，减速悬停更容易命中。每轮携带 6 枚，连续投弹间隔 0.45 秒，用完后自动装填 3 秒。场内有 5 个地面靶标，每个首次命中加 100 分，重新开始会重置靶标和得分。</p></div>
    <button className="primary-button" onClick={onClose}>准备好了</button>
  </dialog>;
}
