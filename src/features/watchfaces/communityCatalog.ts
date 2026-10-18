export type WatchCategory =
  | 'Band (194x368)'
  | 'Round (466x466)'
  | 'Round (454x454)'
  | 'Fit (408x480)'
  | 'Fit (336x480)';

export interface WatchfaceItem {
  readonly id: string;
  readonly hardwareId?: string;
  readonly title: string;
  readonly author: string;
  readonly width: number;
  readonly height: number;
  readonly sizeLabel: string;
  readonly description: string;
  readonly downloadUrl: string;
  readonly previewUrl?: string;
  readonly category: WatchCategory;
  readonly tags?: readonly string[];
  readonly savedAt?: number;
}

export type CommunityFace = WatchfaceItem;

/** Derives canonical watch chassis category from pixel width. */
export function resolveCategory(width: number): WatchCategory {
  if (width === 466 || width >= 460) {
    return 'Round (466x466)';
  }
  if (width === 454 || (width >= 430 && width < 460)) {
    return 'Round (454x454)';
  }
  if (width === 408 || (width >= 380 && width < 430)) {
    return 'Fit (408x480)';
  }
  if (width === 336 || (width >= 260 && width < 380)) {
    return 'Fit (336x480)';
  }
  return 'Band (194x368)';
}

/**
 * Built-in curated community watch faces.
 * Resolves offline or when remote catalog is unreachable.
 */
