# 康城站 · 下一班車／觀塘繞道（LOHAS Park MTR + Kwun Tong Bypass）

Mobile-first single-page app showing:

1. **Real-time countdown** until the next MTR train departs from **康城站 / LOHAS Park (LHP)**
2. **Official Transport Department traffic snapshot cameras** on **觀塘繞道 / Kwun Tong Bypass**

Live: https://tlc-cmyk.github.io/lohas-mtr/

## Files

| Path | Role |
|------|------|
| `index.html` | Page shell (Traditional Chinese UI, MTR / cam tabs) |
| `styles.css` | Mobile-first styles |
| `app.js` | MTR fetch + countdown + camera refresh |
| `README.md` | This note |

## How to open (phone)

**Recommended — local HTTP server** (avoids `file://` CORS quirks):

```bash
cd /workspace/lohas-mtr
python3 -m http.server 8080
```

Then on your phone (same Wi‑Fi), open `http://<your-computer-ip>:8080/`.

## Data sources

### MTR Next Train

- URL: `https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP&lang=TC`
- Station: **LHP** = LOHAS Park / 康城 · Line: **TKL** = 將軍澳綫
- Spec: https://opendata.mtr.com.hk/doc/Next_Train_API_Spec_v1.7.pdf
- Update: ~every **10 seconds** · CORS: `Access-Control-Allow-Origin: *`

### Traffic snapshot images (運輸署)

- Dataset: [Traffic snapshot images](https://data.gov.hk/en-data/dataset/hk-td-tis_2-traffic-snapshot-images) (data.gov.hk / Transport Department)
- Camera list XML: `https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml`
- Image URL pattern: `https://tdcctv.data.one.gov.hk/{CAMERA_ID}.JPG`
- Official snapshot interval: about **every 2 minutes** · CDN `Cache-Control: s-maxage=60`
- CORS: `Access-Control-Allow-Origin: *` — safe to embed as `<img>` from GitHub Pages
- This page force-refreshes images every **60 seconds** with a `?t=` cache-buster

#### Cameras used (curated for LOHAS Park drivers)

| ID | Location (zh-HK) | Direction filter |
|----|------------------|------------------|
| AID02104 | 匯景花園 | 往九龍（西行） |
| AID02215 | 匯景花園 | 往將軍澳（東行） |
| K812F | 麗港城 | 全部 |
| AID02106 | 麗港城 | 往九龍（西行） |
| AID02214 | 日升中心 | 往將軍澳（東行） |
| K813F | 勵業街 | 全部 |
| AID02108 | 觀塘碼頭 | 往九龍（北行） |
| AID02211 | 觀塘碼頭 | 往將軍澳（東行） |
| AID02210 | 九龍麵粉廠 | 往將軍澳（南行） |
| AID02109 | 九龍麵粉廠 | 往九龍（北行） |
| K814F | 啟祥道 | 全部 |
| AID02116 | 彩虹邨 | 往九龍（北行） |
| AID02203 | 啟晴邨 | 往將軍澳（南行） |

Many more Kwun Tong Bypass cameras exist in the official list (AID02104–AID02116, AID02203–AID02215, K812F–K814F); this UI shows a phone-friendly subset with 往九龍 / 往將軍澳 chips.

## Behaviour

- Tabs: **港鐵倒數** · **觀塘繞道**
- MTR: large **MM:SS** countdown; auto-refresh every 10s; clock skew from API `curr_time`
- MTR ETA: uses **`ttnt` (minutes)** as the source of truth. The API’s `time` field is regenerated as `curr_time + ttnt` on every response (it slides forward), so treating `time` as a fixed deadline reset the countdown to `ttnt:00` every refresh. Deadlines are **ratcheted** (never slip later) so seconds tick smoothly between refreshes.
- Cams: name + direction + live JPEG; auto-refresh every 60s; filters by travel direction
- UI in **Traditional Chinese (Hong Kong)**

## Caveats / limits

1. MTR ETA is estimated — prefer in-station displays.
2. Camera images are **snapshots** (not continuous video), typically delayed up to ~2 minutes.
3. TD may return a placeholder JPEG at night or when a camera is offline.
4. `x-frame-options: SAMEORIGIN` on the image host blocks iframes; **`<img>` embedding works**.
5. Hotlinking: official open-data feed intended for reuse; CORS allows browser use. If TD later blocks referrers, images would fail to load.
6. HTTP 429 on MTR API if polled too aggressively (app uses 10s).
7. LOHAS Park is a branch terminus: typically **no UP** trains from LHP.

## Quick API tests

```bash
curl -sS "https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php?line=TKL&sta=LHP" | python3 -m json.tool
curl -sI "https://tdcctv.data.one.gov.hk/K812F.JPG"
```
