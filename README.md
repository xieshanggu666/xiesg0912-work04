# 河流声音地图 · 亲子互动装置

孩子沿着一条虚拟河流拖动声波碎片，把它们拼成一段会随水流变化的声音地图；家长调节河流速度与水位，孩子在不同水位下寻找被淹没的音符。

无需登录、无后端、无外部音频资源（全部声音由 Web Audio 实时合成）。

## 玩法

**孩子**
- 把河里漂着的声波碎片（do re mi sol la…）拖进顶部 6 个圆圈，拼出循环播放的河流之歌
- 把碎片从圆圈拖回河里即可取下；拖到已占用的圆圈会交换
- 水位上涨时，河床上的 ♪ 音符被淹没后会发光冒泡，点一下收集；集齐 6 个触发庆祝音阶并刷新一轮

**家长（右上角 🎛️ 面板）**
- 🌊 水流速度：同时影响碎片漂流速度、音序器 BPM、音色亮度和水声大小
- 💧 水位高低：决定哪些音符被淹没、可以被找到
- ☀️ / 🌧️ / 💨 三种天气：晴天波光、雨天涟漪+雨滴声、风天落叶+阵风推碎片（待机 75 秒自动轮换）
- 🎙️ 录一段声音：调用手机麦克风录 4 秒，孩子的声音会变成一块新的橙色碎片游进河里
- 🔊 静音开关

## 技术栈

p5.js（渲染）· TypeScript · Vite · Web Audio API（合成 + 音序器 + 录音解码）· Matter.js（浮力/漂流/阵风物理）

## 运行

```bash
npm install
npm run dev      # 开发
npm run build    # 类型检查 + 打包到 dist/
npm run preview  # 预览构建产物
```

## 手机上调试麦克风

`getUserMedia` 要求安全上下文（HTTPS 或 localhost）：

- 电脑本机直接开 `http://localhost:5173` 即可
- 手机访问电脑局域网 IP 是 HTTP，麦克风会被浏览器拒绝。可以：
  - 用 `npx vite --host` 配合隧道（如 `ngrok http 5173`）获得 HTTPS 地址
  - 或部署到任意静态 HTTPS 托管（`npm run build` 后上传 `dist/`）

## 目录结构

```
src/
  main.ts            入口
  Game.ts            编排：物理力、拖拽、格子、音符、渲染
  audio/AudioEngine  音序器 + 水/雨/风环境声 + 音效（纯合成）
  audio/MicRecorder  麦克风录音入口
  world/Fragment     声波碎片（Matter 刚体 + 波形绘制）
  world/Notes        被淹没的音符与气泡
  world/Weather      晴/雨/风粒子系统
  ui/Panel           家长面板（HTML 覆盖层）
```
