/**
 * The vocabulary of the synthetic workspace the @-mention replay (MEN-X-07) generates
 * (`sessions.ts`): title families, database names, people and the families new pages come from.
 *
 * A title family lists titles and, where rules cannot derive what a user types (non-ASCII text,
 * emoji, the traps below), the forms users type, the habitual one first. Forms are typed one code
 * point at a time, and every prefix is replayed.
 *
 * Traps the set carries on purpose:
 * - 30 pages titled exactly `Meeting notes`, so an exact title is often not unique;
 * - diacritics typed with and without their accents, and letters the contract's normalizer does
 *   not fold (`ø`, `Ł`, `æ`, `ß` and the curly quote, decision D1), so some typed forms stop
 *   matching part way;
 * - Greek capitals ending in `Σ`, which the contract lowercases to `σ` code point by code point,
 *   while JavaScript's whole-string `toLowerCase` gives the final `ς`: a port that lowercases the
 *   whole string tiers these titles differently;
 * - Han, kana and Hangul titles and names (CJK contains is T2; Hangul syllables decompose);
 * - emoji, which count one code point and two UTF-16 units;
 * - titles past 128 and past 512 code points;
 * - 200 people on one address domain, which today's substring filter matches for everyone.
 *
 * Escapes stand for characters an editor could change or hide: the en dash, the curly quote and
 * the ideographic space.
 */

/** A title, and the forms users type to find it when rules cannot derive them. */
export type MentionEvalTitle = readonly [title: string, forms?: readonly string[]];

/** A person: their name as shown, the address local part, and the forms users type when rules cannot derive them. */
export type MentionEvalPersonEntry = readonly [name: string, local: string, forms?: readonly string[]];

const EN_DASH = '\u2013';
const CURLY_APOSTROPHE = '\u2019';

/** Exact `Meeting notes` pages that exist before the replay starts; 18 more are created during it. */
export const PREEXISTING_MEETING_NOTES = 12;
/** Exact `Meeting notes` pages created during the replay. */
export const CREATED_MEETING_NOTES = 18;
export const MEETING_NOTES = 'Meeting notes';

