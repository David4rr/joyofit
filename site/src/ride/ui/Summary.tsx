import { Flag, RotateCcw, Route as RouteIcon, Trophy } from "lucide-react";

import type { Game } from "../game.ts";
import { formatKm, formatTime, formatTimeTenths } from "../format.ts";
import { useT, type TKey } from "../i18n.ts";
import { Profile } from "./Profile.tsx";
import { useGame } from "./hooks.ts";

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rd-stat">
      <span className="rd-label">{label}</span>
      <span className="rd-stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

export function Summary({ game }: { game: Game }) {
  useGame(game);
  const { t } = useT();
  const r = game.result;
  if (!r) return null;
  const done = r.segments.filter((s) => s.state === "done");
  const delta = r.deltaToBestS;

  return (
    <section className="rd-screen rd-summary" aria-labelledby="rd-sum-title">
      <div className="rd-card rd-sum-card">
        <header className="rd-sum-head">
          <p className="rd-label">{game.route.name}</p>
          <h1 id="rd-sum-title" className="rd-title rd-title-sm">
            {r.complete ? t("summary.titleDone") : t("summary.titleStopped")}
          </h1>
          {r.newBest && (
            <p className="rd-best">
              <Trophy aria-hidden="true" />
              {t("summary.newBest")}
            </p>
          )}
          {delta !== null && (
            <p className="rd-muted">
              {delta <= 0
                ? t("summary.deltaFaster", { time: formatTimeTenths(-delta) })
                : t("summary.deltaSlower", { time: formatTimeTenths(delta) })}
            </p>
          )}
        </header>

        <div className="rd-sum-hero">
          <Stat label={t("summary.time")} value={formatTime(r.timeS)} />
          <Stat label={t("summary.distance")} value={formatKm(r.distM)} unit="km" />
          <Stat label={t("summary.climb")} value={String(Math.round(r.elevM))} unit="m" />
        </div>

        <Profile route={game.route} positionM={r.distM} segments label={t("hud.profile")} className="rd-sum-prof" />

        <dl className="rd-sum-list">
          <div>
            <dt>{t("summary.avgSpeed")}</dt>
            <dd>
              {r.avgSpeedKmh.toFixed(1)} {t("summary.unit.kmh")}
            </dd>
          </div>
          <div>
            <dt>{t("summary.maxSpeed")}</dt>
            <dd>
              {r.maxSpeedKmh.toFixed(1)} {t("summary.unit.kmh")}
            </dd>
          </div>
          {r.avgCad !== null && (
            <div>
              <dt>{t("summary.avgCad")}</dt>
              <dd>
                {Math.round(r.avgCad)} {t("summary.unit.rpm")}
              </dd>
            </div>
          )}
          {r.avgHr !== null && (
            <div>
              <dt>{t("summary.avgHr")}</dt>
              <dd>
                {Math.round(r.avgHr)} {t("summary.unit.bpm")}
              </dd>
            </div>
          )}
          {r.maxHr !== null && (
            <div>
              <dt>{t("summary.maxHr")}</dt>
              <dd>
                {Math.round(r.maxHr)} {t("summary.unit.bpm")}
              </dd>
            </div>
          )}
          {r.avgPower !== null && (
            <div>
              <dt>{r.powerMeasured ? t("summary.avgPowerMeasured") : t("summary.avgPower")}</dt>
              <dd>
                {Math.round(r.avgPower)} {t("summary.unit.w")}
              </dd>
            </div>
          )}
        </dl>
        {!r.powerMeasured && <p className="rd-muted rd-note">{t("summary.powerNote")}</p>}

        {(r.laps.length > 1 || done.length > 0) && (
          <div className="rd-sum-cols">
            {r.laps.length > 1 && (
              <div>
                <h2 className="rd-h3">
                  <Flag aria-hidden="true" />
                  {t("summary.laps")}
                </h2>
                <ol className="rd-table">
                  {r.laps.map((lap, i) => (
                    <li key={i}>
                      <span>{i + 1}</span>
                      <span>{formatTime(lap.sec)}</span>
                      <span>{formatKm(lap.distM)} km</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {done.length > 0 && (
              <div>
                <h2 className="rd-h3">
                  <Trophy aria-hidden="true" />
                  {t("summary.segments")}
                </h2>
                <ul className="rd-table">
                  {done.map((s) => (
                    <li key={s.def.id}>
                      <span>{t(`segment.${s.def.id}` as TKey)}</span>
                      <span>{formatTimeTenths(s.elapsedS)}</span>
                      <span className={s.pb ? "rd-pb" : "rd-dim"}>{s.pb ? t("segment.pb") : s.bestS !== null ? formatTimeTenths(s.bestS) : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className={`rd-delivery ${game.delivery === "sent" ? "is-ok" : ""}`} role="status">
          {game.delivery === "sent" ? t("summary.sent") : game.delivery === "pending" ? t("summary.notSent") : t("summary.notRoom")}
        </p>

        <div className="rd-actions">
          <button type="button" className="rd-btn rd-btn-primary rd-btn-lg" onClick={() => game.startRide()}>
            <RotateCcw aria-hidden="true" />
            {t("summary.again")}
          </button>
          <button type="button" className="rd-btn rd-btn-quiet" onClick={() => game.toRoutes()}>
            <RouteIcon aria-hidden="true" />
            {t("summary.otherRoute")}
          </button>
        </div>
      </div>
    </section>
  );
}