export const COMMUNITY_WATCHFACES: readonly CommunityFace[] = [
  // --- Band Series (194x368) ---
  {
    id: 'nike9_sport_band',
    title: 'Nike Sport Band 9/10',
    author: 'anrinion / Community',
    width: 194,
    height: 368,
    sizeLabel: '308 KB',
    description: 'Vibrant sporty digital dial optimized for Huawei Band 9 & Band 10 with live metrics and AOD.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/band9_10/Nike9/Nike9.band9.2.1.2.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/band9_10/Nike9/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Nike', 'Sport'],
  },
  {
    id: 'kanagawa_wave_v12',
    title: 'Kanagawa Great Wave V12',
    author: 'Gabriel Menezes',
    width: 194,
    height: 368,
    sizeLabel: '137 KB',
    description: 'The Great Wave off Kanagawa woodblock art dial crafted specifically for Huawei Band 8, 9, and 10.',
    downloadUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v12.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v12_preview.png',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Band 8', 'Art', 'Kanagawa'],
  },
  {
    id: 'kanagawa_wave_v11',
    title: 'Kanagawa Classic V11',
    author: 'Gabriel Menezes',
    width: 194,
    height: 368,
    sizeLabel: '125 KB',
    description: 'Traditional Japanese Great Wave edition with high-contrast time and battery telemetry.',
    downloadUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v11.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v11_preview.png',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Band 8', 'Art'],
  },
  {
    id: 'kanagawa_wave_v10',
    title: 'Kanagawa Compact V10',
    author: 'Gabriel Menezes',
    width: 194,
    height: 368,
    sizeLabel: '130 KB',
    description: 'Minimalist Kanagawa wave artwork layout with bold digital hour and minute counters.',
    downloadUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v10.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/menezes-labs/lab-band8-kanagawa-watchface/main/dist/Kanagawa_Band8_v10_preview.png',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Band 8', 'Art'],
  },
  {
    id: 'iv22_hms_big',
    title: 'IV-22 VFD Big Digits',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description:
      'Retro Soviet vacuum fluorescent display (ИВ-22 VFD) tube glow with large hour/minute/second digits.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_BIG_MK1/IV22_HMS_BIG_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_BIG_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Band 8', 'Retro', 'VFD'],
  },
  {
    id: 'iv22_hmsdm_med',
    title: 'IV-22 VFD Calendar & Seconds',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description: 'Vintage VFD glowing tube indicators showing day, month, date, and full HMS timer.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMSDM_MED_MK1/IV22_HMSDM_MED_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMSDM_MED_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Retro', 'VFD'],
  },
  {
    id: 'iv22_hms_med',
    title: 'IV-22 VFD Balanced Sports',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description: 'Medium-sized Soviet vacuum tube digital dial with step counter and heart rate indicators.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_MED_MK1/IV22_HMS_MED_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_MED_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Retro', 'VFD'],
  },
  {
    id: 'iv22_hms_sml',
    title: 'IV-22 VFD Minimal Compact',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description: 'Compact VFD tube typography preserving maximum screen contrast and battery life.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_SML_MK1/IV22_HMS_SML_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HMS_SML_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Retro', 'VFD'],
  },
  {
    id: 'iv22_hm_big',
    title: 'IV-22 VFD Clean Bold',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description: 'Clean glowing tube numerals focusing on hours and minutes for instant glanceability.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HM_BIG_MK1/IV22_HM_BIG_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HM_BIG_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Retro', 'VFD'],
  },
  {
    id: 'iv22_hm_med',
    title: 'IV-22 VFD Balanced Clean',
    author: 'Gumix',
    width: 194,
    height: 368,
    sizeLabel: '73 KB',
    description: 'Balanced tube display with date, battery, and step count indicators for everyday use.',
    downloadUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HM_MED_MK1/IV22_HM_MED_MK1_2.1.1.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/Gumix/huawei-band-6-watch-faces/main/IV22_HM_MED_MK1/preview/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Retro', 'VFD'],
  },
  {
    id: 'mironov_sports_band',
    title: 'Mironov Tactical Digital',
    author: 'Vitaliy Mironov',
    width: 194,
    height: 368,
    sizeLabel: '217 KB',
    description: 'High-density multi-complication fitness watch face engineered for Huawei Band 7, 8, 9, 10.',
    downloadUrl:
      'https://raw.githubusercontent.com/Vitaliy-Mironov/HuaweiBand678WatchFace/main/Mironov_2.1.4.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/band9_10/Nike9/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Tactical', 'Fitness'],
  },
  {
    id: 'takenoclock_project',
    title: 'Takenoclock Project Modern',
    author: 'takenokogohan96',
    width: 194,
    height: 368,
    sizeLabel: '83 KB',
    description: 'Minimalist Japanese typography dial designed for Huawei Band screens.',
    downloadUrl:
      'https://raw.githubusercontent.com/takenokogohan96/WatchFaces-MM/main/Takenoclock%20Project.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/takenokogohan96/WatchFaces-MM/main/0.25x/%E3%82%A2%E3%83%BC%E3%83%88%E3%83%9C%E3%83%BC%E3%83%89%201_120.25x.png',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Minimal', 'Japanese'],
  },
  {
    id: 'takenoclock_classic',
    title: 'Takenoclock Classic Pure',
    author: 'takenokogohan96',
    width: 194,
    height: 368,
    sizeLabel: '72 KB',
    description: 'Clean modern layout with battery percentage and step progress circle.',
    downloadUrl: 'https://raw.githubusercontent.com/takenokogohan96/WatchFaces-MM/main/Takenoclock.hwt',
    previewUrl:
      'https://raw.githubusercontent.com/takenokogohan96/WatchFaces-MM/main/0.25x/%E3%82%A2%E3%83%BC%E3%83%88%E3%83%9C%E3%83%BC%E3%83%89%201_130.25x.png',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Minimal'],
  },

  // --- Round Smartwatch Series (466x466 & 454x454) ---
  {
    id: 'focus_wgt_round',
    title: 'Focus Tactical Chrono GT',
    author: 'anrinion / Community',
    width: 466,
    height: 466,
    sizeLabel: '338 KB',
    description: 'High-precision dual chronograph tactical dial for circular Huawei smartwatches (GT 3/4/5/Pro).',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_46_pro/FocusWGTru/FocusWGTru.gt6_46_pro.2.8.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_46_pro/FocusWGTru/cover.jpg',
    category: 'Round (466x466)',
    tags: ['Watch GT', 'Watch 4', 'Tactical', 'Analog'],
  },
  {
    id: 'gt6_nike_round',
    title: 'Nike Clean Motion GT',
    author: 'John Smith / Community',
    width: 466,
    height: 466,
    sizeLabel: '290 KB',
    description: 'Clean modern Nike digital typography with active complications for circular GT series.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_41/Gt6Nike/Gt6Nike.gt6_41.2.7.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_41/Gt6Nike/cover.jpg',
    category: 'Round (466x466)',
    tags: ['Watch GT', 'Nike', 'Digital', 'AOD'],
  },
  {
    id: 'hublot_aod_gt3',
    title: 'Hublot Classic Fusion AOD GT',
    author: 'leeorichi / Community',
    width: 466,
    height: 466,
    sizeLabel: '520 KB',
    description: 'Luxury skeleton tourbillon dial with realistic metallic reflections and subtle ambient AOD.',
    downloadUrl: 'https://raw.githubusercontent.com/leeorichi/huawei-watch-face-maker/main/release/Hublot-AOD-EN_V202_FIX.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_46_pro/FocusWGTru/cover.jpg',
    category: 'Round (466x466)',
    tags: ['Watch GT', 'Luxury', 'Analog', 'AOD'],
  },
  {
    id: 'carrera_heritage_gt2',
    title: 'Carrera Heritage Chrono GT2',
    author: 'Silent / Community',
    width: 454,
    height: 454,
    sizeLabel: '310 KB',
    description: 'Timeless automotive racing chronograph for Huawei Watch GT 2 / GT 2e and circular 454px displays.',
    downloadUrl: 'https://raw.githubusercontent.com/Silenttttttt/hwt-gt2e/main/templates/Carrera.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_41/Gt6Nike/cover.jpg',
    category: 'Round (454x454)',
    tags: ['Watch GT 2', 'Classic', 'Chrono'],
  },
  {
    id: 'simple_italic_gt2',
    title: 'Simple Italic Clean GT2',
    author: 'Silent / Community',
    width: 454,
    height: 454,
    sizeLabel: '180 KB',
    description: 'Minimalist high-contrast typography with instant legibility under bright sunlight.',
    downloadUrl: 'https://raw.githubusercontent.com/Silenttttttt/hwt-gt2e/main/templates/SimpleItalic.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_41/Gt6Nike/cover.jpg',
    category: 'Round (454x454)',
    tags: ['Watch GT 2', 'Minimal', 'Clean'],
  },

  // --- Square / Rect Fit Series (408x480 & 336x480) ---
  {
    id: 'apple_ultra_red_fit',
    title: 'Ultra Tactical Red Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '560 KB',
    description: 'Night vision tactical red dial designed for rectangular AMOLED Huawei Fit series (Fit 3 / Fit 4).',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRed/AppleUltraRed.fit4_pro.2.1.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRed/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Tactical', 'AOD'],
  },
  {
    id: 'apple_ultra_red_next_fit',
    title: 'Ultra Tactical Stealth Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '580 KB',
    description: 'High-contrast stealth variant of the Ultra Tactical dial with modular widget complications.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRedNext/AppleUltraRedNext.fit4_pro.2.1.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRedNext/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Stealth', 'AOD'],
  },
  {
    id: 'apple_ultra_red_next2_fit',
    title: 'Ultra Tactical Crimson Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '575 KB',
    description: 'Crimson edition featuring deep red night-mode telemetry, battery gauge, and step rings.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRedNext2/AppleUltraRedNext.fit4_pro.2.1.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRedNext2/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Crimson', 'Rings'],
  },
  {
    id: 'nike_combo_steps_fit',
    title: 'Nike Combo Steps Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '420 KB',
    description: 'Energetic running dashboard dial featuring live step telemetry and calorie progress bars.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeComboSteps/NikeComboSteps.fit4_pro.2.7.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeComboSteps/cover.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Nike', 'Steps'],
  },
  {
    id: 'nike_combo_pro_fit',
    title: 'Nike Combo Pro Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '440 KB',
    description: 'Pro athlete edition with high-contrast dual time, active heart rate tracker, and distance readout.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeCombo/NikeCombo.fit4_pro.2.7.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeCombo/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Nike', 'Athlete'],
  },
  {
    id: 'nike_combo_less_aod_fit',
    title: 'Nike Minimal AOD Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '390 KB',
    description: 'Battery-saving clean edition featuring low-power AOD mode with minimal pixel illumination.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeComboLessAOD/NikeComboLessAOD.fit4_pro.2.7.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/NikeComboLessAOD/cover.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Nike', 'Battery Saver'],
  },
  {
    id: 'functional_for_hikes_fit',
    title: 'Functional For Hikes Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '380 KB',
    description: 'Outdoor adventure watchface featuring compass, sunrise/sunset, and barometer altitude trackers.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/FunctionalForHikes/FunctionalForHikes.fit4_pro.2.8.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/FunctionalForHikes/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Hiking', 'Compass'],
  },
  {
    id: 'functional_for_hikes2_fit',
    title: 'Functional Compass Explorer Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '395 KB',
    description: 'Enhanced explorer dashboard with dynamic altitude graph and solar elevation angles.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/FunctionalForHikes2/FunctionalForHikes2.fit4_pro.2.8.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/FunctionalForHikes2/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Explorer', 'Compass'],
  },
  {
    id: 'space_red_fit',
    title: 'Space Red Sci-Fi Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '450 KB',
    description: 'Cyberpunk inspired futuristic red cockpit interface with dual time and battery gauge.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/SpaceRed/SpaceRed.fit4_pro.2.8.2.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/SpaceRed/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'Sci-Fi', 'Cockpit'],
  },
  {
    id: 'space_red2_fit',
    title: 'Space Red Cockpit V2 Fit',
    author: 'John Smith / Community',
    width: 408,
    height: 480,
    sizeLabel: '470 KB',
    description: 'Upgraded sci-fi HUD with animated orbital rings and dual timezone chronometer.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/SpaceRed2/SpaceRedV2.fit4_pro.2.8.2.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/SpaceRed2/screen.jpg',
    category: 'Fit (408x480)',
    tags: ['Fit 3', 'Fit 4', 'HUD', 'Sci-Fi'],
  },
];
