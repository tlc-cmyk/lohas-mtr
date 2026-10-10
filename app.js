/**
 * 康城站 (LOHAS Park / LHP) — MTR Next Train countdown
 * Source: Official MTR Next Train API via data.gov.hk
 * https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP
 *
 * CORS: API returns Access-Control-Allow-Origin: * — works from http(s) origins.
 * file:// may be blocked by some browsers; use a local server on phone if so.
 */

(function () {
  "use strict";

  const API_URL =
    "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP&lang=TC";
  const REFRESH_MS = 10000; // API updates ~every 10s; cache-control max-age=10
  const TICK_MS = 250;

  /** Station code → Traditional Chinese (HK) + English */
  const STATIONS = {
    LHP: { tc: "康城", en: "LOHAS Park" },
    TIK: { tc: "調景嶺", en: "Tiu Keng Leng" },
    NOP: { tc: "北角", en: "North Point" },
    TKO: { tc: "將軍澳", en: "Tseung Kwan O" },
    YAT: { tc: "油塘", en: "Yau Tong" },
    QUB: { tc: "鰂魚涌", en: "Quarry Bay" },
    HAH: { tc: "坑口", en: "Hang Hau" },
    POA: { tc: "寶琳", en: "Po Lam" },
  };

  const DIR_LABEL = {
    DOWN: "往調景嶺／北角",
    UP: "往寶琳／康城",
  };

  // --- DOM ---
  const el = {
    mainDigits: document.getElementById("mainDigits"),
    mainDest: document.getElementById("mainDest"),
    mainMeta: document.getElementById("mainMeta"),
    trainList: document.getElementById("trainList"),
    statusLine: document.getElementById("statusLine"),
    statusHint: document.getElementById("statusHint"),
    refreshBtn: document.getElementById("refreshBtn"),
  };

  // --- State ---
  /** @type {{ dest: string, plat: string, timeMs: number, seq: string, dir: string }[]} */
  let trains = [];
  /** Wall-clock skew: apiCurrMs - Date.now() at last successful fetch */
  let clockSkewMs = 0;
  let lastFetchOkAt = 0;
  let fetching = false;
  let refreshTimer = null;

  function stationName(code) {
    const s = STATIONS[code];
    return s ? `${s.tc}` : code;
  }

  function stationSub(code) {
    const s = STATIONS[code];
    return s ? s.en : "";
  }

  /** Parse API time "yyyy-MM-dd HH:mm:ss" as Hong Kong local wall time → epoch ms */
  function parseApiTime(str) {
    if (!str || str === "-") return NaN;
    // Treat as Asia/Hong_Kong (UTC+8) — API times have no zone suffix
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(str.trim());
    if (!m) return NaN;
    const [, Y, Mo, D, H, Mi, S] = m.map(Number);
    // Construct UTC equivalent of HKT by subtracting 8 hours
    return Date.UTC(Y, Mo - 1, D, H - 8, Mi, S);
  }

  function nowMs() {
    return Date.now() + clockSkewMs;
  }

  function pad2(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** Format remaining ms as MM:SS (or H:MM:SS if >= 1h). Negative → departed. */
  function formatCountdown(remainMs) {
    if (!Number.isFinite(remainMs)) return { text: "--:--", cls: "" };
    if (remainMs <= 0) return { text: "即將開出", cls: "imminent" };
    const totalSec = Math.floor(remainMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const text = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
    let cls = "";
    if (totalSec <= 60) cls = "imminent";
    else if (totalSec <= 180) cls = "urgent";
    return { text, cls };
  }

  function formatClockHKT(ms) {
    if (!Number.isFinite(ms)) return "";
    // Display in HKT
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("hour")}:${get("minute")}:${get("second")}`;
  }

  function setStatus(text, kind, hint) {
    el.statusLine.textContent = text;
    el.statusLine.className = "status-line" + (kind ? " " + kind : "");
    el.statusHint.textContent = hint || "";
  }

  function collectTrains(payload) {
    const block = payload?.data?.["TKL-LHP"];
    if (!block) return [];
    const out = [];
    for (const dir of ["DOWN", "UP"]) {
      const arr = block[dir];
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        if (t.valid && t.valid !== "Y") continue;
        const timeMs = parseApiTime(t.time);
        if (!Number.isFinite(timeMs)) continue;
        out.push({
          dest: t.dest,
          plat: String(t.plat ?? ""),
          timeMs,
          seq: String(t.seq ?? ""),
          dir,
          ttnt: t.ttnt,
        });
      }
    }
    out.sort((a, b) => a.timeMs - b.timeMs);
    return out;
  }

  function render() {
    const now = nowMs();
    // Drop trains that left more than 45s ago
    const active = trains.filter((t) => t.timeMs - now > -45000);

    if (active.length === 0) {
      el.mainDigits.textContent = "--:--";
      el.mainDigits.className = "digits";
      el.mainDest.textContent =
        trains.length === 0 ? "暫無列車資料" : "等候下一班…";
      el.mainMeta.textContent =
        "非服務時間、特別車務或資料暫時缺席時可能沒有班次。";
      el.trainList.innerHTML =
        '<li class="empty-msg">目前沒有即將開出的列車</li>';
      return;
    }

    const next = active[0];
    const remain = next.timeMs - now;
    const cd = formatCountdown(remain);
    el.mainDigits.textContent = cd.text;
    el.mainDigits.className = "digits" + (cd.cls ? " " + cd.cls : "");
    el.mainDest.textContent = `往 ${stationName(next.dest)}`;
    const dirNote = DIR_LABEL[next.dir] || "";
    el.mainMeta.textContent = [
      next.plat ? `月台 ${next.plat}` : "",
      dirNote,
      `預計 ${formatClockHKT(next.timeMs)}`,
    ]
      .filter(Boolean)
      .join(" · ");

    el.trainList.innerHTML = "";
    active.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "train-item" + (i === 0 ? " next" : "");
      const r = formatCountdown(t.timeMs - now);
      const platHtml = t.plat
        ? `<span class="plat">月台 ${t.plat}</span>`
        : "";
      li.innerHTML = `
        <div>
          <div class="train-dest">往 ${stationName(t.dest)}${platHtml}</div>
          <div class="train-sub">${stationSub(t.dest)}${
            DIR_LABEL[t.dir] ? " · " + DIR_LABEL[t.dir] : ""
          }</div>
        </div>
        <div class="train-eta">
          <div class="mmss">${r.text}</div>
          <div class="clock">${formatClockHKT(t.timeMs)}</div>
        </div>`;
      el.trainList.appendChild(li);
    });
  }

  async function fetchSchedule() {
    if (fetching) return;
    fetching = true;
    el.refreshBtn.classList.add("spinning");

    try {
      const t0 = Date.now();
      const res = await fetch(API_URL, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      if (res.status === 429) {
        setStatus(
          "請求過於頻繁（429），稍後再試",
          "warn",
          "港鐵 API 有速率限制，本頁約每 10 秒更新一次。"
        );
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      if (data.status === 0) {
        const msg = data.message || "特別車務安排";
        setStatus(msg, "warn", data.url || "");
        trains = collectTrains(data);
        lastFetchOkAt = Date.now();
        render();
        return;
      }

      const block = data?.data?.["TKL-LHP"];
      const apiCurr = parseApiTime(block?.curr_time || data.curr_time);
      if (Number.isFinite(apiCurr)) {
        // Align local clock to API curr_time (HKT)
        clockSkewMs = apiCurr - Date.now();
      }

      trains = collectTrains(data);
      lastFetchOkAt = Date.now();

      const delay =
        data.isdelay === "Y" ? " · 資料標示可能延誤" : "";
      const ago = Math.round((Date.now() - t0) / 1000);
      setStatus(
        `已更新 · ${formatClockHKT(nowMs())} HKT${delay}`,
        "ok",
        `官方 API · 往返約 ${ago < 1 ? "<1" : ago} 秒 · 自動每 ${
          REFRESH_MS / 1000
        } 秒刷新`
      );
      render();
    } catch (err) {
      console.error(err);
      const isFile =
        location.protocol === "file:" ||
        String(err).includes("Failed to fetch") ||
        String(err).includes("NetworkError");
      setStatus(
        "無法取得實時資料",
        "err",
        isFile
          ? "若以 file:// 開啟，部分瀏覽器會阻擋跨域請求。請用本機伺服器開啟（見 README）。"
          : String(err.message || err)
      );
    } finally {
      fetching = false;
      el.refreshBtn.classList.remove("spinning");
    }
  }

  function start() {
    fetchSchedule();
    refreshTimer = setInterval(fetchSchedule, REFRESH_MS);
    setInterval(render, TICK_MS);

    el.refreshBtn.addEventListener("click", () => fetchSchedule());

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        // Refresh immediately when returning to the tab
        if (Date.now() - lastFetchOkAt > 5000) fetchSchedule();
        else render();
      }
    });
  }

  start();
})();
