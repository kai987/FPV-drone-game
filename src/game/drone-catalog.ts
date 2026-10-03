export type DroneId = 'cinewhoop' | 'freestyle' | 'racer' | 'explorer' | 'vector' | 'falcon';
export type DroneFrame = 'ducted' | 'x' | 'stretch-x' | 'long-range' | 'speed-x' | 'streamlined';
export type DroneFlightMode = 'assisted' | 'sport';

/** Multipliers applied to the shared arcade flight simulation, not hardware measurements. */
export interface DroneProfile {
  speed: number;
  climb: number;
  response: number;
  brake: number;
  yaw: number;
  bank: number;
}

export interface DroneSpec {
  id: DroneId;
  name: string;
  tagline: string;
  category: string;
  description: string;
  color: string;
  frame: DroneFrame;
  wheelbaseMm: number;
  propellerInches: number;
  weightGrams: number;
  battery: string;
  motors: string;
  lens: string;
  videoLink: string;
  enduranceMinutes: number;
  flight: Readonly<DroneProfile>;
  reference?: {
    name: string;
    speedKmh: number;
    speedLabel: string;
    summary: string;
    url: string;
    source: string;
  };
}

export const DEFAULT_DRONE_ID: DroneId = 'freestyle';
export const DRONE_CATALOG_NOTE = '全部均为虚构游戏机型，硬件与续航是虚构游戏设定。高速机型受到真实原型启发，外形经过游戏改编；游戏飞行性能不代表真实世界纪录或真实产品实测。';
export const FLIGHT_BOOST_MULTIPLIER = 1.45;

export const BASE_FLIGHT_SETTINGS = Object.freeze({
  assisted: { speed: 20, climbSpeed: 10, response: 5.6, brake: 6.8, yawSpeed: 1.4, bank: 0.2 },
  sport: { speed: 34, climbSpeed: 17, response: 3.2, brake: 2.8, yawSpeed: 1.7, bank: 0.34 },
});

