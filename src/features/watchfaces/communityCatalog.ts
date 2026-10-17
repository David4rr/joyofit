export interface CommunityFace {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly width: number;
  readonly height: number;
  readonly sizeLabel: string;
  readonly description: string;
  readonly downloadUrl: string;
  readonly previewUrl?: string;
  readonly category: 'Band (194x368)' | 'Round (466x466)' | 'Fit (336x480)';
  readonly tags: readonly string[];
}

/**
 * Curated list of free community .hwt watch faces.
 * Standard resolutions:
 * - 194 x 368: Huawei Band 8, Band 9, Band 10
 * - 466 x 466: Huawei Watch GT 3, GT 4, GT 5, Watch 4
 * - 336 x 480: Huawei Watch Fit 2, Fit 3
 */
export const COMMUNITY_WATCHFACES: readonly CommunityFace[] = [
  {
    id: 'nike9_sport_band',
    title: 'Nike Sport Band 9/10',
    author: 'anrinion / Community',
    width: 194,
    height: 368,
    sizeLabel: '104 KB',
    description: 'Vibrant sporty digital dial optimized for Huawei Band 9 & Band 10 with live metrics and AOD.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/band9_10/Nike9/Nike9.band9.2.1.2.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/band9_10/Nike9/cover.jpg',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Nike', 'Sport'],
  },
  {
    id: 'focus_wgt_round',
    title: 'Focus Tactical Chrono',
    author: 'anrinion / Community',
    width: 466,
    height: 466,
    sizeLabel: '338 KB',
    description: 'High-precision dual chronograph tactical dial for circular Huawei smartwatches.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_46_pro/FocusWGTru/FocusWGTru.gt6_46_pro.2.8.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/gt6_46_pro/FocusWGTru/cover.jpg',
    category: 'Round (466x466)',
    tags: ['Watch GT', 'Watch 4', 'Tactical', 'Analog'],
  },
  {
    id: 'apple_ultra_red_fit',
    title: 'Ultra Tactical Red Fit',
    author: 'anrinion / Community',
    width: 336,
    height: 480,
    sizeLabel: '205 KB',
    description: 'Night vision tactical red dial designed for rectangular AMOLED Huawei Fit series.',
    downloadUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRed/AppleUltraRed.fit4_pro.2.1.1.hwt',
    previewUrl: 'https://raw.githubusercontent.com/anrinion/huawei-watchfaces/main/fit_3_4_4pro/AppleUltraRed/screen.jpg',
    category: 'Fit (336x480)',
    tags: ['Fit 2', 'Fit 3', 'Tactical', 'AOD'],
  },
];
