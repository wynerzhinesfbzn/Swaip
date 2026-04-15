# SWAIP — Social Media Platform

## Overview

pnpm workspace monorepo. SWAIP — социальная сеть с несколькими режимами профиля (Pro, Scene, Krug, Circle).

## Stack

- **Monorepo**: pnpm workspaces
- **Node.js**: 24
- **Package manager**: pnpm
- **TypeScript**: 5.9
- **Frontend**: React + Vite PWA (`artifacts/swaip`) — App.tsx 28k+ строк
- **Backend**: Express 5 (`artifacts/api-server`) — WebSocket, REST API
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, drizzle-zod
- **Storage**: Google Cloud Storage (images) + local disk (аудио/видео)
- **Auth**: Ed25519 keypair + session tokens (cookie)
- **Real-time**: WebSocket call signaling

## Artifacts

| Artifact | Port | Path | Описание |
|---|---|---|---|
| `artifacts/swaip` | 18921 | `/` | Фронтенд PWA |
| `artifacts/api-server` | 8080 | `/api` | Backend API |
| `artifacts/mockup-sandbox` | 8081 | `/__mockup` | UI sandbox |

## API Routes

- `GET/POST /api/auth` — авторизация (Ed25519)
- `GET /api/search` — поиск аккаунтов
- `GET /api/account/:hash` — профиль пользователя
- `POST /api/account/update` — обновление профиля
- `GET /api/broadcasts` — посты/эфиры
- `POST /api/broadcasts` — создание поста
- `POST /api/upload` — загрузка медиа (локальный диск)
- `POST /api/image-upload` — загрузка изображений < 8MB (GCS)
- `POST /api/upload-chunk` — чанк универсальной загрузки (GCS для изображений)
- `POST /api/upload-finalize` — финализация чанков → GCS
- `POST /api/audio-upload` — аудио
- `POST /api/greeting-upload` — голосовые приветствия (GCS)
- `POST /api/video-upload` — видео
- `POST /api/doc-upload` — документы
- `WS /ws/calls` — сигналинг звонков

## Object Storage

Replit Object Storage (GCS) подключён через env var `DEFAULT_OBJECT_STORAGE_BUCKET_ID`.
- Изображения (< 8MB): `/api/image-upload` → GCS → `/api/image/:uuid.ext`
- Изображения (> 8MB): `/api/upload-chunk` × N → `/api/upload-finalize` → GCS → `/api/image/:uuid.ext`
- Аудио-приветствия: `/api/greeting-upload` → GCS
- Видео/аудио: локальный диск (эфемерное, теряется при передеплое)

## DB Schema

- `accounts` — аккаунты (hash, data JSONB)
- `sessions` — сессии
- `broadcasts` + `broadcastComments` + `broadcastReactions` — посты
- `conversations` + `conversationParticipants` + `messages` — мессенджер
- `follows` — подписки
- `loginLogs` — логи входа
- `moderation` — модерация
- `meetings` + `meetingParticipants` + `meetingMessages` + `meetingLogs` — звонки/встречи
- `reviews` — отзывы

## Ключевые правила

1. App.tsx — только точечные правки через `edit`, **никогда** не переписывать целиком
2. React imports — одна строка: `import React, { useState, ... } from 'react'`
3. Платёжные системы — только российские (ЮKassa, CloudPayments, Тинькофф)
4. Service Worker — не добавлять `controllerchange` и `|| caches.match('/')` как фолбэк
5. CompassScreen — не трогать без согласования

## Key Commands

- `pnpm run typecheck` — typecheck всего workspace
- `pnpm --filter @workspace/db run push` — применить схему БД
- `pnpm --filter @workspace/api-server run dev` — запуск бэкенда
- `pnpm --filter @workspace/swaip run dev` — запуск фронтенда
