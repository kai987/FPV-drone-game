export type DroneId = 'cinewhoop' | 'freestyle' | 'racer' | 'explorer';
export type DroneFrame = 'ducted' | 'x' | 'stretch-x' | 'long-range';
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
}

export const DEFAULT_DRONE_ID: DroneId = 'freestyle';
export const DRONE_CATALOG_NOTE = '四款均为虚构游戏机型。硬件与续航为参考设定，飞行性能来自游戏模拟，不代表真实产品实测。';
export const FLIGHT_BOOST_MULTIPLIER = 1.45;

export const BASE_FLIGHT_SETTINGS = Object.freeze({
  assisted: { speed: 20, climbSpeed: 10, response: 5.6, brake: 6.8, yawSpeed: 1.4, bank: 0.2 },
  sport: { speed: 34, climbSpeed: 17, response: 3.2, brake: 2.8, yawSpeed: 1.7, bank: 0.34 },
});

export const DRONES: readonly DroneSpec[] = Object.freeze([
  {
    id: 'cinewhoop', name: 'CINE 轻影', tagline: '低速从容，贴近风景', category: '涵道巡游',
    description: '紧凑涵道护圈和柔和转向，适合初次飞行与近景观察。速度较低，松开操纵后更快稳住。',
    color: '#e99a58', frame: 'ducted', wheelbaseMm: 138, propellerInches: 3, weightGrams: 410,
    battery: '4S · 850 mAh', motors: '1404 · 3800 KV', lens: '广角 150°', videoLink: '数字图传 · 1080p', enduranceMinutes: 6,
    flight: Object.freeze({ speed: 0.72, climb: 0.8, response: 1.15, brake: 1.25, yaw: 0.8, bank: 0.72 }),
  },
  {
    id: 'freestyle', name: 'FLOW 自由式', tagline: '均衡灵活，山谷全能', category: '标准 X 架',
    description: '经典 X 架和均衡响应，沿用原来的飞行手感，适合穿环与自由探索。',
    color: '#c9df55', frame: 'x', wheelbaseMm: 225, propellerInches: 5, weightGrams: 680,
    battery: '6S · 1300 mAh', motors: '2207 · 1750 KV', lens: '广角 155°', videoLink: '数字图传 · 1080p', enduranceMinutes: 8,
    flight: Object.freeze({ speed: 1, climb: 1, response: 1, brake: 1, yaw: 1, bank: 1 }),
  },
  {
    id: 'racer', name: 'RACE 疾风', tagline: '轻快凌厉，追逐计时', category: '竞速轻架',
    description: '窄机身与拉长的轻型机架，最高速度与转向更快，响应敏捷，需要更早规划路线。',
    color: '#ec6d61', frame: 'stretch-x', wheelbaseMm: 210, propellerInches: 5, weightGrams: 510,
    battery: '6S · 1050 mAh', motors: '2206 · 2000 KV', lens: '低延迟广角 165°', videoLink: '低延迟图传 · 720p', enduranceMinutes: 5,
    flight: Object.freeze({ speed: 1.35, climb: 1.25, response: 1.2, brake: 0.9, yaw: 1.35, bank: 1.18 }),
  },
  {
    id: 'explorer', name: 'RANGE 远行者', tagline: '稳健巡航，看得更远', category: '远航长机臂',
    description: '长机臂、大电池与高天线形成远航轮廓。惯性更强、转向更缓，适合沿河平稳巡航。',
    color: '#83b8c1', frame: 'long-range', wheelbaseMm: 315, propellerInches: 7, weightGrams: 980,
    battery: '6S · 3000 mAh', motors: '2806 · 1300 KV', lens: '巡航广角 145°', videoLink: '数字图传 · 1080p', enduranceMinutes: 16,
    flight: Object.freeze({ speed: 0.9, climb: 0.85, response: 0.72, brake: 0.7, yaw: 0.72, bank: 0.8 }),
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
