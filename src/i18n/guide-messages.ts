import type { MessageCatalog } from './locale';

export const GUIDE_MESSAGES = {
  'FLIGHT MANUAL': ['フライトマニュアル', 'FLIGHT MANUAL'],
  '键盘操作提示': ['キーボード操作のヒント', 'Keyboard control hints'],
  '掌握你的方向': ['進む方向を自在に', 'Find your bearings'],
  '前后 / 平移': ['前進・後退 / 平行移動', 'Forward/back / Strafe'],
  '转向': ['旋回', 'Turn'],
  '升降': ['上昇・下降', 'Climb/descend'],
  '暂停 / 视角 / 投弹': ['一時停止 / 視点 / 爆弾投下', 'Pause / View / Drop bomb'],
  '飞行操作指南': ['飛行操作ガイド', 'Flight controls guide'],
  '从第一步，到自由飞行。': ['最初の一歩から、自由な飛行へ。', 'From your first flight to free exploration.'],
  '关闭操作指南': ['操作ガイドを閉じる', 'Close flight guide'],
  '先试试辅助模式。机身会辅助稳住，松开按键会减速；有风时仍可能缓慢漂移，需要轻推反方向修正。': [
    'まずはアシストモードを試してください。機体が安定しやすくなり、キーを離すと減速します。風があると少しずつ流されることがあるため、反対方向へ軽く操作して修正します。',
    'Try Assisted mode first. It helps stabilize the aircraft and slows down when you release the keys. Wind can still cause gentle drift; use small inputs in the opposite direction to correct it.',
  ],
  '在机库里挑选飞行伙伴': ['ハンガーで飛行の相棒を選ぶ', 'Choose your aircraft in the hangar'],
  '点击页头当前机型名称，查看六款无人机的游戏同款 3D 缩略图和完整参数。选中机型后可拖动大图旋转，用滚轮或双指缩放，点击「复位」恢复完整视角。CINE 轻影适合低速近景，FLOW 自由式均衡灵活，RACE 疾风追求速度，RANGE 远行者适合平稳巡航；VECTOR 矢量与 FALCON 游隼在运动模式下可达 260 / 360 km/h，适合开阔地带高速飞行。辅助与运动的性能按钮仅用于预览，不会修改当前飞行模式。': [
    'ページ上部の機体名をクリックすると、6 機種のゲーム内と同じ 3D サムネイルと詳細仕様を確認できます。機体を選び、大きなプレビューをドラッグして回転、ホイールやピンチで拡大縮小します。「リセット」で全体が見える表示に戻せます。CINE ライトは低速で近くの景色を楽しむ飛行、FLOW フリースタイルはバランスのよい自在な飛行、RACE 疾風は速度重視、RANGE エクスプローラーは安定した巡航に向いています。VECTOR ベクターと FALCON ハヤブサはスポーツモードでそれぞれ 260 / 360 km/h に達し、開けた場所での高速飛行に向いています。アシストとスポーツの性能ボタンは確認用で、現在の飛行モードを変更しません。',
    'Click the current aircraft name in the header to inspect six aircraft with the same 3D models used in flight and their complete specifications. Select an aircraft, drag the large preview to rotate, and scroll or pinch to zoom. Reset restores the full view. CINE Light suits slow close-up flights, FLOW Freestyle is balanced and agile, RACE Swift prioritizes speed, and RANGE Explorer cruises steadily. VECTOR Vector and FALCON Peregrine reach 260 / 360 km/h in Sport mode and suit open areas. The Assisted and Sport performance buttons only preview specifications; they do not change your current flight mode.',
  ],
  '飞行中打开机库会暂停，关闭后仍可决定何时继续；切换须明确点击「返回起点并应用」，本轮进度和弹药会重置。个人最佳按机型、飞行模式与风况分别记录。机型均为游戏改编或虚构配置，高速机的真实原型及纪录来源可在机库查看；电池、镜头、图传和续航为参考设定，当前不模拟耗电。': [
    '飛行中にハンガーを開くと一時停止し、閉じた後も好きなタイミングで再開できます。機体を変更するには「スタートに戻って適用」を押してください。この飛行の進行状況と爆弾がリセットされます。自己ベストは機体、飛行モード、風の設定ごとに記録します。機体はゲーム向けの改編または架空の設定です。高速機の実在するプロトタイプと記録の出典はハンガーで確認できます。バッテリー、レンズ、映像伝送、飛行時間は参考設定で、現在はバッテリー消費をシミュレーションしていません。',
    'Opening the hangar during flight pauses the game. After closing it, you decide when to resume. To change aircraft, explicitly choose Return to start and apply; this resets the current flight’s progress and ammunition. Personal bests are recorded separately by aircraft, flight mode and wind conditions. Models are fictional or adapted for the game. See the hangar for real high-speed prototypes and record sources. Battery, lens, video link and endurance are reference settings; battery drain is not simulated.',
  ],
  '键盘操作': ['キーボード操作', 'Keyboard controls'],
  '向前 / 向后飞行': ['前進 / 後退', 'Fly forward / backward'],
  '向左 / 向右平移': ['左 / 右へ平行移動', 'Strafe left / right'],
  '向左 / 向右转向': ['左 / 右へ旋回', 'Turn left / right'],
  '上升 / 下降': ['上昇 / 下降', 'Climb / descend'],
  '抬头 / 低头，前进方向随视角变化': ['視点を上 / 下へ。進行方向も視点に合わせて変わります', 'Look up / down; forward flight follows your view'],
  'Esc 暂停，P 暂停或继续': ['Esc で一時停止、P で一時停止・再開', 'Esc pauses; P pauses or resumes'],
  '从起点重新开始': ['スタート地点からやり直す', 'Restart from the start'],
  '循环切换追尾、俯视瞄准、第一视角': ['追尾視点・俯瞰照準・FPV 視点を順に切り替え', 'Cycle chase, top-down aim and FPV views'],
  '向下投放一枚炸弹，飞行中可投弹': ['下向きに爆弾を 1 発投下。飛行中に使えます', 'Drop one bomb downward while flying'],
  '随时切换日间 / 夜间，保留当前飞行进度': ['昼間 / 夜間を切り替え。飛行の進行状況は保持されます', 'Switch day / night while preserving flight progress'],
  '鼠标与触屏': ['マウスとタッチ操作', 'Mouse and touch controls'],
  '飞行时点击画面可启用鼠标视角，Esc 释放鼠标并暂停。手机上使用画面两侧的方向按钮，可同时操作多个方向；点击左侧「投弹」按钮投放炸弹，点击右上角的视角按钮切换俯视瞄准。': [
    '飛行中に画面をクリックするとマウス視点を使えます。Esc でマウスを解放し、一時停止します。スマートフォンでは画面両側の方向ボタンを使い、複数方向を同時に操作できます。左側の爆弾投下ボタンで投下し、右上の視点ボタンで俯瞰照準へ切り替えます。',
    'Click the flight view to enable mouse look. Esc releases the mouse and pauses. On phones, use the direction buttons on both sides; multiple directions can be held together. Use the bomb button on the left to drop a bomb and the view button at the top right to select top-down aim.',
  ],
  '迎着风，修正航迹': ['風の中で航跡を修正する', 'Correct your flight path in the wind'],
  '点击画面左上角的风况按钮，选择无风、微风、中等风或强风，以及八个基准来风方向。风向表示“从哪里吹来”，例如北风从北向南吹。起飞后实际来向会随时间平滑偏转；实时度数表示来向，小地图箭头表示吹向，暂停时冻结。机头转向后，仪表会重新显示迎风、顺风或左右前后侧风。风速也随时间、位置和高度变化。': [
    '画面左上の風設定ボタンから、無風、そよ風、中程度の風、強風と、8方向の基準風向を選べます。風向は「吹いてくる方向」で、北風なら北から南へ吹きます。離陸後は実際の風向が時間とともに滑らかに変化します。リアルタイムの角度は風が来る方向、ミニマップの矢印は吹いていく方向を示し、一時停止中は止まります。機首が変わると、計器は向かい風、追い風、左右前後からの横風を表示します。風速も時間、位置、高度によって変化します。',
    'Use the wind button at the top left to select Calm, Breeze, Moderate or Strong wind and one of eight base directions. Direction means where wind comes from: a north wind blows north to south. After takeoff, the actual direction shifts smoothly over time. Live degrees show its origin; the minimap arrow shows its destination. Both freeze while paused. Turning updates the instrument to headwind, tailwind or a crosswind from the front, rear, left or right. Wind speed also varies with time, position and altitude.',
  ],
  '迎风时地速下降，顺风时地速提高；侧风会把无人机推离航线，用 A/D 或触屏平移修正。辅助模式减轻风偏，运动模式保留更多风的影响。下方速度表显示地速，鼠标悬停可查看空速；机库速度是无风参考。打开风况设置会暂停，应用后保留位置，关闭后可继续；飞行中改变风况的这一轮不计入个人最佳。': [
    '向かい風で対地速度が下がり、追い風で上がります。横風で航路から流されたら、A/D またはタッチ操作の平行移動で修正します。アシストモードは風の影響を軽減し、スポーツモードは影響をより強く残します。下の速度計は対地速度で、マウスを合わせると対気速度を確認できます。ハンガーの速度は無風時の参考値です。風設定を開くと一時停止し、適用後も位置を保持します。閉じてから再開できます。飛行中に風を変更した場合、そのフライトは自己ベストに記録されません。',
    'Headwinds reduce ground speed and tailwinds increase it. Crosswinds push the aircraft off course; correct with A/D or touch strafe controls. Assisted mode reduces drift, while Sport mode retains more wind influence. The lower speed display shows ground speed; hover to see airspeed. Hangar speeds are calm-air references. Opening wind settings pauses the game; applying changes preserves your position, and you can resume after closing. Changing wind during a flight excludes it from personal bests.',
  ],
  '怎样完成挑战？': ['チャレンジをクリアするには？', 'How do I finish the challenge?'],
  '按顺序，从正面穿过 8 个飞行环。当前目标会亮起，小地图会标出航线。碰到地形或树木会减速，并增加 3 秒计时；自由飞行没有计时惩罚。': [
    '8 個のリングを順番に、正面から通過してください。現在の目標が光り、ミニマップに航路が表示されます。地形や木に接触すると減速し、タイムに 3 秒が加算されます。自由飛行にはタイムのペナルティがありません。',
    'Pass through eight rings in order from the front. The current target lights up and the minimap marks the route. Contact with terrain or trees slows you down and adds three seconds; free flight has no time penalty.',
  ],
  '沿河流，拜访乡间村落': ['川沿いの集落を訪ねる', 'Follow the river to rural villages'],
  '松林山谷的飞行区域为 3.6 × 3.6 公里，工厂与海港各为 7.2 × 7.2 公里。山谷包含蜿蜒河道、翡翠湖与松影湖。沿河寻找小桥和乡间小屋，牧场里有牛羊，河湖浅水里有游动的鱼。小地图可切换「航线 / 全域」；自由飞行默认显示全域。用「− / +」在 1×、2×、4×、8× 之间缩放，点击倍率恢复 1×；放大后地图跟随无人机；鼠标或手指拖动地图可自由查看其他区域，此时暂停跟随。点击「跟随」回到无人机；聚焦地图后也可用方向键平移、Home 重新跟随。全域 1× 已显示完整地图，先放大即可拖动。升高后更容易看清湖岸和远山，最高可飞到 450 米。接触水面会自动稳住机身。': [
    '松林の谷の飛行範囲は 3.6 × 3.6 km、工業地区と海港ターミナルはそれぞれ 7.2 × 7.2 km です。谷には蛇行する川、翡翠湖、松影湖があります。川沿いで小さな橋や小屋を探しましょう。牧場には牛と羊がいて、川や湖の浅い場所には魚が泳いでいます。ミニマップは「航路 / 全域」を切り替えられ、自由飛行では全域が初期表示です。「− / +」で 1×、2×、4×、8× に拡大縮小し、倍率を押すと 1× に戻ります。拡大するとドローンを追従します。マウスや指でドラッグすると、追従を止めて別の場所を見られます。「追従」でドローンに戻り、ミニマップにフォーカスした状態では方向キーで平行移動、Home で追従を再開できます。全域の 1× はマップ全体を表示しているので、先に拡大してからドラッグしてください。上昇すると湖岸や遠くの山が見やすくなり、高度 450 m まで飛べます。水面に触れると機体が自動的に安定します。',
    'Pine Valley covers 3.6 × 3.6 km; Iron Works and Sea Port each cover 7.2 × 7.2 km. The valley has winding rivers, Emerald Lake and Pine Shadow Lake. Find bridges and cabins along the river, cattle and sheep in the pastures, and fish in shallow river and lake water. Switch the minimap between Route and World; free flight defaults to World. Use − / + for 1×, 2×, 4× and 8× zoom, or click the multiplier to reset to 1×. Zoomed maps follow the aircraft. Drag with a mouse or finger to browse another area and stop following. Follow returns to the aircraft; when the map is focused, arrow keys pan and Home resumes following. World at 1× already shows the full map, so zoom in before dragging. Gain altitude for clearer views of lake shores and distant mountains, up to 450 m. Touching water automatically stabilizes the aircraft.',
  ],
  '怎样找到鱼群？': ['魚の群れを見つけるには？', 'Where can I find the fish?'],
  '选自由飞行，把小地图切到「航线」，沿河飞到木桥下游的浅蓝鱼形标记。减速悬停在水面上方约 2–8 米，按 V 切到「俯视瞄准」（手机点击右上角视角按钮），向下观察；白天更容易看清。湖里的鱼标可在「全域」查看。': [
    '自由飛行を選び、ミニマップを「航路」にして、木橋の下流にある水色の魚マークまで川沿いに飛びます。減速して水面から約 2〜8 m の高さでホバリングし、V で「俯瞰照準」へ切り替えて下を見てください。スマートフォンでは右上の視点ボタンを使います。昼間のほうが見やすく、湖の魚マークは「全域」で確認できます。',
    'Choose Free flight, switch the minimap to Route, and follow the river to the pale blue fish marker downstream from the wooden bridge. Slow down and hover about 2–8 m above the water. Press V for Top-down aim, or use the view button at the top right on phones, and look down. Fish are easier to see in daylight. Lake fish markers appear in World view.',
  ],
  '点击右上角「日间 / 夜间」或按 N，可在飞行中切换昼夜；位置、计时和弹药都会保留。': [
    '右上の「昼間 / 夜間」または N キーで、飛行中も昼夜を切り替えられます。位置、タイム、爆弾は保持されます。',
    'Use Day / Night at the top right or press N during flight. Your position, timer and ammunition are preserved.',
  ],
  '在山谷里练习投弹': ['谷で爆弾投下を練習する', 'Practice bomb drops in the valley'],
  '计时挑战和自由飞行都可投弹。按 V 切换俯视瞄准，从目标上方投放；炸弹会继承无人机的飞行速度，减速悬停更容易命中。每轮携带 6 枚，连续投弹间隔 0.45 秒，用完后自动装填 3 秒。场内有 5 个地面靶标，每个首次命中加 100 分，重新开始会重置靶标和得分。': [
    'タイムアタックでも自由飛行でも爆弾を投下できます。V で俯瞰照準に切り替え、目標の上から投下してください。爆弾はドローンの速度を引き継ぐため、減速してホバリングすると当てやすくなります。1 回の飛行で 6 発を搭載し、連続投下の間隔は 0.45 秒です。使い切ると 3 秒で自動補充します。地上の標的は 5 個で、各標的への初回命中で 100 点を獲得します。やり直すと標的とスコアがリセットされます。',
    'You can drop bombs in both Time trial and Free flight. Press V for top-down aim and release above the target. Bombs inherit aircraft velocity, so slow hovering makes hits easier. Each flight carries six bombs with a 0.45-second interval between drops. After they run out, reloading takes three seconds. There are five ground targets; the first hit on each earns 100 points. Restarting resets targets and scores.',
  ],
  '准备好了': ['準備できました', 'Ready to fly'],
} satisfies MessageCatalog;
