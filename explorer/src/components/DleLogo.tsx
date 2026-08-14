export function DleLogo({
  size = 40,
  className = '',
}: {
  size?: number
  className?: string
}) {
  return (
    <img
      src="/dle-mark.png"
      alt=""
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className}`}
      aria-hidden
    />
  )
}
