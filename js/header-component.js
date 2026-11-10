// Header组件
class HeaderComponent {
    constructor(options = {}) {
        this.isSubPage = options.isSubPage || false;
        this.basePath = this.isSubPage ? '../' : '';
        this.currentTheme = 'light'; // 默认主题
        
        // 将事件处理器绑定到实例
        this.handleThemeChange = this.handleThemeChange.bind(this);
    }

    // 生成header HTML
    generateHTML() {
        const homeLink = this.isSubPage ? `${this.basePath}index.html` : '#home';
        const aboutLink = this.isSubPage ? `${this.basePath}index.html#about` : '#about';
        const portfolioLink = this.isSubPage ? `${this.basePath}index.html#portfolio` : '#portfolio';
        const contactLink = 'mailto:392084795@qq.com';

        return `
            <header>
                <nav>
                    <a href="${homeLink}" class="logo">East  wen</a>
                    <div class="nav-right">
                        <div class="theme-toggle">
                            <input type="checkbox" id="theme-switch" class="theme-switch">
                            <label for="theme-switch" class="theme-label"></label>
                        </div>
                        <ul class="nav-links">
                            <li><a href="${homeLink}">主页</a></li>
                            <li><a href="${aboutLink}">自我介绍</a></li>
                            <li><a href="${portfolioLink}">作品列表</a></li>
                            <li><a href="${contactLink}">联系方式</a></li>
                        </ul>
                    </div>
                </nav>
            </header>
        `;
    }

    // 安全的主题存储方法
    saveTheme(theme) {
        try {
            if (typeof Storage !== 'undefined') {
                localStorage.setItem('theme', theme);
            }
        } catch (e) {
            console.warn('无法保存主题设置:', e);
        }
        this.currentTheme = theme;
    }

    // 安全的主题读取方法
    getSavedTheme() {
        try {
            if (typeof Storage !== 'undefined') {
                return localStorage.getItem('theme') || 'light';
            }
        } catch (e) {
            console.warn('无法读取主题设置:', e);
        }
        return this.currentTheme;
    }

    // 应用主题
    applyTheme(theme) {
        const body = document.body;
        const html = document.documentElement;
        
        if (theme === 'dark') {
            body.classList.add('dark-theme');
            html.classList.add('dark-theme');
            html.setAttribute('data-theme', 'dark');
        } else {
            body.classList.remove('dark-theme');
            html.classList.remove('dark-theme');
            html.setAttribute('data-theme', 'light');
        }
        
        // 更新开关状态
        const themeSwitch = document.querySelector('#theme-switch');
        if (themeSwitch) {
            themeSwitch.checked = (theme === 'dark');
        }
    }

    // 应用初始主题
    applyInitialTheme() {
        const savedTheme = this.getSavedTheme();
        this.applyTheme(savedTheme);
        console.log('Applied initial theme:', savedTheme);
    }

    // 主题切换事件处理器
    handleThemeChange(event) {
        const newTheme = event.target.checked ? 'dark' : 'light';
        this.applyTheme(newTheme);
        this.saveTheme(newTheme);
        console.log('Theme switched to:', newTheme);
    }

    // 初始化主题切换功能
    initThemeToggle() {
        const themeSwitch = document.querySelector('#theme-switch');
        
        if (!themeSwitch) {
            console.error('Theme switch element not found!');
            return;
        }

        console.log('Initializing theme toggle...');

        // 移除可能存在的旧事件监听器
        themeSwitch.removeEventListener('change', this.handleThemeChange);
        
        // 添加事件监听器
        themeSwitch.addEventListener('change', this.handleThemeChange);

        console.log('Theme toggle initialized successfully');
    }

    // 渲染header到页面
    render(targetElement = 'body') {
        const target = typeof targetElement === 'string'
            ? document.querySelector(targetElement)
            : targetElement;

        if (target) {
            // 如果是body，插入到开头；否则替换目标元素
            if (targetElement === 'body') {
                target.insertAdjacentHTML('afterbegin', this.generateHTML());
            } else {
                target.innerHTML = this.generateHTML();
            }

            // 立即应用初始主题
            this.applyInitialTheme();

            // 确保DOM完全渲染后初始化主题切换
            requestAnimationFrame(() => {
                this.initThemeToggle();
            });
        }
    }

    // 销毁方法（用于清理事件监听器）
    destroy() {
        const themeSwitch = document.querySelector('#theme-switch');
        if (themeSwitch && this.handleThemeChange) {
            themeSwitch.removeEventListener('change', this.handleThemeChange);
        }
    }

    // 静态方法：快速创建并渲染header
    static create(options = {}) {
        const header = new HeaderComponent(options);
        header.render();
        return header;
    }
}

// 导出组件
if (typeof module !== 'undefined' && module.exports) {
    module.exports = HeaderComponent;
} else {
    window.HeaderComponent = HeaderComponent;
}
