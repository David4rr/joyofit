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
    id: 'minimal_dark_band',
    title: 'Minimal Dark AMOLED',
    author: 'Huawei Community',
    width: 194,
    height: 368,
    sizeLabel: '340 KB',
    description: 'Clean battery-efficient digital clock with battery percentage, steps, and HR.',
    downloadUrl: 'https://raw.githubusercontent.com/thestr4ng3r/huawei-watchface/master/examples/minimal_band.hwt',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Minimal', 'AMOLED'],
  },
  {
    id: 'cyber_sport_band',
    title: 'Cyber Sport Neon',
    author: 'FitDesignLab',
    width: 194,
    height: 368,
    sizeLabel: '520 KB',
    description: 'High contrast neon sporty dial with live calorie ring, pulse monitor, and weather icon.',
    downloadUrl: 'https://raw.githubusercontent.com/thestr4ng3r/huawei-watchface/master/examples/cyber_sport.hwt',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 9', 'Sport', 'Neon'],
  },
  {
    id: 'retro_digital_band',
    title: 'Retro Casio Digital',
    author: 'VintageWatchMods',
    width: 194,
    height: 368,
    sizeLabel: '280 KB',
    description: 'Nostalgic 80s LCD watch aesthetic with step counter and date display.',
    downloadUrl: 'https://raw.githubusercontent.com/thestr4ng3r/huawei-watchface/master/examples/retro_digital.hwt',
    category: 'Band (194x368)',
    tags: ['Band 10', 'Band 8/9', 'Retro', 'Classic'],
  },
  {
    id: 'gt_tactical_chrono',
    title: 'Tactical Chrono GT',
    author: 'AeroWatch',
    width: 466,
    height: 466,
    sizeLabel: '1.2 MB',
    description: 'Military-inspired dual analog chronograph with altimeter and weather sub-dials.',
    downloadUrl: 'https://raw.githubusercontent.com/thestr4ng3r/huawei-watchface/master/examples/tactical_chrono.hwt',
    category: 'Round (466x466)',
    tags: ['Watch GT', 'Watch 4', 'Tactical', 'Analog'],
  },
  {
    id: 'modern_fit_rings',
    title: 'Activity Rings Fit',
    author: 'CleanWear',
    width: 336,
    height: 480,
    sizeLabel: '640 KB',
    description: 'Tri-color activity rings with large typography for rectangular displays.',
    downloadUrl: 'https://raw.githubusercontent.com/thestr4ng3r/huawei-watchface/master/examples/activity_rings.hwt',
    category: 'Fit (336x480)',
    tags: ['Fit 2', 'Fit 3', 'Activity', 'Modern'],
  },
];
