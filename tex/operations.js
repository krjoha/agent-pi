/**
 * Text Tools — Pure Text Operations
 * Each function takes a string input and returns a transformed string.
 * No side effects, no DOM access.
 */

const TextOps = {

  // --- Whitespace Operations ---

  /**
   * Collapse 2+ consecutive spaces to a single space.
   * Preserves leading/trailing whitespace per line.
   */
  removeExtraSpaces(text) {
    return text.replace(/[^\S\n\r]{2,}/g, ' ');
  },

  /**
   * Remove extra line breaks:
   * - Joins lines that were hard-wrapped mid-paragraph (single newlines
   *   between non-empty lines become a space)
   * - Collapses runs of 3+ newlines down to a double newline
   * - Clears whitespace-only lines
   * - Preserves paragraph breaks (double newlines)
   * Normalizes \r\n to \n first.
   */
  removeExtraLineBreaks(text) {
    const normalized = text.replace(/\r\n/g, '\n');
    return normalized
      .replace(/^[ \t]+$/gm, '')                // clear whitespace-only lines
      .replace(/\n{3,}/g, '\n\n')               // collapse 3+ newlines to paragraph break
      .replace(/([^\n])\n([^\n])/g, '$1 $2')    // join single-newline wrapped lines
      .replace(/ {2,}/g, ' ');                   // clean up any resulting double spaces
  },

  /**
   * Strip leading and trailing whitespace from every line.
   */
  trimWhitespace(text) {
    return text
      .split('\n')
      .map(line => line.trim())
      .join('\n');
  },

  /**
   * Join all lines into a single continuous line, separated by a space.
   */
  removeAllLineBreaks(text) {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  },

  // --- Case Operations ---

  toUpperCase(text) {
    return text.toUpperCase();
  },

  toLowerCase(text) {
    return text.toLowerCase();
  },

  /**
   * Convert to Title Case — capitalize first letter of each word.
   * Lowercases everything first for consistency.
   */
  toTitleCase(text) {
    return text.toLowerCase().replace(/(?:^|\s|[-/])\S/g, char => char.toUpperCase());
  },

  /**
   * Convert to camelCase — first word lowercase, subsequent words capitalized,
   * all joined without spaces.
   */
  toCamelCase(text) {
    const words = text
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim()
      .split(/\s+/);
    if (words.length === 0) return '';
    return words[0].toLowerCase() + words.slice(1)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  },

  // --- Line Operations ---

  /**
   * Sort lines alphabetically (A-Z), case-insensitive.
   */
  sortLinesAZ(text) {
    const lines = text.split('\n');
    lines.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return lines.join('\n');
  },

  /**
   * Sort lines reverse alphabetically (Z-A), case-insensitive.
   */
  sortLinesZA(text) {
    const lines = text.split('\n');
    lines.sort((a, b) => b.localeCompare(a, undefined, { sensitivity: 'base' }));
    return lines.join('\n');
  },

  /**
   * Natural sort — handles embedded numbers correctly.
   * "item2" comes before "item10".
   */
  sortLinesNatural(text) {
    const lines = text.split('\n');
    lines.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return lines.join('\n');
  },

  /**
   * Remove duplicate lines, preserving first occurrence and original order.
   */
  removeDuplicateLines(text) {
    const seen = new Set();
    return text
      .split('\n')
      .filter(line => {
        if (seen.has(line)) return false;
        seen.add(line);
        return true;
      })
      .join('\n');
  },

  // --- Encode / Decode ---

  urlEncode(text) {
    return encodeURIComponent(text);
  },

  urlDecode(text) {
    try {
      return decodeURIComponent(text);
    } catch {
      return text; // Return original if malformed
    }
  },

  // --- Find and Replace ---

  /**
   * Find and replace with options.
   * @param {string} text - Input text
   * @param {string} find - Search string or regex pattern
   * @param {string} replace - Replacement string
   * @param {object} options
   * @param {boolean} options.useRegex - Treat `find` as a regex pattern
   * @param {boolean} options.caseSensitive - Case-sensitive matching
   * @returns {string}
   */
  findAndReplace(text, find, replace, options = {}) {
    if (!find) return text;
    const { useRegex = false, caseSensitive = true } = options;

    let flags = 'g';
    if (!caseSensitive) flags += 'i';

    try {
      const pattern = useRegex ? new RegExp(find, flags) : new RegExp(escapeRegex(find), flags);
      return text.replace(pattern, replace);
    } catch {
      return text; // Return original if regex is invalid
    }
  },

  // --- Stats ---

  /**
   * Returns character, word, and line counts.
   * @param {string} text
   * @returns {{ characters: number, words: number, lines: number }}
   */
  countStats(text) {
    if (!text || text.trim() === '') {
      return { characters: 0, words: 0, lines: 0 };
    }
    const characters = text.length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const lines = text.split('\n').length;
    return { characters, words, lines };
  }
};

// --- Helpers ---

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export for module usage (if needed) or attach to window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TextOps, escapeRegex };
}
