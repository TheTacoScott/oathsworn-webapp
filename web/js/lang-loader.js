// Language codes to attempt loading at startup.
// Files that don't exist (data/strings_XX.js) are silently skipped.
// Add entries here to try more languages; remove entries to skip them.
window.LANG_CODES = [
    // Germanic
    'de', 'nl', 'sv', 'no', 'da', 'is', 'af',
    // Romance
    'fr', 'es', 'it', 'pt', 'ro', 'ca', 'gl',
    // Slavic
    'pl', 'cs', 'sk', 'ru', 'uk', 'bg', 'sr', 'hr', 'sl', 'mk',
    // Baltic / Finno-Ugric
    'lt', 'lv', 'et', 'fi', 'hu',
    // Other European
    'el', 'sq',
    // Middle Eastern / South Asian
    'tr', 'he', 'ar', 'fa', 'ur', 'hi', 'bn',
    // Caucasian / Central Asian
    'hy', 'ka', 'kk', 'uz',
    // East / Southeast Asian
    'ja', 'ko', 'zh', 'vi', 'th', 'id', 'ms',
];

/**
 * Dynamically loads all language script files listed in LANG_CODES.
 * Missing files trigger an error event and are silently skipped.
 * Returns a Promise that resolves when all load/error events have fired.
 */
window.loadLanguageFiles = function() {
    return Promise.all(LANG_CODES.map(function(lang) {
        return new Promise(function(resolve) {
            var s = document.createElement('script');
            s.src = 'data/strings_' + lang + '.js';
            s.onload = resolve;
            s.onerror = resolve;
            document.head.appendChild(s);
        });
    }));
};
