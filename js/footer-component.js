// Footer组件
class FooterComponent {
    constructor(options = {}) {
        this.customText = options.customText || null;
        this.isSubPage = options.isSubPage || false;
    }

    // 生成footer HTML
    generateHTML() {
        const qrPath = this.isSubPage ? '../img/微信图片_20250703153039.png' : 'img/微信图片_20250703153039.png';
        return `
            <footer id="contact" class="contact">
                <div class="footer-content">
                    <h2>联系我</h2>
                    <p>如果您对我的作品感兴趣，或者有任何合作意向，欢迎通过以下方式联系我：</p>
                    <div class="contact-info">
                        <p style="font-weight: 500;">邮箱 <a href="mailto:392084795@qq.com">392084795@qq.com</a></p>
                        <p style="font-weight: 500;">电话 <a href="tel:+15907669055">15907669055</a></p>
                        <p style="font-weight: 500;">微信 <span class="wechat-contact" onclick="event.preventDefault()">
    <span class="wechat-label qr-bubble-wrap">East-wen
        <span class="qr-bubble qr-bubble--bottom">
            <span class="qr-bubble__inner">
                <img src="${qrPath}" alt="微信二维码" style="width: 150px; height: 150px; border-radius: 8px;" />
            </span>
        </span>
    </span>
</span></p>
                    </div>

                    <!-- 法律保护 - 版权声明 -->
                    <div class="copyright-notice">
                        <p>© 2026 East wen. 所有作品均受版权保护，未经许可不得下载或使用。</p>
                        <p>All works are protected by copyright. Download or use without permission is prohibited.</p>
                        <p style="font-size: 12px; margin-top: 10px; opacity: 0.7;">
                            本网站内容受《中华人民共和国著作权法》保护 | Protected by Copyright Law
                        </p>
                    </div>
                </div>
            </footer>

            <style>
                /* 微信二维码气泡样式 */
                .wechat-contact {
                    position: relative;
                    display: inline-flex;
                    align-items: center;
                    color: #3354FF;
                    text-decoration: none;
                    cursor: pointer;
                }
                .wechat-contact:hover {
                    color: #fff;
                    text-shadow: 0 0 10px rgba(102, 126, 234, 0.5);
                }
                .qr-bubble-wrap {
                    position: relative;
                    display: inline-block;
                    margin-left: 8px;
                }
                .qr-icon {
                    width: 22px;
                    height: 22px;
                    border-radius: 4px;
                    vertical-align: middle;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                }
                .qr-bubble {
                    display: none;
                    position: absolute;
                    left: 50%;
                    bottom: 130%;
                    transform: translateX(-50%);
                    background: #fff;
                    border: 2px solid #3354FF;
                    border-radius: 10px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.18);
                    z-index: 1000;
                    min-width: 200px;
                    padding: 12px 12px 8px 12px;
                    text-align: center;
                    opacity: 0;
                    pointer-events: none;
                    transition: opacity 0.25s cubic-bezier(.4,0,.2,1);
                }
                .qr-bubble--bottom::before {
                    content: '';
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    border: 8px solid transparent;
                    border-top-color: #3354FF;
                }
                .qr-bubble__inner {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .qr-bubble__inner img {
                    width: 150px;
                    height: 150px;
                    border-radius: 8px;
                    margin-bottom: 10px;
                }
                .qr-bubble__inner p {
                    margin: 0;
                    color: #333;
                    font-size: 14px;
                    font-weight: 500;
                }
                .qr-bubble-wrap:hover .qr-bubble,
                .qr-bubble-wrap:focus-within .qr-bubble {
                    display: block;
                    opacity: 1;
                    pointer-events: auto;
                }
                @media (max-width: 768px) {
                    .qr-bubble {
                        left: 0;
                        transform: none;
                        min-width: 160px;
                        padding: 8px 8px 6px 8px;
                    }
                    .qr-bubble__inner img {
                        width: 100px;
                        height: 100px;
                    }
                }
            </style>
        `;
    }

    // 渲染footer到页面
    render(targetElement = 'body') {
        const target = typeof targetElement === 'string'
            ? document.querySelector(targetElement)
            : targetElement;

        if (target) {
            // 如果是body，插入到末尾；否则替换目标元素
            if (targetElement === 'body') {
                target.insertAdjacentHTML('beforeend', this.generateHTML());
            } else {
                target.innerHTML = this.generateHTML();
            }
        }
    }

    // 静态方法：快速创建并渲染footer
    static create(options = {}) {
        const footer = new FooterComponent(options);
        footer.render();
        return footer;
    }
}

// 导出组件
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FooterComponent;
} else {
    window.FooterComponent = FooterComponent;
}
