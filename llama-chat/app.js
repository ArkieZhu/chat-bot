/**
 * Llama Chat - 本地大模型对话前端
 * 与 llama.cpp HTTP API 通信
 */

class LlamaChatApp {
    constructor() {
        // 配置
        this.config = {
            apiUrl: 'http://127.0.0.1:8080',
            temperature: 0.7,
            maxTokens: 2048,
            topP: 0.9,
            topK: 40,
            repeatPenalty: 1.1,
            systemPrompt: '你是一个 helpful assistant。',
            maxContextTokens: 200000, // 默认最大上下文 token 数
            timeout: 60000, // 请求超时时间（毫秒）
            theme: 'dark', // 默认主题
            tokenPrice: 0 // Token 价格 ($/1M tokens)
        };

        // 状态
        this.state = {
            currentChatId: null,
            chats: [],
            messages: [],
            isGenerating: false,
            currentModel: null,
            models: [],
            contextTokens: 0, // 当前上下文使用的 token 数
            maxContextTokens: 200000, // 最大上下文 token 数
            abortController: null, // 用于取消流式请求
            totalCost: 0, // 当前会话累计成本
            attachments: [] // 附件列表
        };

        // DOM 元素
        this.elements = {};

        this.init();
    }

    init() {
        this.cacheElements();
        this.bindEvents();
        this.loadFromStorage();
        this.loadModels();
        this.checkServerStatus();
        this.renderHistory();
        this.applyTheme();

        // 如果有当前对话，加载消息
        if (this.state.currentChatId && this.state.messages.length > 0) {
            this.renderMessages();
            this.hideWelcomeScreen();
        }

        // 定期检测服务器状态
        setInterval(() => this.checkServerStatus(), 30000);
    }

    applyTheme() {
        document.body.setAttribute('data-theme', this.config.theme);
    }

    toggleTheme() {
        this.config.theme = this.config.theme === 'dark' ? 'light' : 'dark';
        this.applyTheme();
        this.saveToStorage();
        const themeName = this.config.theme === 'dark' ? '深色' : '浅色';
        this.showToast('已切换到' + themeName + '主题', 'success');
    }

    cacheElements() {
        this.elements = {
            sidebar: document.getElementById('sidebar'),
            historyList: document.getElementById('historyList'),
            modelSelect: document.getElementById('modelSelect'),
            serverStatus: document.getElementById('serverStatus'),
            settingsPanel: document.getElementById('settingsPanel'),
            chatContainer: document.getElementById('chatContainer'),
            welcomeScreen: document.getElementById('welcomeScreen'),
            messages: document.getElementById('messages'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            fileInput: document.getElementById('fileInput'),
            attachmentsPreview: document.getElementById('attachmentsPreview'),
            modelInfo: document.getElementById('modelInfo'),
            contextInfo: document.getElementById('contextInfo'),
            costInfo: document.getElementById('costInfo'),
            toast: document.getElementById('toast'),
            overlay: document.getElementById('overlay'),
            apiUrlInput: document.getElementById('apiUrl'),

            // 设置控件
            temperature: document.getElementById('temperature'),
            temperatureValue: document.getElementById('temperatureValue'),
            maxTokens: document.getElementById('maxTokens'),
            maxTokensValue: document.getElementById('maxTokensValue'),
            topP: document.getElementById('topP'),
            topPValue: document.getElementById('topPValue'),
            topK: document.getElementById('topK'),
            topKValue: document.getElementById('topKValue'),
            repeatPenalty: document.getElementById('repeatPenalty'),
            repeatPenaltyValue: document.getElementById('repeatPenaltyValue'),
            systemPrompt: document.getElementById('systemPrompt')
        };
    }

    bindEvents() {
        // 发送消息
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 自动调整输入框高度
        this.elements.messageInput.addEventListener('input', () => {
            this.elements.messageInput.style.height = 'auto';
            this.elements.messageInput.style.height = Math.min(
                this.elements.messageInput.scrollHeight, 200
            ) + 'px';
        });

        // 设置滑块
        const sliders = [
            { el: this.elements.temperature, display: this.elements.temperatureValue, key: 'temperature' },
            { el: this.elements.maxTokens, display: this.elements.maxTokensValue, key: 'maxTokens' },
            { el: this.elements.topP, display: this.elements.topPValue, key: 'topP' },
            { el: this.elements.topK, display: this.elements.topKValue, key: 'topK' },
            { el: this.elements.repeatPenalty, display: this.elements.repeatPenaltyValue, key: 'repeatPenalty' }
        ];

        sliders.forEach(({ el, display, key }) => {
            el.addEventListener('input', (e) => {
                const value = e.target.value;
                display.textContent = value;
                this.config[key] = parseFloat(value);
                this.saveToStorage();
            });
        });

        // 系统提示词
        this.elements.systemPrompt.addEventListener('change', (e) => {
            this.config.systemPrompt = e.target.value;
            this.saveToStorage();
        });

        // 监听回车键
        document.addEventListener('keydown', (e) => {
            // Ctrl+N 或 Cmd+N: 新建对话
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.newChat();
            }
            // Ctrl+/: 显示快捷键提示
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                this.showToast('Ctrl+N: 新建对话 | Enter: 发送 | Shift+Enter: 换行', 'info');
            }
        });

