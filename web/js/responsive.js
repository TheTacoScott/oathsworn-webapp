(function () {
    'use strict';

    var MOBILE_BREAKPOINT = 767;

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

    // ----------------------------------------------------------------
    // Might Decks button: show only the first word on narrow screens
    // so it doesn't crowd the game header. Restored in full on wider
    // screens. Uses window.S() (exported from main.js) for i18n.
    // ----------------------------------------------------------------

    function updateMightButtonLabel() {
        var btn = document.getElementById('btn-might-open');
        if (!btn) return;

        if (isMobile()) {
            var full = (window.S && window.S('ui.might_decks')) || btn.textContent;
            btn.textContent = full.split(' ')[0] || full;
        } else {
            if (window.S) btn.textContent = window.S('ui.might_decks');
        }
    }

    // Wrap applyTranslations so our label override survives every sweep
    // (initial load, language change, screen re-renders).
    var _origApplyTranslations = window.applyTranslations;
    if (_origApplyTranslations) {
        window.applyTranslations = function () {
            _origApplyTranslations.apply(this, arguments);
            updateMightButtonLabel();
        };
    }

    // Initial DOM call once the document is ready
    document.addEventListener('DOMContentLoaded', updateMightButtonLabel);

    // Re-apply when the viewport changes (rotation, resize)
    var _resizeTimer;
    window.addEventListener('resize', function () {
        clearTimeout(_resizeTimer);
        _resizeTimer = setTimeout(updateMightButtonLabel, 120);
    });
    window.addEventListener('orientationchange', function () {
        setTimeout(updateMightButtonLabel, 250);
    });


    // ----------------------------------------------------------------
    // Chapter select: after the user taps a chapter item on mobile,
    // smooth-scroll the detail pane into view.
    //
    // selectChapterDetail() is also called programmatically on every
    // screen entry (auto-select) — those must NOT scroll so the user
    // sees the list first. A capturing click listener detects the
    // difference: it sets a flag before the item's own handler fires,
    // and the wrapper consumes and resets that flag immediately.
    // ----------------------------------------------------------------

    var _chapterUserClicked = false;

    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.chapter-list-item')) {
            _chapterUserClicked = true;
        }
    }, true); // capturing phase — fires before the item's click handler

    var _origSelectChapterDetail = window.selectChapterDetail;
    if (_origSelectChapterDetail) {
        window.selectChapterDetail = function (chNum) {
            var scrollAfter = isMobile() && _chapterUserClicked;
            _chapterUserClicked = false; // reset before original runs, in case of re-entrant calls
            _origSelectChapterDetail.call(this, chNum);
            if (scrollAfter) {
                var pane = document.querySelector('.chapters-detail-pane');
                if (pane) {
                    pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        };
    }

}());
