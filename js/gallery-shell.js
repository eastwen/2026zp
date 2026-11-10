(function () {
    function getPrefix() {
        var parts = window.location.pathname.split("/").filter(Boolean);
        return parts.length > 1 ? "../" : "";
    }

    function init() {
        document.documentElement.classList.add("gallery-page");
        document.body.classList.add("gallery-page");

        function initGrid() {
            var host = document.createElement("div");
            host.className = "grid-overlay";
            host.setAttribute("aria-hidden", "true");
            document.body.insertBefore(host, document.body.firstChild);

            function render() {
                var width = Math.max(1, window.innerWidth);
                var height = Math.max(1, window.innerHeight);
                var pad = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--g-pad")) || 56;
                var column = (width - pad * 2) / 3;
                var xs = [];
                var ys = [];
                var gap = 12;
                var tick = 6;

                for (var i = 0; i <= 3; i += 1) {
                    xs.push(Math.round(pad + column * i) + 0.5);
                }
                ys.push(Math.round(height / 3) + 0.5);
                ys.push(Math.round((height * 2) / 3) + 0.5);

                var lines = [];

                xs.forEach(function (x) {
                    var start = 0;
                    ys.forEach(function (y) {
                        var end = Math.max(start, y - gap);
                        if (end > start) lines.push("M" + x + " " + start + "V" + end);
                        start = y + gap;
                    });
                    if (height > start) lines.push("M" + x + " " + start + "V" + height);
                });

                ys.forEach(function (y) {
                    var start = 0;
                    xs.forEach(function (x) {
                        var end = Math.max(start, x - gap);
                        if (end > start) lines.push("M" + start + " " + y + "H" + end);
                        start = x + gap;
                    });
                    if (width > start) lines.push("M" + start + " " + y + "H" + width);
                });

                var ticks = [];
                xs.forEach(function (x) {
                    ys.forEach(function (y) {
                        ticks.push("M" + (x - tick) + " " + y + "H" + (x + tick));
                        ticks.push("M" + x + " " + (y - tick) + "V" + (y + tick));
                    });
                });

                host.innerHTML =
                    '<svg viewBox="0 0 ' + width + " " + height + '" shape-rendering="crispEdges" aria-hidden="true">' +
                    '<path class="grid-lines" d="' + lines.join("") + '" fill="none" stroke-width="1"></path>' +
                    '<path class="grid-ticks" d="' + ticks.join("") + '" fill="none" stroke-width="1"></path>' +
                    "</svg>";
            }

            render();
            window.addEventListener("resize", render, { passive: true });
        }

        function decorateLogo() {
            var logo = document.querySelector("header .logo");
            if (logo && !logo.querySelector("span") && /^\s*East\s+wen\s*$/i.test(logo.textContent)) {
                logo.innerHTML = "East wen<span>BLOG</span>";
            }
        }
        decorateLogo();
        window.addEventListener("load", decorateLogo);

        initGrid();

        var themeLink = document.querySelector('link[href*="style.css"]');
        if (themeLink) {
            var desired = getPrefix() + "css/gallery.css";
            var existing = document.querySelector('link[data-gallery-css]');
            if (!existing) {
                var link = document.createElement("link");
                link.rel = "stylesheet";
                link.href = desired;
                link.setAttribute("data-gallery-css", "true");
                themeLink.parentNode.insertBefore(link, themeLink.nextSibling);
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
