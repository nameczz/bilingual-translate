# Bilingual Translate 使用指南

## 安装扩展

### 1. 在Chrome中加载
1. 打开Chrome浏览器
2. 地址栏输入：`chrome://extensions/`
3. 打开右上角的"开发者模式"开关
4. 点击"加载已解压的扩展程序"
5. 选择文件夹：`/Users/sangdongmei/Working/translate`
6. 扩展安装成功！会在工具栏显示图标

## 配置API Key

### 2. 填写API Key
1. 点击Chrome工具栏的扩展图标（翻译图标）
2. 在弹出的设置面板中，点击 **"API Keys"** 标签
3. 在"Translation Provider"下拉框选择：
   - **Claude (Anthropic)** - 需要Claude API key
   - **Kimi (Moonshot AI)** - 需要Kimi API key
4. 在"API Key"输入框填入你的API key：
   - Claude: `sk-ant-...` (从 https://console.anthropic.com 获取)
   - Kimi: `sk-...` (从 https://platform.moonshot.cn 获取)
5. 点击"Verify Connection"验证key是否有效
6. 验证成功后，点击"Save Settings"保存

## 开始翻译

### 3. 翻译网页
1. 访问任意网页（如英文网站）
2. 点击扩展图标
3. 在"General"标签设置：
   - **Source Language**: Auto Detect（自动检测）
   - **Target Language**: Chinese (Simplified)（中文）
4. 点击"Save Settings"
5. 再次点击扩展图标，翻译会自动开始
6. 网页会显示双语对照翻译

### 4. 其他功能
- **右键菜单翻译**：选中文本 → 右键 → "翻译选中内容"
- **显示样式**：在"Display"标签可以调整翻译样式
- **快速开关**：点击扩展图标右上角的电源按钮

## 获取API Key

### Claude API Key
1. 访问：https://console.anthropic.com
2. 注册/登录账号
3. 进入"API Keys"页面
4. 点击"Create Key"创建新key
5. 复制key（格式：sk-ant-...）

### Kimi API Key  
1. 访问：https://platform.moonshot.cn
2. 注册/登录账号
3. 进入"API密钥"页面
4. 点击"创建新的API Key"
5. 复制key（格式：sk-...）

## 常见问题

**Q: 翻译没有反应？**
- 检查API key是否正确填写
- 点击"Verify Connection"验证
- 查看Chrome控制台是否有错误

**Q: 翻译质量不好？**
- 尝试切换不同的provider
- Claude适合长文本和专业内容
- Kimi速度快，适合日常使用

**Q: 费用多少？**
- 这是BYOK（自带API key）模式，费用由你承担
- Claude: 约$3/百万tokens
- Kimi: 约¥12/百万tokens
- 一般网页翻译每页成本：$0.01-0.05

**Q: 安全吗？**
- API key使用AES-GCM加密存储在本地
- 不会上传到任何服务器
- 翻译内容直接发送到AI服务商
