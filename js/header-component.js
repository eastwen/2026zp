// Header 组件
class HeaderComponent {
    constructor(options = {}) {
        this.isSubPage = options.isSubPage || false;
        this.basePath = this.isSubPage ? '../' : '';
        this.handleThemeToggle = this.handleThemeToggle.bind(this);
        this.handleMenuToggle = this.handleMenuToggle.bind(this);
    }

    generateHTML() {
        const homeLink = this.isSubPage ? `${this.basePath}index.html#top` : '#top';
        const portfolioLink = this.isSubPage ? `${this.basePath}index.html#work` : '#work';
        const contactLink = 'mailto:392084795@qq.com';
        const backButton = this.isSubPage
            ? `<a class="head-back" href="${portfolioLink}" aria-label="返回上一层" title="返回上一层">
                    <img src="${this.basePath}icon/back.svg" alt="" width="18" height="18">
                </a>`
            : '';

        return `
            <header class="site-head" aria-label="站点导航">
                <div class="head-top">
                    <div class="head-brand">
                        <a class="wordmark" href="${homeLink}" aria-label="回到顶部"><span>East wen</span></a>
                        ${backButton}
                    </div>
                    <div class="head-links" id="site-menu">
                        <a href="${homeLink}">首页</a>
                        <a href="${portfolioLink}">作品</a>
                        <a href="${contactLink}">联系</a>
                        <button type="button" data-theme-toggle aria-label="切换主题">主题[D]</button>
                    </div>
                    <button class="head-menu-toggle" type="button" data-menu-toggle aria-expanded="false" aria-controls="site-menu" aria-label="打开菜单">
                        <span></span>
                        <span></span>
                    </button>
                </div>
            </header>
        `;
    }

    getSavedTheme() {
        try {
            return localStorage.getItem('theme') || 'dark';
        } catch (error) {
            return 'dark';
        }
    }

    applyTheme(theme) {
        const html = document.documentElement;
        html.classList.toggle('light', theme === 'light');
        html.classList.toggle('dark', theme === 'dark');
        html.classList.toggle('dark-theme', theme === 'dark');
        html.setAttribute('data-theme', theme);
        document.body.classList.toggle('dark-theme', theme === 'dark');

        const toggle = document.querySelector('[data-theme-toggle]');
        if (toggle) toggle.textContent = theme === 'light' ? '主题[L]' : '主题[D]';
    }

    handleThemeToggle() {
        const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
        this.applyTheme(next);
        try {
            localStorage.setItem('theme', next);
        } catch (error) {
            return;
        }
    }

    initThemeToggle() {
        const toggle = document.querySelector('[data-theme-toggle]');
        if (!toggle) return;
        toggle.addEventListener('click', this.handleThemeToggle);
        this.applyTheme(this.getSavedTheme());
    }

    setMenuOpen(open) {
        const header = document.querySelector('header.site-head');
        const toggle = document.querySelector('[data-menu-toggle]');
        if (!header || !toggle) return;
        header.classList.toggle('is-menu-open', open);
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    }

    handleMenuToggle(event) {
        event.stopPropagation();
        const header = document.querySelector('header.site-head');
        this.setMenuOpen(!header.classList.contains('is-menu-open'));
    }

    initMenu() {
        const header = document.querySelector('header.site-head');
        const toggle = document.querySelector('[data-menu-toggle]');
        const links = document.querySelector('.head-links');
        if (!header || !toggle || !links) return;

        toggle.addEventListener('click', this.handleMenuToggle);
        links.addEventListener('click', (event) => {
            if (event.target.closest('a, button')) this.setMenuOpen(false);
        });
        document.addEventListener('click', (event) => {
            if (!header.classList.contains('is-menu-open')) return;
            if (header.contains(event.target)) return;
            this.setMenuOpen(false);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            this.setMenuOpen(false);
            toggle.focus();
        });
    }

    render(targetElement = 'body') {
        const target = typeof targetElement === 'string'
            ? document.querySelector(targetElement)
            : targetElement;
        if (!target) return;

        if (targetElement === 'body') {
            target.insertAdjacentHTML('afterbegin', this.generateHTML());
        } else {
            target.innerHTML = this.generateHTML();
        }

        this.applyTheme(this.getSavedTheme());
        this.initThemeToggle();
        this.initMenu();
    }

    destroy() {
        const themeToggle = document.querySelector('[data-theme-toggle]');
        const menuToggle = document.querySelector('[data-menu-toggle]');
        if (themeToggle) themeToggle.removeEventListener('click', this.handleThemeToggle);
        if (menuToggle) menuToggle.removeEventListener('click', this.handleMenuToggle);
    }

    static create(options = {}) {
        const header = new HeaderComponent(options);
        header.render();
        return header;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderComponent;
} else {
    window.HeaderComponent = HeaderComponent;
}