        // 模型选择
        this.elements.modelSelect.addEventListener('change', (e) => {
            this.state.currentModel = e.target.value;
            this.updateModelInfo();
        });

        // API 地址设置
        this.elements.apiUrlInput.addEventListener('change', (e) => {
            const url = e.target.value.trim();
            if (url) {
                this.config.apiUrl = url;
                this.saveToStorage();
                this.checkServerStatus();
                this.loadModels();
                this.showToast('API 地址已更新', 'success');
            }
        });

        // Token 价格设置
        const tokenPriceEl = document.getElementById('tokenPrice');
        const tokenPriceValueEl = document.getElementById('tokenPriceValue');
        if (tokenPriceEl && tokenPriceValueEl) {
            tokenPriceEl.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.config.tokenPrice = value;
                tokenPriceValueEl.textContent = value.toFixed(1);
                this.saveToStorage();
                this.updateCostDisplay();
            });
        }
    }

    // ==================== API 通信 ====================

    async fetchWithTimeout(url, options = {}) {
        const { timeout = this.config.timeout } = options;
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            return response;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async checkServerStatus() {
        try {
            const response = await this.fetchWithTimeout(`${this.config.apiUrl}/health`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                this.updateStatus('connected', '已连接');
            } else {
                this.updateStatus('error', '连接异常');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                this.updateStatus('error', '连接超时');
            } else {
                this.updateStatus('error', '未连接');
            }
        }
    }

    updateStatus(status, text) {
        const dot = this.elements.serverStatus.querySelector('.status-dot');
        const statusText = this.elements.serverStatus.querySelector('.status-text');

        dot.className = 'status-dot ' + status;
        statusText.textContent = text;
    }

    async loadModels() {
        try {
            const response = await this.fetchWithTimeout(`${this.config.apiUrl}/v1/models`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) throw new Error('Failed to load models');

            const data = await response.json();
            this.state.models = data.data || [];

            this.renderModelSelect();
            this.showToast('模型列表已更新', 'success');
        } catch (error) {
            console.error('Load models error:', error);
            const message = error.name === 'AbortError' ? '加载模型列表超时' : '无法加载模型列表';
            this.showToast(message, 'error');
        }
    }

    renderModelSelect() {
        const select = this.elements.modelSelect;
        select.innerHTML = '';

        if (this.state.models.length === 0) {
            select.innerHTML = '<option value="">无可用模型</option>';
            return;
        }

        this.state.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model.id;
            option.textContent = model.id;
            select.appendChild(option);
        });

        if (this.state.currentModel) {
            select.value = this.state.currentModel;
        } else if (this.state.models.length > 0) {
            this.state.currentModel = this.state.models[0].id;
            select.value = this.state.currentModel;
        }

        this.updateModelInfo();
    }

    updateModelInfo() {
        const modelName = this.state.currentModel || '未选择';
        this.elements.modelInfo.textContent = modelName;
        this.updateContextInfo();
    }

    updateContextInfo() {
        const contextTokens = this.state.contextTokens || 0;
        const maxTokens = this.state.maxContextTokens || 200000;
        
        // 格式化 token 数
        const formatTokens = (tokens) => {
            if (tokens >= 1000) {
                return (tokens / 1000).toFixed(1) + 'k';
            }
            return tokens.toString();
        };
        
        const contextText = `上下文: ${formatTokens(contextTokens)} / ${formatTokens(maxTokens)}`;
        this.elements.contextInfo.textContent = contextText;
        
        // 根据使用比例设置警告色
        const ratio = contextTokens / maxTokens;
        this.elements.contextInfo.className = 'context-info';
        if (ratio > 0.9) {
            this.elements.contextInfo.classList.add('error');
        } else if (ratio > 0.7) {
            this.elements.contextInfo.classList.add('warning');
        }
    }

    setContextTokens(tokens) {
        this.state.contextTokens = tokens;
        this.updateContextInfo();
        this.updateCostDisplay();
    }

    updateCostDisplay() {
        if (this.config.tokenPrice > 0 && this.elements.costInfo) {
            // 显示成本信息
            const totalTokens = this.state.contextTokens + (this.state.messages.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0));
            const cost = (totalTokens / 1000000) * this.config.tokenPrice;
            this.state.totalCost = cost;
            this.elements.costInfo.textContent = '$' + cost.toFixed(4);
            this.elements.costInfo.style.display = 'inline-flex';
        } else if (this.elements.costInfo) {
            this.elements.costInfo.style.display = 'none';
        }
    }

    estimateMessageTokens(message) {
        // 估算单条消息的 token 数
        const chars = (message.content || '').length;
        return Math.ceil(chars * 1.5);
    }

    // ==================== 辅助估算方法 ====================

    estimateTokensFromMessages() {
        // 如果 API 没有返回 prompt_tokens，我们使用简单的启发式算法进行估算
        // 经验值：混合文本中，1 个字符 ≈ 1.3 ~ 1.5 个 Token
        let totalChars = 0;
        
        // 累加所有消息的长度
        this.state.messages.forEach(msg => {
            totalChars += (msg.content || '').length;
        });
        
        // 加上系统提示词的长度
        totalChars += (this.config.systemPrompt || '').length;

        // 估算 Token 数 (乘以系数 1.5 以覆盖中文字符和特殊符号)
        return Math.ceil(totalChars * 1.5);
    }

    // ==================== 对话管理 ====================

    newChat() {
        const chatId = Date.now().toString();
        const chat = {
            id: chatId,
            title: '新对话',
            messages: [],
            createdAt: new Date().toISOString(),
            model: this.state.currentModel
        };

        this.state.chats.unshift(chat);
        this.state.currentChatId = chatId;
        this.state.messages = [];
        this.state.totalCost = 0;
        this.state.contextTokens = 0;
        this.updateCostDisplay();
        this.updateContextInfo();

        this.saveToStorage();
        this.renderHistory();
        this.showWelcomeScreen();
        this.showToast('新建对话成功', 'success');
    }

    loadChat(chatId) {
        const chat = this.state.chats.find(c => c.id === chatId);
        if (!chat) return;

        this.state.currentChatId = chatId;
        this.state.messages = [...chat.messages];

        this.renderHistory();
        this.renderMessages();
        this.hideWelcomeScreen();
    }

    deleteChat(chatId, event) {
        event.stopPropagation();

        if (!confirm('确定要删除这个对话吗？')) return;

        this.state.chats = this.state.chats.filter(c => c.id !== chatId);

        if (this.state.currentChatId === chatId) {
            this.state.currentChatId = null;
            this.state.messages = [];
            this.showWelcomeScreen();
        }

        this.saveToStorage();
        this.renderHistory();
        this.showToast('对话已删除', 'success');
    }

    renameChat(chatId, event) {
        event.stopPropagation();

        const chat = this.state.chats.find(c => c.id === chatId);
        if (!chat) return;

        const newTitle = prompt('请输入新的对话名称：', chat.title);
        if (newTitle && newTitle.trim()) {
            chat.title = newTitle.trim().slice(0, 50);
            this.saveToStorage();
            this.renderHistory();
            this.showToast('对话已重命名', 'success');
        }
    }

    updateChatTitle(chatId, title) {
        const chat = this.state.chats.find(c => c.id === chatId);
        if (chat && chat.title === '新对话') {
            // 提取前20个字符作为标题
            chat.title = title.slice(0, 20) + (title.length > 20 ? '...' : '');
            this.saveToStorage();
            this.renderHistory();
        }
    }

    // ==================== 消息处理 ====================

    async sendMessage() {
        const input = this.elements.messageInput;
        const content = input.value.trim();

        // 必须有内容或附件才能发送
        if ((!content && this.state.attachments.length === 0) || this.state.isGenerating) return;

        // 如果没有当前对话，创建新对话
        if (!this.state.currentChatId) {
            this.newChat();
        }

        // 处理附件内容
        let fullContent = content;
        if (this.state.attachments.length > 0) {
            fullContent = this.buildContentWithAttachments(content);
        }

        // 添加用户消息
        const userMessage = {
            role: 'user',
            content: fullContent,
            attachments: [...this.state.attachments],
            timestamp: new Date().toISOString()
        };

        this.state.messages.push(userMessage);
        this.appendMessage(userMessage);

        // 清空输入框和附件
        input.value = '';
        input.style.height = 'auto';
        this.clearAttachments();

        // 隐藏欢迎界面
        this.hideWelcomeScreen();

        // 更新对话标题
        if (content) {
            this.updateChatTitle(this.state.currentChatId, content);
        }

        // 保存到存储
        this.saveChatMessages();

        // 发送到 API
        await this.generateResponse();
    }

    buildContentWithAttachments(text) {
        let content = text || '';
        
        const images = this.state.attachments.filter(a => a.type.startsWith('image/'));
        const files = this.state.attachments.filter(a => !a.type.startsWith('image/'));
        
        if (images.length > 0) {
            content += '\n\n[图片附件]\n';
            images.forEach((img, i) => {
                content += `![${img.name}](data:${img.type};base64,${this.extractBase64(img.data)})\n`;
            });
        }
        
        if (files.length > 0) {
            content += '\n\n[文件附件]\n';
            files.forEach((file, i) => {
                content += `**${file.name}** (${this.formatFileSize(file.size)})\n`;
            });
        }
        
        return content;
    }

    extractBase64(dataUrl) {
        return dataUrl.split(',')[1] || '';
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    sendQuickMessage(content) {
        this.elements.messageInput.value = content;
        this.sendMessage();
    }

    async generateResponse() {
        this.state.isGenerating = true;
        this.elements.sendBtn.disabled = true;

        // 创建流式消息占位符
        const streamingMessage = {
            role: 'assistant',
            content: '',
            reasoningContent: '',  // 新增：保存推理/思考过程
            timestamp: new Date().toISOString()
        };
        
        const messageEl = this.createStreamingMessage(streamingMessage);

        try {
            const messages = [
                { role: 'system', content: this.config.systemPrompt },
                ...this.state.messages.map(m => ({ role: m.role, content: m.content }))
            ];

            // 创建 abort controller
            this.state.abortController = new AbortController();

            const response = await fetch(`${this.config.apiUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.state.currentModel || 'default',
                    messages: messages,
                    temperature: this.config.temperature,
                    max_tokens: this.config.maxTokens,
                    top_p: this.config.topP,
                    top_k: this.config.topK,
                    repeat_penalty: this.config.repeatPenalty,
                    stream: true
                }),
                signal: this.state.abortController.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            // 处理流式响应
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let contextTokensUsed = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            const choice = parsed.choices?.[0]?.delta || {};
                            
                            // 尝试从响应体中获取 Usage (通常出现在最后一个 chunk)
                            if (parsed.usage && parsed.usage.prompt_tokens) {
                                contextTokensUsed = parsed.usage.prompt_tokens;
                                this.setContextTokens(contextTokensUsed);
                            }

                            // 处理思考过程 (reasoning_content)
                            if (choice.reasoning_content) {
                                streamingMessage.reasoningContent += choice.reasoning_content;
                                this.updateStreamingMessage(messageEl, streamingMessage);
                            }
                            
                            // 处理实际回答 (content)
                            if (choice.content) {
                                streamingMessage.content += choice.content;
                                this.updateStreamingMessage(messageEl, streamingMessage);
                            }
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }

            // 兜底：如果 API 没有返回 Usage，则进行前端估算
            if (contextTokensUsed === 0) {
                const estimated = this.estimateTokensFromMessages();
                this.setContextTokens(estimated);
            }

            // 完成流式输出
            this.finalizeStreamingMessage(messageEl, streamingMessage);
            this.state.messages.push(streamingMessage);
            this.saveChatMessages();

        } catch (error) {
            console.error('Generate error:', error);
            
            // 用户主动停止
            if (error.name === 'AbortError' && !this.state.isGenerating) {
                // 用户主动停止，不显示错误消息
                this.finalizeStreamingMessage(messageEl, streamingMessage);
                this.state.messages.push(streamingMessage);
                return;
            }
            
            let message = '生成回复失败';
            let detail = '';
            
            if (error.name === 'AbortError') {
                message = '请求超时';
                detail = '请求超过 ' + (this.config.timeout / 1000) + ' 秒未响应，请检查服务器是否正常运行。';
            } else {
                detail = error.message || '请检查 llama.cpp 服务是否正常运行。';
            }
            
            this.showToast(message + ': ' + detail, 'error');

            // 更新为错误消息
            streamingMessage.content = '抱歉，' + message + '。\n\n' + detail;
            streamingMessage.isError = true;
            this.updateStreamingMessage(messageEl, streamingMessage);
            this.finalizeStreamingMessage(messageEl, streamingMessage);
            this.state.messages.push(streamingMessage);
        } finally {
            this.state.isGenerating = false;
            this.state.abortController = null;
            this.elements.sendBtn.disabled = false;
        }
    }

    stopStreaming() {
        if (this.state.abortController) {
            this.state.isGenerating = false; // 设置为 false 以标识是用户主动停止
            this.state.abortController.abort();
            this.showToast('已停止生成', 'info');
        }
    }

    // 创建流式消息元素
    createStreamingMessage(message) {
        const messageEl = document.createElement('div');
        messageEl.className = 'message assistant streaming';
        
        messageEl.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-role">AI</span>
                    <span class="message-time">${new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span class="streaming-indicator">
                        <span class="dot"></span>
                        <span class="dot"></span>
                        <span class="dot"></span>
                    </span>
                    <button class="stop-stream-btn" onclick="chatApp.stopStreaming()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                        </svg>
                    </button>
                </div>
                <div class="reasoning-section" style="display:none;">
                    <div class="reasoning-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span class="reasoning-icon">🧠</span>
                        <span class="reasoning-label">思考过程</span>
                        <span class="reasoning-arrow">▼</span>
                    </div>
                    <div class="reasoning-content"></div>
                </div>
                <div class="message-text"></div>
            </div>
        `;

        this.elements.messages.appendChild(messageEl);
        this.scrollToBottom();
        return messageEl;
    }

     // 更新流式消息内容
    updateStreamingMessage(messageEl, message) {
        // 更新思考过程
        if (message.reasoningContent) {
            const reasoningSection = messageEl.querySelector('.reasoning-section');
            const reasoningContent = messageEl.querySelector('.reasoning-content');
            
            // 显示思考区域
            if (reasoningSection.style.display === 'none') {
                reasoningSection.style.display = 'block';
                reasoningSection.classList.add('collapsed'); // 默认折叠
            }
            
            // 转义并渲染思考内容（纯文本，不经过 markdown）
            reasoningContent.textContent = message.reasoningContent;
            
            // 思考过程内容自动滚动到底部
            reasoningContent.scrollTop = reasoningContent.scrollHeight;
            
            // 流式输出时保持自动下翻
            this.scrollToBottom();
        }
        
        // 更新实际回答
        if (message.content) {
            const textEl = messageEl.querySelector('.message-text');
            textEl.innerHTML = this.renderMarkdown(message.content);
            
            // 代码高亮
            textEl.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
            
            this.scrollToBottom();
        }
    }

    // 完成流式消息
    finalizeStreamingMessage(messageEl, message) {
        // 移除流式指示器
        const indicator = messageEl.querySelector('.streaming-indicator');
        if (indicator) indicator.remove();
        
        // 移除 streaming 类
        messageEl.classList.remove('streaming');
        
        // 添加操作按钮
        const contentEl = messageEl.querySelector('.message-content');
        const actionsHtml = `
            <div class="message-actions">
                <button class="message-action-btn" onclick="chatApp.copyMessage(this)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    复制
                </button>
                <button class="message-action-btn" onclick="chatApp.regenerateMessage()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <polyline points="1 20 1 14 7 14"></polyline>
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                    </svg>
                    重新生成
                </button>
            </div>
        `;
        contentEl.insertAdjacentHTML('beforeend', actionsHtml);
    }

    // ==================== UI 渲染 ====================

    renderHistory(filterText = '') {
        const list = this.elements.historyList;
        list.innerHTML = '';

        if (this.state.chats.length === 0) {
            list.innerHTML = '<div class="empty-history">暂无对话记录</div>';
            return;
        }

        const filterLower = filterText.toLowerCase();
        this.state.chats.forEach(chat => {
            // 如果有搜索词，过滤对话
            if (filterLower && !chat.title.toLowerCase().includes(filterLower)) {
                return;
            }

            const item = document.createElement('div');
            item.className = 'history-item' + (chat.id === this.state.currentChatId ? ' active' : '');
            item.onclick = () => this.loadChat(chat.id);

            // 搜索高亮
            let titleHtml = this.escapeHtml(chat.title);
            if (filterLower) {
                const regex = new RegExp(`(${this.escapeRegex(filterLower)})`, 'gi');
                titleHtml = titleHtml.replace(regex, '<mark>$1</mark>');
            }

            item.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>${titleHtml}</span>
                <div class="history-actions">
                    <button class="rename-btn" onclick="chatApp.renameChat('${chat.id}', event)" title="重命名">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="delete-btn" onclick="chatApp.deleteChat('${chat.id}', event)" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;

            list.appendChild(item);
        });

        // 如果搜索无结果，显示提示
        if (filterLower && list.children.length === 0) {
            list.innerHTML = '<div class="empty-history">没有找到匹配的对话</div>';
        }
    }

    searchChats(text) {
        this.renderHistory(text);
    }

    escapeRegex(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    renderMessages() {
        this.elements.messages.innerHTML = '';

        this.state.messages.forEach(message => {
            this.appendMessage(message, false);
        });

        this.scrollToBottom();
    }

    appendMessage(message, shouldScroll = true) {
        const messageEl = document.createElement('div');
        messageEl.className = 'message ' + message.role;

        const avatar = message.role === 'user' ? '👤' : '🤖';
        const roleName = message.role === 'user' ? '你' : 'AI';
        const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit'
        });

        let reasoningHtml = '';
        if (message.role === 'assistant' && message.reasoningContent) {
            reasoningHtml = `
                <div class="reasoning-section collapsed">
                    <div class="reasoning-toggle" onclick="this.parentElement.classList.toggle('collapsed')">
                        <span class="reasoning-icon">🧠</span>
                        <span class="reasoning-label">思考过程</span>
                        <span class="reasoning-arrow">▼</span>
                    </div>
                    <div class="reasoning-content">${this.escapeHtml(message.reasoningContent)}</div>
                </div>
            `;
        }

        // 渲染 Markdown
        let contentHtml = '';
        if (message.role === 'assistant') {
            contentHtml = this.renderMarkdown(message.content);
        } else {
            contentHtml = this.escapeHtml(message.content).replace(/\n/g, '<br>');
        }

        // 渲染附件
        let attachmentsHtml = '';
        if (message.role === 'user' && message.attachments && message.attachments.length > 0) {
            attachmentsHtml = '<div class="message-attachments">';
            message.attachments.forEach(att => {
                if (att.type.startsWith('image/')) {
                    attachmentsHtml += `<img src="${att.data}" alt="${this.escapeHtml(att.name)}" class="message-attachment-img">`;
                } else {
                    attachmentsHtml += `
                        <div class="message-attachment-file">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            <span>${this.escapeHtml(att.name)}</span>
                        </div>
                    `;
                }
            });
            attachmentsHtml += '</div>';
        }

        messageEl.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-content">
                <div class="message-header">
                    <span class="message-role">${roleName}</span>
                    <span class="message-time">${time}</span>
                </div>
                ${reasoningHtml}
                <div class="message-text">${contentHtml}</div>
                ${attachmentsHtml}
                ${message.role === 'assistant' ? `
                    <div class="message-actions">
                        <button class="message-action-btn" onclick="chatApp.copyMessage(this)">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            复制
                        </button>
                        <button class="message-action-btn" onclick="chatApp.regenerateMessage()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                            重新生成
                        </button>
                    </div>
                ` : ''}
            </div>
        `;

        this.elements.messages.appendChild(messageEl);

        // 代码高亮
        messageEl.querySelectorAll('pre code').forEach(block => {
            hljs.highlightElement(block);
        });

        if (shouldScroll) {
            this.scrollToBottom();
        }
    }

    renderMarkdown(content) {
        // 配置 marked
        marked.setOptions({
            breaks: true,
            gfm: true,
            headerIds: false
        });

        // 渲染并清理
        let html = marked.parse(content);

        // 为代码块添加复制按钮
        html = html.replace(/<pre><code([^>]*)>/g, '<div class="code-block"><button class="copy-code-btn" onclick="chatApp.copyCode(this)">复制</button><pre><code$1>');
        html = html.replace(/<\/code><\/pre>/g, '</code></pre></div>');

        return html;
    }

    showLoading() {
        const id = 'loading-' + Date.now();
        const loadingEl = document.createElement('div');
        loadingEl.id = id;
        loadingEl.className = 'message assistant';
        loadingEl.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <div class="loading-indicator">
                    <div class="loading-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                    <span>AI 正在思考...</span>
                </div>
            </div>
        `;

        this.elements.messages.appendChild(loadingEl);
        this.scrollToBottom();

        return id;
    }

    hideLoading(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    showWelcomeScreen() {
        this.elements.welcomeScreen.style.display = 'flex';
        this.elements.messages.style.display = 'none';
    }

    hideWelcomeScreen() {
        this.elements.welcomeScreen.style.display = 'none';
        this.elements.messages.style.display = 'flex';
    }

    scrollToBottom() {
        // 使用 requestAnimationFrame 确保 DOM 渲染完成后再滚动
        requestAnimationFrame(() => {
            const container = this.elements.chatContainer;
            // 确保滚动到真正的底部
            container.scrollTop = container.scrollHeight;
            
            // 额外的安全检查：由于某些浏览器渲染延迟，可能需要再次滚动
            requestAnimationFrame(() => {
                if (container.scrollTop < container.scrollHeight - container.clientHeight) {
                    container.scrollTop = container.scrollHeight;
                }
            });
        });
    }

    // ==================== 工具方法 ====================

    toggleSettings() {
        const isOpen = this.elements.settingsPanel.classList.toggle('open');
        this.elements.overlay.classList.toggle('show', isOpen);
    }

    // ==================== 文件上传功能 ====================

    triggerFileInput() {
        this.elements.fileInput.click();
    }

    handleFileSelect(files) {
        if (!files || files.length === 0) return;

        for (const file of files) {
            if (file.size > 10 * 1024 * 1024) {
                this.showToast(`文件 ${file.name} 超过 10MB 限制`, 'error');
                continue;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const attachment = {
                    id: Date.now() + Math.random(),
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    data: e.target.result
                };
                this.state.attachments.push(attachment);
                this.renderAttachments();
            };
            reader.readAsDataURL(file);
        }

        // 清空 input 以允许重复选择同一文件
        this.elements.fileInput.value = '';
    }

    renderAttachments() {
        const container = this.elements.attachmentsPreview;
        
        if (this.state.attachments.length === 0) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = '';

        this.state.attachments.forEach(attachment => {
            const item = document.createElement('div');
            item.className = 'attachment-item';
            item.dataset.id = attachment.id;

            if (attachment.type.startsWith('image/')) {
                item.innerHTML = `
                    <img src="${attachment.data}" alt="${this.escapeHtml(attachment.name)}">
                    <button class="remove-attachment">×</button>
                    <span class="attachment-name">${this.escapeHtml(attachment.name)}</span>
                `;
            } else {
                item.innerHTML = `
                    <div class="file-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                    </div>
                    <button class="remove-attachment">×</button>
                    <span class="attachment-name">${this.escapeHtml(attachment.name)}</span>
                `;
            }

            item.querySelector('.remove-attachment').addEventListener('click', () => {
                this.removeAttachment(attachment.id);
            });

            container.appendChild(item);
        });
    }

    removeAttachment(id) {
        this.state.attachments = this.state.attachments.filter(a => a.id !== id);
        this.renderAttachments();
    }

    clearAttachments() {
        this.state.attachments = [];
        this.renderAttachments();
    }

    toggleSidebar() {
        this.elements.sidebar.classList.toggle('open');
    }

    closeSettings() {
        this.elements.settingsPanel.classList.remove('open');
        this.elements.overlay.classList.remove('show');
    }

    copyMessage(btn) {
        const messageEl = btn.closest('.message');
        const textEl = messageEl.querySelector('.message-text');
        const text = textEl.innerText;

        navigator.clipboard.writeText(text).then(() => {
            this.showToast('已复制到剪贴板', 'success');
        }).catch(err => {
            console.error('Copy failed:', err);
            // 降级方案：使用 textarea
            this.fallbackCopy(text);
        });
    }

    copyCode(btn) {
        const codeBlock = btn.closest('.code-block');
        const codeEl = codeBlock.querySelector('code');
        const text = codeEl.innerText;

        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = '已复制!';
            setTimeout(() => btn.textContent = '复制', 2000);
        }).catch(err => {
            console.error('Copy failed:', err);
            btn.textContent = '复制失败';
            setTimeout(() => btn.textContent = '复制', 2000);
            this.fallbackCopy(text);
        });
    }

    fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        
        try {
            document.execCommand('copy');
            this.showToast('已复制到剪贴板', 'success');
        } catch (err) {
            console.error('Fallback copy failed:', err);
            this.showToast('复制失败，请手动复制', 'error');
        } finally {
            document.body.removeChild(textarea);
        }
    }

    async regenerateMessage() {
        if (this.state.messages.length === 0 || this.state.isGenerating) return;

        // 移除最后一条助手消息（如果有）
        const lastMsg = this.state.messages[this.state.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
            this.state.messages.pop();
        } else if (!lastMsg || lastMsg.role !== 'user') {
            // 没有可重新生成的消息
            return;
        }

        this.renderMessages();
        this.saveChatMessages();

        // 显示加载状态
        const loadingId = this.showLoading();

        // 重新生成
        try {
            await this.generateResponse();
        } finally {
            this.hideLoading(loadingId);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message, type = 'info') {
        const toast = this.elements.toast;
        toast.textContent = message;
        toast.className = 'toast show ' + type;

        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // ==================== 存储管理 ====================

    saveToStorage() {
        const data = {
            config: this.config,
            chats: this.state.chats,
            currentChatId: this.state.currentChatId
        };
        localStorage.setItem('llamaChat', JSON.stringify(data));
    }

    loadFromStorage() {
        const data = localStorage.getItem('llamaChat');
        if (!data) return;

        try {
            const parsed = JSON.parse(data);

            if (parsed.config) {
                this.config = { ...this.config, ...parsed.config };
                this.updateSettingsUI();
            }

            if (parsed.chats) {
                this.state.chats = parsed.chats;
            }

            if (parsed.currentChatId) {
                this.state.currentChatId = parsed.currentChatId;
                const chat = this.state.chats.find(c => c.id === parsed.currentChatId);
                if (chat) {
                    this.state.messages = chat.messages;
                }
            }
        } catch (error) {
            console.error('Load from storage error:', error);
        }
    }

    saveChatMessages() {
        const chat = this.state.chats.find(c => c.id === this.state.currentChatId);
        if (chat) {
            chat.messages = [...this.state.messages];
            this.saveToStorage();
        }
    }

    updateSettingsUI() {
        this.elements.temperature.value = this.config.temperature;
        this.elements.temperatureValue.textContent = this.config.temperature;

        this.elements.maxTokens.value = this.config.maxTokens;
        this.elements.maxTokensValue.textContent = this.config.maxTokens;

        this.elements.topP.value = this.config.topP;
        this.elements.topPValue.textContent = this.config.topP;

        this.elements.topK.value = this.config.topK;
        this.elements.topKValue.textContent = this.config.topK;

        this.elements.repeatPenalty.value = this.config.repeatPenalty;
        this.elements.repeatPenaltyValue.textContent = this.config.repeatPenalty;

        this.elements.systemPrompt.value = this.config.systemPrompt;
        this.elements.apiUrlInput.value = this.config.apiUrl;

        const tokenPriceEl = document.getElementById('tokenPrice');
        const tokenPriceValueEl = document.getElementById('tokenPriceValue');
        if (tokenPriceEl) tokenPriceEl.value = this.config.tokenPrice;
        if (tokenPriceValueEl) tokenPriceValueEl.textContent = this.config.tokenPrice.toFixed(1);
    }
}

// 初始化应用
window.chatApp = new LlamaChatApp();
