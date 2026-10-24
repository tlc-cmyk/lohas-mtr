/**
 * 康城站 (LOHAS Park / LHP) — MTR Next Train countdown
 * + 觀塘繞道 (Kwun Tong Bypass) TD traffic snapshot cameras
 *
 * MTR: https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP
 * Cams: https://tdcctv.data.one.gov.hk/{CAMERA_ID}.JPG
 * Camera list: https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml
 */

(function () {
  "use strict";

  const API_URL =
    "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP&lang=TC";
  const REFRESH_MS = 10000; // API updates ~every 10s; cache-control max-age=10
  const TICK_MS = 250;
  const CAM_REFRESH_MS = 60000; // TD JPEG cache s-maxage=60; snapshots ~every 2 min
  const CAM_BASE = "https://tdcctv.data.one.gov.hk/";

  /**
   * Curated Kwun Tong Bypass cameras for LOHAS Park drivers.
   * filter: "to-kln" = toward Kowloon (W/N), "to-tko" = toward TKO/east (E/S)
   * Names in zh-HK Traditional Chinese (official TC XML often uses simplified).
   */
  const CAMERAS = [
    {
      id: "AID02104",
      name: "匯景花園",
      dir: "西行",
      filter: "to-kln",
      note: "東端 · 往九龍",
    },
    {
      id: "AID02215",
      name: "匯景花園",
      dir: "東行",
      filter: "to-tko",
      note: "東端 · 往將軍澳",
    },
    {
      id: "K812F",
      name: "麗港城",
      dir: "",
      filter: "all",
      note: "觀塘繞道近麗港城",
    },
    {
      id: "AID02106",
      name: "麗港城",
      dir: "西行",
      filter: "to-kln",
      note: "往九龍",
    },
    {
      id: "AID02214",
      name: "日升中心",
      dir: "東行",
      filter: "to-tko",
      note: "往將軍澳",
    },
    {
      id: "K813F",
      name: "勵業街",
      dir: "",
      filter: "all",
      note: "觀塘繞道近勵業街",
    },
    {
      id: "AID02108",
      name: "觀塘碼頭",
      dir: "北行",
      filter: "to-kln",
      note: "往九龍灣／彩虹",
    },
    {
      id: "AID02211",
      name: "觀塘碼頭",
      dir: "東行",
      filter: "to-tko",
      note: "往將軍澳方向",
    },
    {
      id: "AID02210",
      name: "九龍麵粉廠",
      dir: "南行",
      filter: "to-tko",
      note: "往觀塘／將軍澳",
    },
    {
      id: "AID02109",
      name: "九龍麵粉廠",
      dir: "北行",
      filter: "to-kln",
      note: "往九龍灣",
    },
    {
      id: "K814F",
      name: "啟祥道",
      dir: "",
      filter: "all",
      note: "觀塘繞道近啟祥道",
    },
    {
      id: "AID02116",
      name: "彩虹邨",
      dir: "北行",
      filter: "to-kln",
      note: "北端 · 往黃大仙／九龍",
    },
    {
      id: "AID02203",
      name: "啟晴邨",
      dir: "南行",
      filter: "to-tko",
      note: "北端 · 往觀塘／將軍澳",
    },
  ];

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
    mainDepart: document.getElementById("mainDepart"),
    mainDest: document.getElementById("mainDest"),
    mainMeta: document.getElementById("mainMeta"),
    trainList: document.getElementById("trainList"),
    statusLine: document.getElementById("statusLine"),
    statusHint: document.getElementById("statusHint"),
    refreshBtn: document.getElementById("refreshBtn"),
    camGrid: document.getElementById("camGrid"),
    camStatusLine: document.getElementById("camStatusLine"),
    camStatusHint: document.getElementById("camStatusHint"),
    panelMtr: document.getElementById("panelMtr"),
    panelCam: document.getElementById("panelCam"),
  };

  // --- State ---
  /** @type {{ dest: string, plat: string, timeMs: number, seq: string, dir: string }[]} */
  let trains = [];
  /** Wall-clock skew: apiCurrMs - Date.now() at last successful fetch */
  let clockSkewMs = 0;
  let lastFetchOkAt = 0;
  let fetching = false;
  let refreshTimer = null;
  let camFilter = "all";
  let camBust = Date.now();
  let camRefreshTimer = null;
  let activeTab = "mtr";

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

  /** Absolute departure clock HH:mm in HKT (no seconds — scheduled leave time). */
  function formatDepartHHmm(ms) {
    if (!Number.isFinite(ms)) return "";
    const d = new Date(ms);
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Hong_Kong",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("hour")}:${get("minute")}`;
  }

  function setStatus(text, kind, hint) {
    el.statusLine.textContent = text;
    el.statusLine.className = "status-line" + (kind ? " " + kind : "");
    el.statusHint.textContent = hint || "";
  }

  function setCamStatus(text, kind, hint) {
    el.camStatusLine.textContent = text;
    el.camStatusLine.className = "status-line" + (kind ? " " + kind : "");
    el.camStatusHint.textContent = hint || "";
  }

  /**
   * MTR's `time` is NOT a stable absolute ETA. Empirically it is regenerated as
   * curr_time + ttnt minutes on every response, so `time` slides forward while
   * ttnt stays constant. Parsing `time` as a deadline therefore resets MM:SS
   * to ttnt:00 on every ~10s refresh. Official docs mark ttnt as Dummy, but it
   * is the only meaningful remaining-minutes signal.
   *
   * Prior ratchet still glitched: MERGE_WINDOW was only 2.5 min. While ttnt
   * stays flat (common at LHP ~7–8 min headway), local deadline drifts behind
   * (now+ttnt) by >2.5 min → identity match fails → countdown jumps back to
   * ttnt:00. All LHP DOWN rows also share dest/plat/dir, so identity is
   * nearest-deadline within a headway-sized window.
   *
   * Fix: match with a 15 min window; same ttnt keeps local seconds (never
   * remount to ttnt:00); lower ttnt ratchets earlier; higher ttnt (delay)
   * accepts the new later ETA; board shifts re-pair by nearest ETA.
   */
  function collectTrains(payload) {
    const block = payload?.data?.["TKL-LHP"];
    if (!block) return [];
    const out = [];
    for (const dir of ["DOWN", "UP"]) {
      const arr = block[dir];
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        if (t.valid && t.valid !== "Y") continue;
        const ttnt = Number.parseInt(String(t.ttnt ?? ""), 10);
        if (!Number.isFinite(ttnt) || ttnt < 0) continue;
        out.push({
          dest: t.dest,
          plat: String(t.plat ?? ""),
          seq: String(t.seq ?? ""),
          dir,
          ttnt,
        });
      }
    }
    return out;
  }

  /**
   * Match incoming API rows to previous local deadlines.
   * @param {{dest:string,plat:string,seq:string,dir:string,ttnt:number}[]} incoming
   * @param {{dest:string,plat:string,seq:string,dir:string,ttnt:number,timeMs:number}[]} previous
   * @param {number} now
   */
  function mergeTrainDeadlines(incoming, previous, now) {
    const prev = previous.map((p) => ({ ...p, _used: false }));
    // Must cover full LHP headway while ttnt stays constant (old 2.5 min was too tight).
    const MERGE_WINDOW_MS = 15 * 60 * 1000;

    const merged = incoming.map((t) => {
      const ceilingMs = t.ttnt * 60 * 1000;
      const apiDeadline = now + ceilingMs;

      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < prev.length; i++) {
        const p = prev[i];
        if (p._used) continue;
        if (p.dest !== t.dest || p.plat !== t.plat || p.dir !== t.dir) continue;
        const dist = Math.abs(p.timeMs - apiDeadline);
        if (dist < bestDist && dist <= MERGE_WINDOW_MS) {
          bestDist = dist;
          bestIdx = i;
        }
      }

      let timeMs = apiDeadline;
      if (bestIdx >= 0) {
        const p = prev[bestIdx];
        p._used = true;
        if (t.ttnt === p.ttnt) {
          // Same ttnt: keep local seconds — never reset upward on refresh.
          timeMs = p.timeMs;
          const remain = timeMs - now;
          if (remain > ceilingMs) {
            // Clock/skew drift only — pull back to ceiling, not a full remount.
            timeMs = now + ceilingMs;
          } else if (remain < 0 && t.ttnt > 0) {
            // Counted past zero while API still shows minutes: stay "imminent",
            // do not jump back up to ttnt:00 (that was the visible reset).
            timeMs = now;
          }
        } else if (t.ttnt < p.ttnt) {
          // ttnt decreased — may snap earlier; never later than previous.
          timeMs = Math.min(p.timeMs, apiDeadline);
          if (timeMs - now > ceilingMs) timeMs = now + ceilingMs;
        } else {
          // ttnt increased (delay) — accept new later ETA.
          timeMs = apiDeadline;
        }
      }

      return {
        dest: t.dest,
        plat: t.plat,
        seq: t.seq,
        dir: t.dir,
        ttnt: t.ttnt,
        timeMs,
      };
    });

    merged.sort((a, b) => a.timeMs - b.timeMs || a.ttnt - b.ttnt);
    return merged;
  }

  function render() {
    const now = nowMs();
    // Drop trains that left more than 45s ago
    const active = trains.filter((t) => t.timeMs - now > -45000);

    if (active.length === 0) {
      el.mainDigits.textContent = "--:--";
      el.mainDigits.className = "digits";
      if (el.mainDepart) el.mainDepart.textContent = "";
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
    const nextDepart = formatDepartHHmm(next.timeMs);
    el.mainDigits.textContent = cd.text;
    el.mainDigits.className = "digits" + (cd.cls ? " " + cd.cls : "");
    if (el.mainDepart) {
      el.mainDepart.textContent = nextDepart
        ? `開出時間 ${nextDepart}`
        : "";
    }
    el.mainDest.textContent = `往 ${stationName(next.dest)}`;
    const dirNote = DIR_LABEL[next.dir] || "";
    el.mainMeta.textContent = [
      next.plat ? `月台 ${next.plat}` : "",
      dirNote,
    ]
      .filter(Boolean)
      .join(" · ");

    el.trainList.innerHTML = "";
    active.forEach((t, i) => {
      const li = document.createElement("li");
      li.className = "train-item" + (i === 0 ? " next" : "");
      const r = formatCountdown(t.timeMs - now);
      const depart = formatDepartHHmm(t.timeMs);
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
          <div class="clock">${depart ? `開出 ${depart}` : ""}</div>
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
        trains = mergeTrainDeadlines(collectTrains(data), trains, nowMs());
        lastFetchOkAt = Date.now();
        render();
        return;
      }

      const block = data?.data?.["TKL-LHP"];
      const apiCurr = parseApiTime(block?.curr_time || data.curr_time);
      if (Number.isFinite(apiCurr)) {
        // Align local clock to API curr_time (HKT). Ignore tiny jitter so
        // remainMs does not visibly jump on every 10s refresh.
        const nextSkew = apiCurr - Date.now();
        if (lastFetchOkAt === 0 || Math.abs(nextSkew - clockSkewMs) > 3000) {
          clockSkewMs = nextSkew;
        }
      }

      const incoming = collectTrains(data);
      trains = mergeTrainDeadlines(incoming, trains, nowMs());
      lastFetchOkAt = Date.now();

      const delay =
        data.isdelay === "Y" ? " · 資料標示可能延誤" : "";
      const ago = Math.round((Date.now() - t0) / 1000);
      const nextTtnt =
        incoming.length > 0 ? ` · API ttnt ${incoming[0].ttnt} 分` : "";
      setStatus(
        `已更新 · ${formatClockHKT(nowMs())} HKT${delay}`,
        "ok",
        `官方 API · 往返約 ${ago < 1 ? "<1" : ago} 秒 · 自動每 ${
          REFRESH_MS / 1000
        } 秒刷新${nextTtnt}`
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

  // --- Traffic cameras ---

  function camUrl(id) {
    return `${CAM_BASE}${id}.JPG?t=${camBust}`;
  }

  function visibleCams() {
    if (camFilter === "all") return CAMERAS;
    return CAMERAS.filter(
      (c) => c.filter === camFilter || c.filter === "all"
    );
  }

  function renderCams() {
    const list = visibleCams();
    el.camGrid.innerHTML = "";
    if (list.length === 0) {
      el.camGrid.innerHTML =
        '<p class="empty-msg">此方向暫無精選攝影機</p>';
      return;
    }

    list.forEach((cam) => {
      const card = document.createElement("article");
      card.className = "cam-card";
      card.dataset.id = cam.id;

      const title = cam.dir
        ? `觀塘繞道近${cam.name} · ${cam.dir}`
        : `觀塘繞道近${cam.name}`;

      const img = document.createElement("img");
      img.className = "cam-img";
      img.alt = title;
      img.loading = "lazy";
      img.decoding = "async";
      img.src = camUrl(cam.id);
      img.addEventListener("error", () => {
        card.classList.add("cam-error");
        if (!card.querySelector(".cam-fail")) {
          const fail = document.createElement("p");
          fail.className = "cam-fail";
          fail.textContent = "圖像暫時無法載入";
          card.appendChild(fail);
        }
      });
      img.addEventListener("load", () => {
        card.classList.remove("cam-error");
        const fail = card.querySelector(".cam-fail");
        if (fail) fail.remove();
      });

      const head = document.createElement("div");
      head.className = "cam-head";
      head.innerHTML = `
        <div class="cam-title">${title}</div>
        <div class="cam-meta">
          ${cam.dir ? `<span class="cam-dir">${cam.dir}</span>` : ""}
          <span class="cam-id">${cam.id}</span>
          ${cam.note ? `<span class="cam-note">${cam.note}</span>` : ""}
        </div>`;

      card.appendChild(head);
      card.appendChild(img);
      el.camGrid.appendChild(card);
    });

    setCamStatus(
      `已刷新 · ${formatClockHKT(Date.now())} HKT · ${list.length} 部攝影機`,
      "ok",
      `運輸署快拍 · 官方約每 2 分鐘更新 · 本頁每 ${
        CAM_REFRESH_MS / 1000
      } 秒強制刷新（?t= 破快取）`
    );
  }

  function refreshCams() {
    camBust = Date.now();
    // If cards already exist for current filter, just swap img src to avoid flicker rebuild
    const imgs = el.camGrid.querySelectorAll("img.cam-img");
    if (imgs.length > 0 && imgs.length === visibleCams().length) {
      imgs.forEach((img) => {
        const card = img.closest(".cam-card");
        const id = card && card.dataset.id;
        if (id) img.src = camUrl(id);
      });
      setCamStatus(
        `已刷新 · ${formatClockHKT(Date.now())} HKT · ${imgs.length} 部攝影機`,
        "ok",
        `運輸署快拍 · 官方約每 2 分鐘更新 · 本頁每 ${
          CAM_REFRESH_MS / 1000
        } 秒強制刷新`
      );
    } else {
      renderCams();
    }
  }

  function switchTab(tab) {
    activeTab = tab;
    const isMtr = tab === "mtr";
    document.getElementById("tabMtr").classList.toggle("active", isMtr);
    document.getElementById("tabCam").classList.toggle("active", !isMtr);
    document
      .getElementById("tabMtr")
      .setAttribute("aria-selected", isMtr ? "true" : "false");
    document
      .getElementById("tabCam")
      .setAttribute("aria-selected", isMtr ? "false" : "true");
    el.panelMtr.classList.toggle("active", isMtr);
    el.panelCam.classList.toggle("active", !isMtr);
    el.panelMtr.hidden = !isMtr;
    el.panelCam.hidden = isMtr;
    if (!isMtr) refreshCams();
  }

  function onRefreshClick() {
    if (activeTab === "cam") refreshCams();
    else fetchSchedule();
  }

  function start() {
    fetchSchedule();
    refreshTimer = setInterval(fetchSchedule, REFRESH_MS);
    setInterval(render, TICK_MS);

    renderCams();
    camRefreshTimer = setInterval(refreshCams, CAM_REFRESH_MS);

    el.refreshBtn.addEventListener("click", onRefreshClick);

    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    document.querySelectorAll(".chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        camFilter = chip.dataset.filter;
        document
          .querySelectorAll(".chip")
          .forEach((c) => c.classList.toggle("active", c === chip));
        renderCams();
      });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - lastFetchOkAt > 5000) fetchSchedule();
        else render();
        refreshCams();
      }
    });
  }

  start();
})();
