import type { WeatherKind } from '../audio/AudioEngine';

export interface PanelCallbacks {
  onFlow: (v: number) => void;
  onLevel: (v: number) => void;
  onWeather: (w: WeatherKind) => void;
  onMic: () => void;
  onMute: (muted: boolean) => void;
  onAnyGesture: () => void;
}

/** 家长面板（HTML 覆盖层）：流速、水位、天气、录音、静音 */
export class Panel {
  private toastTimer: number | null = null;
  private muted = false;
  private micBtn: HTMLButtonElement;
  private muteBtn: HTMLButtonElement;

  constructor(cb: PanelCallbacks) {
    const el = <T extends HTMLElement>(id: string): T => {
      const n = document.getElementById(id);
      if (!n) throw new Error(`#${id} missing`);
      return n as T;
    };

    const flow = el<HTMLInputElement>('flow');
    const level = el<HTMLInputElement>('level');
    const flowVal = el<HTMLOutputElement>('flowVal');
    const levelVal = el<HTMLOutputElement>('levelVal');
    // 实时数值提示：滑杆仍是 0~100，展示换算后的物理单位
    flow.addEventListener('input', () => {
      const raw = flow.valueAsNumber;
      flowVal.textContent = `${(raw / 50).toFixed(1)} m/s`;
      cb.onFlow(raw / 100);
    });
    level.addEventListener('input', () => {
      const raw = level.valueAsNumber;
      levelVal.textContent = `${raw} cm`;
      cb.onLevel(raw / 100);
    });

    document.querySelectorAll<HTMLButtonElement>('[data-weather]').forEach((b) =>
      b.addEventListener('click', () => cb.onWeather(b.dataset.weather as WeatherKind))
    );

    this.micBtn = el<HTMLButtonElement>('mic');
    this.micBtn.addEventListener('click', () => cb.onMic());

    this.muteBtn = el<HTMLButtonElement>('mute');
    this.muteBtn.addEventListener('click', () => {
      this.muted = !this.muted;
      this.syncMute();
      cb.onMute(this.muted);
    });

    const panel = el('panel');
    const toggle = el<HTMLButtonElement>('panelToggle');
    toggle.addEventListener('click', () => {
      const open = panel.classList.toggle('hidden') === false;
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '收起家长面板' : '打开家长面板');
    });

    // 第一次触摸/点击时解锁 AudioContext（移动端要求）
    document.addEventListener('pointerdown', () => cb.onAnyGesture(), { once: true });
  }

  private syncMute(): void {
    this.muteBtn.textContent = this.muted ? '🔇' : '🔊';
    this.muteBtn.setAttribute('aria-pressed', String(this.muted));
    this.muteBtn.setAttribute('aria-label', this.muted ? '取消静音' : '静音');
  }

  setMicRecording(on: boolean): void {
    this.micBtn.classList.toggle('recording', on);
    this.micBtn.textContent = on ? '⏺️ 停止录音' : '🎙️ 录一段声音';
    this.micBtn.setAttribute('aria-pressed', String(on));
    this.micBtn.setAttribute('aria-label', on ? '停止录音' : '录一段声音');
  }

  setWeatherActive(w: WeatherKind): void {
    document
      .querySelectorAll<HTMLButtonElement>('[data-weather]')
      .forEach((b) => {
        const active = b.dataset.weather === w;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', String(active));
      });
  }

  setNotes(n: number, total: number): void {
    document.getElementById('noteCount')!.textContent = String(n);
    document.getElementById('noteTotal')!.textContent = String(total);
  }

  toast(msg: string): void {
    const t = document.getElementById('toast')!;
    t.textContent = msg;
    t.classList.add('show');
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 2600);
  }
}
