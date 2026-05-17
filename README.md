# Llama Chat

本地大模型对话前端，与 llama.cpp HTTP API 通信。

## 功能特性

- 多模型支持：自动检测并切换可用模型
- 流式响应：实时显示 AI 生成内容
- 对话历史：自动保存对话记录到本地存储
- 文件附件：支持图片和文件上传
- 主题切换：支持浅色/深色主题
- 参数调整：可自定义 Temperature、Max Tokens、Top P、Top K、Repeat Penalty 等参数
- 成本追踪：显示 Token 消耗和预估费用

## 快速开始

### 1. 启动 llama.cpp 服务

确保 llama.cpp 服务运行在 `http://127.0.0.1:8080`：

```bash
./server -m model.gguf -c 2048 --host 127.0.0.1 --port 8080
```

### 2. 打开页面

直接在浏览器中打开 `index.html` 文件，或通过本地服务器访问。

## 配置说明

| 参数 | 默认值 | 说明 |
|------|--------|------|
| API 地址 | `http://127.0.0.1:8080` | llama.cpp 服务地址 |
| Temperature | 0.7 | 控制输出的随机性 |
| Max Tokens | 2048 | 生成文本的最大长度 |
| Top P | 0.9 | 核采样概率阈值 |
| Top K | 40 | Top-K 采样限制 |
| Repeat Penalty | 1.1 | 重复惩罚因子 |

## 文件结构

```
llama-chat/
├── index.html   # 主页面
├── styles.css   # 样式文件
└── app.js       # 应用逻辑
```

## 系统要求

- 浏览器：现代浏览器（Chrome、Firefox、Edge、Safari）
- 服务：运行中的 llama.cpp HTTP API 服务