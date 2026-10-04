import { useEffect, useRef } from 'react';
import { X, Keyboard, MousePointer2 } from 'lucide-react';
import { useI18n } from '../i18n/context';
export function Key({ children }: { children: React.ReactNode }) { return <kbd>{children}</kbd>; }
export function CompactControls() {
  const { t } = useI18n();
  return <section className="compact-controls" aria-label={t("键盘操作提示")}>
    <h3>{t("掌握你的方向")}</h3>
    <div className="control-row"><div className="wasd"><Key>W</Key><span><Key>A</Key><Key>S</Key><Key>D</Key></span></div><span>{t("前后 / 平移")}</span></div>
    <div className="control-row"><div className="keys"><Key>Q</Key><Key>E</Key></div><span>{t("转向")}</span></div>
    <div className="control-row"><div className="keys"><Key>Space</Key><Key>Shift</Key></div><span>{t("升降")}</span></div>
    <div className="control-row"><div className="keys"><Key>Esc</Key><Key>V</Key><Key>B</Key></div><span>{t("暂停 / 视角 / 投弹")}</span></div>
  </section>;
}
export default function ControlsGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal(); closeButton.current?.focus({ preventScroll: true });
    return () => { dialog?.close(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="guide-dialog" aria-label={t("飞行操作指南")}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}
    onKeyUp={event => event.stopPropagation()} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div className="dialog-heading"><div><span className="section-index">{t("FLIGHT MANUAL")}</span><h2>{t("从第一步，到自由飞行。")}</h2></div><button ref={closeButton} className="icon-button" aria-label={t("关闭操作指南")} onClick={onClose}><X size={20} /></button></div>
    <p>{t("先试试辅助模式。机身会辅助稳住，松开按键会减速；有风时仍可能缓慢漂移，需要轻推反方向修正。")}</p>
    <div className="guide-note"><strong>{t("在机库里挑选飞行伙伴")}</strong><p>{t("点击页头当前机型名称，查看六款无人机的游戏同款 3D 缩略图和完整参数。选中机型后可拖动大图旋转，用滚轮或双指缩放，点击「复位」恢复完整视角。CINE 轻影适合低速近景，FLOW 自由式均衡灵活，RACE 疾风追求速度，RANGE 远行者适合平稳巡航；VECTOR 矢量与 FALCON 游隼在运动模式下可达 260 / 360 km/h，适合开阔地带高速飞行。辅助与运动的性能按钮仅用于预览，不会修改当前飞行模式。")}</p><p>{t("飞行中打开机库会暂停，关闭后仍可决定何时继续；切换须明确点击「返回起点并应用」，本轮进度和弹药会重置。个人最佳按机型、飞行模式与风况分别记录。机型均为游戏改编或虚构配置，高速机的真实原型及纪录来源可在机库查看；电池、镜头、图传和续航为参考设定，当前不模拟耗电。")}</p></div>
    <div className="guide-section"><h3><Keyboard size={18} /> {t("键盘操作")}</h3><dl>
      <div><dt><Key>W</Key><Key>S</Key></dt><dd>{t("向前 / 向后飞行")}</dd></div>
      <div><dt><Key>A</Key><Key>D</Key></dt><dd>{t("向左 / 向右平移")}</dd></div>
      <div><dt><Key>Q</Key><Key>E</Key></dt><dd>{t("向左 / 向右转向")}</dd></div>
      <div><dt><Key>Space</Key><Key>Shift</Key></dt><dd>{t("上升 / 下降")}</dd></div>
      <div><dt><Key>↑</Key><Key>↓</Key></dt><dd>{t("抬头 / 低头，前进方向随视角变化")}</dd></div>
      <div><dt><Key>Esc</Key><Key>P</Key></dt><dd>{t("Esc 暂停，P 暂停或继续")}</dd></div>
      <div><dt><Key>R</Key></dt><dd>{t("从起点重新开始")}</dd></div>
      <div><dt><Key>V</Key></dt><dd>{t("循环切换追尾、俯视瞄准、第一视角")}</dd></div>
      <div><dt><Key>B</Key></dt><dd>{t("向下投放一枚炸弹，飞行中可投弹")}</dd></div>
      <div><dt><Key>N</Key></dt><dd>{t("随时切换日间 / 夜间，保留当前飞行进度")}</dd></div>
    </dl></div>
    <div className="guide-section"><h3><MousePointer2 size={18} /> {t("鼠标与触屏")}</h3><p>{t("飞行时点击画面可启用鼠标视角，Esc 释放鼠标并暂停。手机上使用画面两侧的方向按钮，可同时操作多个方向；点击左侧「投弹」按钮投放炸弹，点击右上角的视角按钮切换俯视瞄准。")}</p></div>
    <div className="guide-note"><strong>{t("迎着风，修正航迹")}</strong><p>{t("点击画面左上角的风况按钮，选择无风、微风、中等风或强风，以及八个来风方向。风向按“从哪里吹来”标注，例如北风从北向南吹；机头转向后，仪表会重新显示迎风、顺风或左右前后侧风。阵风随时间、位置和高度平滑变化。")}</p><p>{t("迎风时地速下降，顺风时地速提高；侧风会把无人机推离航线，用 A/D 或触屏平移修正。辅助模式减轻风偏，运动模式保留更多风的影响。下方速度表显示地速，鼠标悬停可查看空速；机库速度是无风参考。打开风况设置会暂停，应用后保留位置，关闭后可继续；飞行中改变风况的这一轮不计入个人最佳。")}</p></div>
    <div className="guide-note"><strong>{t("怎样完成挑战？")}</strong><p>{t("按顺序，从正面穿过 8 个飞行环。当前目标会亮起，小地图会标出航线。碰到地形或树木会减速，并增加 3 秒计时；自由飞行没有计时惩罚。")}</p></div>
    <div className="guide-note"><strong>{t("沿河流，拜访乡间村落")}</strong><p>{t("松林山谷的飞行区域为 3.6 × 3.6 公里，工厂与海港各为 7.2 × 7.2 公里。山谷包含蜿蜒河道、翡翠湖与松影湖。沿河寻找小桥和乡间小屋，牧场里有牛羊，河湖浅水里有游动的鱼。小地图可切换「航线 / 全域」；自由飞行默认显示全域。用「− / +」在 1×、2×、4×、8× 之间缩放，点击倍率恢复 1×；放大后地图跟随无人机；鼠标或手指拖动地图可自由查看其他区域，此时暂停跟随。点击「跟随」回到无人机；聚焦地图后也可用方向键平移、Home 重新跟随。全域 1× 已显示完整地图，先放大即可拖动。升高后更容易看清湖岸和远山，最高可飞到 450 米。接触水面会自动稳住机身。")}</p><p><strong>{t("怎样找到鱼群？")}</strong>{t("选自由飞行，把小地图切到「航线」，沿河飞到木桥下游的浅蓝鱼形标记。减速悬停在水面上方约 2–8 米，按 V 切到「俯视瞄准」（手机点击右上角视角按钮），向下观察；白天更容易看清。湖里的鱼标可在「全域」查看。")}</p><p>{t("点击右上角「日间 / 夜间」或按 N，可在飞行中切换昼夜；位置、计时和弹药都会保留。")}</p></div>
    <div className="guide-note"><strong>{t("在山谷里练习投弹")}</strong><p>{t("计时挑战和自由飞行都可投弹。按 V 切换俯视瞄准，从目标上方投放；炸弹会继承无人机的飞行速度，减速悬停更容易命中。每轮携带 6 枚，连续投弹间隔 0.45 秒，用完后自动装填 3 秒。场内有 5 个地面靶标，每个首次命中加 100 分，重新开始会重置靶标和得分。")}</p></div>
    <button className="primary-button" onClick={onClose}>{t("准备好了")}</button>
  </dialog>;
}