/** Fixed pages that exist before the replay starts (the `Meeting notes` duplicates are added apart). */
export const FIXED_PAGES: readonly MentionEvalTitle[] = [
  // Meeting notes variants.
  [`Meeting notes ${EN_DASH} Design`],
  [`Meeting notes ${EN_DASH} Engineering`],
  [`Meeting notes ${EN_DASH} Sales`],
  ['Meeting notes template'],
  ['Meetings index'],
  ['Team meeting agenda'],
  ['All-hands meeting notes'],
  ['Board meeting prep'],
  ['Design meeting notes'],
  ['Engineering meeting notes'],
  // A roadmap family: a short exact title that starts longer ones.
  ['Roadmap'],
  ['Roadmap 2026'],
  ['Roadmap 2027'],
  ['Roadmap Q1 2026'],
  ['Roadmap Q2 2026'],
  ['Roadmap Q3 2026'],
  ['Roadmap Q4 2026'],
  ['Product roadmap'],
  ['Mobile roadmap'],
  ['Web roadmap'],
  ['Desktop roadmap'],
  ['AI roadmap'],
  ['Roadmap review'],
  ['Road trip planning'],
  ['Roadshow deck'],
  // Plans and budgets.
  ['Budget'],
  ['Budget 2026'],
  ['Marketing budget'],
  ['Budget review Q3'],
  ['Plan'],
  ['Planning'],
  ['Planning poker'],
  ['Launch plan'],
  ['Hiring plan 2026'],
  ['Marketing plan'],
  ['Sprint planning'],
  ['Capacity planning'],
  // Diacritics, typed with and without accents. `ø`, `Ł`, `æ`, `ß` and the curly quote do not fold (D1).
  ['Résumé', ['resume', 'résumé', 're']],
  ['Résumé template', ['resume t', 'résumé template']],
  ['Café menu', ['cafe', 'café menu', 'menu']],
  ['Café opening checklist', ['cafe op', 'café']],
  ['Crème brûlée recipe', ['creme', 'brulee']],
  ['Crème de la crème', ['creme de']],
  ['São Paulo offsite', ['sao paulo', 'são', 'offsite']],
  ['Zürich office move', ['zurich', 'zür']],
  ['Ångström lab notes', ['angstrom', 'ång']],
  ['Naïve Bayes experiments', ['naive', 'bayes']],
  ['Smørrebrød party', ['smør', 'smorre']],
  ['Łódź trip', ['łódź', 'lodz']],
  ['Müller account review', ['muller', 'müller']],
  ['Peña contract', ['pena', 'peña c']],
  [`Señor Frog${CURLY_APOSTROPHE}s launch`, ['senor', "señor frog's"]],
  ['Mañana backlog', ['manana', 'mañana']],
  ['Façade redesign', ['facade', 'façade']],
  ['Piñata planning', ['pinata']],
  ['Jalapeño recipes', ['jalapeno']],
  ['Déjà vu bugs', ['deja vu', 'déjà']],
  ['Fiancé visa checklist', ['fiance']],
  ['Über cool ideas', ['uber', 'über']],
  ['Ærø ferry schedule', ['ærø', 'aero']],
  ['Straße map', ['straße', 'strasse']],
  ['Encyclopædia draft', ['encyclopaedia', 'encyclo']],
  // Greek capitals ending in Σ: the contract lowercases them to σ, so a typed ς stops matching.
  ['ΟΔΟΣ ΠΡΟΣ ΤΗΝ ΚΥΚΛΟΦΟΡΙΑ', ['ΟΔΟΣ', 'οδος π', 'οδο']],
  ['ΟΔΟΣ 2026', ['ΟΔΟΣ 2026', 'οδος']],
  ['ΟΔΗΓΟΣ ΧΡΗΣΗΣ', ['οδηγ', 'ΟΔΗΓΟΣ']],
  ['ΚΟΣΜΟΣ notes', ['κοσμος', 'ΚΟΣΜΟΣ']],
  ['Οδός Αθηνάς', ['οδος αθ', 'ΟΔΟΣ']],
  ['Σχέδιο ΟΔΟΣ', ['σχεδ', 'σχεδιο οδος']],
  // Han, kana and Hangul.
  ['路线图', ['路线', '路线图']],
  ['路线图 2026', ['路线图 2', '路线']],
  ['产品路线图', ['路线图', '产品']],
  ['路线规划', ['路线规', '规划']],
  ['季度计划', ['季度', '季度计划']],
  ['季度总结', ['季度总', '总结']],
  ['第一季度目标', ['第一季度', '季度目标']],
  ['第二季度目标', ['第二', '季度目标']],
  ['第三季度目标', ['第三季度', '季度']],
  ['第四季度目标', ['第四', '季度目标']],
  ['季度复盘', ['季度复', '复盘']],
  ['会议纪要', ['会议', '会议纪要']],
  ['会议纪要 2026-09-28', ['会议纪要 2026', '会议']],
  ['周报 第40周', ['周报', '周报 第40']],
  ['周报 第39周', ['周报 第39', '周报']],
  ['项目计划', ['项目', '项目计划']],
  ['需求文档', ['需求', '需求文档']],
  ['产品需求文档', ['需求文档', '产品需求']],
  ['设计评审', ['设计评', '设计']],
  ['用户访谈记录', ['用户访谈', '访谈']],
  ['竞品分析', ['竞品', '竞品分析']],
  ['議事録', ['議事', '議事録']],
  ['会議メモ', ['会議', '会議メモ']],
  ['ロードマップ', ['ロード', 'ロードマップ']],
  ['ロードマップ 2026', ['ロードマップ 2', 'ロード']],
  ['週報', ['週報']],
  ['企画書', ['企画', '企画書']],
  ['プロジェクト計画', ['プロジェクト', '計画']],
  ['採用計画', ['採用', '計画']],
  ['회의록', ['회의', '회의록']],
  ['로드맵', ['로드맵', '로드']],
  ['주간 보고', ['주간', '주간 보고']],
  ['분기 계획', ['분기', '계획']],
  ['제품 기획서', ['기획', '제품 기획']],
  ['Q3 季度计划', ['q3', '季度']],
  ['Design 设计稿', ['design', '设计']],
  ['AppFlowy 用户手册', ['appflowy', '用户手册']],
  // Emoji: one code point, two UTF-16 units, never part of a word.
  ['🚀 Launch plan', ['launch', 'launch pl']],
  ['🐛 Bug triage', ['bug', 'bug tri']],
  ['📅 Content calendar', ['content cal', 'calendar']],
  ['✅ Done list', ['done']],
  ['🔥 Hot topics', ['hot', 'topics']],
  ['Launch 🚀 checklist', ['launch', 'launch che']],
  // Long titles, past 128 and past 512 code points.
  [
    'Notes from the quarterly all-hands: what we shipped, what slipped, the hiring plan for the ' +
      'next two quarters, and the questions people asked at the end of the session',
  ],
  [
    'Onboarding guide for new engineers joining the platform team in 2026, covering tooling, code ' +
      'review, on-call, deployment and the release train',
  ],
  [
    'Architecture decision record: moving search indexing out of the request path and into the ' +
      'worker, with a queue, retries and an audit trail',
  ],
  [
    'Retrospective: ' +
      (
        'the launch went out a week late because the migration needed a second rehearsal, the ' +
        'support queue doubled for three days, and the status page lagged the incident by forty ' +
        'minutes. '
      ).repeat(3),
  ],
  [
    `Customer feedback digest ${EN_DASH} ` +
      (
        'customers asked for offline mode, faster search, better mentions, shared templates, ' +
        'calendar views, granular permissions and an export that keeps comments. '
      ).repeat(4),
  ],
  [
    '年度总结报告：' +
      '我们完成了产品的重大改版，团队扩大了一倍，用户数量持续增长，同时也遇到了稳定性和性能方面的挑战。'.repeat(12),
    ['年度总结', '年度'],
  ],
  // Untitled pages.
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
  ['Untitled'],
];

