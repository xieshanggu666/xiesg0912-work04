import type p5 from 'p5';
import Matter from 'matter-js';
import { AudioEngine } from './audio/AudioEngine';
import type { StepVoice, WeatherKind } from './audio/AudioEngine';
import { MicRecorder } from './audio/MicRecorder';
import { Fragment } from './world/Fragment';
import { NoteField } from './world/Notes';
import { Weather } from './world/Weather';
import { Panel } from './ui/Panel';

const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];
const SOLFEGE = ['do', 're', 'mi', 'sol', 'la', 'do', 're', 'mi'];
const COLORS = ['#ff8a80', '#ffd180', '#ffff8d', '#ccff90', '#80d8ff', '#8c9eff', '#ea80fc', '#a7ffeb'];
const TIMBRES: Array<'sine' | 'triangle' | 'square'> = ['sine', 'triangle', 'square'];
const SLOT_COUNT = 6;
const WEATHER_CYCLE: WeatherKind[] = ['sunny', 'rain', 'wind'];
const WEATHER_AUTO_MS = 75_000;

interface Drag {
  frag: Fragment;
  dx: number;
  dy: number;
  x: number;
  y: number;
  px: number;
  py: number;
  pt: number;
  vx: number;
  vy: number;
}

export class Game {
  private p!: p5;
  private canvasEl!: HTMLCanvasElement;
  private audio = new AudioEngine();
  private mic = new MicRecorder();
  private panel!: Panel;
  private weather = new Weather();
  private notes = new NoteField(SLOT_COUNT, SCALE);
  private fragments: Fragment[] = [];
  private slots: (Fragment | null)[] = Array(SLOT_COUNT).fill(null);
  private engine = Matter.Engine.create({ gravity: { x: 0, y: 0.35, scale: 0.001 } });

  private flow = 0.4;
  private level = 0.5;
  private weatherKind: WeatherKind = 'sunny';
  private lastWeatherSwitch = 0;

  private drags = new Map<number, Drag>();
  private collected = 0;
  private pulseStep = -1;
  private pulseAt = 0;
  private celebrating = false;
  private micTimer: number | null = null;

  sketch = (p: p5): void => {
    p.setup = () => this.setup(p);
    p.draw = () => this.drawFrame();
    p.windowResized = () => this.resized();
  };

  private setup(p: p5): void {
    this.p = p;
    const renderer = p.createCanvas(p.windowWidth, p.windowHeight);
    this.canvasEl = renderer.elt as HTMLCanvasElement;
    p.textFont('system-ui, sans-serif');
    p.textAlign(p.CENTER, p.CENTER);

    for (let i = 0; i < SCALE.length; i++) {
      const frag = new Fragment(
        { freq: SCALE[i], timbre: TIMBRES[i % TIMBRES.length], color: COLORS[i], label: SOLFEGE[i] },
        (i + 0.5) * (p.width / SCALE.length),
        this.surfaceY() + 20
      );
      this.fragments.push(frag);
      Matter.Composite.add(this.engine.world, frag.body);
    }

    this.notes.layout(p.width, p.height);

    this.audio.setVoiceProvider((step) => this.voiceFor(step));
    this.audio.onStep = (s) => {
      this.pulseStep = s;
      this.pulseAt = p.millis();
    };
    this.audio.setFlow(this.flow);
    this.audio.setLevel(this.level);

    this.panel = new Panel({
      onFlow: (v) => {
        this.flow = v;
        this.audio.setFlow(v);
      },
      onLevel: (v) => {
        this.level = v;
        this.audio.setLevel(v);
      },
      onWeather: (w) => this.setWeather(w),
      onMic: () => void this.toggleMic(),
      onMute: (m) => this.audio.setMuted(m),
      onAnyGesture: () => void this.audio.unlock(),
    });
    this.panel.setNotes(0, SLOT_COUNT);

    const canvas = this.canvasEl;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    this.lastWeatherSwitch = p.millis();
  }

  // ---------- 主循环 ----------

