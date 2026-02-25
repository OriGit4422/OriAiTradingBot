export function WinmLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="winmGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="50%" stopColor="#8B5CF6" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
        <linearGradient id="winmGrad2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#06B6D4" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="winmGrad3" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#winmGrad1)" />
      <rect x="1" y="1" width="46" height="46" rx="11" stroke="white" strokeOpacity="0.15" strokeWidth="1" fill="none" />
      <path d="M10 16L15 32L20 22L24 32L29 22L33 32L38 16" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="36" cy="14" r="5" fill="url(#winmGrad3)" />
      <path d="M34.5 14L35.5 15L37.5 13" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 36H34" stroke="url(#winmGrad2)" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
      <circle cx="14" cy="36" r="1.5" fill="#06B6D4" opacity="0.8" />
      <circle cx="20" cy="36" r="1.5" fill="#8B5CF6" opacity="0.8" />
      <circle cx="26" cy="36" r="1.5" fill="#A78BFA" opacity="0.8" />
      <circle cx="32" cy="36" r="1.5" fill="#F59E0B" opacity="0.8" />
    </svg>
  );
}

export function WinmLogoFull({ height = 36, className = "" }: { height?: number; className?: string }) {
  const w = height * 4;
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <WinmLogo size={height} />
      <div className="flex flex-col">
        <span className="font-bold text-sm tracking-tight leading-tight">WINM AI</span>
        <span className="text-[10px] text-muted-foreground leading-tight">Trading Bot</span>
      </div>
    </div>
  );
}
