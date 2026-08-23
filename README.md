<div align="center">

<img src="assets/banner.png" alt="openGym" width="720">

<br>

**A self-hosted gym & body-weight tracker powered by Firebase Realtime Database.**

Plan your week, run guided workouts, track every set and your body weight over time —
on your phone, synced across devices, behind your own passkey login.
No subscription, no ads, zero telemetry.

<br>

![Self-hosted](https://img.shields.io/badge/self--hosted-%F0%9F%8F%A0-60a5fa?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-a78bfa?style=flat-square)
![React](https://img.shields.io/badge/React-19-38bdf8?style=flat-square&logo=react&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Realtime%20Database-FFCA28?style=flat-square&logo=firebase&logoColor=black)
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

## ⚡ Features

- ⚖️ **Body-weight tracking** — interactive chart with a goal line you set, gains/losses colored by whether they move toward it.
- 🏋️ **Weekly plan** — a routine per weekday, over a library of **1,324 exercises** (searchable, with animated demos).
- 🗓️ **Reschedule any day** — move a workout to another day without touching your master weekly plan.
- ▶️ **Guided workouts** — smart start for today's routine; pre-fills previous weights, rest timer, PR detection, per-exercise weight tracking.
- ☀️ **Screen Wake Lock** — keeps the screen awake while you train; automatically releases when the workout finishes.
- 🔗 **Supersets & Timed Exercises** — support for supersets, planks, hangs, wall sits, and loaded carries with dedicated work timers.
- 📈 **Progression Programs** — Linear progression, **Greyskull LP** (AMRAP top set, double jumps, deload resets), double progression, or time-based.
- 💪 **Estimated 1RM & Effort Scales** — calculate estimated 1RM curves and optionally log **RIR** (reps in reserve) or **RPE**.
- 📤 **Share & Import Plans** — export routines as clean JSON or PDF; import history from **FitNotes**, **Strong**, **Hevy**, or **Apple Health**.
- 🟩 **Activity Heatmap & Muscle Map** — GitHub-style workout heatmap and anatomical front/back muscle engagement diagrams.
- 🔔 **Push Notifications** — Web Push (VAPID) rest-timer alerts and workout reminders.
- 🔑 **Passkeys (WebAuthn)** — Face ID / Touch ID / fingerprint biometric login; private keys never leave the device.
- ☁️ **Firebase Realtime Database** — cloud sync single source of truth for persistent profiles, workouts, plans, and settings.
- 🎨 **Customization** — light/dark themes and 8 accent colors.
- 🌍 **12 Languages** — full localization (EN, DE, ES, FR, IT, PT, PL, TR, RU, ZH, KO, HI).

---

## 🏗️ Architecture

```
Browser / PWA / Mobile
         │
         │ HTTP / WebAuthn (Port 3000)
         ▼
┌──────────────────────────────────────────────────────────┐
│              Single Node.js Server (server.js)           │
│                                                          │
│  ├── React 19 Frontend SPA (serves dist/ & SPA routing)  │
│  ├── REST API (/api/health, /api/me, /api/auth, ...)     │
│  ├── WebAuthn Passkeys (@simplewebauthn/server)          │
│  └── Firebase Realtime Database Client Service Layer     │
└────────────────────────────┬─────────────────────────────┘
                             │
                             ▼
              Firebase Realtime Database (Cloud)
```

- **ONE project** → **ONE package.json** → **ONE server (`server.js`)** → **ONE Docker image** → **ONE port `3000`**.

---

## 🚀 Quick Start (Local Node.js)

### 1. Configure Environment

```bash
cp .env.example .env
```

Set your database and session values in `.env`:
```env
# Select database provider: 'firebase' | 'mysql' | 'mongodb'
DATABASE_PROVIDER=firebase

# Firebase Realtime Database
FIREBASE_DATABASE_URL=https://opengym-app-default-rtdb.asia-southeast1.firebasedatabase.app/
FIREBASE_DATABASE_SECRET=your_firebase_secret_here

# MySQL (Optional)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_DATABASE=opengym
MYSQL_USER=opengym
MYSQL_PASSWORD=your_mysql_password

# MongoDB (Optional)
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DATABASE=openGym

SESSION_SECRET=f199488a6d49249538ed060e54eee8104feaf1c090b69ec8cb3b3b48785c445e23c15ebbf0ef6451b26a1b78f6d2a28a7ad5ee357df0787a56bee3d73f8199a6
PORT=3000
```

### 2. Build & Start

```bash
# Install dependencies
npm install

# Build the React production SPA
npm run build

# Start the unified server
npm start
```

Visit **http://localhost:3000** in your browser.

---

## 🐳 Docker Deployment

### 1. Build and Run with Docker Compose (Recommended)

```bash
# Start container in background
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down
```

### 2. Manual Docker CLI (Build, Run, Tag, Push)

#### Build Docker Image Locally
```bash
docker build -t opengym:latest .
```

#### Run Docker Container
```bash
docker run -d \
  --name opengym \
  -p 3000:3000 \
  --env-file .env \
  opengym:latest
```

#### Check Container Health
```bash
curl http://localhost:3000/api/health
```

#### Tag and Push to Docker Hub
```bash
# 1. Log in to Docker Hub
docker login

# 2. Tag image with your Docker Hub username
docker tag opengym:latest <YOUR_DOCKERHUB_USERNAME>/opengym:latest
docker tag opengym:latest <YOUR_DOCKERHUB_USERNAME>/opengym:1.2.4

# 3. Push to Docker Hub
docker push <YOUR_DOCKERHUB_USERNAME>/opengym:latest
docker push <YOUR_DOCKERHUB_USERNAME>/opengym:1.2.4
```

---

## 🤖 GitHub Actions CI/CD (Docker Hub Publishing)

This repository includes a production-ready GitHub Actions workflow at `.github/workflows/docker-publish.yml`.

### Setting Up Automated Builds:

1. In your GitHub repository, navigate to **Settings** → **Secrets and variables** → **Actions**.
2. Add the following repository secrets:
   - `DOCKERHUB_USERNAME`: Your Docker Hub username.
   - `DOCKERHUB_TOKEN`: Your Docker Hub Personal Access Token (PAT).
3. Every push to the `main` branch or release tag (e.g. `v1.2.4`) will automatically build and publish the multi-stage image to your Docker Hub repository.

---

## 🗄️ Firebase Database Schema

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

---

## 🧪 Testing & Linting

```bash
# Run test suite
npm test

# Lint & build check
npm run lint
```
