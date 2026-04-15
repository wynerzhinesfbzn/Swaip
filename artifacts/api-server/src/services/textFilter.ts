/* ═══════════════════════════════════════════════════════════════════
   SWAIP — Служба текстовой фильтрации контента
   Языки: EN · DE · PT · RU + все языки через banned_words.json
   Категории: CSAM · PORN · DRUGS · VIOLENCE · EXTREMISM · FRAUD · HARASSMENT

   Расширение списка слов — только через:
     artifacts/api-server/src/services/banned_words.json
   Код менять не нужно.
═══════════════════════════════════════════════════════════════════ */

import bannedWordsRaw from './banned_words.json';

export type FilterCategory =
  | 'csam'
  | 'porn'
  | 'drugs'
  | 'violence'
  | 'extremism'
  | 'fraud'
  | 'harassment';

export interface FilterResult {
  blocked:  boolean;
  category: FilterCategory | null;
  rule:     string | null;
  severity: 'critical' | 'high' | 'medium' | null;
}

const PASS: FilterResult = { blocked: false, category: null, rule: null, severity: null };

/* ─── Загрузка banned_words.json (импортирован вверху файла) ────── */

interface BannedWords {
  drugs: {
    standalone: string[];
    context_sale: string[];
    sale_words: string[];
  };
  porn:     { standalone: string[] };
  violence: { standalone: string[] };
  fraud:    { standalone: string[] };
}

const BW = bannedWordsRaw as unknown as BannedWords;

/* ─── Вспомогательные ──────────────────────────────────────────── */

function normalize(text: string): string {
  return text
    .toLowerCase()
    /* Убираем разделители между отдельными кириллическими буквами
       Обходит: к.о.к.а.и.н  к-о-к-а-и-н  к_о_к_а_и_н  к о к а и н */
    .replace(/([а-яё])[.\-_\s](?=[а-яё])/g, '$1')
    /* Убираем дублирующиеся буквы (кокааин → кокаин, геррроин → героин) */
    .replace(/([а-яёa-z])\1{2,}/g, '$1')
    /* Цифровые замены */
    .replace(/0/g, 'о')
    .replace(/3/g, 'е')
    .replace(/4/g, 'ч')
    .replace(/1/g, 'и')
    .replace(/2/g, 'з')
    .replace(/6/g, 'б')
    .replace(/7/g, 'т')
    .replace(/9/g, 'д')
    /* Символьные замены */
    .replace(/[@$]/g, 'а')
    .replace(/\*/g, 'а')
    .replace(/!/g, 'и')
    /* Латинско-кириллические омоглифы внутри слов */
    .replace(/y/g, 'у')
    .replace(/\s+/g, ' ')
    .trim();
}

function match(text: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return p.source.slice(0, 60);
  }
  return null;
}

/** Экранирует строку для вставки в RegExp */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Строит паттерн вида (слово1|слово2|...) без \b (для кириллицы) */
function wordGroup(words: string[]): string {
  return `(${words.map(esc).join('|')})`;
}

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 1: CSAM — Детская порнография (нулевая толерантность)
═══════════════════════════════════════════════════════════════════ */
const CSAM_PATTERNS: RegExp[] = [
  /\bcp\b.*\b(nude|naked|sex|photo|video|pic)\b/i,
  /\bchild\s*(porn|sex|nude|naked|abuse|lust|molest)/i,
  /(детск|ребёнок|дети|малолетн).{0,20}(порн|секс|нюд|голый|голая|насил)/i,
  /\bpedo(phile|phil|philia)?\b/i,
  /педофил/i,
  /\bloli(con|ta)?\b/i,
  /\bshota(con)?\b/i,
  /\b(underage|minor)\s*(sex|nude|porn|naked)/i,
  /\bkinderporno\b/i,
  /\bkindersex\b/i,
  /\bporno\s*infantil\b/i,
  /секс.{0,10}(с детьми|дети|ребёнок|несовершеннолетн)/i,
  /\bCSAM\b/i,
  /старшеклассн.{0,20}(секс|порн)/i,
];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 2: ПОРНОГРАФИЯ
═══════════════════════════════════════════════════════════════════ */