  private drawFrame(): void {
    const p = this.p;
    const dt = Math.min(Math.max(p.deltaTime, 8), 33);
    const t = p.millis();

    // 装置待机时自动轮换天气（家长手动切换后重新计时）
    if (t - this.lastWeatherSwitch > WEATHER_AUTO_MS) {
      const next = WEATHER_CYCLE[(WEATHER_CYCLE.indexOf(this.weatherKind) + 1) % WEATHER_CYCLE.length];
      this.setWeather(next);
    }

    const surface = this.surfaceY();
    const gust = this.weather.windGust(t);
    const k = (dt / 16.666) ** 2;

    for (const frag of this.fragments) {
      if (frag.slotIndex !== null) continue;
      const body = frag.body;
      const drag = this.dragOf(frag);
      if (drag) {
        // 刚体在 onPointerDown 中已切为静态：直接贴住手指位置，
        // 避免快速拖拽时速度插值造成的滞后；并按指针轨迹记录甩动速度供松手时使用
        const tx = drag.x + drag.dx;
        const ty = drag.y + drag.dy;
        Matter.Body.setPosition(body, { x: tx, y: ty });
        const dms = Math.max(t - drag.pt, 1);
        drag.vx = ((tx - drag.px) / dms) * 16.666;
        drag.vy = ((ty - drag.py) / dms) * 16.666;
        drag.px = tx;
        drag.py = ty;
        drag.pt = t;
      } else {
        const depth = body.position.y - surface;
        const fx = (this.flow * 0.00015 + gust * 0.0005) * body.mass * k;
        let fy = 0;
        if (depth > 0) fy = -Math.min(depth / frag.h, 1.2) * 0.0011 * body.mass * k;
        if (this.weatherKind === 'rain') {
          fy += Math.sin(t * 0.02 + body.position.x) * 0.00006 * body.mass * k;
        }
        Matter.Body.applyForce(body, body.position, { x: fx, y: fy });
      }
    }
    Matter.Engine.update(this.engine, dt);

    // 水平环绕 + 防沉底
    for (const frag of this.fragments) {
      if (frag.slotIndex !== null || this.dragOf(frag)) continue;
      const { x, y } = frag.body.position;
      if (x < -frag.w) Matter.Body.setPosition(frag.body, { x: p.width + frag.w, y });
      else if (x > p.width + frag.w) Matter.Body.setPosition(frag.body, { x: -frag.w, y });
      if (y > p.height - frag.h / 2) {
        Matter.Body.setPosition(frag.body, { x, y: p.height - frag.h / 2 });
      }
    }

    this.weather.update(dt, this.flow, surface, p.width, p.height, t);
    this.notes.update(dt, surface);

    this.drawSky();
    this.drawRiver(surface, t);
    this.notes.draw(p, surface, t);
    for (const frag of this.fragments) {
      if (frag.slotIndex !== null) continue;
      frag.draw(p, frag.body.position.x, frag.body.position.y, frag.body.angle, 1);
    }
    this.drawSlots(t);
    this.weather.draw(p, surface, t);
  }

  // ---------- 输入 ----------

