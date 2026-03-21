/**
 * Text Tools — Diff Engine
 * Computes word-level diffs between two texts and renders
 * annotated HTML for inline highlighting.
 */

const DiffEngine = {

  /**
   * Compute a word-level diff between two strings.
   * Returns an array of segments: { type: 'equal'|'added'|'removed', value: string }
   */
  computeDiff(oldText, newText) {
    const oldTokens = this.tokenize(oldText);
    const newTokens = this.tokenize(newText);
    const lcs = this.longestCommonSubsequence(oldTokens, newTokens);

    const segments = [];
    let oi = 0;
    let ni = 0;
    let li = 0;

    while (oi < oldTokens.length || ni < newTokens.length) {
      if (li < lcs.length) {
        // Emit removed tokens before next LCS match
        while (oi < oldTokens.length && oldTokens[oi] !== lcs[li]) {
          segments.push({ type: 'removed', value: oldTokens[oi] });
          oi++;
        }
        // Emit added tokens before next LCS match
        while (ni < newTokens.length && newTokens[ni] !== lcs[li]) {
          segments.push({ type: 'added', value: newTokens[ni] });
          ni++;
        }
        // Emit the matched token
        if (li < lcs.length) {
          segments.push({ type: 'equal', value: lcs[li] });
          oi++;
          ni++;
          li++;
        }
      } else {
        // Past LCS — remaining old tokens are removed, new are added
        while (oi < oldTokens.length) {
          segments.push({ type: 'removed', value: oldTokens[oi] });
          oi++;
        }
        while (ni < newTokens.length) {
          segments.push({ type: 'added', value: newTokens[ni] });
          ni++;
        }
      }
    }

    return this.mergeSegments(segments);
  },

  /**
   * Tokenize text into words and whitespace/newline tokens.
   * This preserves whitespace so the diff output reconstructs the original formatting.
   */
  tokenize(text) {
    if (!text) return [];
    // Split on word boundaries, keeping whitespace as separate tokens
    return text.match(/\S+|\s+/g) || [];
  },

  /**
   * Compute the Longest Common Subsequence of two token arrays.
   * Uses standard DP approach — O(n*m) but fine for typical text sizes.
   */
  longestCommonSubsequence(a, b) {
    const m = a.length;
    const n = b.length;

    // Optimization: bail on very large inputs to avoid freezing
    if (m * n > 500000) {
      return this.greedyLCS(a, b);
    }

    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        if (a[i - 1] === b[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to find the LCS
    const result = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (dp[i - 1][j] > dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return result;
  },

  /**
   * Greedy LCS fallback for very large texts.
   * Less optimal but avoids O(n*m) memory.
   */
  greedyLCS(a, b) {
    const result = [];
    let j = 0;
    for (let i = 0; i < a.length && j < b.length; i++) {
      if (a[i] === b[j]) {
        result.push(a[i]);
        j++;
      }
    }
    return result;
  },

  /**
   * Merge consecutive segments of the same type into single segments.
   */
  mergeSegments(segments) {
    if (segments.length === 0) return [];

    const merged = [{ ...segments[0] }];

    for (let i = 1; i < segments.length; i++) {
      const last = merged[merged.length - 1];
      if (segments[i].type === last.type) {
        last.value += segments[i].value;
      } else {
        merged.push({ ...segments[i] });
      }
    }

    return merged;
  },

  /**
   * Render diff segments as HTML with highlighting classes.
   * Returns an HTML string safe for innerHTML.
   */
  renderHTML(segments) {
    return segments.map(seg => {
      const escaped = this.escapeHTML(seg.value);
      switch (seg.type) {
        case 'removed':
          return `<span class="diff-removed">${escaped}</span>`;
        case 'added':
          return `<span class="diff-added">${escaped}</span>`;
        default:
          return `<span class="diff-equal">${escaped}</span>`;
      }
    }).join('');
  },

  /**
   * Escape HTML special characters.
   */
  escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DiffEngine };
}