export const DRONES: readonly DroneSpec[] = Object.freeze([
  {
    id: 'cinewhoop', name: 'CINE 轻影', tagline: '低速从容，贴近风景', category: '涵道巡游',
    description: '紧凑涵道护圈和柔和转向，适合初次飞行与近景观察。速度较低，松开操纵后更快稳住。',
    color: '#ee8d39', frame: 'ducted', wheelbaseMm: 138, propellerInches: 3, weightGrams: 410,
    battery: '4S · 850 mAh', motors: '1404 · 3800 KV', lens: '广角 150°', videoLink: '数字图传 · 1080p', enduranceMinutes: 6,
    flight: Object.freeze({ speed: 0.72, climb: 0.8, response: 1.15, brake: 1.25, yaw: 0.8, bank: 0.72 }),
  },
  {
    id: 'freestyle', name: 'FLOW 自由式', tagline: '均衡灵活，山谷全能', category: '标准 X 架',
    description: '经典 X 架和均衡响应，沿用原来的飞行手感，适合穿环与自由探索。',
    color: '#b8d83b', frame: 'x', wheelbaseMm: 225, propellerInches: 5, weightGrams: 680,
    battery: '6S · 1300 mAh', motors: '2207 · 1750 KV', lens: '广角 155°', videoLink: '数字图传 · 1080p', enduranceMinutes: 8,
    flight: Object.freeze({ speed: 1, climb: 1, response: 1, brake: 1, yaw: 1, bank: 1 }),
  },
  {
    id: 'racer', name: 'RACE 疾风', tagline: '轻快凌厉，追逐计时', category: '竞速轻架',
    description: '窄机身与拉长的轻型机架，最高速度与转向更快，响应敏捷，需要更早规划路线。',
    color: '#da4b43', frame: 'stretch-x', wheelbaseMm: 210, propellerInches: 5, weightGrams: 510,
    battery: '6S · 1050 mAh', motors: '2206 · 2000 KV', lens: '低延迟广角 165°', videoLink: '低延迟图传 · 720p', enduranceMinutes: 5,
    flight: Object.freeze({ speed: 1.35, climb: 1.25, response: 1.2, brake: 0.9, yaw: 1.35, bank: 1.18 }),
  },
  {
    id: 'explorer', name: 'RANGE 远行者', tagline: '稳健巡航，看得更远', category: '远航长机臂',
    description: '长机臂、大电池与高天线形成远航轮廓。惯性更强、转向更缓，适合沿河平稳巡航。',
    color: '#4e9bd6', frame: 'long-range', wheelbaseMm: 315, propellerInches: 7, weightGrams: 980,
    battery: '6S · 3000 mAh', motors: '2806 · 1300 KV', lens: '巡航广角 145°', videoLink: '数字图传 · 1080p', enduranceMinutes: 16,
    flight: Object.freeze({ speed: 0.9, climb: 0.85, response: 0.72, brake: 0.7, yaw: 0.72, bank: 0.8 }),
  },
  {
    id: 'vector', name: 'VECTOR 矢量', tagline: '低伏加速，直线追风', category: '高速对称 X 架',
    description: '受到 DRL RacerX 速度纪录启发的虚构游戏改编。低矮整流罩与对称 X 架，运动模式可达 260 km/h；转向比轻型竞速机更沉稳，需要提早收油。',
    color: '#49c8cd', frame: 'speed-x', wheelbaseMm: 250, propellerInches: 6, weightGrams: 840,
    battery: '6S · 1800 mAh', motors: '2308 · 1950 KV', lens: '速度广角 158°', videoLink: '低延迟图传 · 1080p', enduranceMinutes: 5,
    flight: Object.freeze({ speed: 260 / 122.4, climb: 1.25, response: 0.98, brake: 0.92, yaw: 1.04, bank: 1.04 }),
    reference: {
      name: 'DRL RacerX', speedKmh: 263.1, speedLabel: '2017 年纪录速度',
      summary: '100 米往返纪录，163.5 mph，约 263 km/h。',
      url: 'https://www.guinnessworldrecords.com/news/commercial/2017/7/the-drone-racing-league-builds-the-worlds-fastest-racing-drone-482701',
      source: 'Guinness World Records',
    },
  },
  {
    id: 'falcon', name: 'FALCON 游隼', tagline: '流线长躯，极速巡航', category: '流线速度原型',
    description: '受到 Peregreen V4 原型启发的虚构游戏改编。流线机身、电机舱与尾翼形成独特轮廓，运动模式可达 360 km/h；惯性更强，转弯时适合先减速。',
    color: '#cfa14c', frame: 'streamlined', wheelbaseMm: 305, propellerInches: 7, weightGrams: 1180,
    battery: '8S · 2200 mAh', motors: '2808 · 1550 KV', lens: '巡航广角 152°', videoLink: '数字图传 · 1080p', enduranceMinutes: 4,
    flight: Object.freeze({ speed: 360 / 122.4, climb: 1.18, response: 0.9, brake: 0.85, yaw: 0.95, bank: 0.96 }),
    reference: {
      name: 'Peregreen V4', speedKmh: 657, speedLabel: '原型纪录速度',
      summary: '项目合作方记载的平均纪录速度约 657 km/h。',
      url: 'https://airshaper.com/cases/peregreen-v4-fastest-drone', source: 'AirShaper 项目案例',
    },
  },
]);

export function getDroneSpec(id: DroneId | string): DroneSpec {
  return DRONES.find(drone => drone.id === id) ?? DRONES.find(drone => drone.id === DEFAULT_DRONE_ID)!;
}

export interface DroneFlightConfig {
  speed: number;
  climbSpeed: number;
  response: number;
  brake: number;
  yawSpeed: number;
  bank: number;
  initialAcceleration: number;
  responseTime: number;
}

/** Shared values for both flight physics and the hangar. Speed is metres/second. */
export function resolveFlightConfig(profile: Readonly<DroneProfile>, mode: DroneFlightMode, boost = false): DroneFlightConfig {
  const base = BASE_FLIGHT_SETTINGS[mode];
  const speed = base.speed * profile.speed * (boost ? FLIGHT_BOOST_MULTIPLIER : 1);
  const response = base.response * profile.response;
  return {
    speed, climbSpeed: base.climbSpeed * profile.climb, response,
    brake: base.brake * profile.brake, yawSpeed: base.yawSpeed * profile.yaw, bank: base.bank * profile.bank,
    initialAcceleration: speed * response, responseTime: 1 / response,
  };
}

/** Ordinary assisted/sport performance by default; boost is separately opt-in. */
export function getFlightConfig(id: DroneId | string, mode: DroneFlightMode, boost = false): DroneFlightConfig {
  return resolveFlightConfig(getDroneSpec(id).flight, mode, boost);
}

export const getFlightSettings = getFlightConfig;
