import router from '@system.router';
import { ZONE_LABELS } from '../../common/fuel.js';
import { fatBarPx, formatBpm, formatDuration, formatGrams, formatKcal, formatPercent } from '../../common/format.js';
import { LAST_KEY, loadJson } from '../../common/store.js';

var BAR_W = 360;

export default {
  data: {
    title: 'Session summary',
    elapsed: '0:00',
    kcal: '0',
    fat: '0.0',
    carbs: '0.0',
    fatLabel: 'FAT',
    carbLabel: 'CARBS',
    fatPx: BAR_W / 2,
    carbPx: BAR_W / 2,
    avgHr: '--',
    maxHr: '--',
    zones: [],
    note: 'Estimate from heart rate. The watch does not measure fat or carbs.',
  },

  onInit() {
    var page = this;
    loadJson(LAST_KEY, function (last) {
      if (!last || !last.summary) {
        page.title = 'No finished session';
        return;
      }
      page.show(last.summary);
    });
  },

  show(s) {
    this.elapsed = formatDuration(s.elapsedSec);
    this.kcal = formatKcal(s.kcal);
    this.fat = formatGrams(s.fatGrams);
    this.carbs = formatGrams(s.carbGrams);
    this.fatLabel = 'FAT ' + formatPercent(s.fatShare);
    this.carbLabel = 'CARBS ' + formatPercent(s.fatShare === null ? null : 1 - s.fatShare);
    var fatPx = fatBarPx(s.fatShare, BAR_W);
    this.fatPx = fatPx;
    this.carbPx = BAR_W - fatPx;
    this.avgHr = formatBpm(s.avgHr);
    this.maxHr = formatBpm(s.maxHr);
    var rows = [];
    for (var z = 0; z < s.zoneSeconds.length; z++) {
      if (s.zoneSeconds[z] >= 1) rows.push({ zone: z, name: ZONE_LABELS[z], time: formatDuration(s.zoneSeconds[z]) });
    }
    this.zones = rows;
    this.note = 'Estimate from heart rate, max ' + s.profile.maxHr + ' bpm. The watch does not measure fat or carbs.';
  },

  done() {
    router.replace({ uri: 'pages/index/index' });
  },
};
