import { ArrowLeft, Play } from "lucide-react";

import type { Game } from "../game.ts";
import { formatKm, formatTime } from "../format.ts";
import { useT, type TKey } from "../i18n.ts";
import { ROUTES } from "../routes.ts";
import { loadGhost } from "../storage.ts";
import { QUALITY_IDS, type QualityId } from "../theme.ts";
import { routeStats } from "../track.ts";
import { useGame } from "./hooks.ts";
import { Profile } from "./Profile.tsx";

interface Props {
  game: Game;
  quality: QualityId;
  onQuality: (q: QualityId) => void;
}

export function RouteScreen({ game, quality, onQuality }: Props) {
  useGame(game);
  const { t } = useT();

  return (
    <section className="rd-screen rd-routes" aria-labelledby="rd-routes-title">
      <header className="rd-routes-head">
        <button type="button" className="rd-btn rd-btn-quiet" onClick={() => game.backToPair()}>
          <ArrowLeft aria-hidden="true" />
          {t("routes.back")}
        </button>
        <h1 id="rd-routes-title" className="rd-title rd-title-sm">
          {t("routes.title")}
        </h1>
        <div className="rd-seg" role="radiogroup" aria-label={t("routes.quality")}>
          {QUALITY_IDS.map((q) => (
            <button
              key={q}
              type="button"
              role="radio"
              aria-checked={quality === q}
              className={quality === q ? "is-on" : ""}
              onClick={() => onQuality(q)}
            >
              {t(`routes.quality.${q}` as TKey)}
            </button>
          ))}
        </div>
      </header>

      <div className="rd-route-list" role="radiogroup" aria-label={t("routes.title")}>
        {ROUTES.map((route) => {
          const stats = routeStats(route);
          const best = loadGhost(route.id);
          const selected = game.route.id === route.id;
          return (
            <button
              key={route.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`rd-route ${selected ? "is-on" : ""}`}
              onClick={() => game.selectRoute(route.id)}
              onDoubleClick={() => game.startRide()}
            >
              <span className="rd-route-top">
                <span className="rd-route-name">{route.name}</span>
                <span className="rd-route-km">{formatKm(route.lengthM, 1)} km</span>
              </span>
              <Profile route={route} segments label={`${t("hud.profile")}: ${route.name}`} className="rd-route-prof" />
              <span className="rd-route-blurb">{t(`route.${route.id}.blurb` as TKey)}</span>
              <span className="rd-route-stats">
                <span>
                  <small>{t("routes.climb")}</small>
                  {Math.round(stats.gainM)} m
                </span>
                <span>
                  <small>{t("routes.maxGrade")}</small>
                  {stats.maxGrade.toFixed(1)}%
                </span>
                <span>
                  <small>{t("routes.best")}</small>
                  {best ? formatTime(best.timeS) : t("routes.noBest")}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <footer className="rd-routes-foot">
        <button type="button" className="rd-btn rd-btn-primary rd-btn-lg" onClick={() => game.startRide()}>
          <Play aria-hidden="true" />
          {t("routes.start")} {game.route.name}
        </button>
      </footer>
    </section>
  );
}