/** Databases that exist before the replay starts, as they are, and with a team after them. */
export const DATABASE_BASES: readonly MentionEvalTitle[] = [
  ['Task tracker'],
  ['Bug tracker'],
  ['CRM'],
  ['Content calendar'],
  ['OKR tracker'],
  ['Reading list'],
  ['Hiring pipeline'],
  ['Inventory'],
  ['Customer feedback'],
  ['Sprint board'],
  ['Roadmap board'],
  ['Release tracker'],
  ['Expense log'],
  ['Vendor list'],
  ['Asset library'],
  ['Meeting tracker'],
  ['Feature requests'],
  ['Leads'],
  ['Contacts'],
  ['Projects'],
  ['Tasks'],
  ['Bugs'],
  ['Goals'],
  ['Habit tracker'],
  ['Recipes'],
  ['任务看板', ['任务', '看板']],
  ['客户管理', ['客户']],
  ['タスク管理', ['タスク']],
  ['업무 관리', ['업무']],
  ['Résumé database', ['resume d', 'résumé']],
];
/** Teams a database name takes after an en dash. */
export const DATABASE_TEAMS: readonly string[] = [
  'Mobile',
  'Web',
  'Desktop',
  'Growth',
  'Sales',
  'Support',
  'Design',
  'Platform',
];
/** Databases that exist before the replay starts. */
export const PREEXISTING_DATABASES = 185;
export const DATABASE_TEAM_SEPARATOR = ` ${EN_DASH} `;

/** Topics of the generated page titles. */
export const TOPICS: readonly string[] = [
  'API',
  'Auth',
  'Billing',
  'Brand',
  'Checkout',
  'Cloud',
  'Data',
  'Design',
  'Docs',
  'Editor',
  'Growth',
  'Hiring',
  'Infra',
  'Launch',
  'Mobile',
  'Onboarding',
  'Payments',
  'Platform',
  'Pricing',
  'Product',
  'Research',
  'Sales',
  'Search',
  'Security',
  'Support',
  'Sync',
  'Web',
  'Desktop',
  'Marketing',
  'Legal',
  'Finance',
  'Analytics',
  'Partnerships',
  'Community',
  'Release',
  'Testing',
  'Performance',
  'Accessibility',
  'Localization',
  'Notifications',
  'Mentions',
  'Comments',
  'Databases',
  'Templates',
  'AI',
  'Calendar',
  'Kanban',
  'Import',
  'Export',
  'Sharing',
  'Permissions',
  'Workspace',
  'Offline',
  'Plugins',
  'Themes',
  'Shortcuts',
  'Backup',
  'Migration',
  'Ops',
  'Feedback',
];
/** Kinds of document of the generated page titles. */
export const DOC_TYPES: readonly string[] = [
  'spec',
  'notes',
  'plan',
  'review',
  'checklist',
  'guide',
  'proposal',
  'brief',
  'retro',
  'FAQ',
  'runbook',
  'postmortem',
  'OKRs',
  'report',
  'summary',
  'ideas',
  'backlog',
  'playbook',
  'handbook',
  'research',
  'interview notes',
  'sync',
  'kickoff',
  'timeline',
  'budget',
  'metrics',
  'dashboard',
  'design doc',
  'requirements',
  'test plan',
  'launch checklist',
  'release notes',
  'roadmap',
  'strategy',
  'analysis',
  'survey results',
  'competitive analysis',
  'user stories',
  'wireframes',
  'architecture',
  'API reference',
  'style guide',
  'onboarding',
  'training',
  'offsite agenda',
];
/** What a generated page title may end with; most end with nothing. */
export const QUALIFIERS: readonly string[] = [
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  ' 2026',
  ' v2',
  ' (draft)',
  ' Q3',
  ` ${EN_DASH} archive`,
  ' for Mobile',
  ' WIP',
];

