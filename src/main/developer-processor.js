// ============================================
// MagicWhisper - Developer Dictation Processor
// ============================================
// Adds syntax-aware cleanup for coding prompts:
// developer jargon, spoken case transforms, file
// tags, and common code punctuation.
// ============================================

const DEV_TERMS = [
  ['super base', 'Supabase'],
  ['mongo db', 'MongoDB'],
  ['cloud flare', 'Cloudflare'],
  ['ver sell', 'Vercel'],
  ['versell', 'Vercel'],
  ['next js', 'Next.js'],
  ['react js', 'React.js'],
  ['node js', 'Node.js'],
  ['type script', 'TypeScript'],
  ['java script', 'JavaScript'],
  ['git hub', 'GitHub'],
  ['post gres', 'Postgres'],
  ['post gre sql', 'PostgreSQL'],
  ['my sequel', 'MySQL'],
  ['sql lite', 'SQLite'],
  ['docker compose', 'Docker Compose'],
  ['kuber netes', 'Kubernetes'],
  ['open ai', 'OpenAI'],
  ['chat gpt', 'ChatGPT'],
  ['g p t', 'GPT'],
  ['api', 'API'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['http', 'HTTP'],
  ['https', 'HTTPS'],
  ['cli', 'CLI'],
  ['ui', 'UI'],
  ['ux', 'UX'],
  ['sdk', 'SDK'],
  ['jwt', 'JWT'],
  ['uuid', 'UUID'],
  ['css', 'CSS'],
  ['html', 'HTML']
];

const FILE_EXTENSIONS = [
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'json', 'md', 'css', 'scss', 'html',
  'py', 'php', 'rb', 'go', 'rs', 'java',
  'kt', 'swift', 'cs', 'cpp', 'c', 'h',
  'sql', 'yml', 'yaml', 'toml', 'env'
];

class DeveloperProcessor {
  process(text, options = {}) {
    if (!text) return text;

    let result = text;
    result = this.applyDeveloperTerms(result);

    if (options.fileTagging !== false) {
      result = this.applyFileTags(result);
    }

    if (options.syntaxFormatting !== false) {
      result = this.applyCaseCommands(result);
      result = this.applyCodePunctuation(result);
      result = this.cleanupCodeSpacing(result);
    }

    return result;
  }

  applyDeveloperTerms(text) {
    let result = text;
    for (const [spoken, written] of DEV_TERMS) {
      const regex = new RegExp(`\\b${this.escapeRegex(spoken)}\\b`, 'gi');
      result = result.replace(regex, written);
    }
    return result;
  }

  applyFileTags(text) {
    const extPattern = FILE_EXTENSIONS.join('|');
    return text.replace(
      /(?:\b(?:tag|mention|reference|open)\s+)?(?:the\s+)?\bfile\s+([a-z0-9][a-z0-9 _./-]{0,80}?)\s+(js|jsx|ts|tsx|mjs|cjs|json|md|css|scss|html|py|php|rb|go|rs|java|kt|swift|cs|cpp|c|h|sql|yml|yaml|toml|env)\b/gi,
      (match, name, ext) => {
        const normalizedExt = ext.toLowerCase();
        const normalizedName = name
          .trim()
          .replace(/\s+dot\s+/gi, '.')
          .replace(/\s+slash\s+/gi, '/')
          .replace(/\s+dash\s+/gi, '-')
          .replace(/\s+underscore\s+/gi, '_')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .replace(/([./_-])-+/g, '$1')
          .replace(/-+([./_-])/g, '$1');

        const filename = normalizedName.toLowerCase().endsWith(`.${normalizedExt}`)
          ? normalizedName
          : `${normalizedName}.${normalizedExt}`;

        return `@${filename}`;
      }
    ).replace(new RegExp(`\\b([a-z0-9][a-z0-9_-]{0,50})\\s+dot\\s+(${extPattern})\\b`, 'gi'), '@$1.$2');
  }

  applyCaseCommands(text) {
    return text.replace(
      /\b(camel|snake|pascal|kebab)\s+case\s+([a-zA-Z0-9]+(?:\s+[a-zA-Z0-9]+){0,5})(?=[.,;:!?)]|$)/gi,
      (match, mode, phrase) => this.toCase(mode.toLowerCase(), phrase)
    );
  }

  applyCodePunctuation(text) {
    const replacements = [
      [/\bopen paren\b/gi, '('],
      [/\bclose paren\b/gi, ')'],
      [/\bopen bracket\b/gi, '['],
      [/\bclose bracket\b/gi, ']'],
      [/\bopen brace\b/gi, '{'],
      [/\bclose brace\b/gi, '}'],
      [/\bdouble quote\b/gi, '"'],
      [/\bsingle quote\b/gi, "'"],
      [/\bback tick\b/gi, '`'],
      [/\bbacktick\b/gi, '`'],
      [/\bdouble equals\b/gi, '=='],
      [/\btriple equals\b/gi, '==='],
      [/\bnot equals\b/gi, '!='],
      [/\bgreater than or equal\b/gi, '>='],
      [/\bless than or equal\b/gi, '<='],
      [/\bgreater than\b/gi, '>'],
      [/\bless than\b/gi, '<'],
      [/\bequals\b/gi, '='],
      [/\barrow\b/gi, '=>'],
      [/\bslash\b/gi, '/'],
      [/\bbackslash\b/gi, '\\'],
      [/\bunderscore\b/gi, '_'],
      [/\bdash\b/gi, '-'],
      [/\bpipe\b/gi, '|']
    ];

    let result = text;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

  cleanupCodeSpacing(text) {
    return text
      .replace(/\s+([()[\]{}.,;:])/g, '$1')
      .replace(/([([{])\s+/g, '$1')
      .replace(/\s*(=>|===|==|!=|>=|<=|=|\+|\*|\|)\s*/g, ' $1 ')
      .replace(/@([a-z0-9._/-]+)\s+\./gi, '@$1.')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  toCase(mode, phrase) {
    const words = phrase
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(Boolean);

    if (words.length === 0) return phrase;

    const lower = words.map((word) => word.toLowerCase());
    if (mode === 'snake') return lower.join('_');
    if (mode === 'kebab') return lower.join('-');

    const titled = lower.map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    if (mode === 'pascal') return titled.join('');
    return lower[0] + titled.slice(1).join('');
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = { DeveloperProcessor };
