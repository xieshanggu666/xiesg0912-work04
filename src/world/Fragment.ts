import type p5 from 'p5';
import Matter from 'matter-js';
import type { Timbre } from '../audio/AudioEngine';

export interface FragmentSpec {
  freq: number;
  timbre: Timbre;
  color: string;
  label: string;
  buffer?: AudioBuffer | null;
}

const PEAK_COUNT = 28;

/** 河里漂流的声波碎片：一个 Matter 刚体 + 画在表面的迷你波形 */
export class Fragment {
  body: Matter.Body;
  slotIndex: number | null = null;
  dragged = false;
  peaks: number[];

  constructor(
    public spec: FragmentSpec,
    x: number,
    y: number,
    public w = 96,
    public h = 46
  ) {
    this.body = Matter.Bodies.rectangle(x, y, w, h, {
      frictionAir: 0.03,
      restitution: 0.1,
      chamfer: { radius: 12 },
    });
    this.peaks = spec.buffer ? this.peaksFromBuffer(spec.buffer) : this.peaksFromFreq(spec.freq);
  }

  draw(p: p5, x: number, y: number, angle: number, scale = 1): void {
    p.push();
    p.translate(x, y);
    p.rotate(angle);
    p.scale(scale);
    const { w, h } = this;

    // 阴影 + 身体
    p.noStroke();
    p.fill(0, 0, 0, 40);
    p.rect(-w / 2 + 3, -h / 2 + 5, w, h, 12);
    p.fill(this.spec.color);
    p.rect(-w / 2, -h / 2, w, h, 12);

    // 迷你波形
    p.stroke(30, 60, 90, 170);
    p.strokeWeight(2);
    const n = this.peaks.length;
    for (let i = 0; i < n; i++) {
      const px = p.map(i, 0, n - 1, -w / 2 + 10, w / 2 - 10);
      const py = this.peaks[i] * (h / 2 - 14);
      p.line(px, -py, px, py);
    }

    // 标签
    p.noStroke();
    p.fill(40, 60, 90);
    p.textSize(11);
    p.text(this.spec.label, 0, -h / 2 + 11);
    p.pop();
  }

  private peaksFromFreq(freq: number): number[] {
    const out: number[] = [];
    const k = freq / 110;
    for (let i = 0; i < PEAK_COUNT; i++) {
      out.push(
        Math.min(1, Math.abs(Math.sin(i * 0.7 * k) * 0.7 + Math.sin(i * 0.23 * k + 1.3) * 0.5))
      );
    }
    return out;
  }

  private peaksFromBuffer(buf: AudioBuffer): number[] {
    const d = buf.getChannelData(0);
    const out: number[] = [];
    const step = Math.max(1, Math.floor(d.length / PEAK_COUNT));
    for (let i = 0; i < PEAK_COUNT; i++) {
      let m = 0;
      const off = i * step;
      for (let j = 0; j < step; j += 16) {
        const v = Math.abs(d[off + j] || 0);
        if (v > m) m = v;
      }
      out.push(Math.min(1, m * 1.6));
    }
    return out;
  }
}
