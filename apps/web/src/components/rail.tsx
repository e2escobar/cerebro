import { envColor, formatValue } from "@/lib/env-color";

/**
 * One flag's journey through the pipeline (design/direction.md).
 *
 * Solid track is where the flag has reached; dotted is where it has not. The
 * join between them is the frontier. A lit station means enabled here.
 */

export interface RailStop {
  environmentKey: string;
  rank: number;
  promoted: boolean;
  enabled: boolean;
  value: unknown;
}

export function Rail({
  stops,
  type,
  row = 0,
  showLabels = true,
}: {
  stops: RailStop[];
  type: string;
  row?: number;
  showLabels?: boolean;
}) {
  const total = stops.length;

  return (
    <div className="track">
      {stops.map((stop, index) => {
        const next = stops[index + 1];
        const color = envColor(stop.rank, total);

        const classes = [
          "stop",
          index === 0 ? "origin" : stop.promoted ? "in-laid" : "in-ahead",
          index === total - 1 ? "terminus" : next?.promoted ? "out-laid" : "out-ahead",
        ].join(" ");

        return (
          <div
            key={stop.environmentKey}
            className={classes}
            style={
              {
                "--c": color,
                "--next": next ? envColor(next.rank, total) : color,
                "--rank": stop.rank,
                "--row": row,
              } as React.CSSProperties
            }
          >
            <span
              className={`station ${stop.enabled ? "on" : ""} ${stop.promoted ? "" : "absent"}`}
              aria-hidden
            />
            {showLabels && (
              <span className={`station-value ${stop.enabled ? "on" : ""}`}>
                {!stop.promoted
                  ? "not promoted"
                  : stop.enabled
                    ? formatValue(stop.value, type)
                    : "off"}
              </span>
            )}
            <span className="sr-only">
              {stop.environmentKey}:{" "}
              {!stop.promoted ? "not promoted" : stop.enabled ? "on" : "promoted, off"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Column headings for the matrix — the pipeline stated once. */
export function RailHeader({ environmentKeys }: { environmentKeys: string[] }) {
  return (
    <div className="track pipeline-rule">
      {environmentKeys.map((key, index) => (
        <span
          key={key}
          className="eyebrow pb-2.5 text-center"
          style={{ color: envColor(index, environmentKeys.length) }}
        >
          {String(index).padStart(2, "0")} {key}
        </span>
      ))}
    </div>
  );
}
