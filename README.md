# 行程总览 Trip Overview ✈️

输入入住酒店和想去的目的地，在一张地图上看到全部地点的分布、连线与距离总览。纯静态网页，无需后端、无需安装，克隆即用。

![screenshot](docs/screenshot.png)

## ✨ 功能

- 🔍 **搜索即添加**：输入酒店和景点名称，基于腾讯位置服务实时联想，选中即上地图
- 🏨 **以酒店为中心**：所有目的地自动与酒店连线，显示直线距离
- 🚗 **驾车路线**：点一下即可查看酒店到任意目的地的驾车路线、距离和耗时
- 📊 **行程统计**：目的地数量、总直线距离、总驾车距离一目了然
- 💾 **本地保存**：行程自动存在浏览器 localStorage，刷新不丢，不上传任何服务器
- 📱 **移动端适配**：手机上面板自动变成可收起的底部抽屉
- 🗺 **视角总览**：一键缩放到包含全部地点的最佳视角

## 🚀 快速开始

### 1. 获取腾讯地图 Key（免费）

1. 打开 [腾讯位置服务控制台](https://lbs.qq.com/dev/console/application/mine)，注册 / 登录
2. 创建应用 → **添加 Key**，同时勾选 **WebServiceAPI** 和 **JavaScriptAPI GL**
3. 建议配置「域名白名单」保护你的 Key（个人使用加自己的域名即可）

### 2. 运行

```bash
git clone https://github.com/<你的用户名>/trip-overview-map.git
cd trip-overview-map
# 直接双击 index.html，或起一个本地服务：
python -m http.server 8080
```

打开页面，粘贴你的 Key，即可使用。Key 保存在你自己浏览器的 localStorage 里，**不会被写入代码、不会被提交到 Git**。

### 3. 部署到 GitHub Pages（可选）

仓库 → Settings → Pages → Source 选 `main` 分支根目录，保存即可获得一个公开链接分享给别人。

## 🔑 关于 Key 的安全说明

- 本项目**不内置任何 Key**，首次打开会引导使用者填入自己的 Key
- Key 仅存于使用者本机浏览器，不会随代码提交
- 公开部署时强烈建议在腾讯位置服务控制台为 Key 配置**域名白名单**，防止被盗用

## 🛠 技术栈

- 腾讯位置服务 JavaScript API GL（GCJ-02 坐标系）
- 原生 HTML / CSS / JavaScript，零依赖、零构建

## 📁 目录结构

```
trip-overview-map/
├── index.html      # 页面入口
├── css/style.css   # 登机牌风格样式
├── js/app.js       # 地图、搜索、路线、状态逻辑
└── README.md
```

## 📄 License

[MIT](LICENSE)