/* Статичные паттерны */
const PORN_STATIC: RegExp[] = [
  /\b(porn|porno|pornography|xxx|onlyfans)\b/i,
  /\bescort(s|service)?\b/i,
  /\b(prostitut|prostituierten|prostituição)/i,
  /(порно|порнуха|порнография)/i,
  /(эскорт|интим.услуги|проститут|шлюха)/i,
  /\b(nude\s*(pic|video|photo|cam)|nude\s*leak)\b/i,
  /\b(sex\s*tape|sextape|sexvideo)\b/i,
  /\bupskirt\b/i,
  /\bvoyeur\b/i,
  /(hidden\s*cam|скрытая\s*камера).{0,20}(sex|sexy|ню|nude)/i,
  /\b(sex\s*(service|worker)|sexarbeit)\b/i,
  /(купи|продам|продаю).{0,20}(интим|ню|nude|explicit)/i,
  /ОнлиФанс/i,
  /зоофил/i,
  /бестиали/i,
  /(necro|некро)(philia|фил)/i,
];

/* Динамические из banned_words.json */
const PORN_DYNAMIC: RegExp[] = BW.porn.standalone.length
  ? [new RegExp(wordGroup(BW.porn.standalone), 'i')]
  : [];

const PORN_PATTERNS = [...PORN_STATIC, ...PORN_DYNAMIC];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 3: НАРКОТИКИ
═══════════════════════════════════════════════════════════════════ */

/* --- Однозначные названия (из кода + banned_words.json) --- */
const DRUG_STANDALONE_STATIC = [
  'героин','кокаин','амфетамин','метамфетамин','метадон',
  'мефедрон','экстази','кетамин','бутират','феназепам',
  'трамадол','прегабалин','оксикодон','оксиконтин',
  'гашиш','анаша','марихуана','спайс','фентанил','лирика',
];
const DRUG_STANDALONE_ALL = [
  ...new Set([...DRUG_STANDALONE_STATIC, ...BW.drugs.standalone])
];

/* --- Слова контекста продажи (из кода + banned_words.json) --- */
const SALE_WORDS_STATIC = [
  'продам','продаю','купить','куплю','продаётся',
  'доставка','закладка','закладки','закладчик',
  'оптом','розница','дозировка','грамм','граммов',
  'цена','стоимость','дёшево','telegram','телега','телеграм',
  'buy','sell','price','delivery',
];
const SALE_WORDS_ALL = [
  ...new Set([...SALE_WORDS_STATIC, ...(BW.drugs.sale_words ?? [])]),
];

/* --- Сленг с контекстом (из кода + banned_words.json) --- */
const DRUG_CONTEXT_STATIC = [
  'герыч','гера','кокс','кока','кокос','снег',
  'амф','амфа','фен','скорость','быстрый',
  'меф','мяу',
  'соль','кристалл','стекло','мука','сахар',
  'травка','трава','шишки','бошки','косяк','джойнт','блант',
  'кислота','эйсид','марки',
  'кет','калипсо',
  'бутер','вода',
  'ширка','ширяться','дурь','колёса',
  'weed','acid','molly','coke','smack','crack',
];
const DRUG_CONTEXT_ALL = [
  ...new Set([...DRUG_CONTEXT_STATIC, ...BW.drugs.context_sale])
];

/* --- Финальные паттерны --- */
const DRUGS_STATIC: RegExp[] = [
  /* EN: sale + drug */
  /\b(buy|sell|selling|dealer|deal)\b.{0,50}\b(cocaine|heroin|meth|methamphetamine|fentanyl|mdma|lsd|ecstasy|weed|ketamine|crack)\b/i,
  /\b(cocaine|heroin|meth|methamphetamine|fentanyl|mdma|lsd|ecstasy|ketamine|crack)\b.{0,50}\b(buy|sell|gram|grams|oz|kilo|delivery|price)\b/i,
  /\bdrug\s*(deal|dealer|shop|market|store)\b/i,
  /* Даркнет */
  /(дарк|dark).{0,10}(маркет|net|market)/i,
  /darknet.{0,20}(купить|магазин|shop|buy)/i,
  /* Синтез */
  /(как\s*сделать|инструкция|синтез).{0,25}(наркот|амфет|кокаин|мефедрон|метамф)/i,
  /\b(how\s*to\s*(make|cook|synthesize)).{0,25}(meth|cocaine|heroin|drug)\b/i,
  /* Употребление */
  /(ширяться|колоться|нюхать|дунуть|курнуть).{0,25}(кокс|героин|меф|амфет|гашиш)/i,
  /* Жаргон продажа */
  /(кокс|герыч|меф|солевой).{0,30}(купить|продам|дозировка|доставка|закладка|грамм|цена)/i,
  /(купить|продам|доставка|закладка|оптом).{0,30}(кокс|герыч|меф|солевой)/i,
  /* Рецептурные */
  /(продам|купить|без\s*рецепта).{0,25}(трамадол|лирика|прегабалин|оксикодон|оксиконтин)/i,
  /\b(sell|buy|no\s*prescription).{0,25}(oxycontin|oxycodone|tramadol|pregabalin|lyrica|adderall)\b/i,
  /* Немецкий */
  /\b(kaufen|verkaufen).{0,30}(kokain|heroin|meth|drogen|ecstasy|mdma)\b/i,
  /* Португальский */
  /\b(comprar|vender).{0,30}(cocaína|heroína|metanfetamina|drogas|ecstasy)\b/i,
];

