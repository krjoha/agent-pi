/**
 * Text Tools — In-Memory History Manager
 * Records transformation snapshots (original + pipeline + result).
 * Bounded FIFO storage — no persistence, no external dependencies.
 */

const HistoryManager = (function () {
  'use strict';

  var MAX_ENTRIES = 50;
  var PREVIEW_LEN = 80;

  var entries = [];
  var selectedId = null;

  // --- Helpers ---

  function truncate(str, len) {
    if (!str) return '';
    if (str.length <= len) return str;
    return str.substring(0, len) + '\u2026';
  }

  function deepCopyPipeline(pipeline) {
    return pipeline.map(function (item) {
      var copy = { op: item.op, enabled: item.enabled };
      if (item.params) {
        copy.params = JSON.parse(JSON.stringify(item.params));
      } else {
        copy.params = null;
      }
      return copy;
    });
  }

  /**
   * Build a short human-readable label from the pipeline ops.
   */
  function buildOpsLabel(pipeline) {
    return pipeline
      .filter(function (item) { return item.enabled; })
      .map(function (item) { return item.op; });
  }

  /**
   * Compare two pipelines for equality (op names + enabled state + params).
   */
  function pipelinesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].op !== b[i].op) return false;
      if (a[i].enabled !== b[i].enabled) return false;
      if (JSON.stringify(a[i].params) !== JSON.stringify(b[i].params)) return false;
    }
    return true;
  }

  function formatTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    return (h < 10 ? '0' : '') + h + ':'
      + (m < 10 ? '0' : '') + m + ':'
      + (s < 10 ? '0' : '') + s;
  }

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- OP_LABELS mirror (kept in sync with app.js) ---

  var OP_LABELS = {
    removeExtraSpaces: 'Spaces',
    removeExtraLineBreaks: 'Line Breaks',
    trimWhitespace: 'Trim',
    removeAllLineBreaks: 'Flatten',
    toUpperCase: 'UPPER',
    toLowerCase: 'lower',
    toTitleCase: 'Title Case',
    toCamelCase: 'camelCase',
    sortLinesAZ: 'Sort A-Z',
    sortLinesZA: 'Sort Z-A',
    sortLinesNatural: 'Sort Natural',
    removeDuplicateLines: 'Dedup',
    urlEncode: 'URL Encode',
    urlDecode: 'URL Decode',
    findAndReplace: 'Find/Replace',
  };

  // --- Public API ---

  /**
   * Record a transformation snapshot.
   * Deduplicates against the most recent entry.
   * @param {string} original - Original input text
   * @param {Array} pipeline - Current pipeline state (will be deep-copied)
   * @param {string} result - Computed result text
   */
  function record(original, pipeline, result) {
    if (!original || !result) return;
    if (original === result) return;

    var pipelineCopy = deepCopyPipeline(pipeline);

    // Deduplicate: skip if identical to the most recent entry
    if (entries.length > 0) {
      var last = entries[entries.length - 1];
      if (last.originalFull === original && pipelinesEqual(last.pipeline, pipelineCopy)) {
        return;
      }
    }

    var entry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 6),
      timestamp: Date.now(),
      originalPreview: truncate(original.replace(/\n/g, ' '), PREVIEW_LEN),
      originalFull: original,
      pipeline: pipelineCopy,
      ops: buildOpsLabel(pipelineCopy),
      resultPreview: truncate(result.replace(/\n/g, ' '), PREVIEW_LEN),
      resultFull: result,
    };

    entries.push(entry);

    // FIFO eviction
    while (entries.length > MAX_ENTRIES) {
      entries.shift();
    }
  }

  /**
   * Get all entries, newest first.
   */
  function getEntries() {
    return entries.slice().reverse();
  }

  /**
   * Get a single entry by ID.
   */
  function getEntry(id) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  /**
   * Clear all history.
   */
  function clear() {
    entries = [];
    selectedId = null;
  }

  /**
   * Get entry count.
   */
  function count() {
    return entries.length;
  }

  /**
   * Get/set the currently selected entry ID.
   */
  function getSelectedId() {
    return selectedId;
  }

  function setSelectedId(id) {
    selectedId = id;
  }

  /**
   * Render the history entries into a container element.
   * @param {HTMLElement} containerEl - The DOM element to render into
   * @param {object} callbacks - { onSelect(entry), onRestore(entry) }
   */
  function renderPanel(containerEl, callbacks) {
    containerEl.innerHTML = '';

    var displayEntries = getEntries();

    if (displayEntries.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'No history yet';
      containerEl.appendChild(empty);
      return;
    }

    displayEntries.forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'history-row' + (entry.id === selectedId ? ' selected' : '');
      row.dataset.id = entry.id;

      // Time column
      var timeCol = document.createElement('span');
      timeCol.className = 'history-col-time';
      timeCol.textContent = formatTime(entry.timestamp);

      // Original preview column
      var origCol = document.createElement('span');
      origCol.className = 'history-col-original';
      origCol.textContent = entry.originalPreview;

      // Ops column — mini pills
      var opsCol = document.createElement('span');
      opsCol.className = 'history-col-ops';
      entry.ops.forEach(function (opName) {
        var pill = document.createElement('span');
        pill.className = 'history-mini-pill';
        pill.textContent = OP_LABELS[opName] || opName;
        opsCol.appendChild(pill);
      });

      // Result preview column
      var resultCol = document.createElement('span');
      resultCol.className = 'history-col-result';
      resultCol.textContent = entry.resultPreview;

      row.appendChild(timeCol);
      row.appendChild(origCol);
      row.appendChild(opsCol);
      row.appendChild(resultCol);

      // Click to select
      row.addEventListener('click', function () {
        selectedId = entry.id;
        // Update selection visual
        containerEl.querySelectorAll('.history-row').forEach(function (r) {
          r.classList.toggle('selected', r.dataset.id === entry.id);
        });
        if (callbacks && callbacks.onSelect) {
          callbacks.onSelect(entry);
        }
      });

      // Double-click to restore
      row.addEventListener('dblclick', function () {
        if (callbacks && callbacks.onRestore) {
          callbacks.onRestore(entry);
        }
      });

      containerEl.appendChild(row);
    });
  }

  return {
    record: record,
    getEntries: getEntries,
    getEntry: getEntry,
    clear: clear,
    count: count,
    getSelectedId: getSelectedId,
    setSelectedId: setSelectedId,
    renderPanel: renderPanel,
  };

})();

// Export for module usage (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HistoryManager: HistoryManager };
}
