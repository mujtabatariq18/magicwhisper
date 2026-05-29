// ============================================
// MagicWhisper — Smart Text Processor
// ============================================
// Pipeline: raw transcription → cleaned, formatted text
// Handles: filler removal, correction detection,
// auto-punctuation, list formatting, dictionary
// substitution, and snippet expansion.
// ============================================

const { logger } = require('./logger');
const { DeveloperProcessor } = require('./developer-processor');

class TextProcessor {
  constructor(dictionary, snippets) {
    this.dictionary = dictionary;
    this.snippets = snippets;
    this.developerProcessor = new DeveloperProcessor();
  }

  /**
   * Process raw transcription through the full pipeline.
   * @param {string} rawText - Raw output from whisper
   * @returns {string} Cleaned and formatted text
   */
  process(rawText, options = {}) {
    if (!rawText || !rawText.trim()) return '';

    let text = rawText.trim();
    const original = text;

    // Pipeline order matters:
    // 1. Basic cleanup (extra spaces, trim)
    text = this.basicCleanup(text);

    // 2. Remove filler words
    text = this.removeFillers(text);

    // 3. Detect self-corrections ("at 2, actually 3" → "at 3")
    text = this.detectCorrections(text);

    // 4. Format numbered lists
    text = this.formatLists(text);

    // 5. Apply dictionary corrections
    if (this.dictionary) {
      text = this.dictionary.applyCorrections(text);
    }

    // 6. Expand snippets
    if (this.snippets) {
      text = this.snippets.expand(text);
    }

    // 7. Developer-aware formatting
    if (options.developerMode) {
      text = this.developerProcessor.process(text, {
        syntaxFormatting: options.developerSyntaxFormatting,
        fileTagging: options.developerFileTagging
      });
    }

    // 8. Auto-punctuation & capitalization
    text = this.autoPunctuation(text, { skipFinalPeriod: options.developerMode === true });

    // 9. Final cleanup
    text = this.finalCleanup(text);

    if (text !== original) {
      logger.debug('text-processor', 'Text processed', {
        originalLength: original.length,
        resultLength: text.length,
        original: original.slice(0, 80),
        result: text.slice(0, 80)
      });
    }

    return text;
  }

  /**
   * Basic cleanup — normalize whitespace.
   */
  basicCleanup(text) {
    return text
      .replace(/\s+/g, ' ')   // Collapse multiple spaces
      .replace(/\s*\.\s*/g, '. ')  // Normalize period spacing
      .trim();
  }

  /**
   * Remove common filler words.
   */
  removeFillers(text) {
    const fillers = [
      'um', 'uh', 'uhh', 'umm', 'erm',
      'hmm', 'hm', 'ah', 'eh',
      'you know', 'i mean', 'like,', 'so,',
      'basically,', 'literally,', 'actually,'
    ];

    let result = text;
    for (const filler of fillers) {
      // Match filler at word boundaries, optionally followed by comma
      const pattern = new RegExp(
        `\\b${this.escapeRegex(filler)}\\b,?\\s*`,
        'gi'
      );
      result = result.replace(pattern, ' ');
    }

    // Clean up double spaces left behind
    return result.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Detect self-corrections in speech.
   * Pattern: "X, actually Y" → Y
   * Pattern: "X, no wait Y" → Y
   * Pattern: "X, I mean Y" → Y
   */
  detectCorrections(text) {
    const patterns = [
      /(\b\w+(?:\s+\w+){0,3}),?\s*(?:actually|no wait|no,?\s+wait|I mean|sorry|correction)\s+(.+?)(?=[.,!?]|$)/gi,
    ];

    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, (match, before, after) => {
        logger.debug('text-processor', 'Self-correction detected', {
          before: before.trim(),
          after: after.trim()
        });
        return after.trim();
      });
    }

    return result;
  }

  /**
   * Format spoken lists into numbered/bulleted lists.
   * "1 apples 2 bananas 3 oranges" → "1. Apples\n2. Bananas\n3. Oranges"
   */
  formatLists(text) {
    // Detect pattern: "number word(s) number word(s) ..."
    const listPattern = /(?:^|\s)(\d+)\s+([^0-9]+?)(?=\s+\d+\s+|$)/g;
    const matches = [...text.matchAll(listPattern)];

    if (matches.length >= 2) {
      let formatted = '';
      for (const match of matches) {
        const num = match[1];
        const item = match[2].trim();
        formatted += `${num}. ${item.charAt(0).toUpperCase() + item.slice(1)}\n`;
      }
      return formatted.trim();
    }

    return text;
  }

  /**
   * Auto-punctuation and capitalization.
   */
  autoPunctuation(text, options = {}) {
    let result = text;

    // Capitalize first letter of the text
    result = result.charAt(0).toUpperCase() + result.slice(1);

    // Capitalize after sentence-ending punctuation
    result = result.replace(/([.!?])\s+(\w)/g, (match, punct, letter) => {
      return `${punct} ${letter.toUpperCase()}`;
    });

    // Add period at end if missing
    if (!options.skipFinalPeriod && result.length > 0 && !/[.!?]$/.test(result)) {
      result += '.';
    }

    // Handle spoken punctuation words
    result = result
      .replace(/\bperiod\b/gi, '.')
      .replace(/\bcomma\b/gi, ',')
      .replace(/\bquestion mark\b/gi, '?')
      .replace(/\bexclamation mark\b/gi, '!')
      .replace(/\bexclamation point\b/gi, '!')
      .replace(/\bcolon\b/gi, ':')
      .replace(/\bsemicolon\b/gi, ';')
      .replace(/\bnew line\b/gi, '\n')
      .replace(/\bnewline\b/gi, '\n')
      .replace(/\bnew paragraph\b/gi, '\n\n');

    // Clean up spacing around punctuation
    result = result
      .replace(/\s+([,.!?;:])/g, '$1')  // Remove space before punctuation
      .replace(/([,.!?;:])\s{2,}/g, '$1 ');  // Single space after punctuation

    return result;
  }

  /**
   * Final cleanup pass.
   */
  finalCleanup(text) {
    return text
      .replace(/\s{2,}/g, ' ')        // Collapse multiple spaces
      .replace(/\n{3,}/g, '\n\n')     // Max 2 consecutive newlines
      .replace(/^\s+|\s+$/gm, '')     // Trim each line
      .trim();
  }

  escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = { TextProcessor };
