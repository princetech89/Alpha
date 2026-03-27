export function AlphaSignalLogo({ size = 40 }: { size?: number }) {
  const id = "as-logo";
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="AlphaSignal Logo"
      style={{ display: "block", overflow: "visible" }}
    >
      <style>{`
        @keyframes as-draw { to { stroke-dashoffset: 0; } }
        @keyframes as-pop { to { opacity: 1; } }
        @keyframes as-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.18); filter: brightness(1.4); }
        }
        .as-frame-${id} {
          fill: none;
          stroke: #0f172a;
          stroke-width: 14;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: as-draw 2.4s cubic-bezier(0.23,1,0.32,1) forwards;
        }
        .as-signal-${id} {
          fill: none;
          stroke: url(#as-grad-${id});
          stroke-width: 12;
          stroke-linecap: round;
          stroke-linejoin: round;
          stroke-dasharray: 1000;
          stroke-dashoffset: 1000;
          animation: as-draw 2.2s cubic-bezier(0.23,1,0.32,1) forwards 0.4s;
        }
        .as-dot-${id} {
          fill: #ff0033;
          opacity: 0;
          transform-origin: 50px 25px;
          animation: as-pop 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards 2.2s,
                     as-pulse 3.5s infinite ease-in-out 2.7s;
        }
        @media (prefers-reduced-motion: reduce) {
          .as-frame-${id}, .as-signal-${id} {
            animation: none !important;
            stroke-dashoffset: 0 !important;
          }
          .as-dot-${id} { animation: none !important; opacity: 1 !important; }
        }
      `}</style>
      <defs>
        <linearGradient id={`as-grad-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00f2ff" />
          <stop offset="100%" stopColor="#ff0033" />
        </linearGradient>
      </defs>
      <path className={`as-frame-${id}`} d="M30,75 C30,75 50,25 50,25 C50,25 70,75 70,75" />
      <path className={`as-signal-${id}`} d="M35,60 C35,60 65,56 65,46 C65,36 35,36 35,46" />
      <circle className={`as-dot-${id}`} cx="50" cy="25" r="4.5" />
    </svg>
  );
}
