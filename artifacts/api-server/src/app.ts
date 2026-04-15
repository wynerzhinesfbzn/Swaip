import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

/* ── Trust proxy: Replit запускает за реверс-прокси — нужно для rate limiting и cookies ── */
app.set("trust proxy", 1);

/* ── CORS: только разрешённые домены (не зеркало Origin) ── */
const ALLOWED_ORIGINS = [
  /^https:\/\/.*\.replit\.app$/,
  /^https:\/\/.*\.replit\.dev$/,
  /^https:\/\/swaipe\.ru$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];
app.use(
  cors({
    origin: (origin, callback) => {
      /* Разрешаем запросы без Origin (curl, мобильные приложения, Postman) */
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGINS.some(re => re.test(origin));
      callback(null, allowed);
    },
    credentials: true,
  })
);

/* ── Security headers ── */
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "connect-src 'self' https: wss: blob:",
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cookieParser());

/* ── Rate limiting ──
   Общий лимит: 300 запросов / 1 минута на IP.
   Строгий лимит для авторизации: 20 запросов / 15 минут на IP. ── */
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов. Подождите немного." },
  skip: (req) => req.method === "OPTIONS",
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток входа. Попробуйте через 15 минут." },
});

const bookingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много запросов на бронирование. Попробуйте позже." },
});

app.use("/api", globalLimiter);
app.use("/api/auth", authLimiter);
app.use("/api/account/login", authLimiter);
app.use("/api/booking-request", bookingLimiter);

/* Raw binary body for direct file upload and audio/image upload — must come before json parser */
app.use("/api/upload", express.raw({ type: '*/*', limit: '100mb' }));
app.use("/api/audio-upload", express.raw({ type: '*/*', limit: '50mb' }));
app.use("/api/greeting-upload", express.raw({ type: '*/*', limit: '50mb' }));
app.use("/api/image-upload", express.raw({ type: '*/*', limit: '25mb' }));
/* Chunk endpoint — точное совпадение пути, чтобы НЕ захватить /init и /finalize */
app.use("/api/video-upload/chunk", express.raw({ type: '*/*', limit: '8mb' }));
/* Универсальные чанки для изображений и других файлов */
app.use("/api/upload-chunk", express.raw({ type: '*/*', limit: '8mb' }));
/* Прямая загрузка видео одним файлом — применяем ТОЛЬКО для точного пути /api/video-upload */
app.use((req, _res, next) => {
  if (req.path === "/api/video-upload" && req.method === "POST") {
    express.raw({ type: "*/*", limit: "150mb" })(req, _res, next);
  } else {
    next();
  }
});
app.use("/api/doc-upload", express.raw({ type: '*/*', limit: '25mb' }));

/* JSON-тело: снижен лимит с 50mb до 2mb для защиты от DoS */
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use("/api", router);

export default app;