/**
 * What a page or database created during the replay is, most likely first: the families are drawn
 * by Zipf weight. `{date}` is the creation day, `{topic}` a topic, `{doc}` a kind of document,
 * `{first}` and `{full}` a person's first or full name, `{sprint}` the sprint of the week.
 */
export const CREATED_FAMILIES: readonly { readonly pattern: string; readonly kind: 'page' | 'database' }[] = [
  { pattern: 'Meeting notes {date}', kind: 'page' },
  { pattern: 'Weekly sync {date}', kind: 'page' },
  { pattern: '1:1 {first}', kind: 'page' },
  { pattern: 'Sprint {sprint} retro', kind: 'page' },
  { pattern: '{topic} spec', kind: 'page' },
  { pattern: 'Untitled', kind: 'page' },
  { pattern: '会议纪要 {date}', kind: 'page' },
  { pattern: 'Draft: {topic} {doc}', kind: 'page' },
  { pattern: 'Interview: {full}', kind: 'page' },
  { pattern: '{topic} design review', kind: 'page' },
  { pattern: 'Incident {date}', kind: 'page' },
  { pattern: '{topic} brainstorm', kind: 'page' },
  { pattern: '{topic} tracker', kind: 'database' },
  { pattern: '{topic} roadmap', kind: 'page' },
];

/** The requester: the person who types every query. */
export const REQUESTER: MentionEvalPersonEntry = ['Avery Quinn', 'avery.quinn'];

/** First names, as shown and as an address writes them. */
export const FIRST_NAMES: readonly (readonly [name: string, ascii: string])[] = [
  ['Ava', 'ava'],
  ['Ben', 'ben'],
  ['Carlos', 'carlos'],
  ['Chloé', 'chloe'],
  ['Daniel', 'daniel'],
  ['Diana', 'diana'],
  ['Elena', 'elena'],
  ['Émile', 'emile'],
  ['Eva', 'eva'],
  ['Felix', 'felix'],
  ['François', 'francois'],
  ['Grace', 'grace'],
  ['Hannah', 'hannah'],
  ['Hugo', 'hugo'],
  ['Ian', 'ian'],
  ['Isabel', 'isabel'],
  ['Jack', 'jack'],
  ['James', 'james'],
  ['Jane', 'jane'],
  ['Javier', 'javier'],
  ['José', 'jose'],
  ['Julia', 'julia'],
  ['Karen', 'karen'],
  ['Kevin', 'kevin'],
  ['Laura', 'laura'],
  ['Léa', 'lea'],
  ['Liam', 'liam'],
  ['Lucía', 'lucia'],
  ['Marco', 'marco'],
  ['Maria', 'maria'],
  ['María', 'maria'],
  ['Mark', 'mark'],
  ['Martin', 'martin'],
  ['Mia', 'mia'],
  ['Michael', 'michael'],
  ['Nathan', 'nathan'],
  ['Nina', 'nina'],
  ['Noah', 'noah'],
  ['Olivia', 'olivia'],
  ['Oscar', 'oscar'],
  ['Paul', 'paul'],
  ['Pedro', 'pedro'],
  ['Rachel', 'rachel'],
  ['Raúl', 'raul'],
  ['Sarah', 'sarah'],
  ['Sofia', 'sofia'],
  ['Søren', 'soren'],
  ['Thomas', 'thomas'],
  ['Zoë', 'zoe'],
  ['Ana', 'ana'],
  ['Anna', 'anna'],
  ['Andrew', 'andrew'],
  ['Anders', 'anders'],
  ['Björn', 'bjorn'],
  ['Amélie', 'amelie'],
  ['Inès', 'ines'],
  ['Jürgen', 'jurgen'],
  ['Mateo', 'mateo'],
  ['Valentina', 'valentina'],
  ['Priya', 'priya'],
  ['Arjun', 'arjun'],
  ['Fatima', 'fatima'],
  ['Omar', 'omar'],
  ['Yusuf', 'yusuf'],
  ['Leila', 'leila'],
  ['Dmitri', 'dmitri'],
  ['Olga', 'olga'],
  ['Kofi', 'kofi'],
  ['Amara', 'amara'],
  ['Lars', 'lars'],
  ['Ingrid', 'ingrid'],
  ['Siobhán', 'siobhan'],
  ['Seán', 'sean'],
  ['Chiara', 'chiara'],
  ['Giulia', 'giulia'],
];

