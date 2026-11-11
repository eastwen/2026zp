(function () {
    const root = document.documentElement;
    const body = document.body;
    const wrapper = document.querySelector('[data-scroll-wrapper]');
    const content = document.querySelector('[data-scroll-content]');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobileLayout = window.matchMedia('(max-width: 1023px)');
    let lenisInstance = null;

    function createNativeScroll() {
        wrapper.classList.add('native-scroll');
        const native = {
            progress: 0,
            on: function (event, callback) {
                if (event === 'scroll') {
                    wrapper.addEventListener('scroll', callback, { passive: true });
                }
                return native;
            },
            raf: function () {},
            resize: function () {},
            scrollTo: function (target, options) {
                let top = 0;
                if (typeof target === 'number') {
                    top = target;
                } else if (typeof target === 'string') {
                    const element = document.querySelector(target);
                    if (element) top = element.getBoundingClientRect().top + wrapper.scrollTop;
                } else if (target && typeof target.getBoundingClientRect === 'function') {
                    top = target.getBoundingClientRect().top + wrapper.scrollTop;
                }
                wrapper.scrollTo({
                    top: top,
                    behavior: options && options.immediate ? 'auto' : 'smooth'
                });
            }
        };

        function updateProgress() {
            const max = wrapper.scrollHeight - wrapper.clientHeight;
            native.progress = max > 0 ? wrapper.scrollTop / max : 0;
        }

        wrapper.addEventListener('scroll', updateProgress, { passive: true });
        window.addEventListener('resize', updateProgress);
        updateProgress();
        return native;
    }

    function initBoot() {
        const boot = document.getElementById('boot');
        const bar = document.querySelector('[data-boot-bar]');
        const pct = document.querySelector('[data-boot-pct]');
        if (!boot) return;

        let value = 8;
        let done = false;
        let timer = 0;
        const started = performance.now();

        function set(next) {
            value = Math.max(value, Math.min(100, next));
            if (bar) bar.style.transform = 'scaleX(' + (value / 100) + ')';
            if (pct) pct.textContent = String(Math.round(value)).padStart(2, '0') + '%';
        }

        function finish() {
            if (done) return;
            done = true;
            if (timer) clearInterval(timer);
            set(100);
            boot.classList.add('is-complete');
            window.setTimeout(function () { boot.remove(); }, 520);
        }

        if (reducedMotion.matches) {
            finish();
            return;
        }

        set(10);
        timer = window.setInterval(function () {
            if (done) return;
            const cap = document.readyState === 'complete' ? 96 : document.readyState === 'interactive' ? 82 : 68;
            set(value + (cap - value) * 0.12 + Math.random() * 1.4);
            if (performance.now() - started > 1100) finish();
        }, 180);

        window.addEventListener('load', function () {
            window.setTimeout(finish, 320);
        }, { once: true });
    }

    function initLenis() {
        if (!wrapper || !content) return null;
        const Lenis = window.Lenis;
        if (!Lenis || reducedMotion.matches) {
            return createNativeScroll();
        }

        let instance;
        try {
            instance = new Lenis({
                wrapper: wrapper,
                content: content,
                lerp: 0.1,
                smoothWheel: true,
                syncTouch: true,
                anchors: { offset: -96 }
            });
        } catch (error) {
            return createNativeScroll();
        }
        lenisInstance = instance;
        window.__eastLenis = instance;

        function raf(time) {
            instance.raf(time);
            requestAnimationFrame(raf);
        }
        requestAnimationFrame(raf);

        const space = document.querySelector('[data-space]');
        const outro = document.querySelector('.outro');
        [space, outro].forEach(function (el) {
            if (!el) return;
            el.addEventListener('wheel', function (event) {
                if (event.ctrlKey) return;
                const rect = el.getBoundingClientRect();
                const distance = el.offsetHeight - window.innerHeight;
                const progress = distance > 0 ? -rect.top / distance : 0;
                if ((event.deltaY < 0 && progress <= 0) || (event.deltaY > 0 && progress >= 1)) return;
                event.stopPropagation();
            }, { passive: true });
        });
        return instance;
    }

    function initReveals() {
        const items = document.querySelectorAll('.stagger');
        if (reducedMotion.matches || !('IntersectionObserver' in window)) {
            items.forEach(function (item) { item.classList.add('is-visible'); });
            return;
        }

        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                const siblings = Array.from(entry.target.parentElement.children).filter(function (el) {
                    return el.classList.contains('stagger');
                });
                const index = siblings.indexOf(entry.target);
                entry.target.style.transitionDelay = String(Math.min(index * 80, 480)) + 'ms';
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

        items.forEach(function (item) { observer.observe(item); });
    }

    function initClock() {
        const clock = document.querySelector('[data-clock]');
        if (!clock) return;
        const formatter = new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
        function update() {
            const prefix = mobileLayout.matches ? '' : '中国时间 ';
            clock.textContent = prefix + formatter.format(new Date());
        }
        update();
        if (typeof mobileLayout.addEventListener === 'function') {
            mobileLayout.addEventListener('change', update);
        }
        window.setInterval(update, 1000);
        document.addEventListener('east-clock-refresh', update);
    }

    function initMenu() {
        const header = document.querySelector('.site-head');
        const toggle = document.querySelector('[data-menu-toggle]');
        const links = document.querySelector('.head-links');
        const scrim = document.querySelector('[data-menu-scrim]');
        if (!header || !toggle || !links) return;

        function setOpen(open) {
            header.classList.toggle('is-menu-open', open);
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
            if (scrim) scrim.setAttribute('aria-hidden', open ? 'false' : 'true');
        }

        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            setOpen(!header.classList.contains('is-menu-open'));
        });

        links.addEventListener('click', function (event) {
            if (event.target.closest('a, button')) setOpen(false);
        });

        if (scrim) {
            scrim.addEventListener('click', function () {
                setOpen(false);
            });
        }

        document.addEventListener('click', function (event) {
            if (!header.classList.contains('is-menu-open')) return;
            if (header.contains(event.target)) return;
            setOpen(false);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape') return;
            setOpen(false);
            toggle.focus();
        });

        function closeOnBreakpointChange() {
            if (!mobileLayout.matches) setOpen(false);
        }

        if (typeof mobileLayout.addEventListener === 'function') {
            mobileLayout.addEventListener('change', closeOnBreakpointChange);
        }

        wrapper.addEventListener('scroll', function () {
            if (header.classList.contains('is-menu-open')) setOpen(false);
        }, { passive: true });
    }

    function initPointer() {
        const xOut = document.querySelector('[data-pointer-x]');
        const yOut = document.querySelector('[data-pointer-y]');
        if (!xOut || !yOut) return;
        let uvX = 0.5;
        let uvY = 0.5;
        function render() {
            xOut.textContent = String(Math.round(uvX * window.innerWidth)).padStart(4, '0');
            yOut.textContent = String(Math.round(uvY * window.innerHeight)).padStart(4, '0');
        }
        render();
        window.addEventListener('pointermove', function (event) {
            uvX = window.innerWidth ? event.clientX / window.innerWidth : 0.5;
            uvY = window.innerHeight ? event.clientY / window.innerHeight : 0.5;
            render();
        }, { passive: true });
        window.addEventListener('resize', render, { passive: true });
    }

    function initTheme() {
        const toggle = document.querySelector('[data-theme-toggle]');
        let theme = 'dark';
        try {
            theme = localStorage.getItem('theme') || 'dark';
        } catch (error) {
            theme = root.classList.contains('cool') ? 'cool' : 'dark';
        }
        theme = theme === 'cool' ? 'cool' : 'dark';
        function notify(next) {
            window.dispatchEvent(new CustomEvent('themechange', {
                detail: { theme: next }
            }));
        }
        function apply(next) {
            root.classList.toggle('cool', next === 'cool');
            root.classList.toggle('dark', next === 'dark');
            root.setAttribute('data-theme', next);
            if (toggle) toggle.textContent = next === 'cool' ? '主题[C]' : '主题[D]';
        }
        apply(theme);
        notify(theme);
        if (!toggle) return;
        toggle.addEventListener('click', function () {
            const next = root.classList.contains('cool') ? 'dark' : 'cool';
            apply(next);
            notify(next);
            try {
                localStorage.setItem('theme', next);
            } catch (error) {
                return;
            }
        });
    }

    function initSpace(instance) {
        const section = document.querySelector('[data-space]');
        const title = document.querySelector('[data-space-title]');
        const stickers = Array.from(document.querySelectorAll('.sticker'));
        const stage = document.querySelector('[data-space-stage]');
        if (!section || !title) return;

        let mouseX = 0;
        let mouseY = 0;
        let targetX = 0;
        let targetY = 0;

        window.addEventListener('pointermove', function (event) {
            targetX = event.clientX / window.innerWidth - 0.5;
            targetY = event.clientY / window.innerHeight - 0.5;
        }, { passive: true });

        function frame() {
            mouseX += (targetX - mouseX) * 0.06;
            mouseY += (targetY - mouseY) * 0.06;
            stickers.forEach(function (sticker, index) {
                const depth = 8 + (index % 4) * 7;
                sticker.style.transform = 'translate3d(' + (mouseX * depth) + 'px, ' + (mouseY * depth) + 'px, 0) rotate(' + ((index % 2 ? 1 : -1) * (4 + index * 1.2)) + 'deg)';
            });
            if (!reducedMotion.matches) requestAnimationFrame(frame);
        }
        frame();

        const stages = ['01', '02', '03', '04', '05', '06', '07', '08'];
        const classes = ['', 'is-secondary', '', 'is-secondary', '', 'is-end', '', 'is-end'];

        function update() {
            const rect = section.getBoundingClientRect();
            const distance = section.offsetHeight - window.innerHeight;
            const progress = distance > 0 ? Math.min(1, Math.max(0, -rect.top / distance)) : 0;
            const index = Math.min(stages.length - 1, Math.floor(progress * stages.length));
            title.classList.toggle('is-secondary', classes[index] === 'is-secondary');
            title.classList.toggle('is-end', classes[index] === 'is-end');
            if (stage) stage.textContent = stages[index];
        }

        instance.on('scroll', update);
        update();
    }

    function initScrollbar(instance) {
        const track = document.querySelector('[data-scrollbar]');
        const thumb = document.querySelector('[data-scrollbar-thumb]');
        if (!track || !thumb) return;

        let dragging = false;

        function update() {
            const max = wrapper.scrollHeight - wrapper.clientHeight;
            const progress = max > 0 ? (typeof instance.progress === 'number' ? instance.progress : wrapper.scrollTop / max) : 0;
            const ratio = Math.min(1, wrapper.clientHeight / wrapper.scrollHeight);
            thumb.style.height = Math.max(16, ratio * 100) + '%';
            const thumbHeight = track.clientHeight * Math.max(16, ratio * 100) / 100;
            thumb.style.transform = 'translateY(' + (progress * (track.clientHeight - thumbHeight)) + 'px)';
        }

        function moveTo(clientY) {
            const rect = track.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
            const max = wrapper.scrollHeight - wrapper.clientHeight;
            instance.scrollTo(ratio * max, { immediate: true, force: true });
        }

        track.addEventListener('pointerdown', function (event) {
            dragging = true;
            track.setPointerCapture(event.pointerId);
            moveTo(event.clientY);
        });
        track.addEventListener('pointermove', function (event) {
            if (dragging) moveTo(event.clientY);
        });
        track.addEventListener('pointerup', function () {
            dragging = false;
        });
        instance.on('scroll', update);
        window.addEventListener('resize', update);
        update();
    }

    function initPreviews() {
        document.querySelectorAll('.work-card[data-preview]').forEach(function (card) {
            card.addEventListener('pointermove', function (event) {
                const visual = card.querySelector('.work-visual');
                if (!visual || reducedMotion.matches) return;
                const rect = visual.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width - 0.5;
                const y = (event.clientY - rect.top) / rect.height - 0.5;
                const image = visual.querySelector('img');
                if (image) image.style.transform = 'scale(1.04) translate3d(' + (-x * 12) + 'px, ' + (-y * 12) + 'px, 0)';
            });
            card.addEventListener('pointerleave', function () {
                const image = card.querySelector('.work-visual img');
                if (image) image.style.transform = '';
            });
        });
    }

    function initGrid() {
        const host = document.querySelector('[data-grid-overlay]');
        if (!host) return;

        function render() {
            const width = Math.max(1, window.innerWidth);
            const height = Math.max(1, window.innerHeight);
            const pad = parseFloat(getComputedStyle(root).getPropertyValue('--pad')) || 56;
            const column = (width - pad * 2) / 3;
            const xs = [];
            const ys = [];
            const gap = 12;
            const tick = 6;

            for (let i = 0; i <= 3; i += 1) {
                xs.push(Math.round(pad + column * i) + 0.5);
            }
            ys.push(Math.round(height / 3) + 0.5);
            ys.push(Math.round((height * 2) / 3) + 0.5);

            const lines = [];

            xs.forEach(function (x) {
                let start = 0;
                ys.forEach(function (y) {
                    const end = Math.max(start, y - gap);
                    if (end > start) lines.push('M' + x + ' ' + start + 'V' + end);
                    start = y + gap;
                });
                if (height > start) lines.push('M' + x + ' ' + start + 'V' + height);
            });

            ys.forEach(function (y) {
                let start = 0;
                xs.forEach(function (x) {
                    const end = Math.max(start, x - gap);
                    if (end > start) lines.push('M' + start + ' ' + y + 'H' + end);
                    start = x + gap;
                });
                if (width > start) lines.push('M' + start + ' ' + y + 'H' + width);
            });

            const ticks = [];
            xs.forEach(function (x) {
                ys.forEach(function (y) {
                    ticks.push('M' + (x - tick) + ' ' + y + 'H' + (x + tick));
                    ticks.push('M' + x + ' ' + (y - tick) + 'V' + (y + tick));
                });
            });

            const markup =
                '<svg viewBox="0 0 ' + width + ' ' + height + '" shape-rendering="crispEdges" aria-hidden="true">' +
                '<path class="grid-lines" d="' + lines.join('') + '" fill="none" stroke-width="1"></path>' +
                '<path class="grid-ticks" d="' + ticks.join('') + '" fill="none" stroke-width="1"></path>' +
                '</svg>';

            host.innerHTML = markup;
        }

        render();
        window.addEventListener('resize', render, { passive: true });
    }

    initTheme();
    initBoot();
    const lenis = initLenis();
    initReveals();
    initClock();
    initPointer();
    initMenu();
    initGrid();
    if (lenis) {
        initSpace(lenis);
        initScrollbar(lenis);
    }
    initPreviews();

    if (!lenisInstance && wrapper) {
        window.setTimeout(function () {
            wrapper.classList.add('native-scroll');
        }, 300);
    }
})();
