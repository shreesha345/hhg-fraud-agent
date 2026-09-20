import React from "react";

/** The AI presenter. `mouth` (0..1) comes from the real narration audio, so the mouth follows what is actually being said. */
export const Avatar: React.FC<{ mouth: number; speaking: boolean; frame: number; size: number }> = ({ mouth, speaking, frame, size }) => {
  const bob = Math.sin(frame / 30 / 4.5 * Math.PI * 2);
  const blink = frame % 118 < 4;
  const ry = 4 + 17 * Math.min(1, mouth);
  const rx = 24 + 9 * Math.min(1, mouth);
  const pulse = 0.5 + 0.5 * Math.sin(frame / 9);
  return (
    <div style={{ position: "relative", width: size, height: size * 1.05 }}>
      {speaking && <div style={{ position: "absolute", inset: `-${size * 0.06}px`, borderRadius: "50%", border: `3px solid rgba(62,224,208,${0.25 + 0.5 * pulse})`, transform: `scale(${0.97 + 0.06 * pulse})` }} />}
      <svg viewBox="0 0 400 420" width="100%" height="100%">
        <defs>
          <linearGradient id="hg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#4a6cf7" /><stop offset="1" stopColor="#1b2a78" /></linearGradient>
          <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a3f9a" /><stop offset="1" stopColor="#101a4d" /></linearGradient>
          <radialGradient id="eg"><stop offset="0" stopColor="#b8fff7" /><stop offset="1" stopColor="#3ee0d0" /></radialGradient>
        </defs>
        <path d="M40 420 Q60 330 200 320 Q340 330 360 420 Z" fill="url(#bg)" />
        <rect x="170" y="296" width="60" height="40" rx="10" fill="#22336f" />
        <g transform={`rotate(${bob * 1.2} 200 380) translate(0 ${-Math.abs(bob) * 3})`}>
          <line x1="200" y1="46" x2="200" y2="78" stroke="#7d92e8" strokeWidth="6" strokeLinecap="round" />
          <circle cx="200" cy="38" r="12" fill="#3ee0d0" opacity={0.4 + 0.6 * pulse} />
          <circle cx="48" cy="184" r="20" fill="#2a3f9a" /><circle cx="352" cy="184" r="20" fill="#2a3f9a" />
          <rect x="60" y="74" width="280" height="240" rx="78" fill="url(#hg)" />
          <rect x="84" y="100" width="232" height="188" rx="56" fill="#08102c" />
          <rect x="128" y={blink ? 176 : 150} width="46" height={blink ? 6 : 56} rx={blink ? 3 : 20} fill="url(#eg)" />
          <rect x="226" y={blink ? 176 : 150} width="46" height={blink ? 6 : 56} rx={blink ? 3 : 20} fill="url(#eg)" />
          {!blink && <><circle cx="145" cy="166" r="7" fill="#fff" opacity=".8" /><circle cx="243" cy="166" r="7" fill="#fff" opacity=".8" /></>}
          <ellipse cx="200" cy="248" rx={rx} ry={ry} fill="#3ee0d0" />
          <circle cx="112" cy="240" r="13" fill="#ff8fb1" opacity=".22" /><circle cx="288" cy="240" r="13" fill="#ff8fb1" opacity=".22" />
        </g>
      </svg>
      <div style={{ position: "absolute", left: "50%", bottom: -size * 0.03, transform: "translateX(-50%)", display: "flex", gap: size * 0.02, alignItems: "flex-end", height: size * 0.09 }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <i key={i} style={{ display: "block", width: size * 0.018, borderRadius: 4, background: "#3ee0d0", height: `${6 + (speaking ? 90 * Math.min(1, mouth) * Math.abs(Math.sin(frame / 3 + i * 1.3)) : 0)}%` }} />
        ))}
      </div>
    </div>
  );
};
