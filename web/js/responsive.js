(function () {
    'use strict';

    var MOBILE_BREAKPOINT = 767;

    function isMobile() {
        return window.innerWidth <= MOBILE_BREAKPOINT;
    }

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
