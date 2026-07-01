/* linkding-workers lightweight frontend interactions.
 * Replaces the original Turbo/Lit custom elements with small vanilla JS.
 */
(function () {
  "use strict";

  // Inject styles for the lightweight confirm popover.
  var style = document.createElement("style");
  style.textContent = [
    ".ld-confirm{position:absolute;z-index:600;background:var(--menu-bg-color,#fff);border:solid 1px var(--menu-border-color,#ccc);border-radius:var(--border-radius,4px);box-shadow:var(--box-shadow,0 0 8px rgba(0,0,0,.15));padding:var(--unit-3,.6rem);min-width:180px}",
    ".ld-confirm-question{font-size:var(--font-size,.8rem);margin-bottom:var(--unit-2,.4rem);color:var(--text-color,#333)}",
    ".ld-confirm-actions{display:flex;justify-content:flex-end;gap:var(--unit-1,.2rem)}"
  ].join("\n");
  document.head.appendChild(style);

  // ── Dropdowns ───────────────────────────────────────────────────
  // Toggle .active on .dropdown when .dropdown-toggle is clicked.
  function closeAllDropdowns(except) {
    document.querySelectorAll(".dropdown.active").forEach(function (d) {
      if (d !== except) d.classList.remove("active");
    });
  }
  document.addEventListener("click", function (e) {
    var toggle = e.target.closest(".dropdown-toggle");
    if (toggle) {
      var dd = toggle.closest(".dropdown");
      var wasActive = dd.classList.contains("active");
      closeAllDropdowns(dd);
      if (!wasActive) dd.classList.add("active");
      e.stopPropagation();
      return;
    }
    if (!e.target.closest(".dropdown")) closeAllDropdowns(null);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllDropdowns(null);
  });

  // ── Confirm dialogs ─────────────────────────────────────────────
  // Elements with [data-confirm] show a popover before submitting their form.
  function clearConfirms() {
    document.querySelectorAll(".ld-confirm").forEach(function (n) { n.remove(); });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-confirm]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    clearConfirms();
    var question = btn.getAttribute("data-confirm-question") || btn.getAttribute("data-confirm") || "Are you sure?";
    var box = document.createElement("div");
    box.className = "ld-confirm";
    box.innerHTML =
      '<div class="ld-confirm-arrow"></div>' +
      '<div class="ld-confirm-question"></div>' +
      '<div class="ld-confirm-actions">' +
      '<button type="button" class="btn btn-sm ld-confirm-cancel">Cancel</button> ' +
      '<button type="button" class="btn btn-sm btn-error ld-confirm-ok">Confirm</button>' +
      "</div>";
    box.querySelector(".ld-confirm-question").textContent = question;
    document.body.appendChild(box);
    var rect = btn.getBoundingClientRect();
    var boxRect = box.getBoundingClientRect();
    var top = rect.bottom + window.scrollY + 8;
    var left = rect.left + window.scrollX + rect.width / 2 - boxRect.width / 2;
    left = Math.max(8, Math.min(left, document.documentElement.scrollWidth - boxRect.width - 8));
    box.style.top = top + "px";
    box.style.left = left + "px";
    var ok = box.querySelector(".ld-confirm-ok");
    var cancel = box.querySelector(".ld-confirm-cancel");
    cancel.focus();
    function close() { box.remove(); }
    ok.addEventListener("click", function () {
      close();
      var form = btn.closest("form");
      if (form) form.requestSubmit(btn); else btn.click();
    });
    cancel.addEventListener("click", close);
    setTimeout(function () {
      document.addEventListener("click", function handler(ev) {
        if (!ev.target.closest(".ld-confirm")) { close(); document.removeEventListener("click", handler); }
      });
    }, 0);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") clearConfirms();
  });

  // ── Notes toggle on bookmark list ───────────────────────────────
  document.addEventListener("click", function (e) {
    var t = e.target.closest(".toggle-notes");
    if (!t) return;
    e.preventDefault();
    var item = t.closest("li");
    if (item) item.classList.toggle("show-notes");
  });

  // ── Bulk edit active toggle ──────────────────────────────
  document.addEventListener("click", function (e) {
    var t = e.target.closest(".bulk-edit-active-toggle");
    if (!t) return;
    var page = document.querySelector(".bookmarks-page");
    if (page) page.classList.toggle("active");
  });

  // Show/hide the bulk tag input depending on the selected bulk action.
  document.addEventListener("change", function (e) {
    var sel = e.target.closest('select[name="bulk_action"]');
    if (!sel) return;
    var page = document.querySelector(".bookmarks-page");
    if (page) page.setAttribute("data-bulk-action", sel.value);
    var tagInput = document.querySelector(".bulk-tag-input");
    if (tagInput) tagInput.style.display = (sel.value === "bulk_tag" || sel.value === "bulk_untag") ? "" : "none";
  });

  document.addEventListener("DOMContentLoaded", function () {
    var sel = document.querySelector('select[name="bulk_action"]');
    if (sel) {
      var tagInput = document.querySelector(".bulk-tag-input");
      if (tagInput) tagInput.style.display = (sel.value === "bulk_tag" || sel.value === "bulk_untag") ? "" : "none";
    }
    initSearchAutocomplete();
    initTagAutocomplete();
  });

  // ── Search Autocomplete ──────────────────────────────────
  // Fetch tags and recent searches for autocomplete suggestions
  var searchCache = { tags: [], recent: [] };
  var searchDebounceTimer = null;

  function initSearchAutocomplete() {
    var searchInput = document.querySelector('#search input[type="search"]');
    if (!searchInput) return;

    // Fetch tags for autocomplete
    fetch("/autocomplete/tags")
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (Array.isArray(data)) {
          searchCache.tags = data.map(function (t) { return t.name; });
        }
      })
      .catch(function () {});

    // Load recent searches from localStorage
    try {
      var recent = JSON.parse(localStorage.getItem("linkding_recent_searches") || "[]");
      searchCache.recent = recent.slice(0, 5);
    } catch (e) {}

    var dropdown = document.createElement("div");
    dropdown.className = "search-autocomplete-menu";
    dropdown.style.cssText = "display:none;position:absolute;z-index:500;background:var(--body-color);border:solid 1px var(--border-color);border-radius:var(--border-radius);box-shadow:var(--box-shadow);min-width:200px;max-width:400px;max-height:300px;overflow-y:auto;";
    searchInput.parentNode.style.position = "relative";
    searchInput.parentNode.appendChild(dropdown);

    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        var query = searchInput.value.trim();
        if (!query || query.length < 2) {
          dropdown.style.display = "none";
          return;
        }
        showSearchSuggestions(query, dropdown, searchInput);
      }, 200);
    });

    searchInput.addEventListener("focus", function () {
      if (searchInput.value.trim().length >= 2) {
        dropdown.style.display = "block";
      }
    });

    searchInput.addEventListener("blur", function () {
      setTimeout(function () { dropdown.style.display = "none"; }, 150);
    });

    searchInput.form.addEventListener("submit", function () {
      if (searchInput.value.trim()) saveRecentSearch(searchInput.value.trim());
    });

    dropdown.addEventListener("click", function (e) {
      var item = e.target.closest(".search-autocomplete-item");
      if (!item) return;
      e.preventDefault();
      var value = item.getAttribute("data-value");
      var type = item.getAttribute("data-type");
      var url = item.getAttribute("data-url");
      if (type === "bookmark" && isSafeUrl(url)) {
        window.open(url, "_blank", "noopener");
        dropdown.style.display = "none";
      } else if (value) {
        searchInput.value = value;
        saveRecentSearch(value);
        searchInput.form.submit();
      }
    });

    // Keyboard navigation
    searchInput.addEventListener("keydown", function (e) {
      var items = dropdown.querySelectorAll(".search-autocomplete-item");
      if (items.length === 0) return;
      var active = dropdown.querySelector(".search-autocomplete-item.active");
      var idx = Array.prototype.indexOf.call(items, active);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        idx = (idx + 1) % items.length;
        items.forEach(function (i, n) { i.classList.toggle("active", n === idx); });
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        idx = idx <= 0 ? items.length - 1 : idx - 1;
        items.forEach(function (i, n) { i.classList.toggle("active", n === idx); });
        items[idx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        if (active) {
          e.preventDefault();
          var type = active.getAttribute("data-type");
          var url = active.getAttribute("data-url");
          if (type === "bookmark" && isSafeUrl(url)) {
            window.open(url, "_blank", "noopener");
            dropdown.style.display = "none";
          } else {
            searchInput.value = active.getAttribute("data-value");
            saveRecentSearch(searchInput.value);
            searchInput.form.submit();
          }
        }
      } else if (e.key === "Escape") {
        dropdown.style.display = "none";
      }
    });
  }

  function showSearchSuggestions(query, dropdown, input) {
    var suggestions = [];

    // Match tags (prefix match)
    var tagMatches = searchCache.tags
      .filter(function (t) { return t.toLowerCase().indexOf(query.toLowerCase()) !== -1; })
      .slice(0, 5);

    tagMatches.forEach(function (tag) {
      suggestions.push({ type: "tag", value: "#" + tag, label: "#" + tag });
    });

    // Match recent searches
    searchCache.recent
      .filter(function (s) { return s.toLowerCase().indexOf(query.toLowerCase()) !== -1; })
      .slice(0, 3)
      .forEach(function (s) {
        suggestions.push({ type: "recent", value: s, label: s });
      });

    fetch("/autocomplete/bookmarks?q=" + encodeURIComponent(query))
      .then(function (res) { return res.json(); })
      .then(function (bookmarks) {
        if (Array.isArray(bookmarks)) {
          bookmarks.slice(0, 5).forEach(function (b) {
            suggestions.push({ type: "bookmark", value: b.title || b.url, label: b.title || b.url, url: b.url });
          });
        }
        renderSearchSuggestions(suggestions, dropdown);
      })
      .catch(function () { renderSearchSuggestions(suggestions, dropdown); });
  }

  function renderSearchSuggestions(suggestions, dropdown) {
    if (suggestions.length === 0) {
      dropdown.style.display = "none";
      return;
    }

    dropdown.innerHTML = suggestions.map(function (s, i) {
      var icon = s.type === "tag" ? "#" : (s.type === "bookmark" ? "\u{1F516}" : "\u{1F551}");
      return '<div class="search-autocomplete-item' + (i === 0 ? " active" : "") + '" data-type="' + escAttr(s.type) + '" data-value="' + escAttr(s.value) + '" data-url="' + escAttr(s.url || "") + '" style="padding:var(--unit-1) var(--unit-2);cursor:pointer;">' +
        '<span class="text-secondary">' + icon + '</span> ' + escHtml(s.label) + '</div>';
    }).join("");
    dropdown.style.display = "block";
  }

  function saveRecentSearch(query) {
    try {
      var recent = JSON.parse(localStorage.getItem("linkding_recent_searches") || "[]");
      recent = [query].concat(recent.filter(function (s) { return s !== query; })).slice(0, 10);
      localStorage.setItem("linkding_recent_searches", JSON.stringify(recent));
    } catch (e) {}
  }

  function isSafeUrl(url) {
    return /^(https?|ftp):\/\//i.test(String(url || ""));
  }

  function escAttr(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function escHtml(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ── Tag Autocomplete (for forms) ─────────────────────────
  function initTagAutocomplete() {
    var tagInputs = document.querySelectorAll('input[name="tag_names"], input[name="bulk_tag_string"]');
    tagInputs.forEach(function (input) {
      if (!input || input._tagAutocompleteInit) return;
      input._tagAutocompleteInit = true;

      var dropdown = document.createElement("div");
      dropdown.className = "tag-autocomplete-menu";
      dropdown.style.cssText = "display:none;position:absolute;z-index:500;background:var(--body-color);border:solid 1px var(--border-color);border-radius:var(--border-radius);box-shadow:var(--box-shadow);min-width:150px;max-height:200px;overflow-y:auto;";
      input.parentNode.style.position = "relative";
      input.parentNode.appendChild(dropdown);

      var tags = [];
      fetch("/autocomplete/tags")
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (Array.isArray(data)) tags = data.map(function (t) { return t.name; });
        })
        .catch(function () {});

      input.addEventListener("input", function () {
        var value = input.value;
        var words = value.split(/\s+/);
        var currentWord = words[words.length - 1];
        if (!currentWord || currentWord.length < 1) {
          dropdown.style.display = "none";
          return;
        }

        var matches = tags
          .filter(function (t) { return t.toLowerCase().indexOf(currentWord.toLowerCase()) !== -1 && t !== currentWord; })
          .slice(0, 8);

        if (matches.length === 0) {
          dropdown.style.display = "none";
          return;
        }

        dropdown.innerHTML = matches.map(function (t, i) {
          return '<div class="tag-autocomplete-item' + (i === 0 ? " active" : "") + '" data-tag="' + escAttr(t) + '" style="padding:var(--unit-1) var(--unit-2);cursor:pointer;">' + escHtml(t) + '</div>';
        }).join("");
        dropdown.style.display = "block";
      });

      input.addEventListener("blur", function () {
        setTimeout(function () { dropdown.style.display = "none"; }, 150);
      });

      dropdown.addEventListener("click", function (e) {
        var item = e.target.closest(".tag-autocomplete-item");
        if (!item) return;
        e.preventDefault();
        var tag = item.getAttribute("data-tag");
        if (!tag) return;
        var value = input.value;
        var words = value.split(/\s+/);
        words[words.length - 1] = tag + " ";
        input.value = words.join(" ").trim() + " ";
        input.focus();
        dropdown.style.display = "none";
      });

      input.addEventListener("keydown", function (e) {
        var items = dropdown.querySelectorAll(".tag-autocomplete-item");
        if (items.length === 0) return;
        var active = dropdown.querySelector(".tag-autocomplete-item.active");
        var idx = Array.prototype.indexOf.call(items, active);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          idx = (idx + 1) % items.length;
          items.forEach(function (i, n) { i.classList.toggle("active", n === idx); });
          items[idx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          idx = idx <= 0 ? items.length - 1 : idx - 1;
          items.forEach(function (i, n) { i.classList.toggle("active", n === idx); });
          items[idx].scrollIntoView({ block: "nearest" });
        } else if (e.key === "Enter") {
          if (active) {
            e.preventDefault();
            var tag = active.getAttribute("data-tag");
            if (tag) {
              var value = input.value;
              var words = value.split(/\s+/);
              words[words.length - 1] = tag + " ";
              input.value = words.join(" ").trim() + " ";
              input.focus();
              dropdown.style.display = "none";
            }
          }
        } else if (e.key === "Escape") {
          dropdown.style.display = "none";
        }
      });
    });
  }

  // ── data-submit-on-change ────────────────────────────────
  document.addEventListener("change", function (e) {
    var el = e.target.closest("[data-submit-on-change]");
    if (!el) return;
    var form = el.closest("form");
    if (form) form.requestSubmit();
  });

  // ── Modal (Bookmark Details) ─────────────────────────────
  // Intercept clicks on [data-modal-trigger] links
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("[data-modal-trigger]");
    if (!trigger) return;
    e.preventDefault();
    var href = trigger.getAttribute("href");
    if (!href) return;
    openModal(href, trigger);
  });

  function openModal(url, sourceElement) {
    fetch(url, { headers: { "X-Requested-With": "XMLHttpRequest" } })
      .then(function (res) { return res.text(); })
      .then(function (html) {
        var modals = document.querySelector(".modals") || document.body;
        modals.insertAdjacentHTML("beforeend", html);
        var modal = modals.querySelector(".modal.active");
        if (!modal) return;
        document.body.classList.add("scroll-lock");
        // Focus first focusable element in modal
        var firstFocusable = modal.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (firstFocusable) firstFocusable.focus();
        // Store source element for focus restoration
        modal._sourceElement = sourceElement;
      })
      .catch(function (err) { console.error("Failed to load modal:", err); });
  }

  // Close modal handlers
  document.addEventListener("click", function (e) {
    if (e.target.matches("[data-close-modal]")) {
      e.preventDefault();
      closeModal(e.target.closest(".modal.active"));
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      var modal = document.querySelector(".modal.active");
      if (modal) closeModal(modal);
    }
  });

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add("closing");
    var sourceElement = modal._sourceElement;
    setTimeout(function () {
      modal.remove();
      document.body.classList.remove("scroll-lock");
      // Restore focus to source element
      if (sourceElement && document.body.contains(sourceElement)) {
        sourceElement.focus();
      }
    }, 150); // Match fade-out animation duration
  }

  // Focus trap for modal
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var modal = document.querySelector(".modal.active");
    if (!modal) return;
    var focusables = modal.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (focusables.length === 0) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ── Filter drawer (mobile) ───────────────────────────────
  document.addEventListener("click", function (e) {
    var trigger = e.target.closest("ld-filter-drawer-trigger");
    if (!trigger) return;
    e.preventDefault();
    var sidePanel = document.querySelector(".side-panel");
    if (!sidePanel) return;
    var modals = document.querySelector(".modals") || document.body;
    var drawer = document.createElement("div");
    drawer.className = "modal drawer active";
    drawer.innerHTML =
      '<div class="modal-overlay" data-close-modal></div>' +
      '<div class="modal-container" role="dialog" aria-modal="true">' +
      '<div class="modal-header"><h2 class="title">Filters</h2>' +
      '<button class="btn btn-noborder close" aria-label="Close dialog" data-close-modal>\u2715</button></div>' +
      '<div class="modal-body"></div></div>';
    modals.appendChild(drawer);
    var body = drawer.querySelector(".modal-body");
    // Move side panel children into the drawer body.
    while (sidePanel.firstChild) body.appendChild(sidePanel.firstChild);
    document.body.classList.add("scroll-lock");
    function close() {
      while (body.firstChild) sidePanel.appendChild(body.firstChild);
      drawer.remove();
      document.body.classList.remove("scroll-lock");
    }
    drawer.querySelectorAll("[data-close-modal]").forEach(function (b) { b.addEventListener("click", close); });
  });

  // ── Bulk edit select-all ────────────────────────────────────────
  document.addEventListener("change", function (e) {
    if (e.target.id !== "select-all" && !e.target.matches('input[name="bookmark_id"]')) return;
    var all = document.getElementById("select-all");
    var page = document.querySelector(".bookmarks-page");
    var boxes = document.querySelectorAll('input[name="bookmark_id"]');
    if (e.target.id === "select-all") {
      boxes.forEach(function (b) { b.checked = all.checked; });
    } else if (all) {
      all.checked = Array.prototype.every.call(boxes, function (b) { return b.checked; });
    }
    var bulkForm = document.querySelector('form.bookmark-actions');
    if (bulkForm) {
      var execute = bulkForm.querySelector('button[name="bulk_execute"]');
      if (execute) execute.disabled = !Array.prototype.some.call(boxes, function (b) { return b.checked; });
    }
    var selectAcross = page && page.querySelector(".select-across");
    if (selectAcross) selectAcross.classList.toggle("d-none", !Array.prototype.some.call(boxes, function (b) { return b.checked; }));
  });
})();