/** Last names, as shown and as an address writes them. */
export const LAST_NAMES: readonly (readonly [name: string, ascii: string])[] = [
  ['Smith', 'smith'],
  ['Johnson', 'johnson'],
  ['García', 'garcia'],
  ['Müller', 'muller'],
  ['Martin', 'martin'],
  ['Rossi', 'rossi'],
  ['Silva', 'silva'],
  ['Nguyen', 'nguyen'],
  ['Kim', 'kim'],
  ['Brown', 'brown'],
  ['Álvarez', 'alvarez'],
  ['Núñez', 'nunez'],
  ['Ødegaard', 'odegaard'],
  ['Ström', 'strom'],
  ['Dubois', 'dubois'],
  ['Lefèvre', 'lefevre'],
  ['Kowalski', 'kowalski'],
  ["O'Brien", 'obrien'],
  ['Andersen', 'andersen'],
  ['Fischer', 'fischer'],
  ['Moreau', 'moreau'],
  ['Costa', 'costa'],
  ['Novak', 'novak'],
  ['Horvat', 'horvat'],
  ['Jensen', 'jensen'],
  ['Laurent', 'laurent'],
  ['Becker', 'becker'],
  ['Weber', 'weber'],
  ['Schmidt', 'schmidt'],
  ['Popescu', 'popescu'],
  ['Ivanova', 'ivanova'],
  ['Patel', 'patel'],
  ['Khan', 'khan'],
  ['Okafor', 'okafor'],
  ['Haddad', 'haddad'],
  ['Larsen', 'larsen'],
  ['Virtanen', 'virtanen'],
  ['Kovačević', 'kovacevic'],
  ['Yılmaz', 'yilmaz'],
  ['Rodríguez', 'rodriguez'],
  ['Pérez', 'perez'],
  ['Gómez', 'gomez'],
  ['Fernández', 'fernandez'],
  ['Sánchez', 'sanchez'],
  ['Ramírez', 'ramirez'],
  ['Bianchi', 'bianchi'],
  ['Romano', 'romano'],
  ['Müller-Lüdenscheidt', 'muller-ludenscheidt'],
  ['Van der Berg', 'vanderberg'],
  ['De Souza', 'desouza'],
];

/** People whose forms rules cannot derive: Greek, Han, kana and Hangul names, and blank names. */
export const FIXED_PEOPLE: readonly MentionEvalPersonEntry[] = [
  ['Νίκος Παπαδόπουλος', 'nikos.papadopoulos', ['νικ', 'nikos', 'παπαδ']],
  ['ΑΛΕΞΗΣ ΚΩΝΣΤΑΝΤΙΝΟΥ', 'alexis.konstantinou', ['αλεξη', 'ΑΛΕΞΗΣ', 'alexis']],
  ['王伟', 'wang.wei', ['王伟', '王', 'wang']],
  ['王芳', 'wang.fang', ['王芳', '王']],
  ['李娜', 'li.na', ['李娜', 'li']],
  ['张敏', 'zhang.min', ['张', 'zhang']],
  ['刘洋', 'liu.yang', ['刘洋', 'liu']],
  ['陈静', 'chen.jing', ['陈', 'chen']],
  ['杨磊', 'yang.lei', ['杨磊', 'yang']],
  ['赵丽', 'zhao.li', ['赵', 'zhao']],
  ['黄勇', 'huang.yong', ['黄勇', 'huang']],
  ['田中太郎', 'taro.tanaka', ['田中', 'tanaka']],
  ['佐藤花子', 'hanako.sato', ['佐藤', 'sato']],
  ['鈴木一郎', 'ichiro.suzuki', ['鈴木', 'suzuki']],
  ['김민수', 'minsu.kim', ['김민', 'minsu', 'kim']],
  ['이서연', 'seoyeon.lee', ['이서연', 'seoyeon']],
  ['박지훈', 'jihoon.park', ['박지', 'park']],
  ['최유진', 'yujin.choi', ['최유진', 'yujin']],
  // Blank names (only White_Space): shown, matched and measured by the address.
  ['', 'ops', ['ops']],
  ['', 'finance-bot', ['finance', 'fin']],
  ['\u3000', 'noreply.reports', ['noreply', 'reports']],
  ['   ', 'ideas.inbox', ['ideas']],
];

/** The one address domain every person shares. */
export const PEOPLE_DOMAIN = 'acme.example';
