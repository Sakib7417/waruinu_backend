# Waruinu Backend

Express + Prisma + PostgreSQL backend.

## Requirements

- Node.js 18+
- Docker Desktop (sirf database ke liye)

## Setup & Run

### 1. Database start karo (Docker)

```bash
docker compose up -d db
```

Postgres `localhost:5432` pe chalega (user: `user`, password: `password`, db: `waruinu`).

### 2. Dependencies install karo

```bash
npm install
```

### 3. Environment variables

`.env` file mein `DATABASE_URL` ka host `localhost` hona chahiye (backend locally chalta hai, docker mein nahi):

```env
PORT=5000
DATABASE_URL="postgresql://user:password@localhost:5432/waruinu?schema=public"
JWT_SECRET="supersecretjwtkey"
```

> Note: Agar backend kabhi docker mein chalana ho to host `localhost` ki jagah `db` hoga.

### 4. Prisma setup

```bash
npx prisma generate   # Prisma client generate karta hai
npx prisma db push    # Schema ko database mein sync karta hai
```

(Optional) Seed data:

```bash
npx prisma db seed
```

### 5. Backend start karo (local, docker nahi)

```bash
npm run dev
```

Server `http://localhost:5000` pe chalega.

## Useful Commands

| Command | Kaam |
|---|---|
| `docker compose up -d db` | Database start |
| `docker compose stop` | Database stop |
| `docker compose ps` | Container status |
| `npx prisma studio` | Database GUI browser |
| `npx prisma db push` | Schema changes DB mein apply |

## Troubleshooting

- **`Cannot find module '.prisma/client/default'`** → `npx prisma generate` chalao.
- **Port 5000 already in use** → Purana `waruinu_backend` docker container chal raha ho sakta hai: `docker rm -f waruinu_backend`
- **DB connection error** → Check karo `docker compose ps` mein `waruinu_db` running hai aur `.env` mein host `localhost` hai.
