/*
 * Dark theme by default; the header button switches to light and back.
 * Runs in <head> so the page never flashes the wrong colours.
 */
(function () {
  var KEY = 'fbd.theme';
  var get = function () { try { return localStorage.getItem(KEY) || 'dark'; } catch (e) { return 'dark'; } };
  var apply = function (t) {
    document.documentElement.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#f4f6fb' : '#0f1420');
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (b) {
      b.textContent = t === 'light' ? '☾' : '☀';
      b.title = t === 'light' ? 'Switch to dark mode' : 'Switch to light mode';
    });
  };
  apply(get());
  document.addEventListener('DOMContentLoaded', function () {
    apply(get());
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (b) {
      b.addEventListener('click', function () {
        var t = get() === 'light' ? 'dark' : 'light';
        try { localStorage.setItem(KEY, t); } catch (e) { /* private mode: applies until reload */ }
        apply(t);
      });
    });
  });
})();
