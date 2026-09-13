import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Pause,
  Play,
  Maximize,
  Minimize,
  SlidersHorizontal,
  X,
  ArrowUpRight,
  Film,
  Tv,
} from "lucide-react";
import "./style.css";
type Title = {
  id: number | string;
  type: string;
  title: string;
  backdrop: string | null;
  rank?: number;
  ratingsUnavailable?: boolean;
  imdbAsOf?: number | null;
  criticAsOf?: number | null;
  logo: string | null;
  genres: string[];
  tmdb: number | null;
  imdb: number | null;
  critic: number | null;
};
type Prefs = { mode: string; type: string; duration: number };
type Candidate = {
  imdb?: number;
  id: number | string;
  type: string;
  rank?: number;
  title?: string;
};
type ChartSource = {
  source: string;
  archive: string;
  archiveUpdatedAt: string;
};
const modes = [
  ["popular", "Popular now"],
  ["day", "Trending today"],
  ["week", "Trending this week"],
  ["rated", "Top rated"],
  ["shuffle", "Shuffle"],
  ["imdb", "IMDb Top 250"],
];
const defaults: Prefs = { mode: "popular", type: "all", duration: 12 };
function readPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem("afterglow") || "null");
    return p &&
      modes.some((x) => x[0] === p.mode) &&
      ["all", "movie", "tv"].includes(p.type) &&
      [12, 20, 30].includes(p.duration)
      ? p
      : defaults;
  } catch {
    return defaults;
  }
}
async function json(url: string, signal: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw Error("Library unavailable");
  return r.json();
}
function preload(src: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const img = new Image();
    const finish = (err?: Error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      img.onload = null;
      img.onerror = null;
      err ? reject(err) : resolve();
    };
    const abort = () => {
      img.src = "";
      finish(Error("Aborted"));
    };
    const timer = setTimeout(() => finish(Error("Image timeout")), 15000);
    img.onload = () =>
      img.decode().then(
        () => finish(),
        () => finish(),
      );
    img.onerror = () => finish(Error("Image unavailable"));
    signal.addEventListener("abort", abort, { once: true });
    img.src = src;
  });
}
function Slide({
  data,
  outgoing,
  paused,
  duration,
}: {
  data: Title;
  outgoing?: boolean;
  paused: boolean;
  duration: number;
}) {
  return (
    <section
      className={"slide " + (outgoing ? "outgoing" : "incoming")}
      aria-hidden={outgoing || undefined}
      aria-label={data.title}
      style={{ "--duration": `${duration + 3}s` } as React.CSSProperties}
    >
      {data.backdrop && (
        <img
          className="backdrop"
          src={data.backdrop}
          alt=""
          style={{ animationPlayState: paused ? "paused" : "running" }}
        />
      )}
      <div className="shade" />
      <div className="caption">
        {data.rank && (
          <a
            className="chart-rank"
            href={`https://www.imdb.com/title/${data.id}/`}
            target="_blank"
            rel="noreferrer"
          >
            IMDb Top 250 · {data.type === "movie" ? "Movie" : "TV show"} #
            {data.rank}
          </a>
        )}
        {!data.backdrop && (
          <p className="artwork-note">
            Artwork unavailable · keeping your place in the chart
          </p>
        )}
        {data.logo ? (
          <img className="title-logo" src={data.logo} alt={data.title} />
        ) : (
          <h1>{data.title}</h1>
        )}
        <div className="genres">
          {data.genres.map((g, i) => (
            <React.Fragment key={g}>
              {i > 0 && <span className="dot">•</span>}
              <span>{g}</span>
            </React.Fragment>
          ))}
        </div>
        <div className="ratings">
          {data.tmdb !== null && (
            <span
              className="rating"
              aria-label={`TMDb ${data.tmdb.toFixed(1)} out of 10`}
            >
              <img className="tmdb" src="/ratings/tmdb.svg" alt="TMDb" />
              <span>
                {data.tmdb.toFixed(1)}
                <small>/10</small>
              </span>
            </span>
          )}
          {data.imdb !== null && (
            <span
              className="rating"
              title={
                data.imdbAsOf
                  ? `IMDb score saved ${new Date(data.imdbAsOf).toLocaleDateString()}`
                  : undefined
              }
              aria-label={`IMDb ${data.imdb.toFixed(1)} out of 10`}
            >
              <img className="imdb" src="/ratings/imdb.svg" alt="IMDb" />
              <span>
                {data.imdb.toFixed(1)}
                <small>/10</small>
              </span>
            </span>
          )}
          {data.critic !== null && (
            <span
              className="rating"
              title={
                data.criticAsOf
                  ? `Critic score saved ${new Date(data.criticAsOf).toLocaleDateString()}`
                  : undefined
              }
              aria-label={`Rotten Tomatoes critics ${data.critic}%`}
            >
              <img
                className="tomato"
                src={`/ratings/${data.critic >= 60 ? "fresh" : "rotten"}.svg`}
                alt="Rotten Tomatoes"
              />
              <span>
                {data.critic}
                <small>%</small>
              </span>
            </span>
          )}
        </div>
        {data.ratingsUnavailable && data.critic === null && (
          <p className="artwork-note" role="status">
            Critic score temporarily unavailable
          </p>
        )}
      </div>
    </section>
  );
}
function App() {
  const [prefs, setPrefs] = useState(readPrefs);
  const [current, setCurrent] = useState<Title | null>(null);
  const [previous, setPrevious] = useState<Title | null>(null);
  const [paused, setPaused] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mirroring, setMirroring] = useState(false);
  const [charts, setCharts] = useState<Record<string, ChartSource>>({});
  const [awake, setAwake] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [full, setFull] = useState(false);
  const [notice, setNotice] = useState("");
  const queue = useRef<Title[]>([]),
    history = useRef<Title[]>([]),
    currentRef = useRef<Title | null>(null),
    fillRef = useRef<() => Promise<void>>(async () => {}),
    lock = useRef(false),
    hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    transition = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reveal = () => {
    setAwake(true);
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setAwake(false), 3000);
  };
  const show = (t: Title) => {
    if (currentRef.current) setPrevious(currentRef.current);
    currentRef.current = t;
    setCurrent(t);
    setError("");
    lock.current = true;
    clearTimeout(transition.current);
    transition.current = setTimeout(() => {
      setPrevious(null);
      lock.current = false;
    }, 2100);
  };
  useEffect(() => {
    try {
      localStorage.setItem("afterglow", JSON.stringify(prefs));
    } catch {}
  }, [prefs]);
  useEffect(() => {
    const abort = new AbortController();
    queue.current = [];
    history.current = [];
    currentRef.current = null;
    setCurrent(null);
    setPrevious(null);
    setError("");
    clearTimeout(transition.current);
    lock.current = false;
    const ordered = prefs.mode === "imdb";
    let orderedItems: Candidate[] | null = null;
    let cursor: string | null = null,
      started = false,
      busy = false;
    const seen = new Set<string>();
    let replace = true;
    // A buffered feed iterator preserves every candidate across refills.
    let candidates: Candidate[] = [];
    const buffered = async () => {
      if (busy || abort.signal.aborted) return;
      busy = true;
      let attempts = 0;
      try {
        while (
          queue.current.length < 2 &&
          attempts++ < 60 &&
          !abort.signal.aborted
        ) {
          if (!candidates.length) {
            if (started && !cursor) {
              seen.clear();
              if (currentRef.current)
                seen.add(currentRef.current.type + currentRef.current.id);
            }
            const feed = orderedItems
              ? { items: orderedItems, cursor: null }
              : await json(
                  "/api/feed?" +
                    new URLSearchParams({
                      mode: prefs.mode,
                      type: prefs.type,
                      ...(cursor ? { cursor } : {}),
                    }),
                  abort.signal,
                );
            if (abort.signal.aborted) return;
            if (ordered && !orderedItems) {
              if (!feed.items.length) throw Error("Chart unavailable");
              orderedItems = feed.items;
              setCharts(feed.charts || {});
            }
            started = true;
            cursor = feed.cursor;
            candidates = [...feed.items];
            if (!candidates.length) continue;
          }
          const item = candidates.shift()!;
          const key = item.type + item.id;
          if (!ordered && seen.has(key)) continue;
          seen.add(key);
          if (seen.size > 12000) seen.clear();
          try {
            const t: Title = await json(
              `/api/title/${item.type}/${item.id}`,
              abort.signal,
            );
            if (ordered) {
              t.id = item.id;
              t.rank = item.rank;
              t.title = item.title || t.title;
            }
            if (t.backdrop) await preload(t.backdrop, abort.signal);
            if (t.logo)
              try {
                await preload(t.logo, abort.signal);
              } catch {
                t.logo = null;
              }
            if (abort.signal.aborted) return;
            if (replace) {
              replace = false;
              show(t);
            } else queue.current.push(t);
          } catch {
            if (abort.signal.aborted) return;
            if (ordered) {
              const fallback: Title = {
                id: item.id,
                type: item.type,
                rank: item.rank,
                title: item.title || "Title unavailable",
                backdrop: null,
                logo: null,
                genres: [],
                tmdb: null,
                imdb: item.imdb ?? null,
                critic: null,
              };
              if (replace) {
                replace = false;
                show(fallback);
              } else queue.current.push(fallback);
            }
          }
        }
        if (!currentRef.current)
          setError(
            "No artwork is available right now. Try another collection.",
          );
      } catch {
        if (!abort.signal.aborted)
          setError(
            currentRef.current
              ? "Connection interrupted. Retrying in the background."
              : "The film library is taking a moment.",
          );
      } finally {
        busy = false;
      }
    };
    fillRef.current = buffered;
    void buffered();
    const retryTimer = setInterval(() => void buffered(), 15000);
    return () => {
      abort.abort();
      clearInterval(retryTimer);
    };
  }, [prefs.mode, prefs.type, retry]);
  const next = () => {
    if (lock.current) return;
    const t = queue.current.shift();
    if (t) {
      if (currentRef.current) {
        history.current.push(currentRef.current);
        if (history.current.length > 30) history.current.shift();
      }
      show(t);
    }
    void fillRef.current();
  };
  const back = () => {
    if (lock.current) return;
    const t = history.current.pop();
    if (t) {
      if (currentRef.current) queue.current.unshift(currentRef.current);
      show(t);
    }
  };
  useEffect(() => {
    if (paused || settings || mirroring || !current) return;
    const timer = setInterval(next, prefs.duration * 1000);
    return () => clearInterval(timer);
  }, [current, paused, settings, mirroring, prefs.duration]);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else
        setNotice("Use your browser’s fullscreen command to fill the screen.");
    } catch {
      setNotice("Use your browser’s fullscreen command to fill the screen.");
    }
  };
  useEffect(() => {
    const listener = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", listener);
    return () => document.removeEventListener("fullscreenchange", listener);
  }, []);
  useEffect(() => {
    let sentinel: { release: () => Promise<void> } | undefined;
    let alive = true;
    const acquire = async () => {
      if (
        !paused &&
        document.visibilityState === "visible" &&
        "wakeLock" in navigator
      )
        try {
          const s = await (
            navigator as Navigator & {
              wakeLock: {
                request: (
                  type: string,
                ) => Promise<{ release: () => Promise<void> }>;
              };
            }
          ).wakeLock.request("screen");
          if (alive) sentinel = s;
          else void s.release();
        } catch {}
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      alive = false;
      void sentinel?.release();
      document.removeEventListener("visibilitychange", acquire);
    };
  }, [paused]);
  useEffect(() => {
    reveal();
    return () => {
      clearTimeout(hide.current);
      clearTimeout(transition.current);
    };
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      reveal();
      if (e.key === "Escape") {
        setSettings(false);
        setMirroring(false);
        return;
      }
      if (settings || mirroring) return;
      if ((e.target as HTMLElement).matches("select,input,textarea")) return;
      if (
        e.code === "Space" &&
        !(e.target as HTMLElement).matches("button,a")
      ) {
        e.preventDefault();
        setPaused((x) => !x);
      }
      if (e.key.toLowerCase() === "f") void fullscreen();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") back();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  return (
    <main
      onPointerMove={reveal}
      onPointerDown={reveal}
      className={
        (awake || settings || mirroring ? "" : "idle ") +
        (paused || settings || mirroring ? "paused" : "")
      }
    >
      {previous && (
        <Slide
          key={previous.type + previous.id}
          data={previous}
          outgoing
          paused={false}
          duration={prefs.duration}
        />
      )}
      {current && (
        <Slide
          key={current.type + current.id}
          data={current}
          paused={paused || settings || mirroring}
          duration={prefs.duration}
        />
      )}
      {!current && (
        <div className="loading">
          <div className="wordmark">
            afterglow<span>•</span>
          </div>
          <p>{error || "A world of cinema. Coming into focus."}</p>
          {error ? (
            <button
              onClick={() => {
                setError("");
                setRetry((x) => x + 1);
              }}
            >
              Try again <ArrowRight size={16} />
            </button>
          ) : (
            <div className="loading-line" />
          )}
        </div>
      )}
      <header className="chrome">
        <span className="wordmark">
          afterglow<span>•</span>
        </span>
        <span className="collection">
          {modes.find((m) => m[0] === prefs.mode)?.[1]}
          <span className="collection-dot" />{" "}
          {prefs.type === "all"
            ? "Film & television"
            : prefs.type === "movie"
              ? "Film"
              : "Television"}
        </span>
      </header>
      <nav className="controls chrome" aria-label="Screensaver controls">
        <button onClick={back} aria-label="Previous title" title="Previous (←)">
          <ArrowLeft />
        </button>
        <button
          onClick={() => setPaused((x) => !x)}
          aria-label={paused ? "Play" : "Pause"}
          title="Play / pause (Space)"
        >
          {paused ? <Play /> : <Pause />}
        </button>
        <button onClick={next} aria-label="Next title" title="Next (→)">
          <ArrowRight />
        </button>
        <span className="separator" />
        <button
          onClick={() => setSettings(true)}
          aria-label="Settings"
          title="Settings"
        >
          <SlidersHorizontal />
        </button>
        <button
          onClick={() => void fullscreen()}
          aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
          title="Fullscreen (F)"
        >
          {full ? <Minimize /> : <Maximize />}
        </button>
        <button
          onClick={() => setMirroring(true)}
          aria-label="Watch on TV"
          title="Watch on TV"
        >
          <Tv />
        </button>
      </nav>
      {notice && (
        <div className="notice" role="status" onClick={() => setNotice("")}>
          {notice}
        </div>
      )}
      {error && current && (
        <div className="notice" role="status">
          {error}
        </div>
      )}
      {mirroring && <Mirroring close={() => setMirroring(false)} />}
      {settings && (
        <div className="scrim" onClick={() => setSettings(false)}>
          <Settings
            prefs={prefs}
            setPrefs={setPrefs}
            close={() => setSettings(false)}
            error={error}
            charts={charts}
          />
        </div>
      )}
    </main>
  );
}
function Settings({
  prefs,
  setPrefs,
  close,
  error,
  charts,
}: {
  prefs: Prefs;
  setPrefs: React.Dispatch<React.SetStateAction<Prefs>>;
  close: () => void;
  error: string;
  charts: Record<string, ChartSource>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const last = document.activeElement as HTMLElement;
    ref.current?.querySelector("button")?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const els = Array.from(
        ref.current!.querySelectorAll<HTMLElement>("button,select,a"),
      );
      const first = els[0],
        last = els.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.removeEventListener("keydown", trap);
      last?.focus();
    };
  }, []);
  return (
    <div
      ref={ref}
      className="settings"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => e.stopPropagation()}
    >
      <button className="close" onClick={close} aria-label="Close settings">
        <X size={20} />
      </button>
      <div className="eyebrow">
        <Film size={15} /> MAKE YOURSELF AT HOME
      </div>
      <h2 id="settings-title">Set the scene.</h2>
      <p className="intro">A little cinema. A little escape.</p>
      <label>
        Collection
        <select
          value={prefs.mode}
          onChange={(e) => setPrefs((p) => ({ ...p, mode: e.target.value }))}
        >
          {modes.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        On screen
        <div className="segmented">
          {[
            ["all", prefs.mode === "imdb" ? "Mix" : "Everything"],
            ["movie", "Movies"],
            ["tv", "TV shows"],
          ].map(([v, l]) => (
            <button
              key={v}
              aria-pressed={prefs.type === v}
              onClick={() => setPrefs((p) => ({ ...p, type: v }))}
            >
              {l}
            </button>
          ))}
        </div>
      </label>
      {prefs.mode === "imdb" && (
        <div className="chart-info">
          <p>
            {prefs.type === "all"
              ? "Movie #1 → TV #1 → Movie #2 → TV #2, through both #250s. Then repeat."
              : "From #1 to #250, in chart order. Then back to #1."}
          </p>
          <p>
            Starts at #1 when you select a chart. Missing artwork never skips a
            rank.
          </p>
          {Object.entries(charts)
            .filter(([type]) => prefs.type === "all" || type === prefs.type)
            .map(([type, chart]) => (
              <p key={type}>
                <a href={chart.source} target="_blank" rel="noreferrer">
                  IMDb {type === "movie" ? "movie" : "TV"} chart
                </a>
                {" · "}
                <a href={chart.archive} target="_blank" rel="noreferrer">
                  Archive updated{" "}
                  {new Date(chart.archiveUpdatedAt).toLocaleDateString(
                    undefined,
                    {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    },
                  )}
                </a>
              </p>
            ))}
          <p>
            Saved chart snapshot via a third-party archive. Live IMDb rankings
            may have changed.
          </p>
        </div>
      )}
      <label>
        Time to linger
        <select
          value={prefs.duration}
          onChange={(e) =>
            setPrefs((p) => ({ ...p, duration: Number(e.target.value) }))
          }
        >
          <option value={12}>12 seconds · A little livelier</option>
          <option value={20}>20 seconds · Take it slow</option>
          <option value={30}>30 seconds · Stay a while</option>
        </select>
      </label>
      <div className="shortcuts">
        <span>
          <kbd>F</kbd> Fullscreen
        </span>
        <span>
          <kbd>space</kbd> Pause
        </span>
        <span>
          <kbd>← →</kbd> Browse
        </span>
      </div>
      {error && (
        <p className="connection" role="status">
          {error}
        </p>
      )}
      <footer>
        <div className="credits">
          <span className="wordmark">
            afterglow<span>•</span>
          </span>
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            <img src="/ratings/tmdb.svg" alt="TMDb" />
            <ArrowUpRight size={12} />
          </a>
        </div>
        <p>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB. Ratings via{" "}
          <a href="https://www.omdbapi.com" target="_blank" rel="noreferrer">
            OMDb
          </a>
          . Artwork belongs to its respective owners.
        </p>
        <p>
          Only available scores are shown. Audience scores and unverified
          certification badges are omitted.
        </p>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

function Mirroring({ close }: { close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const last = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => last?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="settings mirror-dialog"
      aria-label="Watch on TV"
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={close} aria-label="Close TV guide">
          <X size={20} />
        </button>
        <div className="eyebrow">
          <Tv size={15} /> THE BIG SCREEN
        </div>
        <h2>Watch on TV.</h2>
        <p className="intro">Mirror your screen with Apple AirPlay.</p>
        <ol className="mirror-steps">
          <li>Connect your Mac and AirPlay TV to the same Wi-Fi network.</li>
          <li>
            Click <strong>Control Center</strong> in your Mac’s menu bar, then{" "}
            <strong>Screen Mirroring</strong>.
          </li>
          <li>
            Choose your TV or display. Enter the code shown on your TV if asked,
            and choose to mirror your screen.
          </li>
          <li>
            Return here, close this guide and press <strong>F</strong> for
            fullscreen.
          </li>
        </ol>
        <p className="chart-info">
          Your browser can’t directly open Apple’s Screen Mirroring menu. Use
          the Mac menu bar to choose the display.
        </p>
        <p className="chart-info">
          Using Chromecast? In Chrome, open the ⋮ menu → Cast, save, and share →
          Cast. For any computer, an HDMI cable also works.
        </p>
        <a
          className="guide-link"
          href="https://support.apple.com/guide/mac-help/stream-video-and-audio-with-airplay-mchld7e543a0/mac"
          target="_blank"
          rel="noreferrer"
        >
          Apple’s AirPlay guide ↗
        </a>
      </div>
    </dialog>
  );
}
