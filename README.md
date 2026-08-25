<div align="center">

<img src="assets/banner.png" alt="openGym" width="720">

<br>

**A modern, privacy-first, self-hosted gym & body-weight tracker with multi-database support.**

Plan your week, run guided workouts, track every set, and monitor your body weight over time —
on your phone, tablet, or desktop, synced across devices, secured behind biometric passkey login.
No subscription, no ads, zero telemetry.

<br>

![Self-hosted](https://img.shields.io/badge/self--hosted-%F0%9F%8F%A0-60a5fa?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-a78bfa?style=flat-square)
![React](https://img.shields.io/badge/React-19-38bdf8?style=flat-square&logo=react&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Realtime%20Database-FFCA28?style=flat-square&logo=firebase&logoColor=black)
![MySQL](https://img.shields.io/badge/MySQL-Supported-4479A1?style=flat-square&logo=mysql&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Supported-47A248?style=flat-square&logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-compose-2496ED?style=flat-square&logo=docker&logoColor=white)
![No tracking](https://img.shields.io/badge/telemetry-none-f472b6?style=flat-square)

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center"><img src="assets/screenshots/home.png" alt="Home" width="230"><br><sub><b>Home</b> — today's workout & weight</sub></td>
<td align="center"><img src="assets/screenshots/workout.png" alt="Workout" width="230"><br><sub><b>Guided workout</b> — animated demos & sets</sub></td>
<td align="center"><img src="assets/screenshots/stats.png" alt="Stats" width="230"><br><sub><b>Stats</b> — heatmap, charts & PRs</sub></td>
</tr>
</table>
</div>

---

## ⚡ Key Features

- ⚖️ **Body-Weight Tracking** — interactive chart with goal line projections, gains/losses color-coded to your targets.
- 🏋️ **Weekly Workout Planner** — assign routines per weekday with a library of **1,324+ exercises** (searchable, with animated demos).
- 🗓️ **Flexible Rescheduling** — shift workouts to any day without altering your master weekly schedule.
- ▶️ **Smart Guided Workouts** — pre-fills previous weights, auto-rest timers, personal record (PR) badges, and per-set notes.
- ☀️ **Screen Wake Lock** — keeps the screen awake throughout training and automatically releases when you finish.
- 🔗 **Supersets & Timed Exercises** — native support for supersets, planks, dead hangs, wall sits, and loaded carries.
- 📈 **Built-in Progression Models** — Linear progression, **Greyskull LP** (AMRAP top set, double jumps, deload resets), double progression, or time-based routines.
- 💪 **Estimated 1RM & Effort Tracking** — calculate estimated 1RM curves; log **RIR** (reps in reserve) or **RPE** (rate of perceived exertion).
- 📤 **Export & Import** — export routines as JSON or PDF; import workout history from **FitNotes**, **Strong**, **Hevy**, or **Apple Health**.
- 🟩 **Activity Heatmap & Muscle Map** — GitHub-style workout heatmap and anatomical front/back muscle engagement diagrams.
- 🔔 **Push Notifications** — Web Push (VAPID) rest-timer alerts and workout reminders.
- 🔑 **Passkeys (WebAuthn)** — passwordless Face ID / Touch ID / fingerprint biometric login; private keys never leave your device.
- 🗄️ **Multi-Database Support** — pluggable storage providers: **Firebase Realtime Database**, **MySQL**, or **MongoDB**.
- 🎨 **Full UI Customization** — dark/light modes and 8 vibrant accent colors.
- 🌍 **12 Languages** — complete localization (EN, DE, ES, FR, IT, PT, PL, TR, RU, ZH, KO, HI).
- 📱 **PWA & Mobile Ready** — installable progressive web app (PWA) with offline caching.

---

## 🏗️ Architecture

```
Browser / PWA / Mobile
         │
         │ HTTP / WebAuthn (Port 3000)
         ▼
┌──────────────────────────────────────────────────────────┐
│          Unified Server (dist/server.cjs)                │
│                                                          │
│  ├── React 19 Frontend SPA (dist/ static assets + SPA)   │
│  ├── REST API (/api/health, /api/me, /api/auth, ...)     │
│  ├── WebAuthn Passkeys (@simplewebauthn/server)          │
│  └── Pluggable Database Service Layer (database/index)   │
└────────────────────────────┬─────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
Firebase Realtime         MySQL 8+               MongoDB
  Database (Cloud)     (Self-Hosted)          (Atlas / Local)
```

- **ONE project** → **ONE package.json** → **ONE unified server (`dist/server.cjs`)** → **ONE Docker container** → **ONE port `3000`**.

---

## 🚀 Quick Start (Local Node.js)

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` to configure your preferred database provider:

```env
# ==============================================================================
# Select Database Provider: 'firebase' | 'mysql' | 'mongodb'
# ==============================================================================
DATABASE_PROVIDER=firebase

# Firebase Realtime Database (used when DATABASE_PROVIDER=firebase)
FIREBASE_DATABASE_URL=https://opengym-app-default-rtdb.asia-southeast1.firebasedatabase.app/
FIREBASE_DATABASE_SECRET=your_firebase_database_secret

# MySQL (used when DATABASE_PROVIDER=mysql)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=opengym
MYSQL_USER=opengym
MYSQL_PASSWORD=your_mysql_password

# MongoDB (used when DATABASE_PROVIDER=mongodb)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DATABASE=openGym

# Server & Session Settings
SESSION_SECRET=your_long_random_64_char_session_secret
PORT=3000
NODE_ENV=production
```

### 3. Build & Run

```bash
# 1. Install dependencies
npm install

# 2. Build the React frontend and bundle the Node backend
npm run build

# 3. Start the production server
npm start
```

Visit **http://localhost:3000** in your browser.

---

## 🐳 Docker Deployment

### 1. Docker Compose (Recommended)

```bash
# Start container in detached mode
docker compose up -d

# View live application logs
docker compose logs -f

# Stop and remove containers
docker compose down
```

### 2. Manual Docker CLI

#### Build the Docker Image
```bash
docker build -t opengym:latest .
```

#### Run the Container
```bash
docker run -d \
  --name opengym \
  -p 3000:3000 \
  --env-file .env \
  opengym:latest
```

#### Check Health Endpoint
```bash
curl http://localhost:3000/api/health
```

---

## 🤖 GitHub Actions CI/CD

An automated Docker build & publish workflow is available at `.github/workflows/docker-publish.yml`.

### Setting Up Automated Releases:
1. In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.
2. Add the following repository secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username.
   - `DOCKERHUB_TOKEN`: Your Docker Hub Personal Access Token (PAT).
3. Every push to the `main` branch or release tag (e.g. `v1.0.0`) automatically builds and pushes the multi-platform image.

---

## 🗄️ Database Architecture

The data access layer in `database/` abstracts persistence across providers:

### Firebase Realtime Database Schema

```text
profiles/
  <userId>/
    id: string
    name: string
    created: ISO timestamp
    admin: boolean
    disabled: boolean
    publicPasskeys/
      <credId>/
        id: string
        publicKey: base64url string
        counter: number
        transports: string[]

users/
  <userId>/
    unit: 'kg' | 'lbs'
    restSec: number
    sound: boolean
    keepAwake: boolean
    lang: string
    theme: string
    accent: string
    body: string
    targetW: number | null
    bodyweight: [{ d, w, t }]
    routines: [{ id, name, emoji, ex: [{ id, sets, reps, weight }] }]
    week: { "1": routineId, ... }
    dayPlan: { "YYYY-MM-DD": routineId | 'rest' }
    workouts: [{ id, d, name, emoji, dur, vol, sets: [...] }]
    customEx: [...]
    reminder: { on: boolean, time: "08:00", tz: string }
    effort: 'rir' | 'rpe' | 'none'
    _ts: number

invites/
  <inviteCode>/
    code: string
    note: string
    createdBy: string

subscriptions/
  <userId>/
    <subId>/
      endpoint: string
      keys: { p256dh, auth }

system/
  vapid/
    publicKey: string
    privateKey: string
```

### MySQL & MongoDB Auto-Provisioning
- **MySQL**: Automatically creates `profiles`, `user_states`, `invites`, `push_subscriptions`, and `system_config` tables with appropriate indexes on first connection.
- **MongoDB**: Automatically initializes collections and unique indexes for fast queries.

---

## 🧪 Testing & Linting

```bash
# Run unit & integration test suites
npm test

# Run build verification & linter
npm run lint
```

---

## 📬 Support & Community

<p align="center">
  <a href="https://t.me/BlueOrbitDevs">
    <img src="https://img.shields.io/badge/Telegram-Community%20Support-blue?style=for-the-badge&logo=telegram">
  </a>
</p>

---

## 📜 License

GNU General Public License v3.0 (GPL-3.0) © 2026 [Amit Das](https://amitdas.site)

---

<p align="center">
  <b>Made with ❤️ by <a href="https://amitdas.site">Amit Das</a></b><br>
  ☕ Support development: <a href="https://paypal.me/AmitDas4321">PayPal.me/AmitDas4321</a>
</p>