  private canvasPos(e: PointerEvent): { x: number; y: number } {
    const r = this.canvasEl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this.p.width / r.width),
      y: (e.clientY - r.top) * (this.p.height / r.height),
    };
  }

  private onPointerDown(e: PointerEvent): void {
    void this.audio.unlock();
    const { x, y } = this.canvasPos(e);
    const note = this.notes.hit(x, y, this.surfaceY());
    if (note) {
      this.collectNote(note);
      return;
    }
    const frag = this.fragmentAt(x, y);
    if (frag) {
      if (frag.slotIndex !== null) this.unslot(frag);
      // 切为静态刚体：拖拽期间完全跟随手指，不参与重力/浮力模拟
      Matter.Body.setStatic(frag.body, true);
      Matter.Body.setAngle(frag.body, 0);
      this.drags.set(e.pointerId, {
        frag,
        dx: frag.body.position.x - x,
        dy: frag.body.position.y - y,
        x,
        y,
        px: frag.body.position.x,
        py: frag.body.position.y,
        pt: this.p.millis(),
        vx: 0,
        vy: 0,
      });
      // 快速拖出画布时仍能收到 pointerup/pointercancel
      try {
        this.canvasEl.setPointerCapture(e.pointerId);
      } catch {
        /* 某些环境不支持，忽略即可 */
      }
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    const { x, y } = this.canvasPos(e);
    d.x = x;
    d.y = y;
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    this.drags.delete(e.pointerId);
    try {
      this.canvasEl.releasePointerCapture(e.pointerId);
    } catch {
      /* 忽略 */
    }
    this.releaseDrag(d);
  }

  private releaseDrag(d: Drag): void {
    const frag = d.frag;
    // 以手指释放位置（含抓取偏移）判定格子。快速拖拽时手指已到格子、
    // 刚体此前可能还滞后在半空，用刚体位会判定失败
    const tx = d.x + d.dx;
    const ty = d.y + d.dy;
    const slot = this.slotAt(tx, ty);
    if (slot >= 0) {
      this.placeInSlot(frag, slot);
      return;
    }
    // 没放进格子：恢复动态物理，放回释放点并带上甩动速度（限幅，防止穿透）
    Matter.Body.setStatic(frag.body, false);
    Matter.Body.setPosition(frag.body, { x: tx, y: ty });
    const maxV = 18;
    Matter.Body.setVelocity(frag.body, {
      x: Math.max(-maxV, Math.min(maxV, d.vx)),
      y: Math.max(-maxV, Math.min(maxV, d.vy)),
    });
    Matter.Body.setAngularVelocity(frag.body, 0);
  }

  // ---------- 格子 / 音序器 ----------

  private voiceFor(step: number): StepVoice | null {
    const frag = this.slots[step];
    if (!frag) return null;
    return { freq: frag.spec.freq, timbre: frag.spec.timbre, buffer: frag.spec.buffer ?? null };
  }

  private placeInSlot(frag: Fragment, i: number): void {
    const occupant = this.slots[i];
    if (occupant && occupant !== frag) {
      this.unslot(occupant, frag.body.position.x, frag.body.position.y);
      // 被换出的碎片可能同样来自拖拽（静态刚体），恢复动态以便落回河里
      Matter.Body.setStatic(occupant.body, false);
      Matter.Body.setVelocity(occupant.body, { x: 0, y: 0 });
    }
    Matter.Composite.remove(this.engine.world, frag.body);
    frag.slotIndex = i;
    this.slots[i] = frag;
    this.audio.pluckNow(frag.spec.freq * 2);
  }

  private unslot(frag: Fragment, x?: number, y?: number): void {
    if (frag.slotIndex === null) return;
    const i = frag.slotIndex;
    const s = this.slotPos(i);
    this.slots[i] = null;
    frag.slotIndex = null;
    Matter.Body.setPosition(frag.body, x !== undefined ? { x, y: y! } : s);
    Matter.Body.setVelocity(frag.body, { x: 0, y: 0 });
    Matter.Composite.add(this.engine.world, frag.body);
  }

  private slotSpacing(): number {
    return Math.min(this.p.width / (SLOT_COUNT + 0.5), 104);
  }

  private slotY(): number {
    return Math.max(56, this.p.height * 0.085);
  }

  private slotPos(i: number): { x: number; y: number } {
    const spacing = this.slotSpacing();
    return {
      x: this.p.width / 2 - (spacing * (SLOT_COUNT - 1)) / 2 + i * spacing,
      y: this.slotY(),
    };
  }

  private slotR(): number {
    return Math.min(this.slotSpacing() * 0.44, 38);
  }

  private slotAt(x: number, y: number): number {
    const r = this.slotR() * 1.6;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.slotPos(i);
      const dx = x - s.x;
      const dy = y - s.y;
      // 精确落在圆形热区内
      if (dx * dx + dy * dy < r * r) return i;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // 快速甩到顶部格子行附近：吸附到水平最近的格子，
    // 只要纵向在格子带内、横向不超过半个间距
    const s = this.slotPos(best);
    if (
      Math.abs(y - s.y) < this.slotR() * 2.1 &&
      Math.abs(x - s.x) < this.slotSpacing() * 0.55
    ) {
      return best;
    }
    return -1;
  }

  private fragmentAt(x: number, y: number): Fragment | null {
    const hitR = this.slotR() * 1.3;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const frag = this.slots[i];
      if (!frag) continue;
      const s = this.slotPos(i);
      const dx = x - s.x;
      const dy = y - s.y;
      if (dx * dx + dy * dy < hitR * hitR) return frag;
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const frag = this.fragments[i];
      if (frag.slotIndex !== null) continue;
      const b = frag.body.bounds;
      if (x >= b.min.x - 6 && x <= b.max.x + 6 && y >= b.min.y - 6 && y <= b.max.y + 6) return frag;
    }
    return null;
  }

  private dragOf(frag: Fragment): Drag | null {
    for (const d of this.drags.values()) if (d.frag === frag) return d;
    return null;
  }

  // ---------- 音符收集 ----------

  private collectNote(note: { freq: number; collected: boolean }): void {
    note.collected = true;
    this.collected++;
    this.panel.setNotes(this.collected, SLOT_COUNT);
    this.audio.chime(note.freq);
    if (this.collected === SLOT_COUNT && !this.celebrating) {
      this.celebrating = true;
      this.audio.fanfare();
      this.panel.toast('🎉 河流之歌完成啦！');
      window.setTimeout(() => {
        this.notes.layout(this.p.width, this.p.height);
        this.collected = 0;
        this.panel.setNotes(0, SLOT_COUNT);
        this.celebrating = false;
      }, 2200);
    }
  }

  // ---------- 录音 ----------

  private async toggleMic(): Promise<void> {
    if (this.mic.recording) {
      await this.stopMic();
      return;
    }
    try {
      await this.audio.unlock();
      await this.mic.start();
    } catch {
      this.panel.toast('打不开麦克风 😢 请检查权限');
      return;
    }
    this.panel.setMicRecording(true);
    this.panel.toast('🎙️ 录音中… 再点一下停止');
    this.micTimer = window.setTimeout(() => void this.stopMic(), 4000);
  }

  private async stopMic(): Promise<void> {
    if (this.micTimer !== null) {
      window.clearTimeout(this.micTimer);
      this.micTimer = null;
    }
    if (!this.mic.recording) return;
    const blob = await this.mic.stop();
    this.panel.setMicRecording(false);
    try {
      const buffer = await this.audio.decode(await blob.arrayBuffer());
      const frag = new Fragment(
        { freq: 261.63, timbre: 'sample', color: '#ffab40', label: '🎙️', buffer },
        this.p.width / 2,
        this.surfaceY() + 8
      );
      this.fragments.push(frag);
      Matter.Composite.add(this.engine.world, frag.body);
      this.panel.toast('你的声音游进河里啦！🐟');
    } catch {
      this.panel.toast('这段声音没法用 😢');
    }
  }

  // ---------- 天气 ----------

  private setWeather(w: WeatherKind): void {
    this.weatherKind = w;
    this.weather.setKind(w);
    this.audio.setWeather(w);
    this.panel.setWeatherActive(w);
    this.lastWeatherSwitch = this.p.millis();
  }

  // ---------- 渲染 ----------

  private surfaceY(): number {
    return this.p.height * (0.62 - 0.32 * this.level);
  }

  private waveY(x: number, surface: number, t: number): number {
    return (
      surface +
      Math.sin(x * 0.02 + t * 0.002 * (1 + this.flow * 3)) * 4 +
      Math.sin(x * 0.045 - t * 0.0032) * 2.5
    );
  }

  private drawSky(): void {
    const p = this.p;
    const ctx = p.drawingContext as CanvasRenderingContext2D;
    const [top, bottom] = this.weather.skyColors();
    const g = ctx.createLinearGradient(0, 0, 0, p.height);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, p.width, p.height);
  }

  private drawRiver(surface: number, t: number): void {
    const p = this.p;
    const ctx = p.drawingContext as CanvasRenderingContext2D;

    const g = ctx.createLinearGradient(0, surface, 0, p.height);
    g.addColorStop(0, 'rgba(80,170,255,0.45)');
    g.addColorStop(1, 'rgba(8,50,110,0.8)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, surface);
    for (let x = 0; x <= p.width; x += 14) ctx.lineTo(x, this.waveY(x, surface, t));
    ctx.lineTo(p.width, p.height);
    ctx.lineTo(0, p.height);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= p.width; x += 14) {
      const y = this.waveY(x, surface, t);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 随流速加快的水纹
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    const depth = p.height - surface;
    for (let i = 0; i < 10; i++) {
      const speed = 0.03 + this.flow * 0.3;
      const sx = ((i * 197 + t * speed) % (p.width + 140)) - 70;
      const sy = surface + 16 + ((i * 53) % Math.max(20, depth - 40));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 24 + this.flow * 50, sy);
      ctx.stroke();
    }
  }

  private drawSlots(t: number): void {
    const p = this.p;
    const y = this.slotY();
    p.stroke(255, 255, 255, 90);
    p.strokeWeight(2);
    p.line(20, y, p.width - 20, y);

    for (let i = 0; i < SLOT_COUNT; i++) {
      const s = this.slotPos(i);
      const r = this.slotR();
      let pulse = 1;
      if (i === this.pulseStep) pulse = 1 + 0.22 * Math.exp(-(t - this.pulseAt) / 130);
      p.push();
      p.translate(s.x, s.y);
      p.scale(pulse);
      p.noFill();
      p.stroke(255, 255, 255, 170);
      p.strokeWeight(2);
      p.drawingContext.setLineDash([5, 6]);
      p.circle(0, 0, r * 2);
      p.drawingContext.setLineDash([]);
      p.pop();
      const frag = this.slots[i];
      if (frag) frag.draw(p, s.x, s.y, 0, pulse * ((r * 1.9) / frag.w));
    }
  }

  private resized(): void {
    this.p.resizeCanvas(this.p.windowWidth, this.p.windowHeight);
    this.notes.resize(this.p.width, this.p.height);
  }
}
