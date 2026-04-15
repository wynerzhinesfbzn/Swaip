/* ═══════════════════════════════════════════════════════════════════
   SWAIP — Фильтрация ссылок по чёрным спискам
   Оффлайн-список + паттерны фишинга
═══════════════════════════════════════════════════════════════════ */

/* Известные вредоносные / фишинговые домены */
const BLOCKED_DOMAINS = new Set([
  /* Даркнет-маркеты */
  'hydra2web.com', 'hydraruzxpnew4af.onion', 'ramp2triomp4isup.onion',
  'darkweb', 'darknet', 'onion.to', 'tor2web', 'onion.cab',
  /* Известные скам-шаблоны */
  'yourfreebitcoin', 'getcryptofree', 'claimbtc', 'bitcoingenerator',
  /* Фишинг популярных сервисов */
  'vk-login', 'vkontakte-login', 'inst-login', 'tiktok-login',
  'sberbank-online', 'sbersonline', 'gazprom-online', 'vtb-login',
  'paypal-security', 'paypal-confirm', 'apple-id-verify',
  'google-security-alert', 'account-google-secure',
  /* Нелегальные аптеки */
  'rxpill', 'pharmacy-no-prescription', 'pillstore',
]);

/* Паттерны в URL, которые указывают на мошенничество */
const SUSPICIOUS_URL_PATTERNS: RegExp[] = [
  /login.{1,20}(token|verify|secure|confirm)/i,
  /secure.{1,20}(login|account|update)/i,
  /account.{1,20}(suspended|locked|verify)/i,
  /\b(free\s*(bitcoin|crypto|money|gift|iphone))\b/i,
  /\b(prize|winner|congratulations|you\s*won)\b/i,
  /\b(click\s*here\s*to\s*(claim|verify|confirm|activate))\b/i,
];

const URL_REGEX = /https?:\/\/[^\s<>"]+|www\.[^\s<>"]+/gi;

export interface LinkCheckResult {
  blocked:     boolean;
  blockedUrl:  string | null;
  reason:      string | null;
}

export function checkLinks(text: string): LinkCheckResult {
  const urls = text.match(URL_REGEX) ?? [];

  for (const raw of urls) {
    let hostname = '';
    try {
      const url = new URL(raw.startsWith('www.') ? `https://${raw}` : raw);
      hostname = url.hostname.toLowerCase();
    } catch {
      hostname = raw.toLowerCase();
    }

    /* Проверка по чёрному списку доменов */
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostname.includes(blocked)) {
        return { blocked: true, blockedUrl: raw, reason: `Заблокированный домен: ${blocked}` };
      }
    }

    /* Проверка подозрительных паттернов в самом URL */
    for (const pat of SUSPICIOUS_URL_PATTERNS) {
      if (pat.test(raw)) {
        return { blocked: true, blockedUrl: raw, reason: `Подозрительная ссылка: ${pat.source.slice(0, 40)}` };
      }
    }
  }

  return { blocked: false, blockedUrl: null, reason: null };
}