/* Паттерн 1: standalone-слово → сразу блок */
const DRUGS_STANDALONE_RE = new RegExp(wordGroup(DRUG_STANDALONE_ALL), 'i');

/* Паттерн 2: сленг + контекст продажи (с обеих сторон) */
const _slang = wordGroup(DRUG_CONTEXT_ALL);
const _sale  = wordGroup(SALE_WORDS_ALL);
const DRUGS_CONTEXT_RE_FWD = new RegExp(`${_sale}.{0,60}${_slang}`, 'i');
const DRUGS_CONTEXT_RE_BWD = new RegExp(`${_slang}.{0,60}${_sale}`, 'i');

/* Комбинированная: RU продажа + standalone */
const _standalone = wordGroup(DRUG_STANDALONE_ALL);
const DRUGS_COMBO_RU_FWD = new RegExp(`${_sale}.{0,50}${_standalone}`, 'i');
const DRUGS_COMBO_RU_BWD = new RegExp(`${_standalone}.{0,50}${_sale}`, 'i');

const DRUGS_PATTERNS: RegExp[] = [
  DRUGS_STANDALONE_RE,
  DRUGS_COMBO_RU_FWD,
  DRUGS_COMBO_RU_BWD,
  DRUGS_CONTEXT_RE_FWD,
  DRUGS_CONTEXT_RE_BWD,
  ...DRUGS_STATIC,
];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 4: НАСИЛИЕ
═══════════════════════════════════════════════════════════════════ */
const VIOLENCE_STATIC: RegExp[] = [
  /(я\s*(тебя|вас|его|её)).{0,10}(убью|прибью|зарежу|застрелю|взорву|убить|прикончу)/i,
  /\b(I('ll|\s*will)\s*(kill|murder|shoot|stab|blow\s*up)).{0,20}(you|him|her|them)\b/i,
  /(угрожаю|угроза\s*убийством|расправлюсь)/i,
  /(заказать|нанять).{0,20}(убийц|киллер|hit\s*man)/i,
  /\b(hire|contract).{0,20}(killer|assassin|hitman)\b/i,
  /(как\s*(сделать|собрать|зарядить)).{0,20}(бомб|взрывчатк|гранат|оружи)/i,
  /\b(how\s*to\s*(make|build|assemble)).{0,20}(bomb|explosive|weapon|gun)\b/i,
  /(пытки|torture).{0,20}(видео|video|фото|photo)/i,
];

const VIOLENCE_DYNAMIC: RegExp[] = BW.violence.standalone.length
  ? [new RegExp(wordGroup(BW.violence.standalone), 'i')]
  : [];

const VIOLENCE_PATTERNS = [...VIOLENCE_STATIC, ...VIOLENCE_DYNAMIC];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 5: ЭКСТРЕМИЗМ
═══════════════════════════════════════════════════════════════════ */
const EXTREMISM_PATTERNS: RegExp[] = [
  /\b(ИГИЛ|ISIS|ISIL|Daesh|Талибан|Taliban|Аль-?Каида|Al-?Qaeda|Хамас|Hamas)\b/i,
  /(джихад|jihad).{0,20}(объявить|призыв|за\s*веру|kill|attack|war)/i,
  /(террор|terror).{0,20}(атак|планируется|готовимся|bomb|strike)/i,
  /(смерть\s*(евреям|мусульманам|русским|украинцам|чёрным|геям))/i,
  /\b(death\s*to\s*(jews|muslims|christians|blacks|gays|infidels))\b/i,
  /\b(nigger|kike|spic|chink|gook)\b/i,
  /(нигер|жид|чурка|хач|чёрный.{0,5}обезьяна)/i,
  /\b(heil\s*hitler|sieg\s*heil|nazi)\b/i,
  /(нацис[т]?|гитлер.{0,10}(молодец|прав|герой))/i,
  /(свергнуть|свержение).{0,20}(правительств|власт|государств)/i,
  /\b(overthrow|topple).{0,20}(government|state|regime)\b/i,
];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 6: МОШЕННИЧЕСТВО
═══════════════════════════════════════════════════════════════════ */
const FRAUD_STATIC: RegExp[] = [
  /(фальшивые|поддельные|купить\s*фальшив).{0,20}(паспорт|документ|диплом|удостоверени|права|visa|passport)/i,
  /\b(fake|forged|buy\s*fake).{0,20}(passport|id|diploma|degree|license)\b/i,
  /(купить|продам).{0,20}(аккаунт.{0,10}(vk|instagram|tiktok|bank|банк))/i,
  /(взлом|хак|hack).{0,20}(аккаунт|пароль|password|account)/i,
  /(фишинг|phishing)/i,
  /(кардинг|carding|дамп\s*карты|cc\s*dump)/i,
  /(money\s*laundering|отмывание\s*денег)/i,
  /(пирамида|финансовая\s*пирамида|ponzi)/i,
  /(нигерийское\s*письмо|advance\s*fee\s*fraud)/i,
];

const FRAUD_DYNAMIC: RegExp[] = BW.fraud.standalone.length
  ? [new RegExp(wordGroup(BW.fraud.standalone), 'i')]
  : [];

const FRAUD_PATTERNS = [...FRAUD_STATIC, ...FRAUD_DYNAMIC];

/* ═══════════════════════════════════════════════════════════════════
   КАТЕГОРИЯ 7: ХАРАССМЕНТ
═══════════════════════════════════════════════════════════════════ */
const HARASSMENT_PATTERNS: RegExp[] = [
  /(иди\s*на\s*хуй|пошёл\s*на\s*хуй|ебись\s*с\s*конём)/i,
  /(уёбок|мразь|тварь|сука|пиздец|пидор(ас)?|ебать)\s.{0,15}(ты|вы|тебя|вас)/i,
  /\b(go\s*kill\s*yourself|kys|neck\s*yourself)\b/i,
  /\b(I\s*(hope|wish)\s*you\s*(die|get\s*(cancer|raped|killed)))\b/i,
  /\b(dox|doxx|doxxing)\b/i,
  /(раскрою\s*(твой\s*адрес|где\s*ты\s*живёшь|личные\s*данные))/i,
];

/* ═══════════════════════════════════════════════════════════════════
   Главная функция
═══════════════════════════════════════════════════════════════════ */
export function filterText(raw: string): FilterResult {
  if (!raw || raw.trim().length === 0) return PASS;
  const text = normalize(raw);

  let rule = match(text, CSAM_PATTERNS);
  if (rule) return { blocked: true, category: 'csam', rule, severity: 'critical' };

  rule = match(text, PORN_PATTERNS);
  if (rule) return { blocked: true, category: 'porn', rule, severity: 'high' };

  rule = match(text, DRUGS_PATTERNS);
  if (rule) return { blocked: true, category: 'drugs', rule, severity: 'high' };

  rule = match(text, EXTREMISM_PATTERNS);
  if (rule) return { blocked: true, category: 'extremism', rule, severity: 'critical' };

  rule = match(text, VIOLENCE_PATTERNS);
  if (rule) return { blocked: true, category: 'violence', rule, severity: 'high' };

  rule = match(text, FRAUD_PATTERNS);
  if (rule) return { blocked: true, category: 'fraud', rule, severity: 'medium' };

  rule = match(text, HARASSMENT_PATTERNS);
  if (rule) return { blocked: true, category: 'harassment', rule, severity: 'medium' };

  return PASS;
}

/* Фильтрует несколько полей сразу, возвращает первое нарушение */
export function filterFields(fields: Record<string, string | undefined>): FilterResult {
  for (const [, value] of Object.entries(fields)) {
    if (!value) continue;
    const result = filterText(value);
    if (result.blocked) return result;
  }
  return PASS;
}
