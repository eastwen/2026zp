(function () {
    'use strict';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (reducedMotion.matches) return;
    if (
        document.documentElement.classList.contains('boot-skip') ||
        document.documentElement.classList.contains('intro-skip')
    ) return;

    const hero = document.querySelector('.hero');
    const manifesto = document.querySelector('.manifesto');
    const folio = document.querySelector('.folio');
    if (!hero || !manifesto || !folio) return;

    const canvas = document.createElement('canvas');
    canvas.className = 'swarm-annotate-layer';
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '60',
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        contain: 'strict'
    });
    document.body.appendChild(canvas);

    const context = canvas.getContext('2d');
    if (!context) {
        canvas.remove();
        return;
    }

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const mix = (from, to, progress) => from + (to - from) * progress;
    const rand = (min, max) => min + Math.random() * (max - min);
    const easeOutCubic = (value) => 1 - Math.pow(1 - value, 3);
    const easeInOutCubic = (value) => (
        value < 0.5
            ? 4 * value * value * value
            : 1 - Math.pow(-2 * value + 2, 3) / 2
    );

    const hiddenNodes = new WeakMap();
    const cursorColors = [
        '#F24E1E', '#A259FF', '#1ABCFE', '#0ACF83', '#FF7262', '#FFC700',
        '#9747FF', '#E8467C', '#14AE5C', '#0D99FF', '#FF8A00', '#00B5CE'
    ];
    let selectionColor = '#FFD600';
    const arrowPath = new Path2D(
        'M4.6 3.9 C4.2 3.1 4.9 2.4 5.7 2.8 L20.6 9.4 C21.5 9.8 21.4 11.1 20.4 11.3 ' +
        'L13.9 12.9 C13.4 13 13 13.4 12.9 13.9 L11.3 20.4 C11.1 21.4 9.8 21.5 9.4 20.6 Z'
    );
    const ibeamPath = new Path2D(
        'M8.5 4.5 H10.5 Q12 4.5 12 6 Q12 4.5 13.5 4.5 H15.5 ' +
        'M12 6 V18 M8.5 19.5 H10.5 Q12 19.5 12 18 Q12 19.5 13.5 19.5 H15.5'
    );
    const scenes = [];

    let viewportWidth = window.innerWidth;
    let viewportHeight = window.innerHeight;
    let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    let compact = viewportWidth < 700;
    let lightTheme = document.documentElement.classList.contains('light');
    let started = false;
    let eventFrame = 0;
    let lastTime = performance.now();
    let frameDelta = 1 / 60;
    let flockTime = 0;
    let flock = [];

    function getPalette() {
        return cursorColors;
    }

    function refreshSelectionColor() {
        const value = getComputedStyle(document.documentElement)
            .getPropertyValue('--selection')
            .trim();
        if (value) selectionColor = value;
    }

    function hideNode(node) {
        if (!node || hiddenNodes.has(node)) return;
        hiddenNodes.set(node, {
            visibility: node.style.visibility,
            opacity: node.style.opacity
        });
        node.style.visibility = 'hidden';
    }

    function showNode(node) {
        if (!node || !hiddenNodes.has(node)) return;
        const previous = hiddenNodes.get(node);
        node.style.visibility = previous.visibility;
        node.style.opacity = previous.opacity;
        hiddenNodes.delete(node);
    }

    function restoreAllNodes() {
        const nodes = [];
        hiddenNodes.forEach((value, node) => {
            nodes.push(node);
        });
        nodes.forEach(showNode);
    }

    function refreshLiveClock() {
        const clock = document.querySelector('[data-clock]');
        if (!clock) return;
        const mobile = window.matchMedia('(max-width: 1023px)').matches;
        try {
            const formatter = new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            clock.textContent = (mobile ? '' : '中国时间 ') + formatter.format(new Date());
        } catch (error) {
            clock.textContent = (mobile ? '' : '中国时间 ') +
                new Date().toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
        }
    }

    function getTextRect(element) {
        if (!element) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        const rects = Array.from(range.getClientRects()).filter((rect) => (
            rect.width > 1 && rect.height > 1
        ));
        if (!rects.length) return element.getBoundingClientRect();

        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        rects.forEach((rect) => {
            left = Math.min(left, rect.left);
            top = Math.min(top, rect.top);
            right = Math.max(right, rect.right);
            bottom = Math.max(bottom, rect.bottom);
        });
        const bounds = element.getBoundingClientRect();
        left = Math.max(left, bounds.left);
        top = Math.max(top, bounds.top);
        right = Math.min(right, bounds.right);
        bottom = Math.min(bottom, bounds.bottom);
        if (right <= left || bottom <= top) return bounds;
        return {
            left,
            top,
            right,
            bottom,
            width: right - left,
            height: bottom - top
        };
    }

    function getFrameRect(element, padding) {
        const rect = element.getBoundingClientRect();
        const expand = padding || 0;
        return {
            left: rect.left - expand,
            top: rect.top - expand,
            right: rect.right + expand,
            bottom: rect.bottom + expand,
            width: rect.width + expand * 2,
            height: rect.height + expand * 2
        };
    }

    function visibleAmount(element) {
        if (!element) return 0;
        const rect = element.getBoundingClientRect();
        const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        if (visibleHeight <= 0) return 0;
        return visibleHeight / Math.min(rect.height || viewportHeight, viewportHeight);
    }

    function sectionVisible(element, threshold) {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= viewportHeight) return false;
        const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
        return visibleHeight / Math.min(rect.height || viewportHeight, viewportHeight) >= threshold;
    }

    function collectGlyphs(element, originRect) {
        if (!element) return [];
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const glyphs = [];
        let node = walker.nextNode();

        while (node) {
            const content = node.nodeValue || '';
            const parent = node.parentElement;
            if (parent && content.length) {
                const style = getComputedStyle(parent);
                const font = [
                    style.fontStyle,
                    style.fontWeight,
                    style.fontSize,
                    style.fontFamily
                ].join(' ');
                const color = style.color;

                for (let index = 0; index < content.length; index += 1) {
                    const character = content[index];
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const rect = Array.from(range.getClientRects()).find((item) => (
                        item.width > 0.5 && item.height > 0.5
                    ));
                    if (!rect) continue;
                    glyphs.push({
                        character,
                        whitespace: /\s/.test(character),
                        x: rect.left - originRect.left,
                        y: rect.top - originRect.top,
                        width: rect.width,
                        height: rect.height,
                        font,
                        color
                    });
                }
            }
            node = walker.nextNode();
        }

        glyphs.sort((a, b) => (
            Math.abs(a.y - b.y) > 2 ? a.y - b.y : a.x - b.x
        ));
        return glyphs;
    }

    function refreshGlyphColors() {
        scenes.forEach((scene) => {
            scene.actions.forEach((action) => {
                if (!action.textElement || !action.glyphs.length) return;
                const originRect = action.element.getBoundingClientRect();
                const glyphs = collectGlyphs(action.textElement, originRect);
                const count = Math.min(action.glyphs.length, glyphs.length);
                for (let index = 0; index < count; index += 1) {
                    action.glyphs[index].color = glyphs[index].color;
                }
            });
        });
    }

    function drawGlyphs(glyphs, originRect, elapsed, alpha) {
        if (!glyphs.length || elapsed < 0 || alpha <= 0) {
            return {
                x: originRect.left,
                y: originRect.top + originRect.height * 0.5
            };
        }

        let current = glyphs[0];
        context.save();
        context.globalAlpha = alpha;
        context.textAlign = 'left';
        context.textBaseline = 'middle';

        for (let index = 0; index < glyphs.length; index += 1) {
            const glyph = glyphs[index];
            if (glyph.time > elapsed) break;
            current = glyph;
            if (glyph.whitespace) continue;
            context.font = glyph.font;
            context.fillStyle = glyph.color;
            context.fillText(
                glyph.character,
                originRect.left + glyph.x,
                originRect.top + glyph.y + glyph.height * 0.5 + 0.5
            );
        }
        context.restore();

        return {
            x: originRect.left + current.x + current.width + 2,
            y: originRect.top + current.y + current.height * 0.5
        };
    }

    function roundedRect(ctx, x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + width - r, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + r);
        ctx.lineTo(x + width, y + height - r);
        ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        ctx.lineTo(x + r, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    function normalizeAngle(angle) {
        return ((((angle + 180) % 360) + 360) % 360) - 180;
    }

    function angleFromVelocity(vx, vy) {
        return normalizeAngle(Math.atan2(vy, vx) * 180 / Math.PI + 128);
    }

    function smoothAngle(current, target, rate) {
        const delta = normalizeAngle(target - current);
        return normalizeAngle(current + delta * Math.min(1, rate));
    }

    function drawCursor(point, color, shape, angle, alpha) {
        if (alpha <= 0 || !point) return;
        const scale = compact ? 0.86 : 1;
        const hot = shape === 'arrow' ? { x: 5, y: 3.5 } : { x: 12, y: 12 };

        context.save();
        context.globalAlpha = alpha;
        context.translate(point.x, point.y);
        context.rotate((shape === 'arrow' ? angle : 0) * Math.PI / 180);
        context.scale(scale, scale);
        context.translate(-hot.x, -hot.y);
        context.shadowColor = 'rgba(0, 0, 0, 0.34)';
        context.shadowBlur = 2;
        context.shadowOffsetY = 1;

        if (shape === 'cross') {
            context.lineCap = 'round';
            context.beginPath();
            context.moveTo(12, 3.5);
            context.lineTo(12, 20.5);
            context.moveTo(3.5, 12);
            context.lineTo(20.5, 12);
            context.strokeStyle = '#ffffff';
            context.lineWidth = 3.6;
            context.stroke();
            context.shadowColor = 'transparent';
            context.strokeStyle = color;
            context.lineWidth = 1.5;
            context.stroke();
        } else if (shape === 'ibeam') {
            context.lineCap = 'round';
            context.strokeStyle = '#ffffff';
            context.lineWidth = 3.6;
            context.stroke(ibeamPath);
            context.shadowColor = 'transparent';
            context.strokeStyle = color;
            context.lineWidth = 1.5;
            context.stroke(ibeamPath);
        } else {
            context.fillStyle = color;
            context.lineJoin = 'round';
            context.fill(arrowPath);
            context.shadowColor = 'transparent';
            context.strokeStyle = '#ffffff';
            context.lineWidth = 1.5;
            context.stroke(arrowPath);
        }
        context.restore();
    }

    function curvedPoint(from, to, progress, bend, drag) {
        const eased = drag ? easeInOutCubic(progress) : easeOutCubic(progress);
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const offset = Math.sin(Math.PI * eased) * (bend || 0) * Math.min(length, 600);
        return {
            x: from.x + dx * eased + (-dy / length) * offset,
            y: from.y + dy * eased + (dx / length) * offset
        };
    }

    function actionOrigin(rect, index) {
        const enterFromRight = rect.left + rect.width * 0.5 > viewportWidth * 0.5;
        const offset = (index % 3 - 1) * 52;
        return {
            x: enterFromRight ? viewportWidth + 48 : -48,
            y: clamp(rect.top + rect.height * 0.5 + offset, 78, viewportHeight - 78)
        };
    }

    function drawDimensionBadge(rect, alpha) {
        const width = Math.max(0, Math.round(rect.width));
        const height = Math.max(0, Math.round(rect.height));
        if (width < 20 || height < 8) return;
        const label = width + ' × ' + height;
        context.save();
        context.globalAlpha = alpha;
        context.font = (compact ? '500 8px ' : '500 9px ') + '"Geist Mono", monospace';
        const boxWidth = Math.ceil(context.measureText(label).width) + 10;
        const boxHeight = compact ? 14 : 16;
        const x = rect.left + rect.width * 0.5 - boxWidth * 0.5;
        const y = Math.min(
            viewportHeight - boxHeight - 8,
            rect.top + rect.height + 8
        );
        roundedRect(context, x, y, boxWidth, boxHeight, 2);
        context.fillStyle = selectionColor;
        context.fill();
        context.fillStyle = '#ffffff';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, x + boxWidth * 0.5, y + boxHeight * 0.5 + 0.5);
        context.restore();
    }

    function drawSelectionBox(rect, alpha, options) {
        if (!rect || alpha <= 0 || rect.width < 0.5 || rect.height < 0.5) return;
        const settings = options || {};
        const handleSize = compact ? 6 : 7;

        context.save();
        context.globalAlpha = alpha;
        context.strokeStyle = selectionColor;
        context.lineWidth = 1;
        context.strokeRect(rect.left, rect.top, rect.width, rect.height);

        const corners = [
            [rect.left, rect.top],
            [rect.left + rect.width, rect.top],
            [rect.left + rect.width, rect.top + rect.height],
            [rect.left, rect.top + rect.height]
        ];
        corners.forEach(([x, y]) => {
            context.fillStyle = '#ffffff';
            context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
            context.strokeStyle = selectionColor;
            context.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
        });

        if (settings.text) {
            context.strokeStyle = selectionColor;
            context.lineWidth = 1.5;
            context.beginPath();
            context.moveTo(rect.left, rect.top + rect.height - 1);
            context.lineTo(rect.left + rect.width, rect.top + rect.height - 1);
            context.stroke();
        }
        context.restore();

        if (settings.badge !== false) drawDimensionBadge(rect, alpha);
    }

    function dragRect(fullRect, point) {
        return {
            left: fullRect.left,
            top: fullRect.top,
            width: clamp(point.x - fullRect.left, 0, fullRect.width),
            height: clamp(point.y - fullRect.top, 0, fullRect.height)
        };
    }

    function prepareAction(action) {
        if (!action.element) return;
        const originRect = action.element.getBoundingClientRect();
        action.glyphs = action.textElement
            ? collectGlyphs(action.textElement, originRect)
            : [];
        const glyphCount = action.glyphs.filter((glyph) => !glyph.whitespace).length;
        let typeTotal = 0;
        action.glyphs.forEach((glyph) => {
            glyph.time = typeTotal;
            let delay = rand(0.012, 0.04);
            if (glyph.whitespace) delay += rand(0, 0.03);
            if (Math.random() < 0.025) delay += rand(0.08, 0.2);
            typeTotal += delay;
        });
        action.typeTotal = Math.max(0.1, typeTotal);
        if (action.kind === 'text') {
            action.typeDuration = clamp(action.typeTotal * 1150, compact ? 680 : 820, 2400);
        } else {
            action.typeDuration = glyphCount
                ? clamp(action.typeTotal * 920, 480, 2200)
                : 0;
        }
        hideNode(action.element);
        if (action.textElement && action.textElement !== action.element) {
            hideNode(action.textElement);
        }
    }

    function prepareScene(scene, now) {
        if (scene.prepared) return;
        scene.prepared = true;
        scene.startedAt = now;
        scene.ambientUntil = now + 700;
        scene.actions.forEach(prepareAction);
    }

    function createScene(section, actions, options) {
        const settings = options || {};
        const scene = {
            section,
            actions: actions.map((action, index) => ({
                ...action,
                sequence: index,
                colorIndex: (index + scenes.length * 3) % cursorColors.length,
                bend: (index % 2 ? 1 : -1) * (0.04 + ((index * 7) % 9) * 0.011),
                glyphs: [],
                typeDuration: 0,
                started: false,
                finished: false,
                startAt: 0
            })),
            prepared: false,
            preparedAt: 0,
            startedAt: 0,
            visibleAt: 0,
            delay: settings.delay || 0,
            stagger: settings.stagger || (compact ? 230 : 330),
            ambientUntil: 0,
            nextAt: 0
        };
        scenes.push(scene);
        return scene;
    }

    const wordmark = document.querySelector('.wordmark');
    const menuToggle = document.querySelector('.head-menu-toggle');
    const headTime = document.querySelector('.head-time');
    const headCoords = document.querySelector('.head-coords');
    const headSum = document.querySelector('.head-sum');
    const menuItems = Array.from(document.querySelectorAll('#site-menu > *'));
    createScene(document.body, [
        wordmark,
        ...menuItems,
        menuToggle,
        headTime,
        headCoords,
        headSum
    ].filter(Boolean).map((element) => ({
        kind: 'text',
        element,
        textElement: element,
        label: '',
        badge: false,
        onDraw: element === headTime ? refreshLiveClock : null,
        move: 360,
        frameDuration: 0,
        typeMove: 80,
        hold: 120,
        exitDuration: 380
    })), { delay: compact ? 420 : 560, stagger: compact ? 170 : 200 });

    const manifestoPortrait = manifesto.querySelector('.manifesto-portrait-frame');
    const manifestoParagraphs = Array.from(manifesto.querySelectorAll('.manifesto-copy p'));
    createScene(manifesto, [
        manifestoPortrait ? {
            kind: 'frame',
            element: manifestoPortrait,
            textElement: null,
            label: 'FRAME',
            move: 560,
            frameDuration: 1040,
            typeMove: 0,
            hold: 560,
            exitDuration: 560
        } : null,
        ...manifestoParagraphs.map((element, index) => ({
            kind: 'frameText',
            element,
            textElement: element,
            label: index === 0 ? 'TEXT' : 'AUTO',
            move: 560,
            frameDuration: 820,
            typeMove: 340,
            hold: 420,
            exitDuration: 520
        }))
    ].filter(Boolean));

    const folioHead = folio.querySelector('.folio-head');
    const folioIntro = folio.querySelector('.folio-intro');
    const folioCards = Array.from(folio.querySelectorAll('.folio-card'));
    const folioCta = folio.querySelector('.folio-cta');
    createScene(folio, [
        folioHead ? {
            kind: 'frameText',
            element: folioHead,
            textElement: folioHead.querySelector('.folio-head-title'),
            label: 'TYPE',
            move: 500,
            frameDuration: 720,
            typeMove: 300,
            hold: 360,
            exitDuration: 460
        } : null,
        folioIntro ? {
            kind: 'frameText',
            element: folioIntro,
            textElement: folioIntro.querySelector('.folio-intro-title'),
            label: '01',
            move: 560,
            frameDuration: 980,
            typeMove: 340,
            hold: 420,
            exitDuration: 520
        } : null,
        ...folioCards.map((element, index) => ({
            kind: 'frameText',
            element,
            textElement: element.querySelector('.folio-card-name'),
            label: String(index + 2).padStart(2, '0'),
            move: 500,
            frameDuration: 820,
            typeMove: 300,
            hold: 340,
            exitDuration: 460
        })),
        folioCta ? {
            kind: 'frameText',
            element: folioCta,
            textElement: folioCta.querySelector('.folio-cta-title'),
            label: 'VIEW',
            move: 540,
            frameDuration: 900,
            typeMove: 320,
            hold: 380,
            exitDuration: 500
        } : null
    ].filter(Boolean));

    function primeSceneVisibility() {
        scenes.forEach((scene) => {
            scene.actions.forEach((action) => {
                hideNode(action.element);
                if (action.textElement && action.textElement !== action.element) {
                    hideNode(action.textElement);
                }
            });
        });
    }

    primeSceneVisibility();

    function resize() {
        viewportWidth = window.innerWidth;
        viewportHeight = window.innerHeight;
        pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        compact = viewportWidth < 700;
        lightTheme = document.documentElement.classList.contains('light');
        refreshSelectionColor();
        canvas.width = Math.max(1, Math.round(viewportWidth * pixelRatio));
        canvas.height = Math.max(1, Math.round(viewportHeight * pixelRatio));
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function queueAction(scene, action, now) {
        if (action.started) return;
        action.started = true;
        action.startAt = Math.max(now + 110, scene.nextAt);
        scene.nextAt = action.startAt + scene.stagger;
        scene.ambientUntil = Math.max(scene.ambientUntil, now + 1800);
    }

    function startVisibleActions(scene, now) {
        if (!started) return;
        scene.actions.forEach((action) => {
            if (action.finished && action.onDraw) action.onDraw();
        });
        if (!scene.visibleAt) scene.visibleAt = now;
        const threshold = scene.section === folio ? 0.08 : 0.14;
        if (!sectionVisible(scene.section, threshold)) return;

        prepareScene(scene, now);
        if (document.getElementById('boot')) return;
        if (now - scene.visibleAt < scene.delay) return;
        scene.actions.forEach((action) => {
            if (action.started || action.finished) return;
            const targetReady = action.kind === 'text'
                ? visibleAmount(action.element) > 0.55
                : visibleAmount(action.element) > (compact ? 0.34 : 0.26);
            if (!targetReady) return;
            queueAction(scene, action, now);
        });
    }

    function revealShell(action) {
        if (!action.textElement || action.textElement === action.element) return;
        showNode(action.element);
        hideNode(action.textElement);
    }

    function finishAction(action) {
        if (action.finished) return;
        if (action.onDraw) action.onDraw();
        action.finished = true;
        showNode(action.element);
        if (action.textElement) showNode(action.textElement);
    }

    function drawFrameAction(action, now, palette) {
        const elapsed = now - action.startAt;
        const frameStart = action.move;
        const frameEnd = frameStart + action.frameDuration;
        const hasText = Boolean(action.textElement && action.glyphs.length);
        const typeStart = frameEnd + action.typeMove;
        const typeEnd = typeStart + action.typeDuration;
        const holdEnd = (hasText ? typeEnd : frameEnd) + action.hold;
        const total = holdEnd + action.exitDuration;

        if (elapsed < 0) return false;
        if (elapsed > total) {
            finishAction(action);
            return true;
        }

        const color = palette[action.identity.colorIndex % palette.length];
        const frame = getFrameRect(action.element, compact ? 2 : 4);
        const origin = actionOrigin(frame, action.sequence);
        const fadeProgress = clamp((elapsed - holdEnd) / action.exitDuration, 0, 1);
        const alpha = 1 - fadeProgress;

        if (elapsed < frameStart) {
            const moveProgress = clamp(elapsed / Math.max(1, action.move), 0, 1);
            const trail = drawTrail(
                origin,
                { x: frame.left, y: frame.top },
                moveProgress,
                color,
                alpha
            );
            drawCursor(trail.x, trail.y, color, action.label, alpha);
            return false;
        }

        if (elapsed < frameEnd) {
            const frameProgress = easeInOutCubic(clamp(
                (elapsed - frameStart) / Math.max(1, action.frameDuration),
                0,
                1
            ));
            drawFrameProgress(frame, frameProgress, color, alpha);
            const head = perimeterPoint(frame, frameProgress);
            drawCursor(head.x, head.y, color, action.label, alpha);
            return false;
        }

        revealShell(action);
        drawFrameProgress(frame, 1, color, alpha * 0.86);

        if (!hasText) {
            showNode(action.element);
            if (elapsed >= holdEnd) finishAction(action);
            return false;
        }

        const textRect = action.element.getBoundingClientRect();
        const firstGlyph = action.glyphs[0];
        const lastGlyph = action.glyphs[action.glyphs.length - 1];
        const typeStartPoint = {
            x: textRect.left + firstGlyph.x,
            y: textRect.top + firstGlyph.y + firstGlyph.height * 0.5
        };
        const endPoint = {
            x: textRect.left + lastGlyph.x + lastGlyph.width,
            y: textRect.top + lastGlyph.y + lastGlyph.height * 0.5
        };

        if (elapsed < typeStart) {
            const typeMoveProgress = clamp(
                (elapsed - frameEnd) / Math.max(1, action.typeMove),
                0,
                1
            );
            const trail = drawTrail(
                perimeterPoint(frame, 1),
                typeStartPoint,
                typeMoveProgress,
                color,
                alpha
            );
            drawCursor(trail.x, trail.y, color, action.label, alpha);
            return false;
        }

        if (elapsed < typeEnd) {
            const typeProgress = clamp(
                (elapsed - typeStart) / Math.max(1, action.typeDuration),
                0,
                1
            );
            const cursor = drawGlyphs(action.glyphs, textRect, typeProgress, alpha);
            drawCursor(cursor.x, cursor.y, color, action.label, alpha);
            return false;
        }

        showNode(action.textElement);
        if (elapsed < holdEnd) {
            drawCursor(endPoint.x, endPoint.y, color, action.label, alpha);
            return false;
        }

        const exitProgress = easeOutCubic(clamp(
            (elapsed - holdEnd) / Math.max(1, action.exitDuration),
            0,
            1
        ));
        const exitPoint = actionOrigin(frame, (action.sequence + 2) % 4);
        const cursor = {
            x: mix(endPoint.x, exitPoint.x, exitProgress),
            y: mix(endPoint.y, exitPoint.y, exitProgress)
        };
        drawCursor(cursor.x, cursor.y, color, action.label, alpha);
        if (elapsed >= total) finishAction(action);
        return false;
    }

    function drawTextAction(action, now, palette) {
        const elapsed = now - action.startAt;
        const typeStart = action.move + action.typeMove;
        const typeEnd = typeStart + action.typeDuration;
        const holdEnd = typeEnd + action.hold;
        const total = holdEnd + action.exitDuration;

        if (elapsed < 0) return false;
        if (elapsed > total) {
            finishAction(action);
            return true;
        }

        const color = palette[action.identity.colorIndex % palette.length];
        const rect = action.element.getBoundingClientRect();
        const textBounds = getTextRect(action.element) || rect;
        const frame = {
            left: textBounds.left - (compact ? 3 : 5),
            top: textBounds.top - (compact ? 3 : 5),
            right: textBounds.right + (compact ? 3 : 5),
            bottom: textBounds.bottom + (compact ? 3 : 5),
            width: textBounds.width + (compact ? 6 : 10),
            height: textBounds.height + (compact ? 6 : 10)
        };
        const firstGlyph = action.glyphs[0] || { x: 0, y: rect.height * 0.5, width: 0, height: 0 };
        const lastGlyph = action.glyphs[action.glyphs.length - 1] || firstGlyph;
        const startPoint = {
            x: rect.left + firstGlyph.x,
            y: rect.top + firstGlyph.y + firstGlyph.height * 0.5
        };
        const endPoint = {
            x: rect.left + lastGlyph.x + lastGlyph.width,
            y: rect.top + lastGlyph.y + lastGlyph.height * 0.5
        };
        const origin = actionOrigin(frame, action.sequence);
        const fadeProgress = clamp((elapsed - holdEnd) / action.exitDuration, 0, 1);
        const alpha = 1 - fadeProgress;

        if (elapsed < action.move) {
            const moveProgress = clamp(elapsed / Math.max(1, action.move), 0, 1);
            const trail = drawTrail(origin, startPoint, moveProgress, color, alpha);
            drawCursor(trail.x, trail.y, color, action.label, alpha);
            return false;
        }

        if (elapsed < typeStart) {
            const typeMoveProgress = clamp(
                (elapsed - action.move) / Math.max(1, action.typeMove),
                0,
                1
            );
            const trail = drawTrail(startPoint, startPoint, typeMoveProgress, color, alpha);
            drawCursor(trail.x, trail.y, color, action.label, alpha);
            return false;
        }

        if (elapsed < typeEnd) {
            const typeProgress = clamp(
                (elapsed - typeStart) / Math.max(1, action.typeDuration),
                0,
                1
            );
            const cursor = drawGlyphs(action.glyphs, rect, typeProgress, alpha);
            drawFrameProgress(frame, typeProgress, color, alpha * 0.54);
            drawCursor(cursor.x, cursor.y, color, action.label, alpha);
            return false;
        }

        showNode(action.textElement || action.element);
        if (elapsed < holdEnd) {
            drawCursor(endPoint.x, endPoint.y, color, action.label, alpha);
            return false;
        }

        const exitProgress = easeOutCubic(clamp(
            (elapsed - holdEnd) / Math.max(1, action.exitDuration),
            0,
            1
        ));
        const exitPoint = actionOrigin(frame, (action.sequence + 2) % 4);
        const cursor = {
            x: mix(endPoint.x, exitPoint.x, exitProgress),
            y: mix(endPoint.y, exitPoint.y, exitProgress)
        };
        drawCursor(cursor.x, cursor.y, color, action.label, alpha);
        if (elapsed >= total) finishAction(action);
        return false;
    }

    function drawAmbient(scene, now, palette, sceneIndex) {
        if (!scene.prepared || now > scene.ambientUntil) return;
        if (!sectionVisible(scene.section, 0.06)) return;
        const timeLeft = scene.ambientUntil - now;
        if (timeLeft <= 0) return;

        const rect = scene.section.getBoundingClientRect();
        const visibleTop = Math.max(76, rect.top);
        const visibleBottom = Math.min(viewportHeight - 76, rect.bottom);
        if (visibleBottom - visibleTop < 120) return;

        const centerY = (visibleTop + visibleBottom) * 0.5;
        const radiusX = viewportWidth * (compact ? 0.29 : 0.34);
        const radiusY = Math.min(compact ? 170 : 250, (visibleBottom - visibleTop) * 0.31);
        const count = compact ? 2 : 3;
        const fade = clamp(timeLeft / 700, 0, 1);
        const alphaScale = fade * (compact ? 0.62 : 0.74);

        for (let index = 0; index < count; index += 1) {
            const phase = index * 2.18 + sceneIndex * 0.9;
            const speed = 0.00022 + index * 0.000018;
            const time = now * speed;
            const x = viewportWidth * 0.5 + Math.cos(time * 1.1 + phase) * radiusX;
            const y = centerY + Math.sin(time * 1.42 + phase * 1.7) * radiusY;
            const color = palette[(index + sceneIndex + 1) % palette.length];
            const label = identities[(index + sceneIndex) % identities.length].label;

            context.save();
            context.fillStyle = color;
            for (let trailIndex = 1; trailIndex <= 5; trailIndex += 1) {
                const trailPhase = phase - trailIndex * 0.06;
                const trailX = viewportWidth * 0.5 + Math.cos(time * 1.1 + trailPhase) * radiusX;
                const trailY = centerY + Math.sin(time * 1.42 + trailPhase * 1.7) * radiusY;
                context.globalAlpha = alphaScale * (0.12 - trailIndex * 0.016);
                context.beginPath();
                context.arc(trailX, trailY, compact ? 1.1 : 1.5, 0, Math.PI * 2);
                context.fill();
            }
            context.restore();
            drawCursor(x, y, color, label, alphaScale);
        }
    }

    function drawTaskExit(action, elapsed, holdEnd, frame, startPoint, color, alpha) {
        const progress = clamp(
            (elapsed - holdEnd) / Math.max(1, action.exitDuration),
            0,
            1
        );
        const exitPoint = actionOrigin(frame, (action.sequence + 2) % 4);
        const point = curvedPoint(
            startPoint,
            exitPoint,
            progress,
            action.bend,
            false
        );
        const angle = angleFromVelocity(
            exitPoint.x - startPoint.x,
            exitPoint.y - startPoint.y
        );
        drawCursor(point, color, 'arrow', angle, alpha);
        return point;
    }

    function drawSelectionFrameTask(action, now, palette) {
        if (action.kind === 'frameText' && action.textElement === action.element) {
            return drawSelectionTextTask(action, now, palette);
        }

        const elapsed = now - action.startAt;
        if (elapsed < 0) return false;

        const color = palette[action.colorIndex % palette.length];
        const frame = getFrameRect(action.element, 0);
        const start = { x: frame.left, y: frame.top };
        const end = { x: frame.left + frame.width, y: frame.top + frame.height };
        const dragDuration = action.frameDuration || 820;
        const dragEnd = action.move + dragDuration;
        const settleEnd = dragEnd + 160;
        const hasText = Boolean(action.textElement && action.glyphs.length);
        const textMoveDuration = action.typeMove || 300;
        const textMoveEnd = settleEnd + textMoveDuration;
        const textDragDuration = compact ? 520 : 640;
        const textDragEnd = textMoveEnd + textDragDuration;
        const typeStart = textDragEnd + 220;
        const typeEnd = typeStart + action.typeDuration;
        const holdEnd = (hasText ? typeEnd : settleEnd) + action.hold;
        const total = holdEnd + action.exitDuration;

        if (elapsed > total) {
            finishAction(action);
            return true;
        }

        const fade = clamp((elapsed - holdEnd) / Math.max(1, action.exitDuration), 0, 1);
        const alpha = 1 - fade;

        if (elapsed < action.move) {
            const progress = clamp(elapsed / Math.max(1, action.move), 0, 1);
            const point = curvedPoint(
                actionOrigin(frame, action.sequence),
                start,
                progress,
                action.bend,
                false
            );
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        if (elapsed < dragEnd) {
            const progress = clamp(
                (elapsed - action.move) / Math.max(1, dragDuration),
                0,
                1
            );
            const point = curvedPoint(start, end, progress, 0, true);
            drawSelectionBox(dragRect(frame, point), alpha, { badge: true });
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        revealShell(action);
        drawSelectionBox(frame, alpha, {
            badge: true,
            text: false
        });

        if (!hasText) {
            showNode(action.element);
            if (elapsed < holdEnd) {
                drawCursor(end, color, 'arrow', 0, alpha);
            } else {
                drawTaskExit(action, elapsed, holdEnd, frame, end, color, alpha);
            }
            if (elapsed >= total) finishAction(action);
            return false;
        }

        const textRect = getTextRect(action.textElement);
        if (!textRect) {
            showNode(action.textElement);
            if (elapsed >= total) finishAction(action);
            return false;
        }
        const textStart = { x: textRect.left, y: textRect.top };
        const textEnd = { x: textRect.left + textRect.width, y: textRect.top + textRect.height };

        if (elapsed < textMoveEnd) {
            const progress = clamp(
                (elapsed - settleEnd) / Math.max(1, textMoveDuration),
                0,
                1
            );
            const point = curvedPoint(
                end,
                textStart,
                progress,
                action.bend * 0.7,
                false
            );
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        if (elapsed < textDragEnd) {
            const progress = clamp(
                (elapsed - textMoveEnd) / Math.max(1, textDragDuration),
                0,
                1
            );
            const point = curvedPoint(textStart, textEnd, progress, 0, true);
            drawSelectionBox(dragRect(textRect, point), alpha, {
                badge: true,
                text: true
            });
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        const firstGlyph = action.glyphs[0];
        const lastGlyph = action.glyphs[action.glyphs.length - 1];
        const glyphOrigin = action.element.getBoundingClientRect();
        const firstPoint = {
            x: glyphOrigin.left + firstGlyph.x,
            y: glyphOrigin.top + firstGlyph.y + firstGlyph.height * 0.5
        };
        const lastPoint = {
            x: glyphOrigin.left + lastGlyph.x + lastGlyph.width,
            y: glyphOrigin.top + lastGlyph.y + lastGlyph.height * 0.5
        };

        if (elapsed < typeStart) {
            const progress = clamp(
                (elapsed - textDragEnd) / Math.max(1, typeStart - textDragEnd),
                0,
                1
            );
            const point = curvedPoint(textEnd, firstPoint, progress, 0, false);
            drawSelectionBox(textRect, alpha, { badge: true, text: true });
            drawCursor(point, color, 'ibeam', 0, alpha);
            return false;
        }

        if (elapsed < typeEnd) {
            const progress = clamp(
                (elapsed - typeStart) / Math.max(1, action.typeDuration),
                0,
                1
            );
            const cursor = drawGlyphs(
                action.glyphs,
                glyphOrigin,
                action.typeTotal * progress,
                alpha
            );
            drawSelectionBox(textRect, alpha, { badge: true, text: true });
            drawCursor(cursor, color, 'ibeam', 0, alpha);
            return false;
        }

        showNode(action.textElement);
        drawSelectionBox(textRect, alpha, { badge: true, text: true });
        if (elapsed < holdEnd) {
            drawCursor(lastPoint, color, 'arrow', angleFromVelocity(0, -1), alpha);
        } else {
            drawTaskExit(action, elapsed, holdEnd, frame, lastPoint, color, alpha);
        }
        if (elapsed >= total) finishAction(action);
        return false;
    }

    function drawSelectionTextTask(action, now, palette) {
        const elapsed = now - action.startAt;
        if (elapsed < 0) return false;

        const color = palette[action.colorIndex % palette.length];
        const elementRect = action.element.getBoundingClientRect();
        const textRect = getTextRect(action.textElement || action.element) || elementRect;
        const start = { x: textRect.left, y: textRect.top };
        const end = { x: textRect.left + textRect.width, y: textRect.top + textRect.height };
        const dragDuration = compact ? 520 : 640;
        const dragEnd = action.move + dragDuration;
        const typeMoveEnd = dragEnd + 220;
        const typeEnd = typeMoveEnd + action.typeDuration;
        const holdEnd = typeEnd + action.hold;
        const total = holdEnd + action.exitDuration;

        if (elapsed > total) {
            finishAction(action);
            return true;
        }

        const fade = clamp((elapsed - holdEnd) / Math.max(1, action.exitDuration), 0, 1);
        const alpha = 1 - fade;

        if (elapsed < action.move) {
            const progress = clamp(elapsed / Math.max(1, action.move), 0, 1);
            const point = curvedPoint(
                actionOrigin(textRect, action.sequence),
                start,
                progress,
                action.bend,
                false
            );
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        if (elapsed < dragEnd) {
            const progress = clamp(
                (elapsed - action.move) / Math.max(1, dragDuration),
                0,
                1
            );
            const point = curvedPoint(start, end, progress, 0, true);
            drawSelectionBox(dragRect(textRect, point), alpha, {
                badge: action.badge !== false,
                text: true
            });
            drawCursor(point, color, 'cross', 0, alpha);
            return false;
        }

        const firstGlyph = action.glyphs[0] || {
            x: 0,
            y: textRect.height * 0.5,
            width: 0,
            height: 0
        };
        const lastGlyph = action.glyphs[action.glyphs.length - 1] || firstGlyph;
        const firstPoint = {
            x: elementRect.left + firstGlyph.x,
            y: elementRect.top + firstGlyph.y + firstGlyph.height * 0.5
        };
        const lastPoint = {
            x: elementRect.left + lastGlyph.x + lastGlyph.width,
            y: elementRect.top + lastGlyph.y + lastGlyph.height * 0.5
        };

        if (elapsed < typeMoveEnd) {
            const progress = clamp(
                (elapsed - dragEnd) / Math.max(1, typeMoveEnd - dragEnd),
                0,
                1
            );
            const point = curvedPoint(end, firstPoint, progress, 0, false);
            drawSelectionBox(textRect, alpha, {
                badge: action.badge !== false,
                text: true
            });
            drawCursor(point, color, 'ibeam', 0, alpha);
            return false;
        }

        if (elapsed < typeEnd) {
            const progress = clamp(
                (elapsed - typeMoveEnd) / Math.max(1, action.typeDuration),
                0,
                1
            );
            const cursor = drawGlyphs(
                action.glyphs,
                elementRect,
                action.typeTotal * progress,
                alpha
            );
            drawSelectionBox(textRect, alpha, {
                badge: action.badge !== false,
                text: true
            });
            drawCursor(cursor, color, 'ibeam', 0, alpha);
            return false;
        }

        showNode(action.textElement || action.element);
        drawSelectionBox(textRect, alpha, {
            badge: action.badge !== false,
            text: true
        });
        if (elapsed < holdEnd) {
            drawCursor(lastPoint, color, 'arrow', angleFromVelocity(0, -1), alpha);
        } else {
            drawTaskExit(action, elapsed, holdEnd, textRect, lastPoint, color, alpha);
        }
        if (elapsed >= total) finishAction(action);
        return false;
    }

    function createFlock() {
        const count = compact ? 8 : 18;
        flock = [];
        for (let index = 0; index < count; index += 1) {
            const fromLeft = index % 2 === 0;
            const fast = Math.random() < 0.24;
            flock.push({
                x: fromLeft ? -rand(36, 240) : viewportWidth + rand(36, 240),
                y: rand(0.08, 0.92) * viewportHeight,
                vx: fromLeft ? rand(80, 240) : -rand(80, 240),
                vy: rand(-60, 60),
                angle: rand(-180, 180),
                color: cursorColors[index % cursorColors.length],
                speed: fast ? rand(1000, 1450) : rand(320, 760),
                force: fast ? rand(3400, 5600) : rand(750, 1750),
                spin: fast ? rand(2.2, 3.4) : rand(0.8, 1.8),
                curl: rand(-1, 1),
                orbit: rand(70, 170)
            });
        }
    }

    function activeFlockScene() {
        let active = null;
        let best = 0;
        scenes.forEach((scene) => {
            const rect = scene.section.getBoundingClientRect();
            const visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
            if (visible > best) {
                best = visible;
                active = scene;
            }
        });
        return best > 40 ? active : null;
    }

    function updateFlock(scene) {
        if (!flock.length) createFlock();
        const target = {
            x: viewportWidth * (0.5 + 0.28 * Math.sin(flockTime * 0.37)),
            y: viewportHeight * (0.5 + 0.25 * Math.sin(flockTime * 0.53 + 1))
        };

        const scale = compact ? 0.72 : 1;
        const radius = 135 * scale * (1 + 0.18 * Math.sin(flockTime * 0.55));
        const swirl = Math.tanh(Math.cos(flockTime * 0.11) * 3);
        const desired = flock.map((cursor) => {
            const dx = cursor.x - target.x;
            const dy = cursor.y - target.y;
            const distance = Math.hypot(dx, dy) || 0.01;
            const nx = dx / distance;
            const ny = dy / distance;
            const angle = Math.atan2(dy, dx);
            const offset = (cursor.orbit - 120) * 0.55 * scale;
            const orbitRadius = radius * (1 + 0.3 * Math.sin(3 * angle + flockTime * 0.7)) + offset;
            const tangent = 300 * (0.7 + cursor.spin * 0.2) * swirl;
            const radial = clamp((orbitRadius - distance) * 4, -2600, 1400);
            const far = clamp((distance - orbitRadius) / 600, 0, 1);
            return [
                -ny * tangent + nx * radial - ny * cursor.curl * 400 * far,
                nx * tangent + ny * radial + nx * cursor.curl * 400 * far
            ];
        });

        for (let index = 0; index < flock.length; index += 1) {
            const cursor = flock[index];
            let alignmentX = 0;
            let alignmentY = 0;
            let alignmentWeight = 0;
            let separationX = 0;
            let separationY = 0;

            for (let otherIndex = 0; otherIndex < flock.length; otherIndex += 1) {
                if (index === otherIndex) continue;
                const other = flock[otherIndex];
                const dx = other.x - cursor.x;
                const dy = other.y - cursor.y;
                const distance = Math.hypot(dx, dy);
                if (distance > 96) continue;
                const weight = 1 - distance / 96;
                alignmentX += other.vx * weight;
                alignmentY += other.vy * weight;
                alignmentWeight += weight;
                if (distance < 34 && distance > 0.01) {
                    separationX -= dx / distance * (34 - distance) * 20;
                    separationY -= dy / distance * (34 - distance) * 20;
                }
            }

            let [forceX, forceY] = desired[index];
            if (alignmentWeight > 0) {
                forceX = forceX * 0.7 + (alignmentX / alignmentWeight) * 0.3;
                forceY = forceY * 0.7 + (alignmentY / alignmentWeight) * 0.3;
            }
            forceX += separationX;
            forceY += separationY;

            const distanceToTarget = Math.max(
                0,
                Math.hypot(cursor.x - target.x, cursor.y - target.y) - 180 * scale
            );
            const maxVelocity = cursor.speed * (1.3 + Math.min(3.2, distanceToTarget / 90));
            const forceLength = Math.hypot(forceX, forceY);
            if (forceLength > maxVelocity) {
                forceX *= maxVelocity / forceLength;
                forceY *= maxVelocity / forceLength;
            }

            let accelX = (forceX - cursor.vx) * 6;
            let accelY = (forceY - cursor.vy) * 6;
            const maxForce = cursor.force * (1.4 + Math.min(5, distanceToTarget / 50));
            const accelLength = Math.hypot(accelX, accelY);
            if (accelLength > maxForce) {
                accelX *= maxForce / accelLength;
                accelY *= maxForce / accelLength;
            }
            cursor.vx += accelX * frameDelta;
            cursor.vy += accelY * frameDelta;
            cursor.x += cursor.vx * frameDelta;
            cursor.y += cursor.vy * frameDelta;

            if (cursor.x < -260) {
                cursor.x = -260;
                cursor.vx = Math.abs(cursor.vx) * 0.5;
            } else if (cursor.x > viewportWidth + 260) {
                cursor.x = viewportWidth + 260;
                cursor.vx = -Math.abs(cursor.vx) * 0.5;
            }
            if (cursor.y < -220) {
                cursor.y = -220;
                cursor.vy = Math.abs(cursor.vy) * 0.5;
            } else if (cursor.y > viewportHeight + 220) {
                cursor.y = viewportHeight + 220;
                cursor.vy = -Math.abs(cursor.vy) * 0.5;
            }

            cursor.angle = smoothAngle(
                cursor.angle,
                angleFromVelocity(cursor.vx, cursor.vy),
                frameDelta * 8
            );
        }
    }

    function drawFlock() {
        flock.forEach((cursor) => {
            if (
                cursor.x < -30 || cursor.x > viewportWidth + 30 ||
                cursor.y < -30 || cursor.y > viewportHeight + 30
            ) {
                return;
            }
            drawCursor(cursor, cursor.color, 'arrow', cursor.angle, compact ? 0.78 : 0.9);
        });
    }

    function render(now) {
        context.clearRect(0, 0, viewportWidth, viewportHeight);
        lightTheme = document.documentElement.classList.contains('light');
        const palette = getPalette();

        if (!started) {
            const boot = document.getElementById('boot');
            if (!boot || boot.classList.contains('is-complete')) started = true;
        }

        scenes.forEach((scene) => {
            startVisibleActions(scene, now);
        });

        scenes.forEach((scene) => {
            if (!sectionVisible(scene.section, 0.02)) return;
            scene.actions.forEach((action) => {
                if (!action.started || action.finished) return;
                const finished = action.kind === 'text'
                    ? drawSelectionTextTask(action, now, palette)
                    : drawSelectionFrameTask(action, now, palette);
                if (finished) {
                    finishAction(action);
                }
            });
        });
    }

    function tick(now) {
        frameDelta = clamp((now - lastTime) / 1000, 0, 0.05);
        flockTime += frameDelta;
        lastTime = now;
        render(now);
        eventFrame = window.requestAnimationFrame(tick);
    }

    function stopAndRestore() {
        window.cancelAnimationFrame(eventFrame);
        restoreAllNodes();
        context.clearRect(0, 0, viewportWidth, viewportHeight);
        canvas.remove();
    }

    window.addEventListener('resize', resize, { passive: true });
    window.addEventListener('orientationchange', resize, { passive: true });
    window.addEventListener('themechange', () => {
        refreshGlyphColors();
        refreshSelectionColor();
        lightTheme = document.documentElement.classList.contains('light');
    });
    window.addEventListener('pagehide', restoreAllNodes);
    document.addEventListener('visibilitychange', () => {
        lastTime = performance.now();
    });
    if (typeof reducedMotion.addEventListener === 'function') {
        reducedMotion.addEventListener('change', (event) => {
            if (event.matches) stopAndRestore();
        });
    }

    resize();
    eventFrame = window.requestAnimationFrame(tick);
}());
